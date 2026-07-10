# Unified Render Page v2 — Browser-First Element Rendering

**Date:** 2026-03-26
**Status:** Approved
**Supersedes:** 2026-03-26-unified-render-page-design.md

## Problem

The slidecast system has two rendering paths that produce visually different output:

1. **Server-side HTML** (`generateElementDocument()`) — builds its own HTML documents with its own CSS for text, shapes, nav, QR, ping elements. Playwright screenshots these.
2. **Widget-specific** (`renderViaPage()` with `page.setContent()`) — builds a different HTML document for widget elements only.

Neither path matches what the studio editor (SlideRenderer.svelte) renders in the browser. The result: elements look different on Roku than in the editor. Font sizing, spacing, opacity, gradients, and other CSS effects diverge.

## Solution

**One render page for all element types.** An Express-served bare HTML page that renders any element using the same CSS and style functions as the studio editor. Playwright navigates to it and screenshots — the browser IS the renderer.

- What you see in the studio editor IS what gets exported as a PNG layer.
- All CSS effects (opacity, backdrop-filter, gradients, shadows, blend modes) are captured faithfully because Playwright screenshots the actual Chrome compositor output.

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `shared-renderer/styles.css` | Single source of truth for ALL rendering CSS (widget classes, element classes, resets). Consumed by both SlideRenderer.svelte and the render page. |
| Express route: `GET /protocol/render-element` | Serves the bare HTML render page |
| Express route: `GET /protocol/render-data/:token` | Returns element data JSON for a given token |
| Express route: `POST /protocol/render-data` | Stores element data in temp cache, returns token |

### Modified Files

| File | Change |
|------|--------|
| `SlideImageRenderer.js` | All non-native elements use the render page. Removes `generateElementDocument()` and `renderViaPage()` code paths. |
| `SlideRenderer.svelte` | CSS imports from `shared-renderer/styles.css` via `:global()` rules instead of its own scoped styles for rendering classes. |
| `shared-renderer/elementRenderer.js` | Still provides element HTML generation functions, but no longer generates full HTML documents. The render page calls these functions. |

### Removed Paths

| What | Why |
|------|-----|
| `generateElementDocument()` full HTML generation | Render page replaces it |
| `renderViaPage()` widget-specific path | Unified into the render page |
| `renderHtmlToPng()` for non-widget elements | Playwright screenshots the render page instead |

## Render Flow

### For every non-native element:

```
SlideImageRenderer.renderSlide()
  │
  ├─ POST /protocol/render-data
  │    body: { element, variables, context }
  │    response: { token: "abc123" }
  │
  ├─ Playwright navigates to:
  │    /api/extensions/slidecast/protocol/render-element?token=abc123
  │
  ├─ Render page:
  │    1. Reads token from URL
  │    2. Fetches GET /protocol/render-data/abc123
  │    3. Sets html/body to element dimensions
  │    4. Builds HTML based on element type (see below)
  │    5. Injects into #render-container
  │    6. Sets document.body.dataset.renderReady = 'true'
  │
  ├─ Playwright waits for renderReady
  ├─ Playwright screenshots with omitBackground: true
  └─ Server saves PNG to disk
```

### For nav elements (multiple states):

Nav elements produce N+1 PNGs (one "no highlight" + one per nav item). The server calls the render page multiple times:

```
For i = -1 to items.length - 1:
  POST /protocol/render-data { element, focusedNavItemIndex: i }
  → Playwright navigates → screenshot → save layer-{idx}-nav-{i}.png
```

## The Render Page

### Structure

Express route `GET /protocol/render-element` serves a self-contained HTML page:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    /* Reset */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { overflow: hidden; background: transparent; }

    /* Contents of shared-renderer/styles.css inlined here */
    ${sharedCss}
  </style>
</head>
<body>
  <div id="render-container"></div>

  <!-- Debug overlay (shown when ?debug=true) -->
  <div id="debug-overlay" style="display:none">...</div>

  <script type="module">
    // Shared render functions inlined here by Express at serve time:
    // - renderPrimitivesToHtml() from widgetRenderer.js
    // - getTextStyle(), getShapeStyle(), getNavStyle() etc from styleBuilder.js
    // - escapeHtml(), resolveVariables() from elementRenderer.js

    ${inlinedRenderFunctions}

    // 1. Read token from URL
    const token = new URLSearchParams(location.search).get('token');
    const debug = new URLSearchParams(location.search).get('debug') === 'true';

    // 2. Fetch element data
    const res = await fetch('/api/extensions/slidecast/protocol/render-data/' + token);
    const data = await res.json();
    const { element, variables, context } = data;

    // 3. Set page dimensions to match element
    const w = element.size?.width || element.width || 100;
    const h = element.size?.height || element.height || 100;
    document.documentElement.style.width = w + 'px';
    document.documentElement.style.height = h + 'px';
    document.body.style.width = w + 'px';
    document.body.style.height = h + 'px';

    // 4. Render based on element type
    const container = document.getElementById('render-container');
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    container.innerHTML = await renderElement(element, variables, context);

    // 5. Show debug overlay if requested
    if (debug) { showDebugOverlay(element); }

    // 6. Signal ready
    document.body.dataset.renderReady = 'true';
  </script>
</body>
</html>
```

### Element Rendering (inside the page)

```javascript
async function renderElement(element, variables, context) {
  switch (element.type) {
    case 'text':
      return renderTextElement(element, 1, variables);

    case 'shape':
      return renderShapeElement(element, 1);

    case 'widget':
      // Fetch primitives from widget runtime
      const res = await fetch('/api/extensions/slidecast/protocol/widget/' +
        element.widgetUuid + '/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: element.widgetConfig || element.config || {},
          styles: element.widgetStyles || element.styles || {},
          size: element.size
        })
      });
      const data = await res.json();
      if (data.success && data.primitives) {
        return '<div class="widget-native" style="width:100%;height:100%">'
          + renderPrimitivesToHtml(data.primitives)
          + '</div>';
      }
      return '<div class="widget-error">Widget render failed</div>';

    case 'nav':
      return renderNavElement(element, 1,
        context?.currentGroupId,
        context?.currentSlideIndex,
        context?.focusedNavItemIndex);

    case 'qr':
      return renderQRElement(element, 1, context?.assetBaseUrl, context?.qrDataUrl);

    case 'ping':
      return renderPingElement(element, 1);

    default:
      return '';
  }
}
```

## Shared CSS — Single Source of Truth

### `shared-renderer/styles.css`

This file contains ALL rendering CSS. It is the merger of:
- Current `widget-styles.css` (widget classes)
- Element classes from SlideRenderer.svelte's `<style>` block
- The CSS reset used by the render page

```css
/* === Reset (render page only — SlideRenderer has its own scoping) === */
/* Applied via the render page's own <style> block, not in this file */

/* === Widget classes === */
.widget-native { width: 100%; height: 100%; display: flex; flex-direction: column; }
.widget-box { display: flex; align-items: center; justify-content: center; }
.widget-stack { display: flex; }
.widget-text { white-space: pre-wrap; word-wrap: break-word; }
.widget-image { width: 100%; height: 100%; object-fit: contain; }
.widget-placeholder { ... }
.widget-error { ... }
.widget-loading { ... }

/* === Element classes === */
.element-text { white-space: pre-wrap; word-wrap: break-word; overflow: hidden; }
.element-shape { /* base shape styles */ }
.nav-container { display: flex; }
.nav-item { display: flex; align-items: center; }
/* etc. */
```

### Consumers

| Consumer | How it imports |
|----------|---------------|
| **SlideRenderer.svelte** | `:global()` rules in `<style>` block referencing the same class names. The actual values come from `styles.css`. |
| **Render page** | Express reads `styles.css` at startup and inlines it in the `<style>` tag. |

### Rule

**Any CSS that affects rendered element output MUST live in `shared-renderer/styles.css`.** SlideRenderer.svelte may have its own scoped styles for editor-only UI (selection handles, hover states, grid), but rendering CSS belongs in the shared file.

## Temp Data Cache

### Storage

In-memory `Map<string, { data, expires }>` in the slidecast extension context. Not persisted — render data is ephemeral.

### Endpoints

**`POST /protocol/render-data [public]`**
```json
// Request
{ "element": {...}, "variables": {...}, "context": {...} }

// Response
{ "success": true, "token": "a1b2c3d4" }
```

**`GET /protocol/render-data/:token [public]`**
```json
// Response
{ "success": true, "element": {...}, "variables": {...}, "context": {...} }
```

### Token lifecycle
- Generated: random hex string (16 chars)
- Expires: 60 seconds after creation
- Cleanup: lazy (checked on read) + periodic sweep every 5 minutes
- Public endpoints (no auth) — tokens are unguessable and short-lived

### Context object

Passed alongside the element for type-specific rendering needs:

```json
{
  "currentGroupId": "group-uuid",
  "currentSlideIndex": 3,
  "focusedNavItemIndex": -1,
  "qrDataUrl": "data:image/png;base64,...",
  "assetBaseUrl": "http://127.0.0.1:5173/api/extensions/slidecast/protocol/asset"
}
```

## Debug Mode

Opening the render page URL in a browser with `&debug=true` shows:
- The rendered element (visible on transparent/checkerboard background)
- A metadata overlay: element ID, type, dimensions, token
- Useful during development to verify rendering matches the studio

The debug overlay is hidden by default and excluded from Playwright screenshots (Playwright doesn't pass `debug=true`).

## Server-Side Changes (SlideImageRenderer.js)

### New unified method: `renderElementViaPage()`

Replaces both `renderElementLayer()` (for text/shape/nav/qr/ping) and `renderViaPage()` (for widgets).

```javascript
async renderElementViaPage(castId, slideIndex, element, variables, context, outputPath) {
  // 1. Store element data
  const token = await this.storeRenderData({ element, variables, context });

  // 2. Navigate Playwright
  const url = `${this.baseUrl}/api/extensions/slidecast/protocol/render-element?token=${token}`;
  await this.renderPage.setViewportSize({
    width: element.size?.width || element.width,
    height: element.size?.height || element.height
  });
  await this.renderPage.goto(url, { waitUntil: 'domcontentloaded' });

  // 3. Wait for ready signal
  await this.renderPage.waitForFunction(
    () => document.body.dataset.renderReady === 'true',
    { timeout: 15000 }
  );

  // 4. Screenshot
  const buffer = await this.renderPage.screenshot({
    type: 'png',
    omitBackground: true,
    timeout: 15000
  });

  await fs.writeFile(outputPath, buffer);
}
```

### renderSlide() changes

The element loop simplifies:

```javascript
for (const element of sortedElements) {
  if (isNativeElement(element)) {
    // Clock, date, countdown, video, image — metadata only
    layers.push(createNativeLayerMetadata(element, layerIndex));
    continue;
  }

  if (element.type === 'nav') {
    // Multiple PNGs for nav states
    const navLayers = await renderNavStates(castId, slideIndex, element, variables, layerIndex);
    layers.push(...navLayers);
    continue;
  }

  // Everything else: text, shape, widget, qr, ping
  const pngPath = path.join(slideDir, `layer-${layerIndex}.png`);
  const context = { currentGroupId, currentSlideIndex: slideIndex, assetBaseUrl };

  if (element.type === 'qr') {
    context.qrDataUrl = await generateQRDataUrl(element);
  }

  await renderElementViaPage(castId, slideIndex, element, variables, context, pngPath);
  layers.push(createLayerMetadata(element, layerIndex, pngPath));
}
```

## Performance Considerations

- **Single Playwright page reused** — navigate to new URL for each element, no page creation overhead.
- **Temp cache is in-memory** — no disk I/O for render data.
- **Tokens cleaned lazily** — no background timer pressure.
- **Render page is served once** — Express caches the compiled HTML (with inlined CSS/JS) at startup. Subsequent requests serve from memory.
- **Incremental rendering preserved** — hash-based skip logic still applies before calling `renderElementViaPage()`.

## Migration

1. Create `shared-renderer/styles.css` by consolidating `widget-styles.css` + element CSS from SlideRenderer.svelte
2. Add the three Express routes (render-element page, render-data POST/GET)
3. Update `SlideImageRenderer.js` to use `renderElementViaPage()` for all non-native elements
4. Update `SlideRenderer.svelte` to use CSS from `shared-renderer/styles.css`
5. Remove old `widget-styles.css` (contents moved to `styles.css`)
6. Remove old `renderViaPage()` and `generateElementDocument()` full-document generation
7. Force re-render all casts to regenerate layer PNGs via the new path
