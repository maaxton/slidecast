# Unified Render Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single SvelteKit render page that both Playwright (server-side) and browsers (debugging) access to produce pixel-perfect layer PNGs — identical to what the editor shows.

**Architecture:** A new page at `/ext/slidecast/render` accepts query params (cast, slide, element), fetches data from public protocol endpoints, renders the element using the exact same SlideRenderer widget code and CSS, and signals readiness. Playwright navigates a persistent page to this URL, waits for the ready signal, and screenshots. The same URL is accessible in a browser for debugging.

**Tech Stack:** SvelteKit (render page), Playwright (persistent browser + screenshot), existing slidecast API endpoints

**Spec:** `extensions/slidecast/docs/superpowers/specs/2026-03-26-unified-render-page-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `frontend-routes/slidecast/render/+page.svelte` | Render page — fetches element data, renders widget natively, signals ready |
| `frontend-routes/slidecast/lib/widget-styles.css` | Shared widget CSS — single source of truth for `.widget-native`, `.widget-box`, `.widget-stack`, `.widget-text`, etc. |
| `frontend-routes/slidecast/lib/widget-primitives.js` | Shared `renderPrimitivesToHtml()` + all helpers — single source of truth. Extracted from SlideRenderer.svelte (lines 59-205). Used by SlideRenderer, render page, widget factory, and PreviewPanel. |

### Modified Files
| File | Change |
|------|--------|
| `SlideImageRenderer.js` | Add `renderViaPage()` method + persistent render page + mutex. Route widget elements through the render page instead of `renderElementLayer()`. |
| `frontend-routes/slidecast/lib/SlideRenderer.svelte` | Import shared `widget-styles.css` instead of defining widget CSS inline. Import `renderPrimitivesToHtml` from shared module instead of inline definition. |
| `frontend-routes/slidecast/widgets/factory/+page.svelte` | Import `renderPrimitivesToHtml` from shared module instead of inline copy (line 1301). Import shared `widget-styles.css`. |
| `frontend-routes/slidecast/widgets/factory/lib/components/PreviewPanel.svelte` | Import `renderPrimitivesToHtml` from shared module instead of inline copy (line 30). Import shared `widget-styles.css`. |
| `frontend-routes/slidecast/debug/+page.svelte` | Add "Open Render" link for widget layer cards. |
| `index.js` | Pass `baseUrl` to SlideImageRenderer for render page URL construction. |

---

## Task 1: Extract widget CSS and renderPrimitivesToHtml into shared files

**Files:**
- Create: `frontend-routes/slidecast/lib/widget-styles.css`
- Create: `frontend-routes/slidecast/lib/widget-primitives.js`
- Modify: `frontend-routes/slidecast/lib/SlideRenderer.svelte` (lines 59-205 for functions, lines 1044-1157 for CSS)
- Modify: `frontend-routes/slidecast/widgets/factory/+page.svelte` (line 1301 — inline renderPrimitivesToHtml)
- Modify: `frontend-routes/slidecast/widgets/factory/lib/components/PreviewPanel.svelte` (line 30 — inline renderPrimitivesToHtml)

- [ ] **Step 1: Create the shared CSS file**

Create `frontend-routes/slidecast/lib/widget-styles.css` with the widget CSS currently in SlideRenderer.svelte. Extract these classes from SlideRenderer.svelte's `<style>` block (approximately lines 1044-1157):

```css
/* Widget element styles — shared between SlideRenderer and render page */

.widget-native {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.widget-native .widget-box {
  display: flex;
  align-items: center;
  justify-content: center;
}

.widget-native .widget-stack {
  display: flex;
}

.widget-native .widget-text {
  white-space: pre-wrap;
  word-wrap: break-word;
}

.widget-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.widget-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
}

.widget-placeholder .placeholder-icon {
  font-size: 24px;
  opacity: 0.5;
}

.widget-placeholder .placeholder-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.widget-error {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.widget-error .error-icon {
  font-size: 24px;
}

.widget-error .error-text {
  font-size: 12px;
  color: #ef4444;
}

.widget-loading {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}
```

- [ ] **Step 2: Extract renderPrimitivesToHtml into shared module**

Create `frontend-routes/slidecast/lib/widget-primitives.js` with the `renderPrimitivesToHtml` function and ALL its helpers, copied verbatim from `SlideRenderer.svelte` lines 59-205:

```javascript
// Shared widget primitives renderer — single source of truth
// Used by: SlideRenderer, render page, widget factory, PreviewPanel

export function renderPrimitivesToHtml(primitive) {
  // [COPY ENTIRE FUNCTION from SlideRenderer.svelte line 59-91]
}

function renderBoxPrimitive(p) {
  // [COPY from SlideRenderer.svelte lines 93-123]
}

function renderStackPrimitive(p) {
  // [COPY from SlideRenderer.svelte lines 125-146]
}

function renderTextPrimitive(p) {
  // [COPY from SlideRenderer.svelte lines 148-167]
}

function renderIconPrimitive(p) {
  // [COPY from SlideRenderer.svelte lines 170-184]
}

function renderImagePrimitive(p) {
  // [COPY from SlideRenderer.svelte lines 186-199]
}

export function escapeHtml(text) {
  // Browser-safe HTML escaping
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  // Fallback for SSR
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

Then update ALL consumers to import from this shared module:

**SlideRenderer.svelte:** Replace lines 59-205 (the inline functions) with:
```javascript
import { renderPrimitivesToHtml, escapeHtml } from './widget-primitives.js';
```

**widgets/factory/+page.svelte:** Replace the inline `renderPrimitivesToHtml` at line 1301 with:
```javascript
import { renderPrimitivesToHtml } from '../../lib/widget-primitives.js';
```

**widgets/factory/lib/components/PreviewPanel.svelte:** Replace the inline `renderPrimitivesToHtml` at line 30 with:
```javascript
import { renderPrimitivesToHtml } from '../../../lib/widget-primitives.js';
```

This ensures ALL four consumers (SlideRenderer, render page, factory, PreviewPanel) use the exact same function.

- [ ] **Step 3: Update SlideRenderer.svelte to import shared CSS**

In `SlideRenderer.svelte`, replace the widget CSS in the `<style>` block (the `.widget-native`, `.widget-box`, `.widget-stack`, `.widget-text`, `.widget-image`, `.widget-placeholder`, `.widget-error`, `.widget-loading` rules) with an import. At the top of the `<style>` block add:

```svelte
<style>
  @import './widget-styles.css';

  /* ... rest of non-widget styles stay ... */
</style>
```

Remove the widget-related `:global()` rules that are now in the shared file. Keep all non-widget CSS (`.element-wrapper`, `.element-text`, `.element-shape`, etc.).

**Note:** The widget CSS in SlideRenderer uses `:global()` for nested classes. The shared CSS file uses plain selectors (not `:global()`) because both consumers will apply it globally. Test that the import works — Svelte may need the styles to be in a `<style global>` or imported differently. Check how the existing codebase handles CSS imports in Svelte components.

- [ ] **Step 3: Verify editor still renders correctly**

Run: `cd /Users/matt/waiveo/waiveo/frontend && npx vite build 2>&1 | tail -5`

Then deploy the extension and verify the editor canvas still shows widgets correctly:
```bash
./scripts/cli/deploy-cli.sh extension slidecast
```

Open the editor in a browser and confirm a weather widget still displays its temperature.

- [ ] **Step 4: Commit**

```bash
cd /Users/matt/waiveo/waiveo
git add extensions/slidecast/frontend-routes/slidecast/lib/widget-styles.css extensions/slidecast/frontend-routes/slidecast/lib/SlideRenderer.svelte
git commit -m "refactor: extract widget CSS into shared file"
```

---

## Task 2: Build the render page

**Files:**
- Create: `frontend-routes/slidecast/render/+page.svelte` (replace existing)

This is the core of the feature. The render page fetches element data and renders it natively using the same code as the editor.

- [ ] **Step 1: Read the existing render page**

Read `/Users/matt/waiveo/waiveo/extensions/slidecast/frontend-routes/slidecast/render/+page.svelte` to understand what's there currently (it uses `?data=` base64 param). We are replacing it entirely.

- [ ] **Step 2: Write the new render page**

Replace the contents of `frontend-routes/slidecast/render/+page.svelte` with:

```svelte
<script>
  import { onMount } from 'svelte';
  import '../lib/widget-styles.css';

  let element = null;
  let widgetPrimitives = null;
  let error = null;
  let loading = true;
  let debug = false;
  let renderTimestamp = null;

  // Import shared widget primitives renderer — same function used by the editor
  import { renderPrimitivesToHtml, escapeHtml } from '../lib/widget-primitives.js';

  const API_BASE = '/api/extensions/slidecast';

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const castId = params.get('cast');
    const slideIndex = parseInt(params.get('slide') || '0', 10);
    const elementId = params.get('element');
    debug = params.get('debug') === 'true';

    if (!castId || !elementId) {
      error = 'Missing cast or element param';
      loading = false;
      document.body.dataset.renderReady = 'true';
      return;
    }

    try {
      // Fetch slide layers to get element metadata (public endpoint, no auth needed)
      const layersRes = await fetch(`${API_BASE}/protocol/slide-layers/${castId}/${slideIndex}`);
      const layersData = await layersRes.json();

      if (!layersData.success && !layersData.layers) {
        error = 'Failed to load slide layers';
        loading = false;
        document.body.dataset.renderReady = 'true';
        return;
      }

      // Find the element in the layers
      const layer = (layersData.layers || []).find(l => l.id === elementId);
      if (!layer) {
        error = `Element ${elementId} not found`;
        loading = false;
        document.body.dataset.renderReady = 'true';
        return;
      }

      // For the element data, we need the full cast definition
      // Use the casts endpoint (may need to be made public or use protocol)
      const castRes = await fetch(`${API_BASE}/casts/${castId}`, { credentials: 'same-origin' });
      const castData = await castRes.json();
      const cast = castData.cast || castData;
      const definition = cast.definition || {};

      // Flatten slides from groups
      const slides = [];
      for (const group of (definition.groups || [])) {
        for (const slide of (group.slides || [])) {
          slides.push(slide);
        }
      }

      const slide = slides[slideIndex];
      if (!slide) {
        error = `Slide ${slideIndex} not found`;
        loading = false;
        document.body.dataset.renderReady = 'true';
        return;
      }

      // Find the full element data
      element = (slide.elements || []).find(el => el.id === elementId);
      if (!element) {
        error = `Element ${elementId} not found in slide`;
        loading = false;
        document.body.dataset.renderReady = 'true';
        return;
      }

      // Set page size to element size
      const w = element.size?.width || 100;
      const h = element.size?.height || 100;
      document.documentElement.style.width = w + 'px';
      document.documentElement.style.height = h + 'px';
      document.body.style.width = w + 'px';
      document.body.style.height = h + 'px';

      // For widget elements, fetch fresh primitives
      if (element.type === 'widget' && element.widgetUuid) {
        try {
          const renderRes = await fetch(`${API_BASE}/protocol/widget/${element.widgetUuid}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              config: element.widgetConfig || {},
              styles: element.widgetStyles || {},
              size: element.size
            })
          });
          const renderData = await renderRes.json();
          if (renderData.success && renderData.primitives) {
            widgetPrimitives = renderData.primitives;
          }
        } catch (err) {
          console.error('Widget render failed:', err);
        }
      }

      renderTimestamp = new Date().toISOString();
      loading = false;

      // Signal ready after DOM updates
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.dataset.renderReady = 'true';
        });
      });

    } catch (err) {
      error = err.message;
      loading = false;
      document.body.dataset.renderReady = 'true';
    }
  });
</script>

<svelte:head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      overflow: hidden;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
  </style>
</svelte:head>

{#if loading}
  <!-- Empty while loading — Playwright waits for renderReady -->
{:else if error}
  <div style="color: red; padding: 8px; font-size: 12px;">{error}</div>
{:else if element}
  <div
    class="element-widget"
    style="width: 100%; height: 100%; position: relative; overflow: hidden;"
  >
    {#if element.type === 'widget' && widgetPrimitives}
      <div class="widget-native" style="width: 100%; height: 100%;">
        {@html renderPrimitivesToHtml(widgetPrimitives)}
      </div>
    {:else if element.type === 'widget'}
      <div class="widget-placeholder">
        <span class="placeholder-icon">📦</span>
        <span class="placeholder-text">{element.widgetName || 'Widget'}</span>
      </div>
    {:else}
      <div style="color: #888; font-size: 12px;">Non-widget: {element.type}</div>
    {/if}
  </div>

  {#if debug}
    <div style="position: fixed; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.8); color: #aaa; font-size: 10px; padding: 4px 8px; font-family: monospace; z-index: 9999;">
      ID: {element.id} | Type: {element.type} | Size: {element.size?.width}x{element.size?.height} | UUID: {element.widgetUuid || '-'} | Rendered: {renderTimestamp}
    </div>
  {/if}
{/if}
```

**CRITICAL:** The `renderPrimitivesToHtml` function and ALL its helpers (`renderBoxPrimitive`, `renderStackPrimitive`, `renderTextPrimitive`, `renderIconPrimitive`, `renderImagePrimitive`, `escapeHtml`) MUST be copied verbatim from `SlideRenderer.svelte` lines 59-205. This is what guarantees pixel-identical output. Do NOT use the server-side `shared-renderer/widgetRenderer.js` version — it produces different HTML.

- [ ] **Step 3: Verify the page works in browser**

Deploy and open in browser:
```bash
./scripts/cli/deploy-cli.sh extension slidecast
```

Then open: `http://waiveo.local:5173/ext/slidecast/render?cast=30a20f7c-8a2f-4427-9eeb-811d8f4b28b0&slide=0&element=889b6a8f-c95c-439d-be75-cc0fdca82c1a&debug=true`

Expected: The weather widget renders at 193x80, showing the current temperature in the same style as the editor. Debug overlay shows element metadata.

- [ ] **Step 4: Commit**

```bash
git add extensions/slidecast/frontend-routes/slidecast/render/+page.svelte
git commit -m "feat: build unified render page for pixel-perfect layer export"
```

---

## Task 3: Add renderViaPage() to SlideImageRenderer

**Files:**
- Modify: `SlideImageRenderer.js` (add new method, modify init/destroy, modify renderSlide loop)

- [ ] **Step 1: Add the persistent render page and mutex**

In `SlideImageRenderer.js`, add to the constructor (around line 232, after `this.widgetRegistry`):

```javascript
this.renderPageUrl = null;  // Set during init
this.renderPage = null;     // Persistent Playwright page for render URL
this.renderLock = Promise.resolve();  // Mutex for single-page access
```

- [ ] **Step 2: Add renderViaPage method**

Add this method to the `SlideImageRenderer` class:

```javascript
/**
 * Render a widget element via the unified render page.
 * Uses the same HTML/CSS as the editor for pixel-perfect output.
 */
async renderViaPage(castId, slideIndex, elementId, outputPath) {
  // Acquire render lock (one render at a time on the persistent page)
  await (this.renderLock = this.renderLock.then(async () => {
    try {
      // Ensure persistent page exists
      if (!this.renderPage) {
        const context = await this.getPersistentContext();
        this.renderPage = await context.newPage();
      }

      // Navigate to render page with element params
      const url = `${this.baseUrl}/ext/slidecast/render?cast=${castId}&slide=${slideIndex}&element=${elementId}`;
      await this.renderPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Wait for render-ready signal
      await this.renderPage.waitForFunction(
        () => document.body.dataset.renderReady === 'true',
        { timeout: 15000 }
      );

      // Screenshot with transparent background
      const buffer = await this.renderPage.screenshot({
        type: 'png',
        omitBackground: true,
        timeout: 15000
      });

      await fs.writeFile(outputPath, buffer);
    } catch (err) {
      logger.error(`renderViaPage failed: cast=${castId} slide=${slideIndex} element=${elementId}: ${err.message}`);
      throw err;
    }
  }));
}
```

- [ ] **Step 3: Route widget elements through renderViaPage in renderSlide()**

In `renderSlide()` (around line 544), find the element rendering loop. For widget elements that pass the `isNativeElement` check, instead of the current widget execution + `renderElementLayer` path, use `renderViaPage`. Replace the widget execution block (lines 556-575 approximately) and the render call with:

```javascript
// For widget elements, use the unified render page (pixel-perfect match with editor)
if (element.type === 'widget' && element.widgetUuid) {
  const filename = `layer-${layerIndex}.png`;
  const pngPath = path.join(slideDir, filename);

  try {
    await this.renderViaPage(castId, slideIndex, element.id, pngPath);

    const pos = element.position || {};
    const size = element.size || {};
    const style = element.style || {};

    layers.push({
      id: element.id,
      type: element.type,
      native: false,
      zIndex,
      x: pos.x ?? 0,
      y: pos.y ?? 0,
      width: size.width ?? 100,
      height: size.height ?? 100,
      opacity: style.opacity ?? element.opacity ?? 1,
      rotation: pos.rotation ?? style.rotation ?? 0,
      file: filename,
      loadPriority: calculateLoadPriority(element),
      contentHash: crypto.createHash('md5').update(await fs.readFile(pngPath)).digest('hex')
    });

    renderedLayers++;
  } catch (err) {
    logger.error(`Widget render via page failed for ${element.id}: ${err.message}`);
  }

  layerIndex++;
  continue;
}
```

This goes AFTER the `isNativeElement` check (line 549) and BEFORE the existing `generateElementDocument` path (line 609). Remove the old widget execution block (lines 556-575) since `renderViaPage` handles everything.

- [ ] **Step 4: Clean up — remove old widget execution code from renderElementLayer**

In `renderElementLayer()` (around line 808), remove the widget execution block that was added previously (the `if (element.type === 'widget' && element.widgetUuid && this.widgetRuntime)` block). Widgets no longer go through `renderElementLayer` — they use `renderViaPage` instead.

Also remove the `widgetDesignWidth/Height` logic and the `widgetPrimitives` option from `generateElementDocument` call. These are no longer needed.

- [ ] **Step 5: Test locally**

Build and deploy:
```bash
cd /Users/matt/waiveo/waiveo
docker buildx build --platform linux/amd64 -t maaxton/waiveo:latest --load .
./scripts/cli/deploy-image.sh maaxton/waiveo:latest
```

Wait for server to restart, then force render:
```bash
TOKEN=$(curl -s -X POST "http://192.168.51.7:5173/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"!Hax0r123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
curl -s -H "Cookie: token=$TOKEN" "http://192.168.51.7:5173/api/extensions/slidecast/protocol/slide-layers/1/0?force=true"
```

Wait 2 minutes for render queue, then check layer-2.png dimensions and content.

- [ ] **Step 6: Commit**

```bash
git add extensions/slidecast/SlideImageRenderer.js
git commit -m "feat: route widget renders through unified render page via Playwright"
```

---

## Task 4: Wire up baseUrl in index.js

**Files:**
- Modify: `index.js` (around line 896, the SlideImageRenderer constructor)

- [ ] **Step 1: Ensure baseUrl is passed**

Check that the `SlideImageRenderer` constructor receives the correct `baseUrl`. In `index.js`, find the SlideImageRenderer instantiation (around line 896). The `api` object passed to the extension provides the server URL. Check if `this.baseUrl` is already set in the constructor — if not, add it:

```javascript
const slideImageRenderer = new SlideImageRenderer(api, {
  dataDir: process.env.DATA_DIR || '/app/data',
  baseUrl: `http://localhost:${process.env.WEB_PORT || 5173}`,
  castManager,
  widgetRuntime,
  widgetRegistry,
  widgetImageRenderer
});
```

The `baseUrl` is used by `renderViaPage` to construct the render page URL.

- [ ] **Step 2: Commit**

```bash
git add extensions/slidecast/index.js
git commit -m "feat: pass baseUrl to SlideImageRenderer for render page access"
```

---

## Task 5: Add "Open Render" link to debug page

**Files:**
- Modify: `frontend-routes/slidecast/debug/+page.svelte`

- [ ] **Step 1: Add the render link**

In the debug page, find where widget layer cards are rendered (around the Widget Config section added previously). Add a link to the render page:

After the Widget Config section and before the Element Data `<details>`, add:

```svelte
{#if layer.type === 'widget'}
  {@const widgetEl = getWidgetElement(layer.id)}
  {#if widgetEl}
    <!-- existing Widget Config section -->

    <div class="render-link">
      <a
        href="/ext/slidecast/render?cast={selectedCastId}&slide={selectedSlideIndex}&element={layer.id}&debug=true"
        target="_blank"
        rel="noopener"
      >
        Open Render Page
      </a>
    </div>
  {/if}
{/if}
```

Add CSS:
```css
.render-link {
  padding: 8px 15px;
  border-top: 1px solid #3d3d5c;
}

.render-link a {
  color: #f59e0b;
  font-size: 11px;
  text-decoration: none;
}

.render-link a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/slidecast/frontend-routes/slidecast/debug/+page.svelte
git commit -m "feat: add Open Render link to debug page widget cards"
```

---

## Task 6: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Build and deploy everything**

```bash
cd /Users/matt/waiveo/waiveo
docker buildx build --platform linux/amd64 -t maaxton/waiveo:latest --load .
./scripts/cli/deploy-image.sh maaxton/waiveo:latest
```

Wait 60 seconds for server restart.

- [ ] **Step 2: Open render page in browser**

Open: `http://waiveo.local:5173/ext/slidecast/render?cast=30a20f7c-8a2f-4427-9eeb-811d8f4b28b0&slide=0&element=889b6a8f-c95c-439d-be75-cc0fdca82c1a&debug=true`

Verify:
- Temperature displays (e.g., 73°)
- Size matches the element (193x80)
- Debug overlay shows metadata
- Background is transparent

- [ ] **Step 3: Compare with editor**

Open the editor at `http://waiveo.local:5173/ext/slidecast/studio?cast=1` side by side with the render page. The widget should look identical — same font size, same positioning, same styling.

- [ ] **Step 4: Force re-render and check layer PNG**

```bash
TOKEN=$(curl -s -X POST "http://192.168.51.7:5173/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"!Hax0r123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
curl -s -H "Cookie: token=$TOKEN" "http://192.168.51.7:5173/api/extensions/slidecast/protocol/slide-layers/1/0?force=true"
```

Wait for render queue (2+ minutes), then download layer-2.png and compare with the render page output. They should be pixel-identical.

- [ ] **Step 5: Check Roku**

Take a Roku screenshot:
```bash
cd /Users/matt/waiveo/waiveo-roku-player
./scripts/screenshot.sh
```

Verify the weather widget on the Roku shows the correct temperature at the correct size.

- [ ] **Step 6: Check debug page**

Open `http://waiveo.local:5173/ext/slidecast/debug`, select a cast, and verify:
- Widget layer card shows "Open Render" link
- Clicking the link opens the render page with the widget

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Extract widget CSS into shared file | `widget-styles.css` (new), `SlideRenderer.svelte` |
| 2 | Build the render page | `render/+page.svelte` (replace) |
| 3 | Add `renderViaPage()` to SlideImageRenderer | `SlideImageRenderer.js` |
| 4 | Wire up baseUrl in index.js | `index.js` |
| 5 | Add "Open Render" link to debug page | `debug/+page.svelte` |
| 6 | End-to-end verification | Testing only |

Tasks 1-2 are frontend. Task 3 is the server-side Playwright integration. Task 4 is configuration. Task 5 is a small UI addition. Task 6 is verification.

**Critical note:** All four widget renderers (SlideRenderer, render page, widget factory, PreviewPanel) MUST import `renderPrimitivesToHtml` from the shared `widget-primitives.js` module. Do NOT use the server-side `shared-renderer/widgetRenderer.js` version — it produces different HTML. The shared module is extracted from SlideRenderer.svelte's version, which is what the editor uses.
