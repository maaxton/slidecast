/**
 * warm-page-bench.js — Render pipeline warm-page benchmark
 *
 * Compares two approaches for rendering slidecast elements:
 *
 *   Test A — Current approach (goto):
 *     For each element, navigate to the render-element URL, wait for renderReady,
 *     then screenshot. Full page load per element.
 *
 *   Test B — Warm page (evaluate):
 *     Load the slide page ONCE in mode=slide (all elements pre-rendered in DOM).
 *     For each element, call window.showOnlyElement() via evaluate() and screenshot.
 *     No HTTP fetch or page navigation per element.
 *
 * Usage:
 *   node extensions/slidecast/benchmarks/warm-page-bench.js
 *
 * Prerequisites:
 *   - Waiveo running at http://127.0.0.1:5173
 *   - Cast 6edf50ca-611b-4967-be7b-8775dc1fb3f5 slide 0 must exist with >=1 element
 */

import { chromium } from 'playwright';
import { buildLaunchOptions } from '../render-browser-config.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://127.0.0.1:5173';
const CAST = '6edf50ca-611b-4967-be7b-8775dc1fb3f5';
const SLIDE = '0';
const ITERATIONS = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ms(n) {
  return `${n.toFixed(1)}ms`;
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function printTable(label, timings) {
  console.log(`\n  ${label}`);
  timings.forEach((t, i) => console.log(`    iter ${i + 1}: ${ms(t)}`));
  console.log(`    avg:    ${ms(avg(timings))}`);
  console.log(`    stddev: ${ms(stddev(timings))}`);
  console.log(`    min:    ${ms(Math.min(...timings))}`);
  console.log(`    max:    ${ms(Math.max(...timings))}`);
}

// ─── Step 1: fetch slide element list from the real server ────────────────────

async function fetchSlideElements() {
  const url = `${BASE_URL}/api/extensions/slidecast/protocol/slide-elements/${encodeURIComponent(CAST)}/${encodeURIComponent(SLIDE)}`;
  console.log(`Fetching element list from ${url} ...`);

  const { default: http } = await import('http');
  const data = await new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  if (!data.success) {
    throw new Error(`slide-elements failed: ${data.error || JSON.stringify(data)}`);
  }

  console.log(`  Found ${data.elements.length} renderable elements on slide ${SLIDE}`);
  return data;
}

// ─── Test A: Current approach — full goto per element ────────────────────────

async function runTestA(context, elements) {
  console.log('\n── Test A: goto per element ──────────────────────────────────');
  const allTimings = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterTimings = [];
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });

    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx];
      const w = el.size?.width || 100;
      const h = el.size?.height || 100;

      await page.setViewportSize({ width: w, height: h });

      const url = `${BASE_URL}/api/extensions/slidecast/protocol/render-element`
        + `?cast=${encodeURIComponent(CAST)}&slide=${encodeURIComponent(SLIDE)}&element=${encodeURIComponent(idx)}`;

      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(
        () => document.body.dataset.renderReady === 'true',
        { timeout: 30000 },
      );
      await page.screenshot({ type: 'png', omitBackground: true, timeout: 15000 });
      const elapsed = Date.now() - t0;
      iterTimings.push(elapsed);
    }

    await page.close();
    const iterTotal = iterTimings.reduce((a, b) => a + b, 0);
    console.log(`  iter ${iter + 1}: ${elements.length} elements in ${ms(iterTotal)} (avg ${ms(avg(iterTimings))}/el)`);
    allTimings.push(...iterTimings);
  }

  return allTimings;
}

// ─── Test B: Warm page — load once, evaluate per element ─────────────────────

async function runTestB(context, elements) {
  console.log('\n── Test B: warm page (evaluate) ──────────────────────────────');

  // Load the slide page ONCE — all elements pre-rendered as hidden DOM nodes
  const slideUrl = `${BASE_URL}/api/extensions/slidecast/protocol/render-element`
    + `?cast=${encodeURIComponent(CAST)}&slide=${encodeURIComponent(SLIDE)}&mode=slide`;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log(`  Loading slide page once: ${slideUrl}`);
  const tLoad0 = Date.now();
  await page.goto(slideUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => document.body.dataset.renderReady === 'true',
    { timeout: 30000 },
  );
  const tLoad = Date.now() - tLoad0;
  console.log(`  Slide page loaded in ${ms(tLoad)} (one-time cost, not included in per-element timings)`);

  const allTimings = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterTimings = [];

    for (const el of elements) {
      const x = el.position?.x || 0;
      const y = el.position?.y || 0;
      const w = el.size?.width || 100;
      const h = el.size?.height || 100;

      const t0 = Date.now();

      // Show only this element — no HTTP request, no page navigation
      await page.evaluate((elId) => {
        if (typeof window.showOnlyElement === 'function') {
          window.showOnlyElement(elId);
        } else {
          // Fallback: manually toggle visibility
          document.querySelectorAll('[data-element-id]').forEach((node) => {
            node.style.visibility = node.dataset.elementId === elId ? 'visible' : 'hidden';
          });
        }
      }, el.id);

      await page.screenshot({
        type: 'png',
        omitBackground: true,
        clip: {
          x, y, width: w, height: h,
        },
        timeout: 15000,
      });

      // Hide all before next element
      await page.evaluate(() => {
        if (typeof window.hideAllElements === 'function') {
          window.hideAllElements();
        } else {
          document.querySelectorAll('[data-element-id]').forEach((node) => {
            node.style.visibility = 'hidden';
          });
        }
      });

      const elapsed = Date.now() - t0;
      iterTimings.push(elapsed);
    }

    const iterTotal = iterTimings.reduce((a, b) => a + b, 0);
    console.log(`  iter ${iter + 1}: ${elements.length} elements in ${ms(iterTotal)} (avg ${ms(avg(iterTimings))}/el)`);
    allTimings.push(...iterTimings);
  }

  await page.close();
  return { timings: allTimings, warmUpMs: tLoad };
}

// ─── Summary table ────────────────────────────────────────────────────────────

function printSummary(aTimings, bResult, elementCount) {
  const { timings: bTimings, warmUpMs } = bResult;

  const aAvg = avg(aTimings);
  const bAvg = avg(bTimings);
  const speedup = aAvg > 0 ? (aAvg / bAvg).toFixed(2) : '?';
  const saving = aAvg > 0 ? (((aAvg - bAvg) / aAvg) * 100).toFixed(1) : '?';

  // Break-even: how many elements before warm-up cost is amortized?
  const breakEven = bAvg > 0 ? Math.ceil(warmUpMs / (aAvg - bAvg)) : Infinity;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  BENCHMARK SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Cast:       ${CAST}`);
  console.log(`  Slide:      ${SLIDE}`);
  console.log(`  Elements:   ${elementCount}`);
  console.log(`  Iterations: ${ITERATIONS}`);
  console.log('');

  printTable('Test A — goto per element (current)', aTimings);
  printTable('Test B — warm page via evaluate', bTimings);

  console.log('\n  Comparison (per-element averages):');
  console.log(`    A avg:   ${ms(aAvg)}`);
  console.log(`    B avg:   ${ms(bAvg)}`);
  console.log(`    Speedup: ${speedup}x`);
  console.log(`    Saving:  ${saving}% per element`);
  console.log('');
  console.log('  Warm-up cost (Test B page load, one-time):');
  console.log(`    ${ms(warmUpMs)}`);
  if (isFinite(breakEven) && breakEven > 0) {
    console.log(`    Break-even at ${breakEven} elements`);
  } else if (bAvg >= aAvg) {
    console.log('    Warm page is not faster than goto for this slide');
  }
  console.log('══════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Slidecast Render Pipeline Warm-Page Benchmark      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Fetch element list from real server
  let slideData;
  try {
    slideData = await fetchSlideElements();
  } catch (err) {
    console.error(`\nFATAL: Could not fetch slide elements — is Waiveo running at ${BASE_URL}?`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  const { elements } = slideData;
  if (elements.length === 0) {
    console.error('FATAL: Slide has 0 renderable elements — nothing to benchmark');
    process.exit(1);
  }

  // Same launch config as render-worker (shared module — #1541)
  const launchOptions = buildLaunchOptions();
  if (launchOptions.executablePath) {
    console.log(`\nUsing system Chromium at ${launchOptions.executablePath}`);
  } else {
    console.log('\nUsing bundled Playwright Chromium');
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ deviceScaleFactor: 1 });

  let aTimings; let
    bResult;

  try {
    // Warm run — discard (browser cold-start skew)
    console.log('\nWarm-up pass (discarded) ...');
    const warmPage = await context.newPage();
    await warmPage.setViewportSize({ width: 1920, height: 1080 });
    const warmUrl = `${BASE_URL}/api/extensions/slidecast/protocol/render-element`
      + `?cast=${encodeURIComponent(CAST)}&slide=${encodeURIComponent(SLIDE)}&mode=slide`;
    try {
      await warmPage.goto(warmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await warmPage.waitForFunction(
        () => document.body.dataset.renderReady === 'true',
        { timeout: 30000 },
      );
    } catch (_e) {
      // If warm-up fails (server not ready yet), we'll catch real failures below
    }
    await warmPage.close();

    aTimings = await runTestA(context, elements);
    bResult = await runTestB(context, elements);
  } finally {
    await context.close();
    await browser.close();
  }

  printSummary(aTimings, bResult, elements.length);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
