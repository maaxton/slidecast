# Slidecast Rendering Architecture (#1541)

Audit 2026-05-15 flagged "renderer proliferation" — multiple files with
`render` in the name. This doc maps the actual pipeline. There is **one**
production Playwright rendering path; the other modules are genuinely
distinct execution contexts, not duplicates.

## The production pipeline (slide/element → PNG)

```
SlideImageRenderer (in-process orchestrator)
        │  enqueues jobs via IPC
        ▼
RenderBridge (in-process: fork/respawn, priority queue, timeouts, health)
        │  child_process.fork
        ▼
render-worker.js (child process: owns Playwright/Chromium, page pool)
        │  navigates to
        ▼
routes/protocol.js render-element page  ──serves──  shared-renderer/* HTML/CSS
        │
        ▼
render-worker-screenshot.js safeScreenshot() → PNG on disk
```

## Why each module exists (do NOT merge these)

| Module | Execution context | Role |
|---|---|---|
| `SlideImageRenderer.js` | main process | Orchestration only: layer cache, layers.json metadata, QR generation, static-layer merging, re-render triggers. **Never touches Playwright directly** — all browser work goes through `this.bridge`. |
| `RenderBridge.js` | main process | IPC bridge: child lifecycle (fork, respawn w/ backoff), priority job queue, per-job timeout/cancel, degraded-mode detection. |
| `render-worker.js` | forked child process | Owns Chromium. Zero extension dependencies (builtins + Playwright only) so a browser crash/OOM can never take down the main process. |
| `render-worker-screenshot.js` | child process (sibling of worker) | `safeScreenshot()` extracted solely so it can be unit-tested without spawning Chromium (#1154). |
| `render-browser-config.js` | shared (main/child/bench) | Single source of truth for Chromium flags + executable resolution (extracted in #1541; was duplicated between worker and benchmark). |
| `shared-renderer/` (`@waiveo/slide-renderer`) | isomorphic (browser + node) | Pure HTML/CSS generation. Shared with the Svelte frontend so web preview and Roku PNGs are pixel-identical. No I/O, no Playwright. |
| `widgets/WidgetImageRenderer.js` | main process | **Deliberately separate stack**: Satori + Sharp (~20MB), no browser. Renders widget primitives to PNG for SpriteSheetGenerator / WidgetRefreshService where spinning up Chromium per frame would be Pi-hostile. |
| `benchmarks/warm-page-bench.js` | dev-only standalone script | Measures warm-page vs cold-page render cost. Launches its own Chromium **by design** (it benchmarks the browser, not the bridge). Uses `render-browser-config.js` so its launch config can't drift from production. |

## Rules of thumb

- New slide/element rendering features → `SlideImageRenderer` (orchestration)
  + `render-worker.js` (browser-side) + `shared-renderer` (visuals).
- Never import Playwright in main-process extension code; go through
  `RenderBridge`.
- Chromium flags / executable path changes → `render-browser-config.js` only.
- Visual changes must go in `shared-renderer/` so frontend preview stays in
  sync with Roku output.
