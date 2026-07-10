# Full-Slide Rendering — One Page Load, Visibility Toggle Per Element

**Date:** 2026-03-27
**Status:** Approved
**Supersedes:** 2026-03-26-unified-render-page-v2-design.md (render flow only — keeps the shared CSS, render-data cache, and render-element page for debug use)

## Problem

The current render pipeline opens a Playwright page per element — 10-14 navigations per slide, each with font loading and DOM initialization. Rendering 8 slides takes 7+ minutes. Font timeouts and Chromium crashes on the Pi make it worse.

The browser renders the same slide in 10 seconds. The bottleneck is per-element Playwright overhead, not rendering itself.

## Solution

**One Playwright page per slide, all elements rendered at once, visibility toggled per element for isolated screenshots.**

- ONE page load per slide (not per element)
- ONE font resolution per slide
- N fast `evaluate()` + `screenshot(clip)` calls (~50-100ms each)
- Target: ~2 seconds per slide, ~16 seconds for 8 slides

## Render Flow

### Per slide:

```
renderSlide(castId, slideIndex, slide, variables)
  │
  ├─ Pre-fetch ALL widget primitives in parallel (existing)
  │
  ├─ Build slide render data: all non-native elements with positions, styles, primitives
  │
  ├─ POST /protocol/render-data → store full slide data → get token
  │
  ├─ Playwright: page.setViewportSize({ width: 1920, height: 1080 })
  │
  ├─ Playwright: page.goto(/protocol/render-element?token={token}&mode=slide)
  │   → Page renders ALL elements at their x,y positions
  │   → All elements start visibility: hidden
  │   → Page signals renderReady when all elements are rendered
  │
  ├─ For each non-native element:
  │   ├─ page.evaluate(showOnly, elementId)  → ~1ms
  │   ├─ page.screenshot({ clip: {x,y,w,h}, omitBackground: true })  → ~50-100ms
  │   ├─ page.evaluate(hideAll)  → ~1ms
  │   └─ Collect buffer
  │
  ├─ Batch write all PNGs to disk
  │
  └─ Save layers.json metadata
```

### For dynamic widget re-renders:

Same flow but for a single slide. The page is loaded fresh with current widget data. Still one page load, but only the widget's clip region is screenshotted. Or re-render the whole slide since it's only ~2 seconds.

## The Render Page (slide mode)

### URL

```
GET /protocol/render-element?token={token}&mode=slide
```

When `mode=slide`, the page renders ALL elements from the token data instead of a single element.

### Token Data (slide mode)

```json
{
  "mode": "slide",
  "elements": [
    {
      "id": "abc123",
      "type": "text",
      "position": { "x": 120, "y": 180 },
      "size": { "width": 700, "height": 94 },
      "style": { ... },
      "content": "APEX Athletics",
      ...
    },
    {
      "id": "def456",
      "type": "widget",
      "position": { "x": 1705, "y": 5 },
      "size": { "width": 193, "height": 80 },
      "_widgetPrimitives": [ ... ],
      ...
    }
  ],
  "variables": {},
  "context": {
    "currentGroupId": "...",
    "currentSlideIndex": 0,
    "assetBaseUrl": "..."
  }
}
```

### HTML Structure

```html
<div id="slide-container" style="width:1920px;height:1080px;position:relative;background:transparent">
  <div data-element-id="abc123"
       style="position:absolute;left:120px;top:180px;width:700px;height:94px;visibility:hidden;overflow:hidden">
    <!-- rendered text element HTML via renderTextElement() -->
  </div>
  <div data-element-id="def456"
       style="position:absolute;left:1705px;top:5px;width:193px;height:80px;visibility:hidden;overflow:hidden">
    <div class="widget-native" style="width:100%;height:100%">
      <!-- rendered widget primitives HTML -->
    </div>
  </div>
  <!-- ... all non-native elements -->
</div>
```

### Page JS (slide mode)

```javascript
if (data.mode === 'slide') {
  const container = document.getElementById('slide-container');
  // or create it
  document.documentElement.style.width = '1920px';
  document.documentElement.style.height = '1080px';
  document.body.style.width = '1920px';
  document.body.style.height = '1080px';

  const slideContainer = document.createElement('div');
  slideContainer.id = 'slide-container';
  slideContainer.style.cssText = 'width:1920px;height:1080px;position:relative;background:transparent';

  for (const element of data.elements) {
    const wrapper = document.createElement('div');
    wrapper.dataset.elementId = element.id;
    wrapper.style.cssText = `position:absolute;left:${element.position.x}px;top:${element.position.y}px;width:${element.size.width}px;height:${element.size.height}px;visibility:hidden;overflow:hidden`;
    wrapper.innerHTML = await renderElement(element, data.variables, data.context);
    slideContainer.appendChild(wrapper);
  }

  document.getElementById('render-container').appendChild(slideContainer);
  document.body.dataset.renderReady = 'true';
}
```

### Visibility Toggle Functions (exposed to window)

```javascript
window.showOnlyElement = function(elementId) {
  document.querySelectorAll('[data-element-id]').forEach(el => {
    el.style.visibility = el.dataset.elementId === elementId ? 'visible' : 'hidden';
  });
};

window.hideAllElements = function() {
  document.querySelectorAll('[data-element-id]').forEach(el => {
    el.style.visibility = 'hidden';
  });
};
```

## Server-Side Changes (SlideImageRenderer.js)

### New method: `renderSlideViaFullPage()`

Replaces the per-element loop in `renderSlide()`.

```javascript
async renderSlideViaFullPage(castId, slideIndex, slide, variables, options) {
  // 1. Collect all non-native elements with pre-fetched widget primitives
  const elements = sortedElements.filter(el => !isNativeElement(el));

  // 2. Store full slide data
  const token = await storeRenderData({
    mode: 'slide',
    elements: elements.map(el => ({
      ...el,
      _widgetPrimitives: el._widgetPrimitives || null
    })),
    variables,
    context: renderContext
  });

  // 3. Navigate once
  await this.renderPage.setViewportSize({ width: 1920, height: 1080 });
  await this.renderPage.goto(renderUrl + token, { waitUntil: 'domcontentloaded' });
  await this.renderPage.waitForFunction(() => document.body.dataset.renderReady === 'true');

  // 4. Screenshot each element via clip
  const buffers = [];
  for (const element of elements) {
    await this.renderPage.evaluate(id => window.showOnlyElement(id), element.id);

    const buffer = await this.renderPage.screenshot({
      type: 'png',
      omitBackground: true,
      clip: {
        x: element.position.x,
        y: element.position.y,
        width: element.size.width,
        height: element.size.height
      }
    });

    buffers.push({ element, buffer });
  }

  // 5. Hide all (cleanup)
  await this.renderPage.evaluate(() => window.hideAllElements());

  return buffers;
}
```

### Nav elements

Nav elements need multiple PNGs (one per highlight state). For nav:
- Render the nav element in the page with `focusedNavItemIndex = -1` (no highlight)
- Screenshot clip
- Then use `evaluate()` to update the nav's highlight state and re-screenshot for each item
- Or: render N copies of the nav element (one per state) at the same position, toggle visibility for each

Simplest: render nav with all states as separate hidden divs, each with a unique `data-element-id` like `{id}-nav-0`, `{id}-nav-1`, etc.

### Background layer

Background rendering still uses the existing `renderHtmlToPng()` path — it's a simple solid color/gradient, not worth changing.

## Performance Estimate

| Step | Current | New |
|------|---------|-----|
| Page loads per slide | 10-14 | 1 |
| Font resolutions per slide | 10-14 | 1 |
| Screenshots per slide | 10-14 | 10-14 (but clip, not full) |
| Time per element | 3-5s (goto + fonts + screenshot) | ~100ms (evaluate + clip screenshot) |
| **Total per slide** | **30-70s** | **~2s** |
| **8 slides** | **4-9 minutes** | **~16 seconds** |

## What Changes

| Component | Change |
|-----------|--------|
| `SlideImageRenderer.js` | New `renderSlideViaFullPage()` replaces per-element `renderElementViaPage()` calls in `renderSlide()` |
| `routes/protocol.js` render-element page | Add `mode=slide` handling — render all elements with positioning |
| `renderElementViaPage()` | Kept for single-element re-renders (debug, widget refresh) |
| Render-data token | Now stores full slide element array instead of single element |

## What Stays The Same

- Shared CSS (`shared-renderer/styles.css`)
- Render-data cache (tokens, TTL)
- Render-element page for single-element debug use
- Layer metadata format (layers.json)
- Incremental rendering (hash-based skip)
- Native element handling (metadata only)
- Buffered PNG writes
- Pre-fetch widget primitives in parallel
