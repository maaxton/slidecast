/**
 * slidecast scheduleStartupJobs — teardown-safe background timers.
 *
 * Regression test for the frozen-screen-class defect: checkExistingRokuDevices
 * and autoCacheMissingCasts were scheduled with raw `setTimeout` instead of
 * `ctx.setTimeout`, so an unload/hot-reload inside the 5s/10s startup window
 * left the timers armed. They later fired against a torn-down ctx.data (closed
 * DB) — SQLITE_MISUSE noise, and worse, ran extension work against
 * already-unloaded state (same class as the Roku Task-thread leak: orphaned
 * work surviving teardown).
 *
 * Moved here from the monorepo (marketplace v2 Phase 4 core extraction): this
 * repo has no access to core's real `ContextFactory`, so the tracked-timeout
 * teardown wiring itself (ContextFactory._trackTimeout /
 * _clearTrackedSideEffects, ExtensionLoader's unload path calling
 * shutdownPrimitives()) is NOT re-proven here — that's covered by core's own
 * ContextFactory tests in the monorepo. What THIS test proves is the
 * SLIDECAST side of the contract: scheduleStartupJobs schedules its two
 * startup jobs exclusively through `ctx.setTimeout` (never a raw global
 * `setTimeout`), and that a teardown which clears every ctx-tracked timeout
 * (exactly what ContextFactory.shutdownPrimitives() does for real) leaves
 * neither job able to fire.
 *
 * The fake factory below reproduces just the slice of ContextFactory's
 * contract that scheduleStartupJobs actually touches (verified by reading
 * index.js's scheduleStartupJobs — it only calls `ctx.setTimeout` and
 * `ctx.log`):
 *   - ctx.setTimeout(fn, ms) — tracks the returned timer id in a Set, and the
 *     id self-untracks the moment the timer fires (one-shot timers do not
 *     pile up over a long-lived load) — mirrors ContextFactory._trackTimeout.
 *   - factory._trackedTimeouts — the tracked Set itself.
 *   - factory.shutdownPrimitives() — clearTimeout() on every tracked id, then
 *     clears the set — mirrors ContextFactory._clearTrackedSideEffects().
 *   - ctx.log — scheduleStartupJobs logs warnings/errors from inside the
 *     delayed jobs; stubbed as a no-op.
 *
 * The timers themselves still go through the REAL global `setTimeout`, so
 * vi.useFakeTimers()/vi.advanceTimersByTimeAsync continue to control them.
 */
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { scheduleStartupJobs } from 'slidecast/index.js';

function buildFakeFactory() {
  const trackedTimeouts = new Set();

  function trackTimeout(fn, ms, ...args) {
    let id;
    const wrapped = (...a) => {
      trackedTimeouts.delete(id);
      return typeof fn === 'function' ? fn(...a) : undefined;
    };
    id = setTimeout(wrapped, ms, ...args);
    trackedTimeouts.add(id);
    return id;
  }

  return {
    _trackedTimeouts: trackedTimeouts,
    createBaseContext() {
      return {
        setTimeout: (fn, ms, ...args) => trackTimeout(fn, ms, ...args),
        log: () => {},
      };
    },
    shutdownPrimitives() {
      for (const id of trackedTimeouts) {
        try { clearTimeout(id); } catch { /* noop */ }
      }
      trackedTimeouts.clear();
    },
  };
}

describe('slidecast scheduleStartupJobs — teardown-safe background timers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('registers both jobs via the tracked ctx.setTimeout, not a raw global timer', () => {
    const factory = buildFakeFactory();
    const ctx = factory.createBaseContext();
    const checkRoku = vi.fn().mockResolvedValue();
    const autoCache = vi.fn().mockResolvedValue();
    const renderBridge = { isReady: () => true };

    scheduleStartupJobs(ctx, renderBridge, { checkRoku, autoCache });

    // The only way the fake factory's own tracked-timeout set gains entries is
    // via ctx.setTimeout (trackTimeout) — a raw global setTimeout() call would
    // never touch this set.
    expect(factory._trackedTimeouts.size).toBe(2);
  });

  it('unload before the delay clears the timers — neither job runs against torn-down state', async () => {
    const factory = buildFakeFactory();
    const ctx = factory.createBaseContext();
    const checkRoku = vi.fn().mockResolvedValue();
    const autoCache = vi.fn().mockResolvedValue();
    const renderBridge = { isReady: () => true };

    scheduleStartupJobs(ctx, renderBridge, { checkRoku, autoCache });
    expect(factory._trackedTimeouts.size).toBe(2);

    // Simulate unload/hot-reload happening inside the 5s/10s startup window —
    // this is the exact teardown ExtensionLoader runs on every unload/reload.
    factory.shutdownPrimitives();
    expect(factory._trackedTimeouts.size).toBe(0);

    // Advance well past both delays. If the fix regressed to raw setTimeout,
    // these would still fire here because a raw timer isn't cancelled by
    // shutdownPrimitives().
    await vi.advanceTimersByTimeAsync(15000);

    expect(checkRoku).not.toHaveBeenCalled();
    expect(autoCache).not.toHaveBeenCalled();
  });

  it('without an unload, both jobs still fire at their original delays (behavior unchanged)', async () => {
    const factory = buildFakeFactory();
    const ctx = factory.createBaseContext();
    const checkRoku = vi.fn().mockResolvedValue();
    const autoCache = vi.fn().mockResolvedValue();
    const renderBridge = { isReady: () => true };

    scheduleStartupJobs(ctx, renderBridge, { checkRoku, autoCache });

    await vi.advanceTimersByTimeAsync(5000);
    expect(checkRoku).toHaveBeenCalledTimes(1);
    expect(autoCache).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(autoCache).toHaveBeenCalledTimes(1);
  });

  it('skips the auto-cache job (but still clears its timer) when the render worker is not ready', async () => {
    const factory = buildFakeFactory();
    const ctx = factory.createBaseContext();
    const checkRoku = vi.fn().mockResolvedValue();
    const autoCache = vi.fn().mockResolvedValue();
    const renderBridge = { isReady: () => false };

    scheduleStartupJobs(ctx, renderBridge, { checkRoku, autoCache });

    await vi.advanceTimersByTimeAsync(10000);

    expect(autoCache).not.toHaveBeenCalled();
    expect(factory._trackedTimeouts.size).toBe(0); // both one-shot timers self-untrack after firing
  });
});
