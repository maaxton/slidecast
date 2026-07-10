import logger from './utils/Logger.js';
/**
 * RenderTracker - Tracks active slide renders with priority queue, concurrency limiting,
 * stale cleanup, and error tracking.
 *
 * Designed for Pi deployment (low memory/CPU) with configurable limits.
 */

class RenderTracker {
  constructor(api, options = {}) {
    this.api = api;
    this.maxConcurrent = options.maxConcurrent || 1; // Default: 1 for Pi
    this.staleTimeoutMs = options.staleTimeoutMs || 5 * 60 * 1000; // 5 minutes

    this.activeRenders = new Map(); // key -> { startedAt, status }
    this.failedRenders = new Map(); // key -> { error, failedAt }
    this.pendingQueue = []; // Regular priority queue
    this.priorityQueue = []; // High priority (active screens) queue

    // Cleanup stale renders every minute via the platform scheduler so the
    // recurring timer is cancelled cleanly on hot-reload (#1028, Wave 2 of
    // #1024). Falls back to raw setInterval only when the host did not wire
    // api.scheduler (legacy test fixtures).
    this.cleanupInterval = null;
    this._cleanupJobId = null;
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._cleanupJobId = this.api.scheduler.schedule(
        () => this.cleanupStale(),
        { intervalMs: 60000, name: 'render-tracker-cleanup' },
      );
    } else {
      this.cleanupInterval = setInterval(() => this.cleanupStale(), 60000);
    }

    logger.info(`RenderTracker initialized: maxConcurrent=${this.maxConcurrent}`);
  }

  /**
   * Generate render key from castId and slideIndex
   */
  getKey(castId, slideIndex) {
    return `${castId}:${slideIndex}`;
  }

  /**
   * Check if a specific slide is currently being rendered
   */
  isRendering(castId, slideIndex) {
    return this.activeRenders.has(this.getKey(castId, slideIndex));
  }

  /**
   * Check if a specific slide render has failed
   */
  hasFailed(castId, slideIndex) {
    return this.failedRenders.has(this.getKey(castId, slideIndex));
  }

  /**
   * Get failure info for a specific slide
   */
  getFailure(castId, slideIndex) {
    return this.failedRenders.get(this.getKey(castId, slideIndex));
  }

  /**
   * Check if we can start a new render (under concurrency limit)
   */
  canStartRender() {
    return this.activeRenders.size < this.maxConcurrent;
  }

  /**
   * Get current queue size
   */
  getQueueSize() {
    return this.priorityQueue.length + this.pendingQueue.length;
  }

  /**
   * Start tracking a render
   */
  startRender(castId, slideIndex) {
    const key = this.getKey(castId, slideIndex);
    this.failedRenders.delete(key); // Clear any previous failure
    this.activeRenders.set(key, {
      startedAt: Date.now(),
      status: 'rendering',
      castId,
      slideIndex,
    });
    logger.debug(`Render started: ${key} (active: ${this.activeRenders.size}/${this.maxConcurrent})`);
  }

  /**
   * Mark a render as complete
   */
  completeRender(castId, slideIndex) {
    const key = this.getKey(castId, slideIndex);
    const render = this.activeRenders.get(key);
    if (render) {
      const elapsed = Date.now() - render.startedAt;
      logger.debug(`Render complete: ${key} (${elapsed}ms)`);
    }
    this.activeRenders.delete(key);
    logger.debug(`completeRender: active=${this.activeRenders.size} queued=${this.getQueueSize()} — triggering processQueue`);
    this.processQueue(); // Start next queued render
  }

  /**
   * Mark a render as failed
   */
  failRender(castId, slideIndex, error) {
    const key = this.getKey(castId, slideIndex);
    const errorMsg = typeof error === 'string' ? error : (error?.message || String(error));
    const render = this.activeRenders.get(key);
    if (render) {
      const elapsed = Date.now() - render.startedAt;
      logger.error(`Render failed: ${key} (${elapsed}ms) - ${errorMsg}`);
    }
    this.activeRenders.delete(key);
    this.failedRenders.set(key, {
      error: errorMsg,
      failedAt: Date.now(),
    });
    logger.debug(`failRender: active=${this.activeRenders.size} queued=${this.getQueueSize()} — triggering processQueue`);
    this.processQueue(); // Start next queued render
  }

  /**
   * Queue a render for later execution
   * @param {string} castId
   * @param {number} slideIndex
   * @param {Function} renderFn - Function to call when slot available
   * @param {boolean} priority - True for active screen priority
   * @returns {boolean} True if queued successfully
   */
  queueRender(castId, slideIndex, renderFn, priority = false) {
    const queue = priority ? this.priorityQueue : this.pendingQueue;

    // Check if already queued
    const key = this.getKey(castId, slideIndex);
    const alreadyQueued = [...this.priorityQueue, ...this.pendingQueue]
      .some((q) => this.getKey(q.castId, q.slideIndex) === key);

    if (alreadyQueued) {
      logger.debug(`Render already queued: ${key}`);
      return true; // Already queued counts as success
    }

    queue.push({
      castId, slideIndex, renderFn, queuedAt: Date.now(),
    });
    logger.debug(`Render queued: ${key} (priority=${priority}, queueSize=${this.getQueueSize()})`);

    // Trigger queue processing (will start if slot available)
    this.processQueue();

    return true;
  }

  /**
   * Process the queue - start next render if slot available
   */
  processQueue() {
    if (!this.canStartRender()) {
      logger.debug(`processQueue: blocked — active=${this.activeRenders.size}/${this.maxConcurrent} queued=${this.getQueueSize()}`);
      return;
    }

    // Priority queue first (active screens)
    let job = null;
    if (this.priorityQueue.length > 0) {
      job = this.priorityQueue.shift();
      logger.debug(`processQueue: dequeued priority job ${job.castId}:${job.slideIndex} (remaining queued=${this.getQueueSize()})`);
    } else if (this.pendingQueue.length > 0) {
      job = this.pendingQueue.shift();
      logger.debug(`processQueue: dequeued job ${job.castId}:${job.slideIndex} (remaining queued=${this.getQueueSize()})`);
    }

    if (job) {
      // Call the render function — it is responsible for calling startRender,
      // completeRender, and failRender itself (the doRender pattern in protocol.js).
      // Do NOT wrap with .then()/.catch() here: doRender launches a fire-and-forget
      // async IIFE and returns synchronously, so Promise.resolve(renderFn()) would
      // resolve immediately and trigger completeRender before the render finishes,
      // freeing the concurrency slot prematurely and causing subsequent queued items
      // to never start (they see a free slot, start, then the slot is freed again
      // from the premature completeRender double-call).
      try {
        job.renderFn();
      } catch (err) {
        // renderFn threw synchronously (should not happen, but guard against it).
        // If startRender was never called the slot is still free; call processQueue
        // again so the queue doesn't stall permanently.
        logger.error(`processQueue: renderFn threw synchronously for ${job.castId}:${job.slideIndex} — ${err.message}`);
        // Ensure the slot is freed in case startRender was partially called
        const key = this.getKey(job.castId, job.slideIndex);
        if (this.activeRenders.has(key)) {
          this.activeRenders.delete(key);
          this.failedRenders.set(key, { error: err.message, failedAt: Date.now() });
        }
        // Recurse to pick up the next queued item
        this.processQueue();
      }
    } else {
      logger.debug('processQueue: queue empty, nothing to start');
    }
  }

  /**
   * Cleanup stale renders (timed out) and old failures
   */
  cleanupStale() {
    const now = Date.now();
    let staleCount = 0;
    let expiredFailures = 0;

    // Clean up stale active renders (stuck > staleTimeout)
    for (const [key, render] of this.activeRenders) {
      if (now - render.startedAt > this.staleTimeoutMs) {
        this.activeRenders.delete(key);
        this.failedRenders.set(key, {
          error: 'Render timed out',
          failedAt: now,
        });
        staleCount++;
      }
    }

    // Clean up old failures (older than 10 minutes)
    const failureMaxAge = 10 * 60 * 1000;
    for (const [key, failure] of this.failedRenders) {
      if (now - failure.failedAt > failureMaxAge) {
        this.failedRenders.delete(key);
        expiredFailures++;
      }
    }

    if (staleCount > 0 || expiredFailures > 0) {
      logger.info(`RenderTracker cleanup: ${staleCount} stale renders, ${expiredFailures} expired failures`);
    }

    // Process queue in case slots freed up
    this.processQueue();
  }

  /**
   * Get current status for diagnostics
   */
  getStatus() {
    return {
      active: this.activeRenders.size,
      maxConcurrent: this.maxConcurrent,
      priorityQueued: this.priorityQueue.length,
      queued: this.pendingQueue.length,
      totalQueued: this.getQueueSize(),
      failed: this.failedRenders.size,
      activeRenders: Array.from(this.activeRenders.entries()).map(([key, val]) => ({
        key,
        elapsedMs: Date.now() - val.startedAt,
      })),
    };
  }

  /**
   * Get queue status for a specific cast
   * @param {string} castId - Cast UUID to filter by
   * @returns {Object} { activeCount, queuedCount, activeSlides, queuedSlides }
   */
  getCastStatus(castId) {
    // Active renders for this cast
    const activeSlides = [];
    for (const [key, val] of this.activeRenders) {
      if (key.startsWith(`${castId}:`)) {
        const slideIndex = parseInt(key.split(':')[1], 10);
        activeSlides.push(slideIndex);
      }
    }

    // Queued renders for this cast (both priority and regular)
    const queuedSlides = [];
    for (const job of [...this.priorityQueue, ...this.pendingQueue]) {
      if (job.castId === castId) {
        queuedSlides.push(job.slideIndex);
      }
    }

    return {
      activeCount: activeSlides.length,
      queuedCount: queuedSlides.length,
      activeSlides,
      queuedSlides,
    };
  }

  /**
   * Update configuration (e.g., from settings change)
   */
  updateConfig(options) {
    if (options.maxConcurrent !== undefined) {
      this.maxConcurrent = options.maxConcurrent;
    }
    if (options.staleTimeoutMs !== undefined) {
      this.staleTimeoutMs = options.staleTimeoutMs;
    }
    logger.info(`RenderTracker config updated: maxConcurrent=${this.maxConcurrent}`);
  }

  /**
   * Cancel all pending renders (active renders will complete)
   * Returns count of cancelled jobs
   */
  cancelAll() {
    const cancelled = this.pendingQueue.length + this.priorityQueue.length;
    this.pendingQueue = [];
    this.priorityQueue = [];
    logger.info(`Cancelled ${cancelled} pending renders`);
    return cancelled;
  }

  /**
   * Cancel pending renders for a specific cast
   * Returns count of cancelled jobs
   */
  cancelForCast(castId) {
    const beforePending = this.pendingQueue.length;
    const beforePriority = this.priorityQueue.length;

    this.pendingQueue = this.pendingQueue.filter((job) => job.castId !== castId);
    this.priorityQueue = this.priorityQueue.filter((job) => job.castId !== castId);

    const cancelled = (beforePending - this.pendingQueue.length) + (beforePriority - this.priorityQueue.length);
    if (cancelled > 0) {
      logger.info(`Cancelled ${cancelled} pending renders for cast ${castId}`);
    }
    return cancelled;
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this._cleanupJobId !== null) {
      try {
        this.api?.scheduler?.cancel?.(this._cleanupJobId);
      } catch { /* noop */ }
      this._cleanupJobId = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.activeRenders.clear();
    this.failedRenders.clear();
    this.pendingQueue = [];
    this.priorityQueue = [];
    logger.info('RenderTracker destroyed');
  }
}

export default RenderTracker;
