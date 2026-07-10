/**
 * ContentJobService — the neutral async batch-install engine for content packs.
 *
 * A thin port of the core ExtensionJobService: same in-memory `_jobs` map, same
 * PHASE model (queued → installing → installed|failed), same per-job WS events and
 * getJob() poll fallback, same "one failure never aborts the batch" guarantee.
 *
 * MINUS the topological dependency planner — content packs have NO inter-item
 * capability deps (reader-3), so the plan collapses to "install each in requested
 * order," which is exactly what this loop does. Each item is delegated to
 * ContentInstallService.install(kind, id, versionSpec).
 *
 * Emits slidecast WS events `content:job_progress` / `content:job_complete`.
 */

import { randomUUID } from 'crypto';

const DEFAULT_JOB_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROGRESS_EVENT = 'content:job_progress';
const DEFAULT_COMPLETE_EVENT = 'content:job_complete';

const PHASE = {
  QUEUED: 'queued',
  INSTALLING: 'installing',
  INSTALLED: 'installed',
  FAILED: 'failed',
};

class ContentJobService {
  /**
   * @param {object} deps
   * @param {object}   deps.installService ContentInstallService
   * @param {Function} [deps.broadcast]    WS broadcaster (event, data)
   * @param {number}   [deps.jobTtlMs]     finished-job retention
   */
  constructor(deps = {}) {
    this.installService = deps.installService;
    this.broadcast = deps.broadcast || (() => {});
    this.jobTtlMs = deps.jobTtlMs ?? DEFAULT_JOB_TTL_MS;
    this._jobs = new Map();
  }

  /**
   * Start a batch install. Returns `{ jobId, total }` immediately and installs each
   * pick in the requested order (async), so the caller can poll/subscribe.
   *
   * @param {Array<{kind: string, id: string, versionSpec?: string}>} items
   * @param {object} [opts]
   * @param {string} [opts.progressEvent]
   * @param {string} [opts.completeEvent]
   * @returns {{ jobId: string, total: number }}
   */
  startJob(items, opts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error('startJob requires a non-empty items[] array');
      err.code = 'E_NO_ITEMS';
      throw err;
    }
    const progressEvent = opts.progressEvent || DEFAULT_PROGRESS_EVENT;
    const completeEvent = opts.completeEvent || DEFAULT_COMPLETE_EVENT;

    const jobId = randomUUID();
    const job = {
      jobId,
      total: items.length,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      progressEvent,
      completeEvent,
      items: items.map((it, index) => ({
        // `name` mirrors the id so the copied InstallProgress/CatalogCard (which key
        // on `name`) render unchanged.
        name: it.id,
        id: it.id,
        kind: it.kind,
        versionSpec: it.versionSpec || 'latest',
        index,
        phase: PHASE.QUEUED,
        error: null,
        code: null,
        version: null,
      })),
      results: null,
      promise: null,
    };
    this._jobs.set(jobId, job);

    // Run async — do NOT await. Keep the promise so callers/tests can settle it.
    job.promise = this._runBatch(job).catch((err) => {
      job.status = 'error';
      job.error = err.message;
    });

    return { jobId, total: job.total };
  }

  /**
   * Install each item in requested order. Every install is wrapped so a single
   * failure records `failed` and CONTINUES (never aborts the batch). @private
   */
  async _runBatch(job) {
    const results = [];
    for (const item of job.items) {
      this._transition(job, item, PHASE.INSTALLING);
      try {
        const result = await this.installService.install(item.kind, item.id, item.versionSpec);
        item.version = result?.version || item.versionSpec;
        this._transition(job, item, PHASE.INSTALLED);
        results.push({
          id: item.id, kind: item.kind, phase: PHASE.INSTALLED, version: item.version, action: result?.action,
        });
      } catch (err) {
        item.error = err.message;
        item.code = err.code || null;
        this._transition(job, item, PHASE.FAILED);
        results.push({
          id: item.id, kind: item.kind, phase: PHASE.FAILED, error: err.message, code: err.code || null,
        });
        // continue — one failure must NOT abort the batch.
      }
    }

    job.status = 'complete';
    job.finishedAt = Date.now();
    job.results = results;
    try { this.broadcast(job.completeEvent, { jobId: job.jobId, results }); } catch { /* WS optional */ }
    this._scheduleEviction(job.jobId);
    return { jobId: job.jobId, results };
  }

  /** Read a job's live progress (poll fallback for a down WS channel). */
  getJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      items: job.items.map((it) => ({
        name: it.name,
        id: it.id,
        kind: it.kind,
        index: it.index,
        phase: it.phase,
        error: it.error,
        code: it.code,
        version: it.version,
      })),
      results: job.results,
      summary: this._summarize(job),
    };
  }

  /** Await the terminal state of a batch (test/consumer helper). */
  async whenSettled(jobId) {
    const job = this._jobs.get(jobId);
    if (job && job.promise) await job.promise;
    return this.getJob(jobId);
  }

  /** Advance one item's phase and broadcast a progress event. @private */
  _transition(job, item, phase) {
    item.phase = phase;
    try {
      this.broadcast(job.progressEvent, {
        jobId: job.jobId,
        name: item.name,
        id: item.id,
        kind: item.kind,
        phase,
        error: item.error || undefined,
        index: item.index,
        total: job.total,
      });
    } catch { /* WS optional */ }
  }

  /** @private */
  _summarize(job) {
    let installed = 0;
    let failed = 0;
    let pending = 0;
    for (const it of job.items) {
      if (it.phase === PHASE.INSTALLED) installed += 1;
      else if (it.phase === PHASE.FAILED) failed += 1;
      else pending += 1;
    }
    return {
      installed, failed, pending, total: job.total,
    };
  }

  /** Evict a finished job after the retention TTL. @private */
  _scheduleEviction(jobId) {
    if (!this.jobTtlMs || this.jobTtlMs <= 0) return;
    const timer = setTimeout(() => { this._jobs.delete(jobId); }, this.jobTtlMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

export { ContentJobService, PHASE };
export default ContentJobService;
