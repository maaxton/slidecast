/**
 * RenderBridge.js — Main-thread IPC bridge to the render-worker child process.
 *
 * Manages:
 *   - Child process lifecycle (fork, respawn with backoff)
 *   - Priority job queue (high / normal, up to maxConcurrent in-flight)
 *   - Per-job timeout and cancellation
 *   - Health tracking from worker heartbeats
 *   - Degraded-mode detection when respawns are exhausted
 *
 * IPC protocol (see render-worker.js for full spec):
 *   Bridge → Worker: { type: 'render-element'|'render-slide'|'restart-browser'|'cancel'|'shutdown', ... }
 *   Worker → Bridge: { type: 'ready'|'done'|'error'|'health'|'progress', ... }
 */

import { EventEmitter } from 'events';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// ─── Constants ─────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isARM = process.arch === 'arm64' || process.arch === 'arm';

// Render-worker page-pool concurrency, sized to the host CPUs.
//
// History: a fixed 4 (#1152) let the 4–8 widget layers per tick overlap and kept
// one slow render from stalling the queue. But a fixed 4 over-subscribes small
// boxes: on a 2-vCPU appliance, 4 concurrent Chromium renders starve the app
// server that *serves* the render-element page each render loads, so page.goto
// blows the 20s budget → clients get retry_after → they re-fire → thrash spiral.
//
// Fix: scale to (cpus - 1) so a core is always left for the app/event loop,
// capped at 4. 2-vCPU → 1, 4-vCPU → 3, 8+ → 4. Tunable via the
// `render_max_concurrent` setting, the maxConcurrent ctor option, or
// RENDER_CONCURRENCY (raise it on dedicated render nodes with spare cores).
const CONCURRENCY_DEFAULT = (() => {
  let cpus = 2;
  try { cpus = os.cpus().length || 2; } catch { /* keep fallback */ }
  return Math.max(1, Math.min(4, cpus - 1));
})();
const MAX_CONCURRENT_ENV_DEFAULT = parseInt(
  process.env.RENDER_CONCURRENCY || String(CONCURRENCY_DEFAULT),
  10,
);
const TIMEOUT_MS = parseInt(process.env.RENDER_TIMEOUT_MS || '60000', 10);
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_WAIT_MS = 5_000;

const RESPAWN_BACKOFF_MS = [1_000, 2_000, 4_000]; // 1 s, 2 s, 4 s
const MAX_RESPAWNS = parseInt(process.env.RENDER_MAX_RESPAWNS || '3', 10);
const RESPAWN_STABILITY_WINDOW_MS = 60_000;

// Backpressure (#1161). When the render pool wedged on Apex, ~5,400 jobs had
// queued up in memory — every subsequent tick kept piling on. Cap it so
// runaway accumulation surfaces as a loud rejection instead of silent growth.
const MAX_QUEUE_DEPTH = parseInt(process.env.RENDER_MAX_QUEUE_DEPTH || '200', 10);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeJobId() {
  return crypto.randomUUID();
}

/**
 * Build a dedupe key from a render job. For render-element we key on
 * (cast, slide, element); for render-slide on (cast, slide). Jobs that
 * render raw HTML (dataUrl — warmup/preview) get unique keys (opaque hash).
 * Returns null when we don't have enough info to dedupe safely (e.g.
 * missing cast/slide), so the caller still files the job unconditionally.
 */
export function makeDedupeKey(type, payload) {
  if (!payload) return null;
  if (type === 'render-element') {
    if (payload.dataUrl) return null;
    if (payload.cast === undefined || payload.slide === undefined) return null;
    const el = payload.element === undefined ? '*' : payload.element;
    return `el|${payload.cast}|${payload.slide}|${el}`;
  }
  if (type === 'render-slide') {
    if (payload.cast === undefined || payload.slide === undefined) return null;
    return `slide|${payload.cast}|${payload.slide}`;
  }
  return null;
}

// ─── RenderBridge ──────────────────────────────────────────────────────────────

export class RenderBridge extends EventEmitter {
  /**
   * @param {{ logger?: { info: Function, warn: Function, error: Function, debug: Function } }} [options]
   */
  constructor(options = {}) {
    super();

    // Render-worker pool concurrency. Setting → ctor option → env → default,
    // then clamped to a CPU-safe ceiling of max(2, cpus-1):
    //  - Upper bound (cpus-1): a higher value — e.g. the migrated
    //    render_max_concurrent=4 — over-subscribes small boxes. On 2 vCPUs, 4
    //    concurrent Chromium renders starve the app server that serves the
    //    render-element page, so page.goto blows the 20s budget → retry thrash.
    //  - Floor of 2: pool=1 is head-of-line fragile — a single hung render (e.g.
    //    a widget that corrupts its render page) blocks the ONLY slot and stalls
    //    the whole pipeline. Keeping ≥2 slots leaves a free slot for everything
    //    else when one render is bad (paired with the per-element failure breaker
    //    in SlideImageRenderer so the bad render also fails fast).
    // The setting/env can only LOWER concurrency below the ceiling; raise it by
    // running on a node with more cores (or set RENDER_CONCURRENCY explicitly).
    const requested = Number.isFinite(options.maxConcurrent)
      ? options.maxConcurrent
      : MAX_CONCURRENT_ENV_DEFAULT;
    let cpus = 2;
    try { cpus = os.cpus().length || 2; } catch { /* keep fallback */ }
    const cpuCeil = Math.max(2, cpus - 1);
    this._maxConcurrent = Math.min(cpuCeil, Math.max(1, requested || 1));
    if (requested > cpuCeil) {
      // Surface the clamp so silent under-provisioning is observable.
      (options.logger || console).warn?.(
        `[RenderBridge] render concurrency requested=${requested} clamped to ${this._maxConcurrent} (cpus=${cpus}, ceiling=max(2,cpus-1)=${cpuCeil})`,
      );
    }

    this._logger = options.logger || {
      info: (...a) => console.log('[RenderBridge][INFO]', ...a),
      warn: (...a) => console.warn('[RenderBridge][WARN]', ...a),
      error: (...a) => console.error('[RenderBridge][ERROR]', ...a),
      debug: (...a) => console.debug('[RenderBridge][DEBUG]', ...a),
    };

    /** @type {import('child_process').ChildProcess | null} */
    this._child = null;
    this._ready = false;
    this._degraded = false;

    // Priority queues: each item is { id, type, payload, priority, resolve, reject, timer }
    /** @type {Array<Object>} */
    this._highQueue = [];
    /** @type {Array<Object>} */
    this._normalQueue = [];

    // Active (dispatched) jobs: Map<jobId, job>
    /** @type {Map<string, Object>} */
    this._activeJobs = new Map();

    // Dedupe: Map<dedupeKey, Promise<result>>. When a caller enqueues the
    // same (type, cast, slide, element) job that is already queued or in
    // flight, piggy-back onto the existing promise instead of filing a new
    // job. Prevents runaway queue growth when schedulers over-tick (#1161).
    /** @type {Map<string, Promise<Object>>} */
    this._inFlight = new Map();

    // Backpressure counters (exposed in getQueueDepth for monitoring).
    this._rejectedForDepth = 0;
    this._dedupedCount = 0;

    // Respawn tracking
    this._respawnCount = 0;
    this._respawnTimes = []; // timestamps of recent respawns within the window
    this._respawnTimer = null;
    // Single cancellable stability-reset timer (SL1). Each successful respawn
    // reschedules this ONE timer for STABILITY_WINDOW after the LAST respawn.
    // The old code scheduled a fresh unconditional reset per respawn, so an
    // early timer wiped _respawnTimes before the count reached MAX_RESPAWNS —
    // the breaker could never trip. Now the reset only fires once a full
    // window has elapsed with no respawn, and prunes rather than blind-clears.
    this._resetTimer = null;

    // Shutdown flag — prevents _handleExit() from respawning after deliberate shutdown
    this._shuttingDown = false;

    // Latest health report from worker
    this._health = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fork render-worker.js and wait for the `ready` signal (max 30 s).
   * @returns {Promise<void>}
   */
  async start() {
    if (this._child || this._respawnTimer) {
      this._logger.warn('start() called but spawn already in progress — ignoring');
      return;
    }

    this._shuttingDown = false;
    this._logger.info('Starting render-worker child process');
    await this._spawnWorker();
  }

  /**
   * Graceful shutdown: send `shutdown`, wait up to 5 s, then kill.
   * @returns {Promise<void>}
   */
  async shutdown() {
    this._shuttingDown = true;
    this._logger.info('Shutting down RenderBridge');

    // Stop any pending respawn + stability-reset timer
    if (this._respawnTimer) {
      clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
      this._resetTimer = null;
    }

    const child = this._child;
    if (!child) return;

    // Reject all queued and active jobs
    this._drainQueues(new Error('RenderBridge shutting down'));

    return new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        this._logger.warn('Worker did not exit in time — sending SIGKILL');
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolve();
      }, SHUTDOWN_WAIT_MS);

      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try {
        child.send({ type: 'shutdown' });
      } catch (err) {
        this._logger.error(`Failed to send shutdown: ${err.message}`);
        try { child.kill(); } catch { /* ignore */ }
      }
    });
  }

  /**
   * Queue a render job and return a Promise that resolves with the result.
   * @param {'render-element'|'render-slide'} type
   * @param {Object} payload  — forwarded as `job` to the worker
   * @param {'high'|'normal'} [priority='normal']
   * @returns {Promise<Object>}
   */
  render(type, payload, priority = 'normal') {
    if (this._degraded) {
      return Promise.reject(new Error('RenderBridge is degraded — render worker unavailable'));
    }

    // Dedupe: if an equivalent job is already queued or in flight, reuse
    // its promise instead of enqueuing a second copy (#1161).
    const dedupeKey = makeDedupeKey(type, payload);
    if (dedupeKey && this._inFlight.has(dedupeKey)) {
      this._dedupedCount++;
      this._logger.debug(`Deduped job key=${dedupeKey} — reusing in-flight promise`);
      return this._inFlight.get(dedupeKey);
    }

    // Backpressure: refuse enqueue when queue depth would exceed the cap.
    // Active jobs aren't counted — they're already running. Caller gets a
    // clear, logged rejection instead of silent queue growth (#1161).
    const queuedNow = this._highQueue.length + this._normalQueue.length;
    if (queuedNow >= MAX_QUEUE_DEPTH) {
      this._rejectedForDepth++;
      const msg = `RenderBridge backpressure — queue depth ${queuedNow} >= ${MAX_QUEUE_DEPTH} (dropping job type=${type})`;
      this._logger.warn(msg);
      return Promise.reject(new Error(msg));
    }

    const promise = new Promise((resolve, reject) => {
      const id = makeJobId();
      const job = {
        id, type, payload, priority, dedupeKey, resolve, reject, timer: null,
      };

      if (priority === 'high') {
        this._highQueue.push(job);
      } else {
        this._normalQueue.push(job);
      }

      this._logger.debug(`Queued job ${id} type=${type} priority=${priority}${dedupeKey ? ` key=${dedupeKey}` : ''}`);
      this._dispatch();
    });

    if (dedupeKey) {
      this._inFlight.set(dedupeKey, promise);
      // Clear the dedupe slot when the promise settles (success or failure).
      promise.finally(() => {
        if (this._inFlight.get(dedupeKey) === promise) {
          this._inFlight.delete(dedupeKey);
        }
      }).catch(() => { /* already surfaced to the caller */ });
    }

    return promise;
  }

  /**
   * Convenience: render a single element.
   * @param {Object} payload
   * @param {'high'|'normal'} [priority='normal']
   */
  renderElement(payload, priority = 'normal') {
    return this.render('render-element', payload, priority);
  }

  /**
   * Convenience: render a full slide (all elements in one page load).
   * @param {Object} payload
   * @param {'high'|'normal'} [priority='normal']
   */
  renderSlide(payload, priority = 'normal') {
    return this.render('render-slide', payload, priority);
  }

  /**
   * Returns the latest health report from the worker, or null if none received yet.
   * @returns {Object|null}
   */
  getHealth() {
    return this._health;
  }

  /**
   * @returns {boolean}
   */
  isReady() {
    return this._ready && !this._degraded;
  }

  /**
   * Ask the worker to restart its Chromium browser instance.
   * @returns {Promise<void>}
   */
  restartBrowser() {
    if (!this._child || !this._ready) {
      return Promise.reject(new Error('Worker is not ready'));
    }

    return new Promise((resolve, reject) => {
      // restart-browser uses a dedicated jobId so we can track it
      const jobId = makeJobId();

      const timer = setTimeout(() => {
        this._activeJobs.delete(jobId);
        reject(new Error('restartBrowser timed out'));
      }, TIMEOUT_MS);

      this._activeJobs.set(jobId, {
        id: jobId,
        type: 'restart-browser',
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
        timer,
      });

      try {
        this._child.send({ type: 'restart-browser', jobId });
      } catch (err) {
        clearTimeout(timer);
        this._activeJobs.delete(jobId);
        reject(err);
      }
    });
  }

  /**
   * @returns {{ high: number, normal: number, active: number }}
   */
  getQueueDepth() {
    return {
      high: this._highQueue.length,
      normal: this._normalQueue.length,
      active: this._activeJobs.size,
      inFlightKeys: this._inFlight.size,
      rejectedForDepth: this._rejectedForDepth,
      dedupedCount: this._dedupedCount,
      maxQueueDepth: MAX_QUEUE_DEPTH,
    };
  }

  // ─── Child process management ───────────────────────────────────────────────

  /**
   * Fork render-worker.js and set up message + exit handlers.
   * Resolves once the `ready` signal is received.
   */
  async _spawnWorker() {
    this._shuttingDown = false;
    const workerPath = path.join(__dirname, 'render-worker.js');

    this._logger.info(`Forking render-worker: ${workerPath}`);

    // Propagate the effective pool size to the worker so render-worker's
    // POOL_SIZE (page pool) matches the bridge's MAX_CONCURRENT (#1152).
    // Without this, the bridge will dispatch N jobs while the worker only
    // has 1 page — acquirePage serializes them, negating the pool bump.
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], // stderr piped, ipc for process.send()
      env: {
        ...process.env,
        RENDER_PAGE_POOL_SIZE: String(this._maxConcurrent),
        RENDER_CONCURRENCY: String(this._maxConcurrent),
      },
    });

    child.stderr.on('data', (chunk) => {
      // Worker writes its own structured logs to stderr; relay at debug level
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this._logger.debug(`[worker stderr] ${line}`);
      }
    });

    this._child = child;

    child.on('message', (msg) => this._handleMessage(msg));
    child.on('exit', (code, signal) => this._handleExit(code, signal));
    child.on('error', (err) => this._logger.error(`Child process error: ${err.message}`));

    // Wait for `ready` with a timeout
    await new Promise((resolve, reject) => {
      const readyTimer = setTimeout(() => {
        // Child hung without ever sending `ready` — child.on('exit') will never
        // fire for a hung-but-alive process, and start() self-guards on
        // this._child, so we must kill + null it here to allow a future retry.
        if (this._child === child) {
          this._child.kill();
          this._child = null;
        }
        reject(new Error('render-worker did not send `ready` within 30 s'));
      }, READY_TIMEOUT_MS);

      this.once('ready', () => {
        clearTimeout(readyTimer);
        resolve();
      });
    });
  }

  // ─── IPC message handler ────────────────────────────────────────────────────

  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'ready':
        this._ready = true;
        this._logger.info('render-worker is ready');
        this.emit('ready');
        this._dispatch(); // drain any pre-queued jobs
        break;

      case 'health':
        this._health = {
          chromium: msg.chromium,
          memoryMB: msg.memoryMB,
          activeRenders: msg.activeRenders,
          rendersCompleted: msg.rendersCompleted,
          uptime: msg.uptime,
          receivedAt: Date.now(),
        };
        break;

      case 'done': {
        const job = this._activeJobs.get(msg.jobId);
        if (!job) break;
        this._activeJobs.delete(msg.jobId);
        clearTimeout(job.timer);

        // Build result: for render-slide `results` array; for render-element `outputPath`
        const result = msg.results !== undefined
          ? { results: msg.results }
          : { outputPath: msg.outputPath };

        job.resolve(result);
        this._dispatch();
        break;
      }

      case 'error': {
        const job = this._activeJobs.get(msg.jobId);
        if (!job) break;
        this._activeJobs.delete(msg.jobId);
        clearTimeout(job.timer);
        job.reject(new Error(msg.message || 'render-worker reported an error'));
        this._dispatch();
        break;
      }

      case 'progress':
        // Forward progress events to callers who listen on the bridge
        this.emit('progress', msg);
        break;

      default:
        this._logger.warn(`Unknown IPC message type: ${msg.type}`);
    }
  }

  // ─── Exit / respawn ─────────────────────────────────────────────────────────

  _handleExit(code, signal) {
    if (this._shuttingDown) {
      this._logger.info('Shutdown in progress — skipping respawn');
      this._child = null;
      return;
    }

    const wasReady = this._ready;
    this._ready = false;
    this._child = null;

    this._logger.warn(`render-worker exited (code=${code}, signal=${signal})`);

    // Reject all active jobs — they cannot complete now
    for (const [, job] of this._activeJobs) {
      clearTimeout(job.timer);
      job.reject(new Error('render-worker exited unexpectedly'));
    }
    this._activeJobs.clear();

    if (this._degraded) {
      this._logger.warn('Already in degraded mode — not attempting respawn');
      return;
    }

    // Prune respawn timestamps outside the stability window
    const now = Date.now();
    this._respawnTimes = this._respawnTimes.filter(
      (t) => now - t < RESPAWN_STABILITY_WINDOW_MS,
    );

    if (this._respawnTimes.length >= MAX_RESPAWNS) {
      this._logger.error(
        `render-worker crashed ${MAX_RESPAWNS} times within ${RESPAWN_STABILITY_WINDOW_MS / 1000}s — entering degraded mode`,
      );
      this._degraded = true;
      this._drainQueues(new Error('RenderBridge degraded — too many worker crashes'));
      this.emit('degraded');
      return;
    }

    const attempt = this._respawnTimes.length; // 0-based → index into backoff array
    const delayMs = RESPAWN_BACKOFF_MS[Math.min(attempt, RESPAWN_BACKOFF_MS.length - 1)];

    this._logger.info(
      `Scheduling respawn attempt ${attempt + 1} in ${delayMs} ms`,
    );

    this._respawnTimer = setTimeout(async () => {
      this._respawnTimer = null;
      this._respawnTimes.push(Date.now());
      try {
        await this._spawnWorker();
        this._logger.info('render-worker respawned successfully');

        // Schedule the stability counter reset via a SINGLE cancellable timer.
        // Reschedule it on every respawn so it only fires once a full window
        // has elapsed since the LAST respawn; re-check timestamps at fire time
        // instead of blindly clearing, so it can never wipe a still-active
        // crash burst (SL1).
        if (this._resetTimer) { clearTimeout(this._resetTimer); }
        this._resetTimer = setTimeout(() => {
          this._resetTimer = null;
          const cutoff = Date.now() - RESPAWN_STABILITY_WINDOW_MS;
          this._respawnTimes = this._respawnTimes.filter((t) => t >= cutoff);
          if (this._respawnTimes.length === 0) {
            this._logger.debug('Respawn stability window elapsed — counter reset');
          }
        }, RESPAWN_STABILITY_WINDOW_MS);
      } catch (err) {
        this._logger.error(`Respawn failed: ${err.message}`);
        // _handleExit will be called when the new child exits, continuing the loop
      }
    }, delayMs);
  }

  // ─── Job dispatcher ─────────────────────────────────────────────────────────

  /**
   * Pull jobs from the queues and send them to the worker, up to maxConcurrent.
   */
  _dispatch() {
    if (!this._ready || !this._child) return;

    while (this._activeJobs.size < this._maxConcurrent) {
      // Always prefer high-priority queue
      const job = this._highQueue.shift() || this._normalQueue.shift();
      if (!job) break;

      // Arm the per-job timeout
      job.timer = setTimeout(() => {
        if (!this._activeJobs.has(job.id)) return;
        this._activeJobs.delete(job.id);
        this._logger.warn(`Job ${job.id} timed out after ${TIMEOUT_MS} ms`);
        job.reject(new Error(`Render job timed out after ${TIMEOUT_MS} ms`));

        // Notify worker (no-op in worker, but good hygiene)
        try {
          this._child?.send({ type: 'cancel', jobId: job.id });
        } catch { /* ignore */ }

        this._dispatch();
      }, TIMEOUT_MS);

      this._activeJobs.set(job.id, job);

      try {
        this._child.send({ type: job.type, jobId: job.id, job: job.payload });
        this._logger.debug(`Dispatched job ${job.id} type=${job.type}`);
      } catch (err) {
        clearTimeout(job.timer);
        this._activeJobs.delete(job.id);
        job.reject(new Error(`Failed to send job to worker: ${err.message}`));
      }
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Reject all queued (not yet dispatched) jobs with the given error.
   * @param {Error} err
   */
  _drainQueues(err) {
    for (const job of [...this._highQueue, ...this._normalQueue]) {
      clearTimeout(job.timer);
      job.reject(err);
    }
    this._highQueue = [];
    this._normalQueue = [];

    // Also reject active jobs if called during shutdown/degraded
    for (const [, job] of this._activeJobs) {
      clearTimeout(job.timer);
      job.reject(err);
    }
    this._activeJobs.clear();
  }
}

export default RenderBridge;
