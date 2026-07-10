/**
 * render-browser-config.js — Single source of truth for Chromium launch
 * configuration used by the slidecast render pipeline.
 *
 * Consumers (#1541 — keep these in sync by importing, never copying):
 *   - render-worker.js            (production: forked child that owns Playwright)
 *   - benchmarks/warm-page-bench.js (dev-only benchmark, mirrors worker setup)
 *
 * Zero extension dependencies — only Node.js builtins — so the render-worker
 * keeps its "builtins + Playwright only" contract.
 */

import { existsSync } from 'fs';

/**
 * Chromium flags for headless software rendering. Tuned for Pi-class ARM
 * boxes: no GPU, no sandbox (containerized), no zygote.
 */
export const BROWSER_FLAGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--no-zygote',
  '--disable-gpu-sandbox',
  '--disable-accelerated-2d-canvas',
  '--disable-software-rasterizer',
];

/**
 * Resolve the effective flag list. WAIVEO_VM_MODE=1 (QEMU/UTM dev VMs) adds
 * single-process flags that Chromium needs under nested virtualization.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - env source (default process.env)
 * @returns {string[]} new array (safe to mutate)
 */
export function resolveBrowserFlags({ env = process.env } = {}) {
  const flags = [...BROWSER_FLAGS];
  if (env.WAIVEO_VM_MODE === '1') {
    flags.push('--single-process', '--disable-features=VizDisplayCompositor');
  }
  return flags;
}

/**
 * Resolve the Chromium executable path, preferring the system binary
 * (Docker image installs /usr/bin/chromium-browser) over the bundled
 * Playwright download. Env overrides win.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]      - env source (default process.env)
 * @param {(p: string) => boolean} [opts.exists] - existence check (injectable for tests)
 * @returns {string|null} absolute path to system Chromium, or null to use bundled
 */
export function resolveChromiumExecutable({ env = process.env, exists = existsSync } = {}) {
  const candidate = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || env.CHROMIUM_PATH
    || '/usr/bin/chromium-browser';
  return exists(candidate) ? candidate : null;
}

/**
 * Build the Playwright launch options object shared by worker + benchmark.
 *
 * @param {object} [opts] - forwarded to resolveChromiumExecutable
 * @returns {{ headless: true, args: string[], executablePath?: string }}
 */
export function buildLaunchOptions(opts = {}) {
  const launchOptions = { headless: true, args: resolveBrowserFlags(opts) };
  const executablePath = resolveChromiumExecutable(opts);
  if (executablePath) launchOptions.executablePath = executablePath;
  return launchOptions;
}
