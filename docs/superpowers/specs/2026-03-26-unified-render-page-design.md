# Unified Render Page — Pixel-Perfect Layer Export

**Date:** 2026-03-26
**Status:** Approved (spec review passed)

## Problem

The slidecast editor renders widget elements natively in the browser using `renderPrimitivesToHtml()` + SlideRenderer.svelte CSS. The server-side layer export uses Playwright with a different HTML document (`generateElementDocument()`) and its own CSS definitions. These two render paths produce visually different output — different font sizing, different CSS behavior, different compositing. The editor shows 73° filling the element box; the exported layer shows 72° tiny and off-center.

## Solution

A single render page that both Playwright and a human browser can access. Same URL, same HTML, same CSS, same Chrome engine. What you see in the browser IS what Playwright exports.

---

## The Render Page

### Route

`/ext/slidecast/render` — a new SvelteKit page in the slidecast extension.

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `cast` | Yes | Cast UUID |
| `slide` | Yes | Flattened slide index (0-based) |
| `element` | Yes | Element ID |
| `debug` | No | Show debug overlay (border, metadata, timestamp) |

### Example URLs

```
/ext/slidecast/render?cast=30a20f7c-8a2f-4427-9eeb-811d8f4b28b0&slide=0&element=889b6a8f-c95c-439d-be75-cc0fdca82c1a
/ext/slidecast/render?cast=30a20f7c&slide=0&element=889b6a8f&debug=true
```

### What the Page Does

1. Reads query params
2. Fetches cast definition from `/api/extensions/slidecast/casts/{cast}`
3. Flattens slides from groups, finds slide at given index
4. Finds the element by ID in that slide
5. For widget elements: calls `/api/extensions/slidecast/protocol/widget/{uuid}/render` with the element's config/styles to get primitives
6. Renders the element using the **same component and CSS as the editor** (SlideRenderer's widget-native rendering)
7. Sets `<html>` and `<body>` to exactly `element.size.width` x `element.size.height`, transparent background
8. When render is complete, sets `document.body.dataset.renderReady = "true"`

### What the Page Imports

- `renderPrimitivesToHtml()` from the shared renderer (same function the editor uses)
- Widget CSS classes from a shared stylesheet (extracted from SlideRenderer.svelte):
  - `.widget-native`, `.widget-box`, `.widget-stack`, `.widget-text`
  - `.widget-image`, `.widget-placeholder`, `.widget-error`
- Element style logic: borders, shadows, border-radius, opacity

### What the Page Does NOT Have

- No editor chrome, toolbar, sidebar, or canvas wrapper
- No zoom/pan transform
- No selection overlays or drag handles
- No authentication required (render page is accessible like other protocol endpoints)

### Debug Mode (`?debug=true`)

When `debug=true` is in the URL:
- Thin 1px blue dashed border around the element bounds
- Below the element: ID, type, size, widget UUID, refresh interval, render timestamp
- Helps diagnose rendering issues without opening dev tools

---

## SlideImageRenderer Changes

### New Method: `renderViaPage(castId, slideIndex, elementId, outputPath, options)`

1. Uses the persistent Playwright page (already open on the render URL)
2. Navigates to `/ext/slidecast/render?cast={castId}&slide={slideIndex}&element={elementId}`
3. Waits for `document.body.dataset.renderReady === "true"` (with timeout)
4. Takes a screenshot with `omitBackground: true` (transparent PNG)
5. Writes to `outputPath` (e.g., `layer-2.png`)

### Persistent Playwright Page

- On `init()`: launch browser, create persistent context, open one page at the render URL
- The page stays open for the lifetime of the server
- For each render: `page.goto(newUrl)` → wait for ready → screenshot
- SvelteKit handles param changes reactively — minimal reload overhead
- On `destroy()`: close page, close browser

### Concurrency

- One page = one render at a time
- Render requests are queued via the existing `renderTracker`
- No change to queuing logic

### Integration with renderSlide()

In the element rendering loop inside `renderSlide()`:

```
for each element:
  if native → skip (handled by Roku)
  if widget → renderViaPage(castId, slideIndex, elementId, layerPath)
  else → renderElementLayer() (existing HTML path for text/shape/nav)
```

Widget elements use the new render page. All other elements keep the existing `generateElementDocument()` path for now.

### What Gets Removed (for widgets)

- Widget execution in `renderElementLayer()` — the render page handles this
- `widgetPrimitives` option in `generateElementDocument()` — no longer needed
- `widgetDesignWidth/Height` scaling logic — no longer needed
- `_widgetPrimitives` property passing between functions — no longer needed

---

## Persistent Playwright Process

### Lifecycle

| Event | Action |
|-------|--------|
| `init()` | Launch Chromium, create BrowserContext, open Page at render URL |
| Render request | Navigate page to new params, wait for ready, screenshot |
| `destroy()` | Close page, close context, close browser |

### Why Persistent

- Chromium launch: ~2-5 seconds (unacceptable per render)
- Page creation: ~200-500ms (adds up across many layers)
- URL navigation on existing page: ~50-100ms (fast)
- Playwright stays hot in memory, ready for instant renders

### Already Exists

`SlideImageRenderer` already has `getPersistentContext()`. The change:
- Instead of creating new pages per render and closing them, keep ONE page open
- Navigate by changing URL
- The persistent page replaces per-render page creation

---

## WidgetRefreshService Integration

### Flow (unchanged trigger, new render path)

1. WidgetRefreshService runs on its 60-second cycle
2. For each widget whose refresh interval has elapsed:
   - Emits `widget:layer_updated` event with `{castId, slideIndex, elementId}`
3. SlideImageRenderer listens for the event
4. Navigates the persistent Playwright page to the render URL for that element
5. Waits for ready, screenshots, writes layer PNG
6. Updates layers.json with new contentHash
7. Pushes `slide_rendered` update to UpdateTracker
8. Roku receives the update, re-fetches the layer PNG

### What Stays the Same

- WidgetRefreshService timer and scheduling
- Widget refresh intervals (defined per widget: 300s for weather, 1s for clock)
- UpdateTracker notification to Roku
- Roku layer refresh mechanism

---

## Widget CSS — Shared Source of Truth

### Problem

SlideRenderer.svelte defines widget CSS in its `<style>` block (scoped). The render page needs the same CSS. Duplicating it creates drift.

### Solution

Extract widget CSS into a shared file:

```
extensions/slidecast/frontend-routes/slidecast/lib/widget-styles.css
```

Contents:
- `.widget-native` — flex column container
- `.widget-box` — flex centered box
- `.widget-stack` — flex stack
- `.widget-text` — pre-wrap text
- `.widget-image` — object-fit contain
- `.widget-placeholder`, `.widget-error`, `.widget-loading`

Both SlideRenderer.svelte and the render page import this file. One source of truth.

---

## Debug Page Integration

The existing `/ext/slidecast/debug` page gets a small enhancement:

- Each layer card for widget-type layers gets a **"Open Render"** link
- The link opens `/ext/slidecast/render?cast=X&slide=Y&element=Z&debug=true` in a new tab
- You see exactly what Playwright sees, with debug overlay

---

## Migration Path

### Phase 1 (this spec): Widgets Only

- Build the render page
- Widget elements render via the page
- Text, shape, nav, qr keep the existing HTML path
- Verify pixel-perfect match between editor and render page

### Phase 2 (future): All Elements

- Migrate text, shape, nav, qr to the render page
- `generateElementDocument()` removed entirely
- `elementRenderer.js` simplified to just `renderPrimitivesToHtml()` and helpers
- All elements use the same single render path

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend-routes/slidecast/render/+page.svelte` | The render page |
| `frontend-routes/slidecast/lib/widget-styles.css` | Shared widget CSS |

## Files to Modify

| File | Change |
|------|--------|
| `SlideImageRenderer.js` | Add `renderViaPage()`, use persistent page, route widgets to render page |
| `frontend-routes/slidecast/lib/SlideRenderer.svelte` | Import shared widget CSS instead of inline styles |
| `frontend-routes/slidecast/debug/+page.svelte` | Add "Open Render" link for widget layers |
| `index.js` | Pass server URL to SlideImageRenderer for render page URL construction |

## Files NOT Modified

- `WidgetRefreshService.js` — trigger logic stays the same
- `UpdateTracker.js` — notification logic stays the same
- Roku player code — layer refresh mechanism stays the same
- `shared-renderer/widgetRenderer.js` — `renderPrimitivesToHtml()` stays the same

---

## Appendix: Spec Review Resolutions

### Critical 1: Existing render page conflict

An existing `frontend-routes/slidecast/render/+page.svelte` exists (takes `?data=` base64 param, renders full slides). This spec's render page is a **replacement** with a different interface. The existing page is only used by SlideImageRenderer internally and has no external consumers. The new page replaces it entirely. The old `?data=` interface is removed.

### Critical 2: Authentication and API access

The render page uses **public protocol endpoints** that don't require authentication:
- Cast data: fetched via `/api/extensions/slidecast/protocol/slide-layers/{castId}/{slideIndex}` (public, used by Roku)
- Widget render: uses `/api/extensions/slidecast/protocol/widget/{uuid}/render` (public)

The render page does NOT call authenticated endpoints like `/api/extensions/slidecast/casts/{id}`. All data comes through the public protocol layer.

When Playwright navigates to the render page, the page is loaded from `http://localhost:5173` (the Express server in Docker serves both the API and the SvelteKit frontend on the same port). No cross-origin issues.

### Critical 3: renderPrimitivesToHtml divergence

Two implementations exist:
- `shared-renderer/widgetRenderer.js` (server-side, used by generateElementDocument)
- `SlideRenderer.svelte` (inline in component script)

The render page uses the **SlideRenderer.svelte version** — the one the editor uses. This is the canonical version. The server-side `shared-renderer/widgetRenderer.js` version continues to exist for non-widget element rendering but is NOT used by the render page. In Phase 2, the server-side version can be removed entirely.

### Important 1: Ready signal lifecycle

When Playwright calls `page.goto(newUrl)`, SvelteKit does a full client-side navigation (new page load). The lifecycle:
1. `page.goto()` triggers navigation
2. SvelteKit loads the page, sets `renderReady = false`
3. Page fetches data, renders element
4. `onMount` or `afterUpdate` sets `document.body.dataset.renderReady = "true"`
5. Playwright detects ready signal via `page.waitForFunction(() => document.body.dataset.renderReady === "true", { timeout: 15000 })`

For consecutive renders: `page.goto()` to a new URL resets the page state. No manual reset needed.

### Important 2: Concurrency

A simple mutex in SlideImageRenderer gates access to the persistent page:
```javascript
this.renderLock = Promise.resolve();

async renderViaPage(...) {
  await (this.renderLock = this.renderLock.then(async () => {
    // navigate, wait, screenshot
  }));
}
```

Events from `widget:layer_updated` queue naturally through this lock.

### Important 3: Error handling

| Failure | Timeout | Action |
|---------|---------|--------|
| Page load | 15s | Log error, skip this layer, continue |
| Ready signal not received | 15s | Log error, skip this layer |
| Widget execution timeout | 5s (on page) | Page shows error state, Playwright screenshots the error (visible in debug) |
| Cast/element not found | N/A | Page shows "not found" message, Playwright screenshots it |
| Playwright crash | N/A | Restart browser on next render attempt |

### Important 4: Element style application

The render page applies element styles (borders, shadows, opacity, rotation) by wrapping the element content in a container div with inline styles computed from the element data — using the same logic as SlideRenderer's `getElementStyle()` function. This function is extracted into a shared utility importable by both components.

### Suggestion: Scoped CSS

Widget CSS in SlideRenderer uses `:global()` selectors for nested classes (`.widget-box`, `.widget-stack`, `.widget-text`). The shared CSS file uses the same `:global()` pattern or is imported as unscoped CSS. The render page's `<style>` block uses `:global()` to match.
