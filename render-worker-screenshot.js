/**
 * safeScreenshot — bounded-wait screenshot helper for render-worker (#1154).
 *
 * Why this exists:
 *   The render-worker's page.screenshot() call was timing out at 60s on Apex
 *   whenever a widget HTML page had pending network activity (long-poll, SSE,
 *   weather fetch, etc.) at the moment the screenshot was requested. Even
 *   though the page had already signalled `renderReady=true`, Playwright's
 *   screenshot would block on the in-flight requests and exhaust the full
 *   job timeout, starving the render pool.
 *
 *   The fix has two parts:
 *     1. Before screenshotting, call window.stop() in the page context to
 *        abort all pending fetches / XHR / subresource loads. The DOM is
 *        already painted — these requests are not needed for the visual.
 *     2. Use a short, bounded screenshot timeout (default 15s, env override
 *        RENDER_SCREENSHOT_TIMEOUT_MS) instead of the job-wide timeout (60s).
 *        If the screenshot still cannot complete in 15s the job fails fast
 *        and the pool slot is recycled, instead of cascading.
 *
 *   Exported separately from render-worker.js so it can be unit-tested
 *   without spawning a real Chromium worker child process.
 */

export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 15000;

export function getScreenshotTimeoutMs() {
  const raw = process.env.RENDER_SCREENSHOT_TIMEOUT_MS;
  const n = parseInt(raw || String(DEFAULT_SCREENSHOT_TIMEOUT_MS), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  return n;
}

/**
 * Cancel any pending network activity on the page, then take a screenshot
 * with a bounded timeout.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options] - Screenshot options (type, clip, omitBackground, ...)
 * @returns {Promise<Buffer>}
 */
/**
 * isBlankPng — true if the PNG is fully transparent (every pixel alpha 0), the
 * signature of a capture taken before content painted (e.g. a text layer whose
 * @font-face wasn't applied yet). A blank capture has the CORRECT dimensions — only
 * its alpha channel is all-zero — so a dimension check (pngHasDimensions) misses it.
 * No alpha channel (opaque image) → never blank. A sharp/decode failure → treated as
 * NOT blank, so a real render is never false-flagged into a failure. #blank-render.
 *
 * @param {Buffer} buffer
 * @returns {Promise<boolean>}
 */
export async function isBlankPng(buffer) {
  if (!buffer || buffer.length === 0) return true;
  try {
    const sharp = (await import('sharp')).default;
    const stats = await sharp(buffer).stats();
    const alpha = stats.channels[3];
    return alpha ? alpha.max === 0 : false;
  } catch (_) {
    return false;
  }
}

/**
 * forcePaint — make the compositor commit a fresh painted frame. By screenshot time the
 * page is fully idle (renderReady has fired — CDP perf metrics show 0 script / 0 layout
 * during the stall), and headless Chromium's new-surface Page.captureScreenshot then
 * intermittently blocks its FULL timeout waiting for a frame an idle page never commits
 * — the observed stall, where the immediate retry succeeds in ~35ms (#1154). The
 * offsetHeight read forces a layout pass (so freshly-applied font metrics flush); two
 * nested rAFs guarantee a paint+commit; the setTimeout bounds it so it can't itself hang.
 */
async function forcePaint(page) {
  try {
    await page.evaluate(() => new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      void document.body.offsetHeight;
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 1000);
    }));
  } catch (_) {
    // Page may be mid-close — fall through to the screenshot.
  }
}

export async function safeScreenshot(page, options = {}) {
  // window.stop() aborts pending network on the page. Wrapped in catch — if the page is
  // closed or eval fails, fall through to the screenshot (the source of truth for the
  // real failure mode).
  try {
    await page.evaluate(() => { try { window.stop(); } catch (_) { /* ignore */ } });
  } catch (_) {
    // Swallow — page may be mid-close.
  }

  await forcePaint(page);

  // animations:'disabled' fast-forwards finite CSS animations/transitions and cancels
  // infinite ones to a stable frame — keeps renders deterministic. Callers may override.
  const shotOpts = { timeout: getScreenshotTimeoutMs(), animations: 'disabled', ...options };
  let buffer = await page.screenshot(shotOpts);

  // #blank-render: a fully-transparent capture has TWO causes that are identical at
  // the pixel level (all-zero alpha under omitBackground):
  //   (a) a transient font-race — text whose @font-face hadn't applied when we
  //       captured; a second forcePaint+recapture recovers it once the face flushes.
  //   (b) a legitimately empty element — empty / whitespace / data-bound-empty text,
  //       or a zero-opacity/transparent shape — which SHOULD ship as an invisible layer.
  // So recapture once to recover (a). If it's STILL blank we cannot distinguish (a) from
  // (b) — and we must NOT throw here: a blank capture is not per-element isolated, so a
  // thrown error fails the ENTIRE slide (no layers.json written), and because empty
  // content is deterministic it re-fails every rebuild with no self-heal — a whole slide
  // goes blank/stale on real screens. Returning the transparent buffer is the correct,
  // pre-existing behavior for empty content, and for a rare persistent font failure it is
  // no worse than the blank the pre-#blank-render code always shipped. Warn so a
  // persistent blank is visible in logs without blanking a slide. RENDER_BLANK_DETECT=0
  // skips the recapture entirely (escape hatch).
  if (process.env.RENDER_BLANK_DETECT !== '0' && (await isBlankPng(buffer))) {
    await forcePaint(page);
    buffer = await page.screenshot(shotOpts);
    if (await isBlankPng(buffer)) {
      console.warn(
        `[render-worker] blank (fully-transparent) capture after recapture for clip ${
          JSON.stringify(options.clip || 'full')
        } — shipping transparent layer (empty element or persistent font failure)`,
      );
    }
  }

  return buffer;
}
