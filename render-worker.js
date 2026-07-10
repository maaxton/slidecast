/**
 * render-worker.js — Child process that owns the Playwright/Chromium instance.
 *
 * Spawned by the render bridge (future RenderBridge.js). Communicates via IPC.
 * Zero extension dependencies — only Node.js builtins + Playwright.
 *
 * IPC message protocol:
 *   Parent → Worker:
 *     { type: 'render-element', jobId, job }
 *     { type: 'render-slide', jobId, job }
 *     { type: 'restart-browser' }
 *     { type: 'cancel', jobId }    — currently no-op; timeout handled by bridge
 *     { type: 'shutdown' }
 *
 *   Worker → Parent:
 *     { type: 'ready' }
 *     { type: 'done', jobId, outputPath }
 *     { type: 'done', jobId, results }  — for render-slide (array of element results)
 *     { type: 'error', jobId, message }
 *     { type: 'health', chromium, memoryMB, activeRenders, rendersCompleted, uptime }
 */

import path from 'path';
import fs from 'fs/promises';
import {
  existsSync, readdirSync, rmSync, statSync,
} from 'fs';
import os from 'os';

import { safeScreenshot, getScreenshotTimeoutMs } from './render-worker-screenshot.js';
import { buildLaunchOptions } from './render-browser-config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const isARM = process.arch === 'arm64' || process.arch === 'arm';

// RenderBridge forwards the effective pool size via RENDER_PAGE_POOL_SIZE, so
// this default only applies when the worker is forked without that env set
// (tests / standalone). Scale to (cpus - 1), capped at 4, to avoid over-
// subscribing small boxes — see RenderBridge CONCURRENCY_DEFAULT for rationale.
const CONCURRENCY_DEFAULT = (() => {
  let cpus = 2;
  try { cpus = os.cpus().length || 2; } catch { /* keep fallback */ }
  return Math.max(1, Math.min(4, cpus - 1));
})();
const POOL_SIZE = parseInt(process.env.RENDER_PAGE_POOL_SIZE || process.env.RENDER_CONCURRENCY || String(CONCURRENCY_DEFAULT), 10);
const MEMORY_LIMIT_MB = parseInt(process.env.RENDER_MEMORY_LIMIT_MB || '500', 10);
const HEALTH_INTERVAL_MS = 5000;
// SL11: number of consecutive over-limit health ticks after which the browser
// is force-restarted even while renders are in flight. The idle-only restart
// never fired on a box under sustained load (activeRenders never hit 0), so RSS
// grew unbounded. 6 ticks × 5s ≈ 30s sustained over-limit before forcing.
const MEMORY_FORCE_RESTART_TICKS = parseInt(
  process.env.RENDER_MEMORY_FORCE_RESTART_TICKS || '6',
  10,
);

// See render-worker-screenshot.js for the safeScreenshot() helper used below —
// bounded-wait screenshot with pre-screenshot window.stop() to unblock the
// render pool when a widget HTML page has a long-running fetch/SSE (#1154).

// Browser flags + executable resolution live in render-browser-config.js
// (shared with benchmarks/warm-page-bench.js — #1541). WAIVEO_VM_MODE handling
// included there.

// ─── State ────────────────────────────────────────────────────────────────────

let chromiumModule = null; // playwright.chromium
let browser = null; // Playwright Browser instance
let persistentContext = null; // Single persistent BrowserContext

/** @type {Array<{ page: import('playwright').Page, busy: boolean, consecutiveTimeouts: number } | null>} */
const pagePool = new Array(POOL_SIZE).fill(null);

// Per-slot consecutive-inner-timeout detector (#1161 round 2). If the same
// slot hits two inner timeouts without a success in between, the persistent
// context is treated as poisoned unconditionally — regardless of whether
// the error string matched isContextPoisoningError — and the whole context
// is discarded and rebuilt. Prevents a wedged slot from silently
// coalescing every subsequent dedupe onto a hung job.
const CONSECUTIVE_TIMEOUT_THRESHOLD = 2;

// #1164 round 2: acquirePage pool-starvation detector. If acquirePage
// bails on the ACQUIRE_TIMEOUT_MS bound repeatedly it means every slot is
// wedged — bridge-outer timeouts have left the worker with zero usable
// pool capacity even though the inner-timeout/poisoning paths never
// fired. After N consecutive acquire timeouts, force a full context
// rebuild unconditionally so follow-up jobs (including dedupe-coalesced
// element-mode renders like current-weather) don't keep timing out at
// exactly ACQUIRE_TIMEOUT_MS for every caller in line.
const ACQUIRE_TIMEOUT_REBUILD_THRESHOLD = 2;
let consecutiveAcquireTimeouts = 0;

let activeRenders = 0;
let rendersCompleted = 0;
const startTime = Date.now();
let isShuttingDown = false;
let browserRestartInProgress = false;
// Single-flight guard for launchBrowser (minor: double-launch race). Concurrent
// callers (crash recovery + ensurePersistentContext) could otherwise each spawn
// a Chromium and leak one. In-flight callers share this promise.
let browserLaunchPromise = null;

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(level, ...args) {
  const msg = `[render-worker][${level.toUpperCase()}] ${args.join(' ')}`;
  process.stderr.write(`${msg}\n`);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

function send(msg) {
  if (process.send) {
    process.send(msg);
  }
}

// ─── Metrics helpers ──────────────────────────────────────────────────────────

function getMemoryMB() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function getUptime() {
  return Math.round((Date.now() - startTime) / 1000);
}

// ─── Playwright temp dir cleanup ──────────────────────────────────────────────

function cleanPlaywrightTempDirs(maxAgeMs) {
  const tmpDir = os.tmpdir();
  let entries;
  try {
    entries = readdirSync(tmpDir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (
      entry.startsWith('playwright-artifacts-')
      || entry.startsWith('playwright_chromiumdev_profile-')
    ) {
      const fullPath = path.join(tmpDir, entry);
      try {
        if (maxAgeMs !== undefined) {
          let mtime = 0;
          try { mtime = statSync(fullPath).mtimeMs; } catch { /* ignore */ }
          if (now - mtime < maxAgeMs) continue;
        }
        rmSync(fullPath, { recursive: true, force: true });
        log('debug', `Cleaned Playwright temp dir: ${entry}`);
      } catch { /* already gone */ }
    }
  }
}

// ─── Browser lifecycle ────────────────────────────────────────────────────────

async function launchBrowser() {
  // Coalesce concurrent launches so only one Chromium is ever spawned.
  if (browserLaunchPromise) { return browserLaunchPromise; }
  if (browser && browser.isConnected()) { return browser; }

  browserLaunchPromise = (async () => {
    if (!chromiumModule) {
      const playwright = await import('playwright');
      chromiumModule = playwright.chromium;
      log('info', 'Playwright loaded');
    }

    const launchOptions = buildLaunchOptions();

    if (launchOptions.executablePath) {
      log('info', `Using system Chromium at ${launchOptions.executablePath}`);
    } else {
      log('info', 'System Chromium not found, using bundled Playwright Chromium');
    }

    browser = await chromiumModule.launch(launchOptions);
    log('info', `Browser launched (${isARM ? 'ARM' : 'x86'}, pool size ${POOL_SIZE})`);

    // Listen for crashes
    browser.on('disconnected', () => {
      if (!isShuttingDown) {
        log('warn', 'Browser disconnected unexpectedly — scheduling crash recovery');
        handleBrowserCrash();
      }
    });

    return browser;
  })();

  try {
    return await browserLaunchPromise;
  } finally {
    browserLaunchPromise = null;
  }
}

async function handleBrowserCrash() {
  if (browserRestartInProgress) return;
  browserRestartInProgress = true;
  try {
    log('warn', 'Handling browser crash — rebuilding...');
    // Null out the pool slots (pages are gone with the browser)
    for (let i = 0; i < pagePool.length; i++) {
      pagePool[i] = null;
    }
    persistentContext = null;
    browser = null;

    await launchBrowser();
    await buildPagePool();
    log('info', 'Browser crash recovery complete');
  } catch (err) {
    log('error', `Browser crash recovery failed: ${err.message}`);
  } finally {
    browserRestartInProgress = false;
  }
}

async function restartBrowser() {
  if (isShuttingDown) {
    log('info', 'Shutdown in progress — skipping restart');
    return;
  }
  if (browserRestartInProgress) {
    log('info', 'Browser restart already in progress — skipping');
    return;
  }
  browserRestartInProgress = true;
  try {
    log('info', 'Manual browser restart requested');

    // Drain the pool
    for (let i = 0; i < pagePool.length; i++) {
      const slot = pagePool[i];
      if (slot) {
        try { await slot.page.close(); } catch { /* ignore */ }
        pagePool[i] = null;
      }
    }

    if (persistentContext) {
      try { await persistentContext.close(); } catch { /* ignore */ }
      persistentContext = null;
    }

    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
      browser = null;
    }

    await launchBrowser();
    await buildPagePool();
    log('info', 'Browser restarted successfully');
  } finally {
    browserRestartInProgress = false;
  }
}

// ─── Persistent context ───────────────────────────────────────────────────────

async function ensurePersistentContext() {
  if (persistentContext && persistentContext.browser()?.isConnected()) {
    return persistentContext;
  }

  if (!browser || !browser.isConnected()) {
    await launchBrowser();
  }

  persistentContext = await browser.newContext({ deviceScaleFactor: 1 });
  log('debug', 'Created persistent browser context');
  return persistentContext;
}

// ─── Page pool ────────────────────────────────────────────────────────────────

async function buildPagePool() {
  // #1164: retry failed slots. During discardContextAndRebuild racing with
  // in-flight renders, newPage() can throw "Target page, context or browser
  // has been closed" on some slots even after a fresh context is created —
  // the freshly-closed context reference inside Playwright's protocol
  // channel lingers briefly. Before #1164 those errors were swallowed with
  // the pool permanently short by N slots; future renders serialized onto
  // the 1 surviving slot and the next failure re-poisoned it, producing
  // permanent pool starvation that wedged single-element rerender requests
  // (e.g. Current Weather) indefinitely despite the render PAGE being OK.
  const PAGE_POOL_RETRIES = 3;
  const PAGE_POOL_RETRY_DELAY_MS = 250;
  for (let attempt = 0; attempt < PAGE_POOL_RETRIES; attempt++) {
    await ensurePersistentContext();
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!pagePool[i]) {
        try {
          const page = await persistentContext.newPage();
          pagePool[i] = { page, busy: false, consecutiveTimeouts: 0 };
          log('debug', `Pool slot ${i} created (attempt ${attempt + 1})`);
        } catch (err) {
          log(
            attempt === PAGE_POOL_RETRIES - 1 ? 'error' : 'warn',
            `Failed to create pool page ${i} (attempt ${attempt + 1}/${PAGE_POOL_RETRIES}): ${err.message}`,
          );
          // If the context itself is already dead, tear it down so the next
          // attempt re-creates it from scratch via ensurePersistentContext.
          if (/Target page, context or browser has been closed/i.test(String(err && err.message))) {
            try { await persistentContext?.close(); } catch { /* ignore */ }
            persistentContext = null;
          }
        }
      }
    }
    const missing = pagePool.filter((s) => !s).length;
    if (missing === 0) return;
    log('warn', `buildPagePool: ${missing}/${POOL_SIZE} slots still empty after attempt ${attempt + 1} — retrying`);
    await new Promise((r) => setTimeout(r, PAGE_POOL_RETRY_DELAY_MS));
  }
  const stillMissing = pagePool.filter((s) => !s).length;
  if (stillMissing > 0) {
    log('error', `buildPagePool: gave up with ${stillMissing}/${POOL_SIZE} slots empty — renders will serialize on survivors`);
  }
}

/**
 * Acquire a free page slot from the pool.
 * Resolves when a slot becomes available (polls every 50ms).
 * @returns {Promise<number>} slot index
 */
function acquirePage() {
  // #1164: bounded wait. Previously this polled forever — if all pool slots
  // were busy (or the pool was permanently short from a failed
  // discardContextAndRebuild), every subsequent renderElement call would
  // sit here indefinitely and the worker would never reply `done`/`error`
  // for the bridge job, producing the wedged-queue symptom on the Current
  // Weather element. Bound to RENDER_ACQUIRE_TIMEOUT_MS so the caller sees
  // a real error, surfaces it to the bridge, and lets the pool recover.
  const ACQUIRE_TIMEOUT_MS = parseInt(
    process.env.RENDER_ACQUIRE_TIMEOUT_MS || '25000',
    10,
  );
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
    function tryAcquire() {
      for (let i = 0; i < pagePool.length; i++) {
        if (pagePool[i] && !pagePool[i].busy) {
          pagePool[i].busy = true;
          return resolve(i);
        }
      }
      if (Date.now() >= deadline) {
        const occupied = pagePool.filter((s) => s && s.busy).length;
        const empty = pagePool.filter((s) => !s).length;
        return reject(new Error(
          `RenderWorker.acquirePage timeout after ${ACQUIRE_TIMEOUT_MS}ms `
          + `(pool: ${occupied} busy, ${empty} empty, size ${pagePool.length})`,
        ));
      }
      setTimeout(tryAcquire, 50);
    }
    tryAcquire();
  });
}

/**
 * Return a page slot to the pool.
 * @param {number} slotIndex
 */
function releasePage(slotIndex) {
  if (pagePool[slotIndex]) {
    pagePool[slotIndex].busy = false;
  }
}

/**
 * Discard the persistent browser context entirely and rebuild the page pool.
 * Used when a job fails in a way that suggests context-level poisoning
 * (screenshot timeouts, page hangs) — per #1161, a reused context with
 * leaked workers / pending network can poison every new page spawned from it.
 *
 * Close all pool pages, close the context, null everything, then let the
 * next acquire / buildPagePool rebuild from scratch with a fresh context.
 */
async function discardContextAndRebuild(reason) {
  if (browserRestartInProgress) {
    log('debug', `discardContextAndRebuild skipped (restart in progress): ${reason}`);
    return;
  }
  browserRestartInProgress = true;
  try {
    log('warn', `Discarding browser context — ${reason}`);
    for (let i = 0; i < pagePool.length; i++) {
      const slot = pagePool[i];
      if (slot) {
        try { await slot.page.close({ runBeforeUnload: false }); } catch { /* ignore */ }
      }
      pagePool[i] = null;
    }
    if (persistentContext) {
      try { await persistentContext.close(); } catch { /* ignore */ }
      persistentContext = null;
    }
    await ensurePersistentContext();
    await buildPagePool();
    log('info', 'Browser context rebuilt — pool restored');
  } catch (err) {
    log('error', `discardContextAndRebuild failed: ${err.message}`);
  } finally {
    browserRestartInProgress = false;
  }
}

/**
 * Detect whether an error suggests the browser context is poisoned and
 * should be rebuilt wholesale rather than just replacing one page.
 */
export function isContextPoisoningError(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  // Playwright screenshot / navigation timeouts; target closed; frame detached.
  return (
    /Timeout \d+ms exceeded/i.test(msg)
    || /page\.screenshot/i.test(msg)
    || /Target page, context or browser has been closed/i.test(msg)
    || /frame was detached/i.test(msg)
    || /Execution context was destroyed/i.test(msg)
    // Our own wall-clock inner-timeout wrapper (#1161 round 2) — Playwright
    // sometimes hangs page.goto / waitForFunction WITHOUT firing its own
    // timeout (persistent-context protocol channel poisoned). bailAfter()
    // throws this error so we always route to context rebuild.
    || /RenderWorker\.innerTimeout/.test(msg)
  );
}

/**
 * Wall-clock racing timeout (#1161 round 2). Playwright's own timeouts on
 * goto / waitForFunction / setViewportSize can fail to fire when the
 * persistent context's protocol channel is poisoned — the op hangs
 * silently and the outer RenderBridge timer fires instead, leaving the
 * slot marked busy and a queue of dedup-coalesced jobs stuck on the same
 * hung promise. bailAfter guarantees a reject from Node's own timer.
 *
 * @param {number} ms
 * @param {string} step  — e.g. 'goto', 'waitForRenderReady', 'screenshot'
 * @param {number} slotIndex
 * @returns {{ promise: Promise<never>, cancel: () => void }}
 */
export function bailAfter(ms, step, slotIndex) {
  let timer;
  const promise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`RenderWorker.innerTimeout slot=${slotIndex} step=${step} after ${ms}ms`));
    }, ms);
    if (timer.unref) timer.unref();
  });
  return {
    promise,
    cancel: () => { if (timer) clearTimeout(timer); },
  };
}

/**
 * Race a Playwright op against a wall-clock timer. If the timer wins,
 * throws a RenderWorker.innerTimeout error that isContextPoisoningError
 * matches, forcing a full context rebuild.
 */
export async function raceWithTimeout(op, ms, step, slotIndex) {
  const bail = bailAfter(ms, step, slotIndex);
  try {
    return await Promise.race([op, bail.promise]);
  } finally {
    bail.cancel();
  }
}

/**
 * Replace a crashed/broken page in the pool with a fresh one.
 * If the error indicates the persistent context itself is poisoned
 * (e.g. a bounded-timeout screenshot failure), discard the context and
 * rebuild the entire pool — a fresh page spawned from a poisoned context
 * inherits the broken state (#1161).
 * @param {number} slotIndex
 * @param {Error} [err]
 */
async function replacePage(slotIndex, err) {
  if (isContextPoisoningError(err)) {
    await discardContextAndRebuild(
      `context-poisoning error on slot ${slotIndex}: ${err && err.message}`,
    );
    return;
  }

  pagePool[slotIndex] = null;
  try {
    await ensurePersistentContext();
    const page = await persistentContext.newPage();
    pagePool[slotIndex] = { page, busy: false, consecutiveTimeouts: 0 };
    log('debug', `Pool slot ${slotIndex} replaced`);
  } catch (err2) {
    log('error', `Failed to replace pool page ${slotIndex}: ${err2.message}`);
    // Leave slot null — acquirePage will skip it; next buildPagePool call will fill it
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────

/**
 * Render a single element to a PNG file.
 * Job shape:
 *   { outputPath, baseUrl, cast, slide, element, width, height, timeout }
 *   For raw HTML rendering (background): { outputPath, dataUrl, width, height, timeout }
 */
async function renderElement(job) {
  const {
    outputPath,
    baseUrl,
    cast,
    slide,
    element,
    contextOverrides,
    dataUrl,
    width = 100,
    height = 100,
    timeout = parseInt(process.env.RENDER_TIMEOUT_MS || '60000', 10),
  } = job;

  const id = element !== undefined ? element : (dataUrl ? 'data-url' : '?');
  const t0 = Date.now();

  let slotIndex;
  try {
    slotIndex = await acquirePage();
    consecutiveAcquireTimeouts = 0;
  } catch (acquireErr) {
    consecutiveAcquireTimeouts += 1;
    log('warn', `renderElement acquirePage timeout (${consecutiveAcquireTimeouts}/${ACQUIRE_TIMEOUT_REBUILD_THRESHOLD}) for element=${id}: ${acquireErr.message}`);
    if (consecutiveAcquireTimeouts >= ACQUIRE_TIMEOUT_REBUILD_THRESHOLD) {
      consecutiveAcquireTimeouts = 0;
      discardContextAndRebuild(
        `acquirePage hit ${ACQUIRE_TIMEOUT_REBUILD_THRESHOLD} consecutive timeouts — pool starved, forcing rebuild`,
      ).catch((e) => log('error', `rebuild-after-acquire-timeout failed: ${e.message}`));
    }
    throw acquireErr;
  }
  const slot = pagePool[slotIndex];

  try {
    activeRenders++;

    // Inner Playwright timeouts are bounded strictly tighter than the bridge's
    // outer per-job timeout (#1161). Every op is wrapped in a wall-clock
    // Promise.race so a poisoned-context hang cannot outlive the inner budget.
    const innerTimeout = Math.min(
      parseInt(process.env.RENDER_INNER_TIMEOUT_MS || '20000', 10),
      Math.max(1, timeout - 5000),
    );

    // Set viewport to element dimensions
    const tViewport0 = Date.now();
    await raceWithTimeout(
      slot.page.setViewportSize({ width, height }),
      innerTimeout,
      'setViewportSize',
      slotIndex,
    );
    const tViewport = Date.now() - tViewport0;

    // Navigate to render URL — direct cast/slide params, or a data: URL for raw HTML.
    let url;
    if (cast !== undefined && slide !== undefined) {
      url = `${baseUrl}/api/extensions/slidecast/protocol/render-element?cast=${encodeURIComponent(cast)}&slide=${encodeURIComponent(slide)}`;
      if (element !== undefined) {
        url += `&element=${encodeURIComponent(element)}`;
      }
      if (contextOverrides && typeof contextOverrides === 'object') {
        for (const [k, v] of Object.entries(contextOverrides)) {
          if (v !== undefined && v !== null) {
            url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
          }
        }
      }
    } else if (dataUrl) {
      url = dataUrl;
    } else {
      throw new Error('render-element job requires cast+slide or dataUrl');
    }
    const tNav0 = Date.now();
    await raceWithTimeout(
      slot.page.goto(url, { waitUntil: 'domcontentloaded', timeout: innerTimeout }),
      innerTimeout,
      'goto',
      slotIndex,
    );
    const tNav = Date.now() - tNav0;

    // Wait for renderReady signal
    const tReady0 = Date.now();
    await raceWithTimeout(
      slot.page.waitForFunction(
        () => document.body.dataset.renderReady === 'true',
        { timeout: innerTimeout },
      ),
      innerTimeout,
      'waitForRenderReady',
      slotIndex,
    );
    const tReady = Date.now() - tReady0;

    // Check for render errors reported by the page. Bounded (SL6): an
    // unguarded evaluate on a poisoned protocol channel hangs and holds the
    // pool slot until the outer bridge timeout, which can't free it.
    const renderError = await raceWithTimeout(
      slot.page.evaluate(() => document.body.dataset.renderError || ''),
      innerTimeout,
      'readRenderError',
      slotIndex,
    );
    if (renderError) {
      log('warn', `Page reported render error for cast=${cast} slide=${slide} element=${element}: ${renderError}`);
    }

    // Screenshot the element. Uses bounded timeout + window.stop() to avoid
    // hanging on pending network activity (see safeScreenshot comment) — #1154.
    // One bounded retry on capture stall — see renderSlide() (#1654).
    const tShot0 = Date.now();
    let buffer;
    try {
      buffer = await safeScreenshot(slot.page, {
        type: 'png',
        omitBackground: true,
      });
    } catch (shotErr) {
      if (!/Timeout \d+ms exceeded/i.test(String(shotErr && shotErr.message))) throw shotErr;
      log('warn', `screenshot stall for element ${id} — retrying once`);
      buffer = await safeScreenshot(slot.page, {
        type: 'png',
        omitBackground: true,
      });
    }
    const tShot = Date.now() - tShot0;

    // Write PNG to disk
    const tWrite0 = Date.now();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, buffer);
    const tWrite = Date.now() - tWrite0;

    const tTotal = Date.now() - t0;
    log('info', `[TIMING] element ${id}: viewport=${tViewport}ms navigate=${tNav}ms renderReady=${tReady}ms screenshot=${tShot}ms write=${tWrite}ms TOTAL=${tTotal}ms`);

    rendersCompleted++;
    // Success resets the per-slot consecutive-timeout counter (#1161 round 2).
    if (pagePool[slotIndex]) pagePool[slotIndex].consecutiveTimeouts = 0;
    releasePage(slotIndex);
    return { outputPath };
  } catch (err) {
    // Track consecutive inner timeouts per slot. After N in a row without a
    // success, unconditionally rebuild the context (#1161 round 2) — catches
    // any future error class our regex doesn't match.
    const isInnerTimeout = /RenderWorker\.innerTimeout/.test(String(err && err.message));
    if (isInnerTimeout && pagePool[slotIndex]) {
      pagePool[slotIndex].consecutiveTimeouts = (pagePool[slotIndex].consecutiveTimeouts || 0) + 1;
      if (pagePool[slotIndex].consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_THRESHOLD) {
        await discardContextAndRebuild(
          `slot ${slotIndex} hit ${pagePool[slotIndex].consecutiveTimeouts} consecutive inner timeouts`,
        );
        throw err;
      }
    }
    // Replace the page (or rebuild the whole context on poisoning errors — #1161)
    await replacePage(slotIndex, err);
    throw err;
  } finally {
    activeRenders--;
  }
}

/**
 * Render all elements of a full slide in one Playwright page load.
 * Job shape:
 *   { baseUrl, cast, slide, elements: [{ id, outputPath, position, size, type, items }], timeout }
 *
 * Returns an array of { elementId, outputPath, navStates? } objects.
 */
async function renderSlide(job) {
  const {
    baseUrl,
    cast,
    slide,
    elements = [],
    timeout = parseInt(process.env.RENDER_TIMEOUT_MS || '60000', 10),
  } = job;

  const t0 = Date.now();

  let slotIndex;
  try {
    slotIndex = await acquirePage();
    consecutiveAcquireTimeouts = 0;
  } catch (acquireErr) {
    consecutiveAcquireTimeouts += 1;
    log('warn', `renderSlide acquirePage timeout (${consecutiveAcquireTimeouts}/${ACQUIRE_TIMEOUT_REBUILD_THRESHOLD}): ${acquireErr.message}`);
    if (consecutiveAcquireTimeouts >= ACQUIRE_TIMEOUT_REBUILD_THRESHOLD) {
      consecutiveAcquireTimeouts = 0;
      discardContextAndRebuild(
        `acquirePage hit ${ACQUIRE_TIMEOUT_REBUILD_THRESHOLD} consecutive timeouts — pool starved, forcing rebuild`,
      ).catch((e) => log('error', `rebuild-after-acquire-timeout failed: ${e.message}`));
    }
    throw acquireErr;
  }
  const slot = pagePool[slotIndex];

  try {
    activeRenders++;

    // Inner timeouts bounded strictly < outer bridge timeout (#1161).
    const innerTimeout = Math.min(
      parseInt(process.env.RENDER_INNER_TIMEOUT_MS || '20000', 10),
      Math.max(1, timeout - 5000),
    );

    // Set viewport to full slide dimensions
    const tViewport0 = Date.now();
    await raceWithTimeout(
      slot.page.setViewportSize({ width: 1920, height: 1080 }),
      innerTimeout,
      'setViewportSize',
      slotIndex,
    );
    const tViewport = Date.now() - tViewport0;

    // Navigate ONCE with mode=slide — direct params only.
    if (cast === undefined || slide === undefined) {
      throw new Error('render-slide job requires cast+slide');
    }
    const url = `${baseUrl}/api/extensions/slidecast/protocol/render-element?cast=${encodeURIComponent(cast)}&slide=${encodeURIComponent(slide)}&mode=slide`;

    const tNav0 = Date.now();
    await raceWithTimeout(
      slot.page.goto(url, { waitUntil: 'domcontentloaded', timeout: innerTimeout }),
      innerTimeout,
      'goto',
      slotIndex,
    );
    const tNav = Date.now() - tNav0;

    const tReady0 = Date.now();
    await raceWithTimeout(
      slot.page.waitForFunction(
        () => document.body.dataset.renderReady === 'true',
        { timeout: innerTimeout },
      ),
      innerTimeout,
      'waitForRenderReady',
      slotIndex,
    );
    const tReady = Date.now() - tReady0;

    const tSetup = Date.now() - t0;
    log('info', `[TIMING] slide: viewport=${tViewport}ms navigate=${tNav}ms renderReady=${tReady}ms TOTAL_SETUP=${tSetup}ms`);

    const results = [];
    const elementTimings = [];

    for (const element of elements) {
      const { id, outputPath, clip = {} } = element;
      const x = clip.x || 0;
      const y = clip.y || 0;
      const width = clip.width || 100;
      const height = clip.height || 100;

      const tEl0 = Date.now();

      // Show only this element (bounded — SL6)
      const tShow0 = Date.now();
      await raceWithTimeout(
        slot.page.evaluate((elId) => window.showOnlyElement(elId), id),
        innerTimeout,
        'showOnlyElement',
        slotIndex,
      );
      const tShow = Date.now() - tShow0;

      // Clip screenshot to element's bounding box (#1154 — bounded).
      // One bounded retry on capture stall (#1654): pages that already
      // produced screenshots can have a single CDP capture request stall
      // past the 15s bound (observed deterministically on seed cast slide 0,
      // 3rd capture). The page itself is healthy — retrying the capture
      // succeeds, where failing the whole slide job poisons the context and
      // leaves the slide permanently uncached for this rebuild.
      const tShot0 = Date.now();
      let buffer;
      try {
        buffer = await safeScreenshot(slot.page, {
          type: 'png',
          omitBackground: true,
          clip: {
            x, y, width, height,
          },
        });
      } catch (shotErr) {
        if (!/Timeout \d+ms exceeded/i.test(String(shotErr && shotErr.message))) throw shotErr;
        log('warn', `screenshot stall for element ${id} (slide mode) — retrying once`);
        buffer = await safeScreenshot(slot.page, {
          type: 'png',
          omitBackground: true,
          clip: {
            x, y, width, height,
          },
        });
      }
      const tShot = Date.now() - tShot0;

      const tWrite0 = Date.now();
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, buffer);
      const tWrite = Date.now() - tWrite0;

      const result = { elementId: id, outputPath };

      // For nav elements: render additional highlight states
      // navItems comes from the bridge job (SlideImageRenderer builds it from element.items)
      // Check navItems directly — element.type may not be sent in the job message
      const navItems = element.navItems || element.items;
      if (navItems && navItems.length > 0) {
        const navStates = [];

        try {
          for (let itemIdx = 0; itemIdx < navItems.length; itemIdx++) {
            await raceWithTimeout(
              slot.page.evaluate(
                ({ elId, idx }) => window.rerenderNavState(elId, idx),
                { elId: id, idx: itemIdx },
              ),
              innerTimeout,
              'rerenderNavState',
              slotIndex,
            );

            const stateBuffer = await safeScreenshot(slot.page, {
              type: 'png',
              omitBackground: true,
              clip: {
                x, y, width, height,
              },
            });

            const stateItem = navItems[itemIdx];
            const navStateOutputPath = stateItem.outputPath || outputPath.replace(/\.png$/, `-nav-${itemIdx}.png`);
            await fs.writeFile(navStateOutputPath, stateBuffer);

            navStates.push({
              index: itemIdx,
              outputPath: navStateOutputPath,
              label: stateItem.label || '',
              groupId: stateItem.action?.group_id || stateItem.groupId || '',
              actionType: stateItem.action?.type || 'group',
            });
          }
        } finally {
          // Always reset nav to no-highlight state, even if a nav item render fails
          await slot.page.evaluate(
            ({ elId }) => window.rerenderNavState(elId, -1),
            { elId: id },
          ).catch(() => {}); // Swallow if page already crashed
        }

        result.navStates = navStates;
      }

      // Hide all elements before next iteration (bounded — SL6)
      const tHideNav0 = Date.now();
      await raceWithTimeout(
        slot.page.evaluate(() => window.hideAllElements()),
        innerTimeout,
        'hideAllElements',
        slotIndex,
      );
      const tNav2 = Date.now() - tHideNav0;

      const tElTotal = Date.now() - tEl0;
      log('info', `[TIMING] slide element ${id}: show=${tShow}ms screenshot=${tShot}ms write=${tWrite}ms nav=${tNav2}ms TOTAL=${tElTotal}ms`);
      elementTimings.push(tElTotal);

      results.push(result);
    }

    rendersCompleted++;
    if (pagePool[slotIndex]) pagePool[slotIndex].consecutiveTimeouts = 0;
    releasePage(slotIndex);

    const tTotal = Date.now() - t0;
    const avgMs = elementTimings.length > 0
      ? Math.round(elementTimings.reduce((a, b) => a + b, 0) / elementTimings.length)
      : 0;
    log('info', `[TIMING] slide COMPLETE: ${elementTimings.length} elements in ${tTotal}ms (avg ${avgMs}ms/element)`);

    return results;
  } catch (err) {
    const isInnerTimeout = /RenderWorker\.innerTimeout/.test(String(err && err.message));
    if (isInnerTimeout && pagePool[slotIndex]) {
      pagePool[slotIndex].consecutiveTimeouts = (pagePool[slotIndex].consecutiveTimeouts || 0) + 1;
      if (pagePool[slotIndex].consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_THRESHOLD) {
        await discardContextAndRebuild(
          `slot ${slotIndex} hit ${pagePool[slotIndex].consecutiveTimeouts} consecutive inner timeouts (slide)`,
        );
        throw err;
      }
    }
    await replacePage(slotIndex, err);
    throw err;
  } finally {
    activeRenders--;
  }
}

// ─── Health heartbeat ─────────────────────────────────────────────────────────

function startHealthHeartbeat() {
  // Consecutive over-limit tick counter (SL11). Persists across ticks via the
  // closure; reset whenever memory drops back under the limit.
  let overLimitTicks = 0;
  const interval = setInterval(async () => {
    const memMB = getMemoryMB();
    const chromiumAlive = !!(browser && browser.isConnected());

    send({
      type: 'health',
      chromium: chromiumAlive,
      memoryMB: memMB,
      activeRenders,
      rendersCompleted,
      uptime: getUptime(),
    });

    // Auto-restart when memory exceeds the limit. Prefer restarting while idle
    // (no in-flight renders to lose), but a box under sustained render load
    // never goes idle — so after MEMORY_FORCE_RESTART_TICKS consecutive
    // over-limit ticks, force the restart anyway (SL11). The in-flight renders
    // are sacrificed; the bridge rejects + the schedulers re-tick them.
    if (memMB > MEMORY_LIMIT_MB) {
      overLimitTicks++;
      const forced = overLimitTicks >= MEMORY_FORCE_RESTART_TICKS;
      if (!browserRestartInProgress && (activeRenders === 0 || forced)) {
        log('warn', `Memory ${memMB}MB exceeds limit ${MEMORY_LIMIT_MB}MB after ${overLimitTicks} tick(s) (activeRenders=${activeRenders}${forced ? ', forcing' : ''}) — auto-restarting browser`);
        overLimitTicks = 0;
        try {
          await restartBrowser();
        } catch (err) {
          log('error', `Auto-restart failed: ${err.message}`);
        }
      }
    } else {
      overLimitTicks = 0;
    }
  }, HEALTH_INTERVAL_MS);

  // Allow Node to exit even if this interval is still live
  if (interval.unref) interval.unref();
}

// ─── IPC message handler ──────────────────────────────────────────────────────

process.on('message', async (msg) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'render-element': {
      const { jobId, job } = msg;
      try {
        const result = await renderElement(job);
        send({ type: 'done', jobId, ...result });
      } catch (err) {
        log('error', `render-element jobId=${jobId}: ${err.message}`);
        send({ type: 'error', jobId, message: err.message });
      }
      break;
    }

    case 'render-slide': {
      const { jobId, job } = msg;
      try {
        const results = await renderSlide(job);
        send({ type: 'done', jobId, results });
      } catch (err) {
        log('error', `render-slide jobId=${jobId}: ${err.message}`);
        send({ type: 'error', jobId, message: err.message });
      }
      break;
    }

    case 'restart-browser': {
      try {
        await restartBrowser();
        send({ type: 'done', jobId: msg.jobId || null });
      } catch (err) {
        log('error', `restart-browser failed: ${err.message}`);
        send({ type: 'error', jobId: msg.jobId || null, message: err.message });
      }
      break;
    }

    case 'cancel': {
      // No-op: timeout is managed by the bridge
      break;
    }

    case 'shutdown': {
      log('info', 'Shutdown requested');
      isShuttingDown = true;

      // Drain the pool
      for (let i = 0; i < pagePool.length; i++) {
        const slot = pagePool[i];
        if (slot) {
          try { await slot.page.close(); } catch { /* ignore */ }
          pagePool[i] = null;
        }
      }

      if (persistentContext) {
        try { await persistentContext.close(); } catch { /* ignore */ }
        persistentContext = null;
      }

      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
        browser = null;
      }

      process.exit(0);
      break;
    }

    default:
      log('warn', `Unknown message type: ${msg.type}`);
  }
});

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  log('info', `Starting render-worker (pool=${POOL_SIZE}, arch=${process.arch}, pid=${process.pid})`);

  // Clean up leftover Playwright temp dirs from previous sessions
  cleanPlaywrightTempDirs();

  // Periodic cleanup: every 30 minutes, remove dirs older than 10 minutes
  const cleanupInterval = setInterval(() => {
    cleanPlaywrightTempDirs(10 * 60 * 1000);
  }, 30 * 60 * 1000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  try {
    await launchBrowser();
    await buildPagePool();
  } catch (err) {
    log('error', `Startup failed: ${err.message}`);
    process.exit(1);
  }

  startHealthHeartbeat();

  send({ type: 'ready' });
  log('info', 'render-worker ready');

  // Fire-and-forget warmup: navigate to render-element page to warm the JS engine,
  // fonts, and screenshot pipeline so the first real render isn't cold.
  warmup().catch((err) => {
    log('warn', `Warmup failed (non-fatal): ${err.message}`);
  });
}

// ─── Warmup render ────────────────────────────────────────────────────────────

async function warmup() {
  // Prefer backend port (3001) — always reachable as the extension's API host.
  // Falls back to frontend port if BACKEND_PORT env is not set.
  const port = process.env.BACKEND_PORT || process.env.WEB_PORT || 3001;
  const baseUrl = `http://127.0.0.1:${port}`;
  const warmupUrl = `${baseUrl}/api/extensions/slidecast/protocol/render-element?warmup=true`;
  const timeout = 30000; // generous but bounded
  const maxAttempts = 6;

  log('info', `[TIMING] warmup: starting — navigating to ${warmupUrl}`);

  const slotIndex = await acquirePage();
  const slot = pagePool[slotIndex];

  try {
    const tNav0 = Date.now();
    // Retry with backoff — web server may not be reachable the instant worker reports ready.
    let lastErr = null;
    let navigated = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await slot.page.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout });
        navigated = true;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
    if (!navigated) throw lastErr;
    const tNav = Date.now() - tNav0;

    const tShot0 = Date.now();
    await slot.page.screenshot({ type: 'png', timeout });
    const tShot = Date.now() - tShot0;

    const tTotal = tNav + tShot;
    log('info', `[TIMING] warmup: navigate=${tNav}ms screenshot=${tShot}ms TOTAL=${tTotal}ms`);
  } finally {
    releasePage(slotIndex);
  }
}

// Only bootstrap Chromium when actually forked as a child worker: must have
// IPC AND be the entry script. The IPC check alone is not enough — test
// runners (e.g. jest-worker) fork their child processes with IPC too, so a
// bare `process.send` guard made importing this module from a test launch a
// browser and `process.exit(1)` the runner's worker (#1628).
const isEntryScript = (() => {
  try {
    return !!process.argv[1]
      && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
  } catch {
    return false;
  }
})();
if (typeof process.send === 'function' && isEntryScript) {
  main();
}
