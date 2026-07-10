/**
 * Protocol Routes - TV client protocol endpoints
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 *
 * Routes marked [public] don't require authentication (TV device access).
 * Auth-required routes (admin actions) have no modifier.
 */
import path from 'path';
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { formatElementForTV, formatSlide, isNativeElement } from '../utils/ProtocolFormatter.js';
import { findDiscoveredRokuForPairing, formatDiscoveredDevice } from '../utils/pairingHelpers.js';
import logger from '../utils/Logger.js';

// ==================== RENDER ELEMENT PAGE ASSET CACHE ====================

/**
 * Read the shared-renderer source files once at module load time and cache them.
 * These are inlined into the render-element HTML page sent to the browser.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHARED_RENDERER_DIR = path.resolve(__dirname, '../shared-renderer');

function loadRendererAssets() {
  try {
    const readSrc = (name) => readFileSync(path.join(SHARED_RENDERER_DIR, name), 'utf8');

    // Strip `export ` keyword so functions can be inlined into a plain <script> block.
    // Also strip `export default` at statement start.
    const stripExports = (src) => src
      .replace(/^export default /gm, '')
      .replace(/^export /gm, '');

    // Strip /* ... */ comments from the cached CSS. Browsers discard them at
    // parse time but they are inlined verbatim into every /protocol/render-element
    // response, and any comment text (e.g. a comment containing the word
    // "transition:") can spuriously trip determinism checks run over the raw
    // <style> body (see Kanban #1065 / #1072 and the test-hub no-animations
    // e2e spec). Stripping at cache load is a one-time defensive filter.
    const sharedCss = readSrc('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    // Build the inlined JS block: styleBuilder → widgetRenderer → elementRenderer
    // Each file imports from the others; we flatten them into one scope.
    const styleBuilderSrc = stripExports(readSrc('styleBuilder.js'));
    const widgetRendererSrc = stripExports(readSrc('widgetRenderer.js'));
    const elementRendererSrc = stripExports(readSrc('elementRenderer.js'));

    // Remove ES module import/export statements (single-line and multi-line).
    const removeImports = (src) => src.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '')
      .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, ''); // side-effect imports

    const inlinedJs = [
      '// ---- styleBuilder.js ----',
      removeImports(styleBuilderSrc),
      '// ---- widgetRenderer.js ----',
      removeImports(widgetRendererSrc),
      '// ---- elementRenderer.js ----',
      removeImports(elementRendererSrc),
    ].join('\n\n');

    return { sharedCss, inlinedJs };
  } catch (err) {
    logger.error(`Failed to load shared-renderer assets for render-element page: ${err.message}`);
    return { sharedCss: '', inlinedJs: '/* asset load error */' };
  }
}

const rendererAssets = loadRendererAssets();

/* HOTDEPLOY-TEST-MARKER-#886 */
/**
 * Build @font-face declarations for every Roku-bundled font weight.
 * Sources fonts from the slidecast font endpoint so the Playwright Chromium
 * loads the SAME font binaries Studio uses — fixing #1009 (bold text un-bolds).
 *
 * The corresponding font file lookup table must stay in sync with the
 * defaultFonts list in WidgetImageRenderer.loadFonts() (single source of truth).
 */
const FONT_FACE_DECLARATIONS = (() => {
  // Each bundled family ships as a single .ttf served from /protocol/font.
  // Variable fonts (fvar) cover the full weight axis (100 900); static
  // single-weight fonts declare weight 400 and rely on the browser's
  // faux-bold synthesis for heavier weights. Files live in
  // <DATA_DIR>/slidecast/fonts and are provisioned with the extension.
  const fonts = [
    { family: 'Inter', file: 'Inter.ttf', variable: true },
    { family: 'Roboto', file: 'Roboto.ttf', variable: true },
    { family: 'Open Sans', file: 'OpenSans.ttf', variable: true },
    { family: 'Montserrat', file: 'Montserrat.ttf', variable: true },
    { family: 'Oswald', file: 'Oswald.ttf', variable: true },
    { family: 'Playfair Display', file: 'PlayfairDisplay.ttf', variable: true },
    { family: 'Roboto Mono', file: 'RobotoMono.ttf', variable: true },
    { family: 'Lato', file: 'Lato.ttf', variable: false },
    { family: 'Poppins', file: 'Poppins.ttf', variable: false },
  ];
  return fonts.map((f) => `@font-face { font-family: '${f.family}'; font-style: normal; `
    + `font-weight: ${f.variable ? '100 900' : '400'}; `
    + `src: url('/api/extensions/slidecast/protocol/font/${encodeURIComponent(f.file)}') format('truetype'); `
    + 'font-display: block; }').join('\n    ');
})();

/**
 * Build the self-contained HTML page for rendering a single slidecast element.
 * @returns {string} Complete HTML document
 */
function buildRenderElementPage() {
  const { sharedCss, inlinedJs } = rendererAssets;

  return `<!DOCTYPE html>
<!-- HOTDEPLOY-TEST-MARKER-#886-IN-OUTPUT -->
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slidecast Element Renderer</title>
  <style>
    /* Task #1009: @font-face declarations injected so Chromium loads the same
     * font binaries Studio uses. font-display:block prevents FOIT-fallback
     * baking in the screenshot. document.fonts.ready is awaited below. */
    ${FONT_FACE_DECLARATIONS}

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { overflow: hidden; background: transparent; }
    #render-container { position: relative; overflow: hidden; }
    ${sharedCss}

    /* Debug overlay */
    #debug-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(0,0,0,0.8);
      color: #00ff00;
      font-family: monospace;
      font-size: 11px;
      padding: 8px;
      z-index: 9999;
      max-height: 40%;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div id="render-container"></div>
  <script type="module">
${inlinedJs}

// ---- render-element page logic ----

async function main() {
  const params = new URLSearchParams(window.location.search);
  const cast = params.get('cast');
  const slide = params.get('slide');
  const element = params.get('element');
  const mode = params.get('mode');
  const debug = params.get('debug') === 'true';
  // Optional context overrides (used by nav-highlight multi-state rendering).
  const focusedNavItemRaw = params.get('focusedNavItem');
  const currentGroupOverride = params.get('currentGroup');
  const currentSlideOverride = params.get('currentSlide');

  if (!cast || slide === null || slide === undefined) {
    document.body.innerHTML = '<div style="color:red;padding:16px">Missing parameters: provide cast+slide</div>';
    document.body.dataset.renderReady = 'true';
    return;
  }

  // Fetch render data directly from cast definition (no token indirection)
  let renderData;
  try {
    const resp = await fetch('/api/extensions/slidecast/protocol/slide-elements/' + encodeURIComponent(cast) + '/' + encodeURIComponent(slide));
    if (!resp.ok) {
      throw new Error('slide-elements fetch failed: ' + resp.status);
    }
    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to load slide elements');
    }

    // Apply optional context overrides from URL params.  These let the worker
    // request specific nav-highlight states without having to mutate the cast.
    const baseContext = Object.assign({}, data.context || {});
    if (focusedNavItemRaw !== null) {
      const n = parseInt(focusedNavItemRaw, 10);
      if (!isNaN(n)) baseContext.focusedNavItemIndex = n;
    }
    if (currentGroupOverride !== null) baseContext.currentGroupId = currentGroupOverride;
    if (currentSlideOverride !== null) {
      const n = parseInt(currentSlideOverride, 10);
      if (!isNaN(n)) baseContext.currentSlideIndex = n;
    }

    if (element !== null && element !== undefined && mode !== 'slide') {
      // Single element mode — element param can be a numeric index or an element ID
      let el;
      const elementInt = parseInt(element);
      if (!isNaN(elementInt) && elementInt >= 0 && elementInt < data.elements.length) {
        el = data.elements[elementInt];
      } else {
        el = data.elements.find(function(e) { return e.id === element; });
      }
      if (!el) {
        // The element was removed from the slide (a transient during a cast edit /
        // widget removal — a device that hasn't re-fetched yet may still request a
        // refresh for it). Render a blank/transparent layer rather than a loud red
        // error tile; the display self-heals on the next full re-render.
        document.body.innerHTML = '';
        document.body.dataset.renderReady = 'true';
        return;
      }
      renderData = { success: true, element: el, variables: data.variables || {}, context: baseContext };
    } else {
      // Slide mode — render all non-native elements
      renderData = { success: true, mode: 'slide', elements: data.elements, variables: data.variables || {}, context: baseContext };
    }
  } catch (err) {
    document.body.innerHTML = '<div style="color:red;padding:16px">Failed to load render data: ' + err.message + '</div>';
    document.body.dataset.renderReady = 'true';
    return;
  }

  if (renderData.mode === 'slide' || mode === 'slide') {
    // SLIDE MODE: render ALL elements at their positions
    document.documentElement.style.width = '1920px';
    document.documentElement.style.height = '1080px';
    document.body.style.width = '1920px';
    document.body.style.height = '1080px';

    const container = document.getElementById('render-container');
    container.style.width = '1920px';
    container.style.height = '1080px';
    container.style.position = 'relative';

    // Store element data on window for rerenderNavState
    window.__slideElements = {};
    window.__slideVariables = renderData.variables || {};
    window.__slideContext = Object.assign({}, renderData.context || {});

    for (const element of (renderData.elements || [])) {
      window.__slideElements[element.id] = element;
      const wrapper = document.createElement('div');
      wrapper.dataset.elementId = element.id;
      const pos = element.position || {};
      const size = element.size || {};
      wrapper.style.cssText = 'position:absolute;left:' + (pos.x||0) + 'px;top:' + (pos.y||0) + 'px;width:' + (size.width||100) + 'px;height:' + (size.height||100) + 'px;visibility:hidden;overflow:hidden';

      // Apply the cross-cutting wrapper effects from the shared getElementStyle()
      // (single source of truth in styleBuilder.js) so PNG layers match Studio:
      //  - border / borderRadius (box-sizing:border-box keeps them inside width/height)
      //  - gradient opacity mask (mask-image never grows the box)
      //  - blur / boxShadow / scale / skew / flip (applyBakedEffects) — these
      //    can paint OUTSIDE the box; that's now safe because the screenshot
      //    clip (SlideImageRenderer.renderSlideViaFullPage) AND the Roku layer
      //    x/y/width/height metadata are both EXPANDED to contain them via the
      //    shared expandRectForEffects() helper, and applyBakedEffects sets
      //    overflow:visible so they aren't cropped at the wrapper edge.
      // Deliberately NOT applied here:
      //  - opacity, rotation: forwarded as native per-layer Roku transforms
      //    (see SlideImageRenderer.js layerEntry / formatElementForTV) — Roku
      //    applies these to the flat PNG, so baking them in here too would
      //    double-apply them.
      try {
        const fullStyle = getElementStyle(element);
        if (fullStyle.border) wrapper.style.border = fullStyle.border;
        if (fullStyle.borderRadius) wrapper.style.borderRadius = fullStyle.borderRadius;
        if (fullStyle.maskImage) {
          wrapper.style.maskImage = fullStyle.maskImage;
          wrapper.style.webkitMaskImage = fullStyle.webkitMaskImage;
        }
        applyBakedEffects(wrapper, element);
      } catch (err) {
        // Non-fatal — fall back to the bare position/size wrapper above.
      }

      try {
        wrapper.innerHTML = await renderElement(element, renderData.variables || {}, renderData.context || {});
      } catch (err) {
        wrapper.innerHTML = '<div style="color:red;font-size:10px">' + err.message + '</div>';
      }
      container.appendChild(wrapper);
    }

    // Task #1009: wait for web fonts to finish loading before signalling ready,
    // otherwise Chromium screenshots fall back to default sans-serif and bold
    // weights silently degrade.
    // #blank-render: document.fonts.ready only confirms the font FILES downloaded,
    // NOT that the faces are applied to computed styles and painted. With
    // font-display:block, text in an unapplied face is invisible — a screenshot here
    // captures a blank/transparent layer. Force a layout BEFORE (so the faces the text
    // references begin loading) and AFTER (so loaded faces are applied), then a
    // double-rAF to commit a painted frame, before signalling ready.
    void document.body.offsetHeight;
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    } catch (e) {
      document.body.dataset.renderError = (document.body.dataset.renderError || '') + ' fonts:' + (e && e.message);
    }
    void document.body.offsetHeight;
    // Double-rAF commits a painted frame, bounded by a setTimeout so a cold compositor
    // that never fires rAF can't wedge renderReady forever (mirrors forcePaint's bound;
    // the worker's waitForFunction timeout is the outer backstop). #blank-render.
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 1000);
    });
    document.body.dataset.renderReady = 'true';
  } else {
    // SINGLE ELEMENT MODE
    if (!renderData.success || !renderData.element) {
      document.body.innerHTML = '<div style="color:red;padding:16px">Invalid render data</div>';
      document.body.dataset.renderReady = 'true';
      return;
    }

    const { element, variables = {}, context = {} } = renderData;

    // Size html/body/#render-container to match element size
    const w = element.size?.width || 100;
    const h = element.size?.height || 100;
    const elX = element.position?.x || 0;
    const elY = element.position?.y || 0;

    // Expand the canvas for paint-outside-the-box effects (blur/box-shadow/
    // scale>1/skew) so the single-element PNG matches the layer's EXPANDED
    // metadata rect (SlideImageRenderer reuses that rect on widget hot-refresh
    // and /rerender-element). No-op for effect-free elements — expanded === raw,
    // so the fast path below is byte-identical to the pre-change render.
    const expanded = expandRectForEffects(
      { x: elX, y: elY, width: w, height: h },
      element.style || {},
      { canvasWidth: 1920, canvasHeight: 1080 }
    );
    const isExpanded = expanded.width !== w || expanded.height !== h
      || expanded.x !== elX || expanded.y !== elY;

    const container = document.getElementById('render-container');

    // Render the element inner HTML
    let html = '';
    try {
      html = await renderElement(element, variables, context);
    } catch (err) {
      html = '<div style="color:red;padding:8px">Render error: ' + err.message + '</div>';
    }

    if (!isExpanded) {
      // Unchanged path: container is the raw element box, content fills it.
      document.documentElement.style.width = w + 'px';
      document.documentElement.style.height = h + 'px';
      document.body.style.width = w + 'px';
      document.body.style.height = h + 'px';
      container.style.width = w + 'px';
      container.style.height = h + 'px';
      container.innerHTML = html;
    } else {
      // Enlarge the canvas to the expanded rect and offset the raw-sized element
      // box inside it; applyBakedEffects paints the effects (overflow:visible).
      const cw = expanded.width;
      const ch = expanded.height;
      const offX = elX - expanded.x;
      const offY = elY - expanded.y;
      document.documentElement.style.width = cw + 'px';
      document.documentElement.style.height = ch + 'px';
      document.body.style.width = cw + 'px';
      document.body.style.height = ch + 'px';
      container.style.width = cw + 'px';
      container.style.height = ch + 'px';

      const wrapper = document.createElement('div');
      wrapper.dataset.elementId = element.id;
      wrapper.style.cssText = 'position:absolute;left:' + offX + 'px;top:' + offY
        + 'px;width:' + w + 'px;height:' + h + 'px;overflow:hidden';
      try {
        const fullStyle = getElementStyle(element);
        if (fullStyle.border) wrapper.style.border = fullStyle.border;
        if (fullStyle.borderRadius) wrapper.style.borderRadius = fullStyle.borderRadius;
        if (fullStyle.maskImage) {
          wrapper.style.maskImage = fullStyle.maskImage;
          wrapper.style.webkitMaskImage = fullStyle.webkitMaskImage;
        }
        applyBakedEffects(wrapper, element);
      } catch (err) {
        // Non-fatal — bare offset wrapper still positions the content correctly.
      }
      wrapper.innerHTML = html;
      container.innerHTML = '';
      container.appendChild(wrapper);
    }

    // Debug overlay
    if (debug) {
      const overlay = document.createElement('div');
      overlay.id = 'debug-overlay';
      overlay.textContent = JSON.stringify({ element, variables, context }, null, 2);
      document.body.appendChild(overlay);
    }

    // Task #1009: wait for web fonts to finish loading before signalling ready.
    // #blank-render: document.fonts.ready only confirms the font FILES downloaded,
    // NOT that the faces are applied to computed styles and painted. With
    // font-display:block, text in an unapplied face is invisible — a screenshot here
    // captures a blank/transparent layer. Force a layout BEFORE (so the faces the text
    // references begin loading) and AFTER (so loaded faces are applied), then a
    // double-rAF to commit a painted frame, before signalling ready.
    void document.body.offsetHeight;
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    } catch (e) {
      document.body.dataset.renderError = (document.body.dataset.renderError || '') + ' fonts:' + (e && e.message);
    }
    void document.body.offsetHeight;
    // Double-rAF commits a painted frame, bounded by a setTimeout so a cold compositor
    // that never fires rAF can't wedge renderReady forever (mirrors forcePaint's bound;
    // the worker's waitForFunction timeout is the outer backstop). #blank-render.
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 1000);
    });
    document.body.dataset.renderReady = 'true';
  }
}

/**
 * Render a single element to an HTML string.
 * Delegates to the inlined elementRenderer / widgetRenderer functions.
 */
async function renderElement(element, variables, context) {
  const scale = 1;

  switch (element.type) {
    case 'text':
      return renderTextElement(element, scale, variables);

    case 'shape':
      return renderShapeElement(element, scale);

    case 'widget': {
      // #1157: primitives-first, always. slide-elements now pre-computes
      // _widgetPrimitives for every widget element; if that plumbing fails
      // for any reason, self-heal by fetching /protocol/widget/<uuid>/render
      // directly. We deliberately do NOT fall back to elementRenderer's
      // UUID-sniffing placeholder path — an unrecognised widget must produce
      // a visibly-broken error tile, not a silent gray box.
      const preFetched = element._widgetPrimitives || context?.widgetPrimitives;
      if (preFetched) {
        const primitivesHtml = renderPrimitivesToHtml(preFetched, scale);
        return '<div class="widget-native">' + primitivesHtml + '</div>';
      }

      const widgetUuid = element.widgetUuid || element.widget_name || '';
      const config = element.widgetConfig || element.config || {};
      const styles = element.widgetStyles || element.styles || {};
      const size = element.size || { width: 100, height: 100 };

      let fetchErr = null;
      try {
        const resp = await fetch(
          '/api/extensions/slidecast/protocol/widget/' + encodeURIComponent(widgetUuid) + '/render',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config, styles, size })
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.primitives) {
            const primitivesHtml = renderPrimitivesToHtml(data.primitives, scale);
            return '<div class="widget-native">' + primitivesHtml + '</div>';
          }
          fetchErr = 'widget/render response had no primitives';
        } else {
          fetchErr = 'widget/render returned ' + resp.status;
        }
      } catch (err) {
        fetchErr = (err && err.message) || 'widget/render fetch threw';
      }

      // Self-heal failed — surface a loud, visibly-broken error tile so
      // screenshots make the failure obvious (no silent placeholders).
      console.error('[render-element] widget fallback failed for ' + widgetUuid + ': ' + fetchErr);
      return '<div class="widget-error" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#ff00ff;color:#fff;font-size:12px;padding:8px;text-align:center;">' +
        'Widget render failed<br/>' + widgetUuid + '<br/>' + (fetchErr || 'unknown') +
        '</div>';
    }

    case 'nav':
      return renderNavElement(
        element,
        scale,
        context.currentGroupId || null,
        context.currentSlideIndex || 0,
        context.focusedNavItemIndex !== undefined ? context.focusedNavItemIndex : -1
      );

    case 'qr':
    case 'qrcode':
      return renderQRElement(element, scale, '/api/extensions/slidecast/protocol/asset', context.qrDataUrl || null);

    case 'ping':
      return renderPingElement(element, scale);

    default:
      return renderElementToHtml(element, { scale, variables, context });
  }
}

// Bake the paint-outside-the-box effects onto an element wrapper so they land
// in the (expanded) screenshot: scale, skewX/skewY, blur, box-shadow, and flip.
// rotation + opacity are deliberately NOT applied — the Roku applies those
// natively to the flat PNG, so baking them here would double-apply. scale=1 in
// this page (no preview downscale), so magnitudes match Studio directly.
function applyBakedEffects(el, element) {
  const es = element.style || {};
  const transforms = [];
  if (es.scale && es.scale !== 1) transforms.push('scale(' + es.scale + ')');
  if (es.flipX) transforms.push('scaleX(-1)');
  if (es.flipY) transforms.push('scaleY(-1)');
  if (es.skewX) transforms.push('skewX(' + es.skewX + 'deg)');
  if (es.skewY) transforms.push('skewY(' + es.skewY + 'deg)');
  if (transforms.length > 0) {
    el.style.transform = transforms.join(' ');
    el.style.transformOrigin = 'center center';
  }
  if (es.blur && es.blur > 0) {
    el.style.filter = 'blur(' + es.blur + 'px)';
  }
  if (es.shadowEnabled) {
    const sx = (es.shadowX != null ? es.shadowX : 4);
    const sy = (es.shadowY != null ? es.shadowY : 4);
    const sb = (es.shadowBlur != null ? es.shadowBlur : 8);
    const col = es.shadowColor || '#000000';
    const op = (es.shadowOpacity != null ? es.shadowOpacity : 0.5);
    el.style.boxShadow = sx + 'px ' + sy + 'px ' + sb + 'px ' + hexToRgba(col, op);
  }
  // Relax clipping only when an effect can paint OUTSIDE the box. Flip alone
  // mirrors in place, so it keeps the wrapper's original overflow (no change).
  const expands = (es.blur && es.blur > 0) || es.shadowEnabled
    || (es.scale && es.scale > 1) || es.skewX || es.skewY;
  if (expands) el.style.overflow = 'visible';
}

window.showOnlyElement = function(elementId) {
  document.querySelectorAll('[data-element-id]').forEach(function(el) {
    el.style.visibility = el.dataset.elementId === elementId ? 'visible' : 'hidden';
  });
};

window.hideAllElements = function() {
  document.querySelectorAll('[data-element-id]').forEach(function(el) {
    el.style.visibility = 'hidden';
  });
};

// Re-render a nav element with a different focusedNavItemIndex (for highlight states)
window.rerenderNavState = async function(elementId, focusedNavItemIndex) {
  const el = document.querySelector('[data-element-id="' + elementId + '"]');
  if (!el) return false;
  const elementData = window.__slideElements && window.__slideElements[elementId];
  if (!elementData) return false;
  const ctx = window.__slideContext || {};
  ctx.focusedNavItemIndex = focusedNavItemIndex;
  try {
    el.innerHTML = await renderElement(elementData, window.__slideVariables || {}, ctx);
  } catch (e) { /* ignore */ }
  return true;
};

main().catch((err) => {
  console.error('render-element fatal error:', err);
  document.body.dataset.renderError = err.message || 'Unknown error';
  document.body.dataset.renderReady = 'true';
});
  </script>
</body>
</html>`;
}

/**
 * Flatten all slides from a cast definition (groups + direct slides) to a
 * plain array. Module-level pure helper so it can be reused by
 * `buildWidgetVersionsMapPure` and unit tests.
 */
export function flattenSlidesPure(definition) {
  const slides = [];
  for (const group of (definition?.groups || [])) {
    for (const slide of (group.slides || [])) {
      slides.push({ ...slide, groupId: group.id, groupName: group.name });
    }
  }
  for (const slide of (definition?.slides || [])) {
    slides.push(slide);
  }
  return slides;
}

/**
 * Pure version of `buildWidgetVersionsMap` (see inside createProtocolRoutes).
 * Accepts injected slideImageRenderer + fs-like module so it can be unit
 * tested without mounting the full extension. #1145.
 *
 * @param {object} cast - cast row: { uuid, definition }
 * @param {object} slideImageRenderer - must expose getSlideLayerMetadata(castId, slideIdx)
 *                                      and getSlideDir(castId, slideIdx)
 * @param {object} opts - { fsMod, pathMod, logger }
 * @returns {Promise<Record<string, number>>} widget_uuid -> unix-ms mtime
 */
export async function buildWidgetVersionsMapPure(cast, slideImageRenderer, opts = {}) {
  const fsMod = opts.fsMod || fs;
  const pathMod = opts.pathMod || path;
  const log = opts.logger || { debug: () => {} };
  const out = {};
  if (!cast?.definition || !slideImageRenderer?.getSlideLayerMetadata
      || !slideImageRenderer?.getSlideDir) {
    return out;
  }
  const castId = cast.uuid;
  const slides = flattenSlidesPure(cast.definition);
  const perSlideMetaCache = new Map();
  for (let slideIdx = 0; slideIdx < slides.length; slideIdx++) {
    const slide = slides[slideIdx];
    if (!slide?.elements?.length) continue;
    const widgetEls = slide.elements.filter(
      (el) => el && el.type === 'widget' && el.widgetUuid,
    );
    if (widgetEls.length === 0) continue;

    let metadata = perSlideMetaCache.get(slideIdx);
    if (metadata === undefined) {
      try {
        metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIdx);
      } catch (_e) {
        metadata = null;
      }
      perSlideMetaCache.set(slideIdx, metadata || null);
    }
    if (!metadata || !Array.isArray(metadata.layers)) continue;

    let slideDir = null;
    try {
      slideDir = slideImageRenderer.getSlideDir(castId, slideIdx);
    } catch (_e) {
      slideDir = null;
    }
    if (!slideDir) continue;

    for (const el of widgetEls) {
      const layer = metadata.layers.find((l) => l && l.id === el.id);
      if (!layer || !layer.file) continue;
      try {
        const st = await fsMod.stat(pathMod.join(slideDir, layer.file));
        const ms = st.mtimeMs || st.mtime?.getTime?.() || 0;
        if (!ms) continue;
        const prev = out[el.widgetUuid] || 0;
        if (ms > prev) out[el.widgetUuid] = Math.floor(ms);
      } catch (err) {
        log.debug(
          `cast-version: stat failed for widget ${el.widgetUuid} `
          + `(cast=${castId} slide=${slideIdx} file=${layer.file}): ${err.message}`,
        );
      }
    }
  }
  return out;
}

export default function createProtocolRoutes(deps) {
  const {
    castManager,
    screenManager,
    mediaLibrary,
    pairingManager,
    slideImageRenderer,
    renderTracker,
    widgetCache,
    widgetRefreshService,
    widgetRegistry,
    widgetRuntime,
    widgetResolver,
    updateTracker,
    api,
    eventBus,
  } = deps;

  // ==================== SHARED INTERNAL HELPERS ====================

  // ---- Native widget support (render on-device instead of a server PNG) --------
  // Which widgets a capable player can render natively. Extend as more are added.
  function getNativeWidgetType(uuid) {
    if (!uuid) return null;
    if (String(uuid).startsWith('seed-widget-current-weather')) return 'weather';
    return null;
  }
  // TTL cache of produced widget DATA keyed by uuid+config, so the widget-data
  // endpoint (polled by native players) doesn't hit the upstream API each poll.
  // Bounded (LRU-evicted via setBoundedCache) so a long-uptime appliance can't
  // grow it without limit as uuid/config combinations vary; the per-entry TTL
  // (by refreshInterval, below) is unchanged. #BUG-7.
  const NATIVE_WIDGET_DATA_CACHE_MAX = 128;
  const nativeWidgetDataCache = new Map(); // key -> { data, at }
  async function getNativeWidgetData(uuid, castId, elementId) {
    if (!widgetResolver) return null;
    let config = {};
    let styles = {};
    let size;
    try {
      if (castId) {
        const cast = await castManager.getByUuid(castId);
        const def = cast && (typeof cast.definition === 'string' ? JSON.parse(cast.definition) : cast.definition);
        const slides = def ? flattenSlidesPure(def) : [];
        let el = null;
        for (const s of slides) {
          for (const e of (s.elements || [])) {
            if ((elementId && e.id === elementId) || e.widgetUuid === uuid) { el = e; break; }
          }
          if (el) break;
        }
        if (el) {
          config = el.widgetConfig || el.config || {};
          styles = el.widgetStyles || el.styles || {};
          size = el.size;
        }
      }
    } catch (e) { /* fall back to widget defaults */ }

    const resolved = await widgetResolver.resolve(uuid);
    if (!resolved) return null;
    const ttl = (resolved.refreshInterval && resolved.refreshInterval > 0) ? resolved.refreshInterval : 300000;
    const key = `${uuid}|${JSON.stringify(config)}`;
    const now = Date.now();
    const cached = nativeWidgetDataCache.get(key);
    if (cached && (now - cached.at) < ttl) return cached.data;
    const produced = await resolved.produce({ config, styles, size: size || resolved.defaultSize });
    const data = produced && produced.data ? produced.data : null;
    if (data) setBoundedCache(nativeWidgetDataCache, key, { data, at: now }, NATIVE_WIDGET_DATA_CACHE_MAX);
    return data;
  }

  // ---- Per-cast poll-path memoization ----------------------------------------
  // WHY: every screen polls GET /protocol/cast-version every ~10s, and /content
  // + /boot re-run the same per-cast work that is IDENTICAL across all screens on
  // a cast. These small, bounded caches collapse that duplicated recomputation.
  // (CastManager.getByUuid is already WHERE-scoped + cached — this covers the
  // remaining per-cast work: the widget-versions map and the formatted cast.)

  // Bound so a long-uptime appliance can't grow these without limit (LRU-evicted).
  const WIDGET_VERSIONS_MAP_CACHE_MAX = 256;
  const FORMAT_CAST_CACHE_MAX = 128;
  // Backstop TTL for the widget-versions map: it depends on on-disk layer PNG
  // mtimes, which a widget re-render changes WITHOUT bumping castVersion. Event
  // invalidation (below) handles the common case promptly; this bounds any
  // missed-invalidation staleness (races, full-slide re-renders) to <5s — well
  // under the 10s poll cycle. Mirrors the existing widgetMetaCache TTL.
  const WIDGET_VERSIONS_MAP_TTL_MS = 5000;
  // Backstop TTL for the formatted-cast cache. The key already pins the exact
  // volatile inputs (castVersion from updated_at + the refresh-interval
  // signature), so a normal edit yields a fresh key rather than a stale hit —
  // but before this the entry lived forever (only LRU-evicted), so a definition
  // change that did NOT bump updated_at (e.g. import/reconcile) could be served
  // stale indefinitely. Event invalidation (below) handles that promptly; this
  // TTL bounds any missed-invalidation staleness. #BUG-6.
  const FORMAT_CAST_TTL_MS = 30000;

  // castId:castVersion -> { value, ts }
  const widgetVersionsMapCache = new Map();
  // castId:castVersion:refreshIntervalSignature -> { value, ts }
  const formatCastCache = new Map();

  /** Set into a bounded Map with LRU eviction (Map keys iterate oldest-first). */
  function setBoundedCache(map, key, value, max) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  /** Drop every widget-versions-map entry for a cast (all versions). */
  function invalidateWidgetVersionsForCast(castId) {
    const prefix = `${castId}:`;
    for (const k of widgetVersionsMapCache.keys()) {
      if (k.startsWith(prefix)) widgetVersionsMapCache.delete(k);
    }
  }

  /** Drop every formatted-cast entry for a cast (all versions/signatures). */
  function invalidateFormatCastForCast(castId) {
    const prefix = `${castId}:`;
    for (const k of formatCastCache.keys()) {
      if (k.startsWith(prefix)) formatCastCache.delete(k);
    }
  }

  // A widget layer re-render (WidgetRefreshService → SlideImageRenderer.
  // reRenderWidgetLayer) rewrites the layer PNG on disk — changing the mtime that
  // feeds the widget-versions map — WITHOUT bumping castVersion. Invalidate the
  // cached map for that cast so the next cast-version poll rebuilds it. The TTL
  // above backstops any race where this fires before the PNG write fully lands.
  //
  // BUG-3b: createProtocolRoutes runs on EVERY extension init/reload/hot-deploy,
  // but `eventBus` is the process-global bus that survives reloads. Adding a
  // fresh listener each time without removing the prior one leaked handlers on
  // the shared bus (EventEmitter MaxListeners warning) and multiplied every
  // invalidation N-fold after N reloads. protocol.js receives `api`, not `ctx`,
  // so ctx.onDestroy isn't reachable here, and hot-reload re-imports this module
  // fresh (module scope can't remember the prior handler). So we tag each handler
  // with a stable global Symbol and sweep any previously-registered instance off
  // the bus before adding the new one — leaving exactly one live listener per
  // event across any number of reloads.
  const BUS_LISTENER_TAG = Symbol.for('slidecast.protocol.busListener');
  function registerBusListener(event, handler) {
    if (!eventBus || typeof eventBus.on !== 'function') return;
    handler[BUS_LISTENER_TAG] = event;
    if (typeof eventBus.listeners === 'function' && typeof eventBus.off === 'function') {
      for (const prev of eventBus.listeners(event)) {
        if (prev && prev[BUS_LISTENER_TAG] === event) eventBus.off(event, prev);
      }
    }
    eventBus.on(event, handler);
  }

  registerBusListener('widget:layer_updated', ({ castId } = {}) => {
    if (castId) invalidateWidgetVersionsForCast(castId);
  });
  // A cast definition change (import/reconcile) may not bump updated_at, so the
  // caches keyed by castVersion could otherwise serve a stale formatted cast or
  // widget-versions map. Drop both for the affected cast promptly. #BUG-6.
  registerBusListener('cast:definition_changed', ({ castId } = {}) => {
    if (!castId) return;
    invalidateWidgetVersionsForCast(castId);
    invalidateFormatCastForCast(castId);
  });

  // #1141: per-screen debounce for the implicit heartbeat fired by
  // /protocol/cast-version. Keyed by serial, value is last ms timestamp.
  const castVersionHeartbeatLastAt = new Map();
  const CAST_VERSION_HEARTBEAT_DEBOUNCE_MS = 5000;

  /**
   * Update screen heartbeat from a /protocol/cast-version poll, but only if
   * the last implicit heartbeat for this screen was more than
   * CAST_VERSION_HEARTBEAT_DEBOUNCE_MS ago. Swallows errors so a DB hiccup
   * never breaks the polling response.
   *
   * Exposed on the returned route object for testability.
   */
  async function maybeHeartbeatFromCastVersion(screenSerial) {
    const now = Date.now();
    const last = castVersionHeartbeatLastAt.get(screenSerial) || 0;
    if (now - last < CAST_VERSION_HEARTBEAT_DEBOUNCE_MS) {
      return { skipped: true, reason: 'debounced' };
    }
    castVersionHeartbeatLastAt.set(screenSerial, now);
    try {
      await screenManager.heartbeat(screenSerial, {});
      return { skipped: false };
    } catch (err) {
      logger.warn(
        `cast-version implicit heartbeat failed for ${screenSerial}: ${err.message}`,
      );
      return { skipped: true, reason: 'error', error: err.message };
    }
  }

  /**
   * Resolve castId: numeric ID to UUID, passthrough if already UUID
   */
  async function resolveCastId(castId) {
    if (/^\d+$/.test(castId)) {
      try {
        const cast = await castManager.getById(parseInt(castId, 10));
        if (cast && cast.uuid) {
          return cast.uuid;
        }
      } catch (err) {
        logger.debug(`Failed to look up cast ${castId}: ${err.message}`);
      }
    }
    return castId;
  }

  /**
   * Extract all widget UUIDs from a cast definition (groups + direct slides)
   */
  function extractWidgetUuids(definition) {
    const uuids = new Set();

    if (definition?.groups) {
      for (const group of definition.groups) {
        if (group.slides) {
          for (const slide of group.slides) {
            if (slide.elements) {
              for (const element of slide.elements) {
                if (element.type === 'widget' && element.widgetUuid) {
                  uuids.add(element.widgetUuid);
                }
              }
            }
          }
        }
      }
    }

    if (definition?.slides) {
      for (const slide of definition.slides) {
        if (slide.elements) {
          for (const element of slide.elements) {
            if (element.type === 'widget' && element.widgetUuid) {
              uuids.add(element.widgetUuid);
            }
          }
        }
      }
    }

    return uuids;
  }

  /**
   * Flatten all slides from a cast definition's groups + direct slides.
   * Returns array of slide objects augmented with groupId/groupName.
   */
  function flattenSlides(definition) {
    const slides = [];
    for (const group of (definition?.groups || [])) {
      for (const slide of (group.slides || [])) {
        slides.push({ ...slide, groupId: group.id, groupName: group.name });
      }
    }
    return slides;
  }

  // #1177: Short-TTL cache for widget metadata to avoid hammering the DB on
  // rapid cast-version polls. Keyed by widget UUID → { refreshInterval, ts }.
  // TTL is intentionally short (5s) so admin changes to
  // slidecast_widgets.refresh_interval propagate to the Roku within one
  // cast-version poll cycle without requiring a container restart.
  const widgetMetaCache = new Map();
  const WIDGET_META_TTL_MS = 5000;

  async function getFreshWidgetMeta(uuid) {
    if (!uuid || !widgetRegistry?.getByUuid) return null;
    const cached = widgetMetaCache.get(uuid);
    const now = Date.now();
    if (cached && (now - cached.ts) < WIDGET_META_TTL_MS) {
      return cached.meta;
    }
    try {
      const widget = await widgetRegistry.getByUuid(uuid);
      const meta = widget
        ? { refreshInterval: widget.refreshInterval != null ? widget.refreshInterval : null }
        : null;
      widgetMetaCache.set(uuid, { meta, ts: now });
      return meta;
    } catch (err) {
      logger.debug(`getFreshWidgetMeta: lookup failed for ${uuid}: ${err.message}`);
      return null;
    }
  }

  /**
   * Build a map of widgetUuid → fresh metadata for every widget referenced by
   * the cast definition. Used to inject up-to-date refresh_interval values
   * into widget elements before they reach the Roku (#1177).
   */
  async function buildWidgetMetaMap(definition) {
    const uuids = extractWidgetUuids(definition);
    const map = new Map();
    await Promise.all(Array.from(uuids).map(async (uuid) => {
      const meta = await getFreshWidgetMeta(uuid);
      if (meta) map.set(uuid, meta);
    }));
    return map;
  }

  /**
   * Build { widget_uuid -> unix-ms mtime } for every widget referenced by
   * the cast, using the rendered layer PNG on disk as the source of truth.
   *
   * This matches /debug/widgets (#1142) and supersedes the old
   * slidecast_widget_cache query (which was perpetually empty for
   * slide-layer-rendered casts — #1145).
   *
   * Exported onto the factory-level helpers so it can be unit-tested with
   * injected fakes.
   */
  async function buildWidgetVersionsMap(cast) {
    // Memoized per (castId, castVersion): the cast-version poll recomputes this
    // identical map for every screen on the cast every ~10s (flattening slides,
    // parsing layers.json per widget-slide, fs.stat on every layer PNG). Keyed by
    // castVersion (cast edits invalidate) + event/TTL invalidation for re-renders.
    const key = `${cast.uuid}:${getCastVersion(cast)}`;
    const cached = widgetVersionsMapCache.get(key);
    if (cached && (Date.now() - cached.ts) < WIDGET_VERSIONS_MAP_TTL_MS) {
      return cached.value;
    }
    const value = await buildWidgetVersionsMapPure(cast, slideImageRenderer, {
      fsMod: fs,
      pathMod: path,
      logger,
    });
    const entry = { value, ts: Date.now() };
    setBoundedCache(widgetVersionsMapCache, key, entry, WIDGET_VERSIONS_MAP_CACHE_MAX);
    return value;
  }

  /**
   * Shallow-clone a slide and override `refreshInterval` on its widget
   * elements with the fresh registry value (if available). Returns a new
   * slide object; does not mutate the input.
   */
  function enrichSlideWithWidgetMeta(slide, widgetMetaMap) {
    if (!slide || !slide.elements) return slide;
    const enrichedElements = slide.elements.map((el) => {
      if (el?.type !== 'widget' || !el.widgetUuid) return el;
      const meta = widgetMetaMap.get(el.widgetUuid);
      if (!meta || meta.refreshInterval == null) return el;
      // Registry is authoritative for refresh cadence: DB updates propagate
      // without a container restart (#1177). Per-element overrides in the
      // cast definition are ignored for this field.
      return { ...el, refreshInterval: meta.refreshInterval };
    });
    return { ...slide, elements: enrichedElements };
  }

  /**
   * Format a full cast for TV protocol consumption.
   * Shared between /protocol/content, /protocol/boot, and batch handlers.
   */
  /**
   * Deterministic signature of the widget refresh-interval map. Included in the
   * formatCastForTV cache key so a DB-side refresh_interval change (#1177) — which
   * does NOT bump castVersion — still produces a cache miss and re-enriches.
   */
  function widgetMetaSignature(widgetMetaMap) {
    if (!widgetMetaMap || widgetMetaMap.size === 0) return '';
    return Array.from(widgetMetaMap.entries())
      .map(([uuid, meta]) => `${uuid}=${meta?.refreshInterval ?? ''}`)
      .sort()
      .join(',');
  }

  async function formatCastForTV(cast) {
    const variables = cast.definition?.variables || {};
    const updatedAt = cast.updated_at || cast.created_at || Date.now();
    const castVersion = `${cast.uuid}-${new Date(updatedAt).getTime()}`;

    // #1177: Fetch fresh widget metadata so DB-side refresh_interval updates
    // propagate to the Roku on the next cast-version poll without restart.
    // (getFreshWidgetMeta already caches registry lookups for 5s.)
    const widgetMetaMap = await buildWidgetMetaMap(cast.definition);

    // Memoized per (castId, castVersion, refresh-interval signature): /content and
    // /boot re-walk every group + slide (enrichSlideWithWidgetMeta + formatSlide) —
    // identical across all screens on a cast. castVersion covers definition edits;
    // the signature covers the only other volatile input (refresh_interval), so the
    // cached value is always identical to a fresh recompute.
    const cacheKey = `${cast.uuid}:${castVersion}:${widgetMetaSignature(widgetMetaMap)}`;
    const cachedFormat = formatCastCache.get(cacheKey);
    if (cachedFormat && (Date.now() - cachedFormat.ts) < FORMAT_CAST_TTL_MS) {
      return cachedFormat.value;
    }

    const formattedCast = {
      id: cast.uuid,
      name: cast.name,
      description: cast.description,
      version: castVersion,
      updated_at: updatedAt,
      variables,
      groups: [],
      slides: [],
    };

    const groups = cast.definition?.groups || [];
    const directSlides = cast.definition?.slides || [];

    let slideIndex = 0;
    for (const group of groups) {
      const formattedGroup = {
        id: group.id,
        name: group.name,
        slides: [],
      };

      for (const slide of (group.slides || [])) {
        const enriched = enrichSlideWithWidgetMeta(slide, widgetMetaMap);
        const formatted = formatSlide(enriched, slideIndex, group, variables, cast.uuid);
        formattedGroup.slides.push(formatted);
        formattedCast.slides.push(formatted);
        slideIndex++;
      }

      formattedCast.groups.push(formattedGroup);
    }

    // Also handle direct slides (legacy format)
    for (const slide of directSlides) {
      const enriched = enrichSlideWithWidgetMeta(slide, widgetMetaMap);
      const formatted = formatSlide(enriched, slideIndex, null, variables, cast.uuid);
      formattedCast.slides.push(formatted);
      slideIndex++;
    }

    setBoundedCache(formatCastCache, cacheKey, { value: formattedCast, ts: Date.now() }, FORMAT_CAST_CACHE_MAX);
    return formattedCast;
  }

  /**
   * Generate a cast version string from a cast row.
   */
  function getCastVersion(cast) {
    const updatedAt = cast.updated_at || cast.created_at || Date.now();
    return `${cast.uuid}-${new Date(updatedAt).getTime()}`;
  }

  /**
   * Try to auto-assign the default cast to a newly-created screen.
   * Returns { id, name } of the assigned cast or null.
   */
  async function tryAutoAssignDefaultCast(ctx, screenSerial) {
    try {
      const settingsModel = api.model('slidecast_settings');
      const [autoAssignSetting, defaultCastSetting] = await Promise.all([
        settingsModel.findOne({ key: 'auto_assign_default_cast' }),
        settingsModel.findOne({ key: 'default_cast_id' }),
      ]);

      if (autoAssignSetting?.value === 'true' && defaultCastSetting?.value) {
        const cast = await castManager.getByUuid(defaultCastSetting.value);
        if (cast) {
          await screenManager.assignCast(screenSerial, defaultCastSetting.value);
          logger.info(`Auto-assigned default cast "${cast.name}" to screen ${screenSerial}`);
          return { id: defaultCastSetting.value, name: cast.name };
        }
      }
    } catch (err) {
      logger.warn(`Failed to auto-assign default cast: ${err.message}`);
    }
    return null;
  }

  /**
   * Trigger a background render for a specific slide, non-blocking.
   * Shared between /protocol/boot and /protocol/slide-layers.
   */
  function triggerBackgroundRender(castId, slideIndex, slide, variables, opts = {}) {
    const { force = false, priority = false } = opts;

    if (!renderTracker) return;

    const doRender = () => {
      console.log(`[RenderTracker] doRender called: cast=${castId} slide=${slideIndex} active=${renderTracker.activeRenders.size} queued=${renderTracker.getQueueSize()}`);
      renderTracker.startRender(castId, slideIndex);
      (async () => {
        try {
          await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { force });
          console.log(`[RenderTracker] renderSlide complete: cast=${castId} slide=${slideIndex}`);
          renderTracker.completeRender(castId, slideIndex);
          logger.debug(`Render complete: cast=${castId} slide=${slideIndex}`);
        } catch (err) {
          console.log(`[RenderTracker] renderSlide failed: cast=${castId} slide=${slideIndex} err=${err.message}`);
          logger.warn(`Background render failed: ${castId}/${slideIndex} - ${err.message}`);
          renderTracker.failRender(castId, slideIndex, err);
        }
      })();
    };

    if (renderTracker.canStartRender()) {
      doRender();
    } else {
      renderTracker.queueRender(castId, slideIndex, doRender, priority);
    }
  }

  // ==================== BATCH INTERNAL HANDLERS ====================
  // Used by both the individual routes and the batch endpoint.

  async function handleManifest(castId, params) {
    const resolvedCastId = await resolveCastId(castId);

    // Validate token if provided
    if (params.token) {
      const validation = await pairingManager.validateToken(params.token);
      if (!validation.valid) {
        throw new Error('Invalid token');
      }
    }

    const cast = await castManager.getByUuid(resolvedCastId);
    if (!cast) {
      throw new Error('Cast not found');
    }

    // Build manifest
    const slides = [];
    const widgetMap = new Map();

    for (const group of (cast.definition?.groups || [])) {
      for (const slide of (group.slides || [])) {
        const slideIndex = slides.length;
        const duration = slide.duration || group.defaultDuration || 10000;
        slides.push({
          index: slideIndex, id: slide.id, name: slide.name, duration, groupId: group.id,
        });

        for (const element of (slide.elements || [])) {
          if (element.type === 'widget' && element.widgetUuid) {
            if (!widgetMap.has(element.widgetUuid)) {
              widgetMap.set(element.widgetUuid, {
                id: element.widgetUuid,
                refreshInterval: element.refreshInterval || 60000,
                usedOnSlides: [],
              });
            }
            widgetMap.get(element.widgetUuid).usedOnSlides.push(slideIndex);
          }
        }
      }
    }

    // Also handle direct slides (legacy format)
    for (const slide of (cast.definition?.slides || [])) {
      const slideIndex = slides.length;
      const duration = slide.duration || 10000;

      slides.push({
        index: slideIndex, id: slide.id, name: slide.name, duration, groupId: null,
      });

      for (const element of (slide.elements || [])) {
        if (element.type === 'widget' && element.widgetUuid) {
          if (!widgetMap.has(element.widgetUuid)) {
            widgetMap.set(element.widgetUuid, {
              id: element.widgetUuid,
              refreshInterval: element.refreshInterval || 60000,
              usedOnSlides: [],
            });
          }
          widgetMap.get(element.widgetUuid).usedOnSlides.push(slideIndex);
        }
      }
    }

    // Build cache status
    const cachedSlides = [];
    const renderingSlides = [];
    const staleSlides = [];

    if (slideImageRenderer) {
      const castUpdateTime = new Date(cast.updated_at || 0).getTime();

      for (let i = 0; i < slides.length; i++) {
        if (renderTracker && renderTracker.isRendering(resolvedCastId, i)) {
          renderingSlides.push(i);
          continue;
        }

        const metadata = await slideImageRenderer.getSlideLayerMetadata(resolvedCastId, i);
        if (metadata) {
          const renderTime = new Date(metadata.generatedAt || 0).getTime();
          if (renderTime >= castUpdateTime) {
            cachedSlides.push(i);
          } else {
            staleSlides.push(i);
          }
        }
      }
    }

    const castVersion = getCastVersion(cast);

    // Build prefetch strategy based on slide count
    const totalSlides = slides.length;
    const prefetchAhead = Math.min(2, totalSlides - 1);
    const prefetchBehind = Math.min(1, totalSlides - 1);

    // Priority slides: first slide and any slides with video backgrounds
    const prioritySlides = [0];
    const allRawSlides = (cast.definition?.groups || []).flatMap((g) => g.slides || [])
      .concat(cast.definition?.slides || []);
    for (let i = 0; i < allRawSlides.length; i++) {
      if (allRawSlides[i]?.background?.type === 'video') {
        if (!prioritySlides.includes(i)) {
          prioritySlides.push(i);
        }
      }
    }

    return {
      success: true,
      cast: { id: cast.uuid, name: cast.name, version: castVersion },
      totalSlides,
      slideDurations: slides.map((s) => s.duration),
      prefetchStrategy: {
        ahead: prefetchAhead,
        behind: prefetchBehind,
        priority: prioritySlides,
      },
      widgets: Array.from(widgetMap.values()),
      cacheStatus: {
        cachedSlides,
        renderingSlides,
        staleSlides,
      },
    };
  }

  /**
   * Enrich layer metadata (from layers.json) with per-layer debug fields (#1143):
   *   - created_at:                 ISO mtime of the layer PNG on disk (null if missing)
   *   - widget_refresh_interval_ms: refreshInterval from widgetRegistry for widget layers
   *
   * Shared by /protocol/slide-layers HTTP route and the WebSocket dispatch path
   * so /ext/slidecast/debug sees the same enriched shape regardless of transport.
   */
  async function enrichLayerMetadata(resolvedCastId, idx, metadata) {
    if (!metadata || !Array.isArray(metadata.layers)) return metadata;
    try {
      const slideDir = slideImageRenderer?.getSlideDir
        ? slideImageRenderer.getSlideDir(resolvedCastId, idx)
        : null;

      const widgetMetaCache = new Map();
      // Resolve refreshInterval + interactions once per uuid, via the unified
      // resolver (so extension-provider widgets are handled too), falling back
      // to the DB registry when no resolver is wired.
      const getWidgetMeta = async (uuid) => {
        if (!uuid) return null;
        if (widgetMetaCache.has(uuid)) return widgetMetaCache.get(uuid);
        let meta = null;
        try {
          if (widgetResolver) {
            const resolved = await widgetResolver.resolve(uuid);
            if (resolved) {
              meta = {
                refreshInterval: resolved.refreshInterval ?? null,
                interactions: resolved.interactions || [],
              };
            }
          } else if (widgetRegistry) {
            const widget = await widgetRegistry.getByUuid(uuid);
            if (widget) meta = { refreshInterval: widget.refreshInterval ?? null, interactions: [] };
          }
        } catch (err) {
          logger.debug(`enrichLayerMetadata: widget lookup failed for ${uuid}: ${err.message}`);
        }
        widgetMetaCache.set(uuid, meta);
        return meta;
      };

      const enrichedLayers = await Promise.all(metadata.layers.map(async (layer) => {
        const out = { ...layer };

        if (slideDir) {
          if (layer.file) {
            try {
              const st = await fs.stat(path.join(slideDir, layer.file));
              out.created_at = st.mtime.toISOString();
            } catch {
              out.created_at = null;
            }
          } else if (Array.isArray(layer.files)) {
            out.files = await Promise.all(layer.files.map(async (f) => {
              if (!f || !f.file) return f;
              try {
                const st = await fs.stat(path.join(slideDir, f.file));
                return { ...f, created_at: st.mtime.toISOString() };
              } catch {
                return { ...f, created_at: null };
              }
            }));
          } else {
            out.created_at = null;
          }
        }

        if (layer.type === 'widget') {
          const uuid = layer.widgetUuid || layer.element?.widgetUuid;
          const meta = await getWidgetMeta(uuid);
          out.widget_refresh_interval_ms = meta?.refreshInterval ?? null;
          // #1144: hoist widgetUuid to the top level so the Roku can correlate
          // active widget layers with the widget_versions map returned by
          // /protocol/cast-version. Without this the Roku can't know which
          // widget a given layer PNG represents.
          if (uuid) out.widgetUuid = uuid;
          // Interactive widgets: surface focusable actions so the device can give
          // the layer D-pad focus and POST /protocol/interaction on OK-press.
          if (meta?.interactions?.length) {
            out.interactive = { actions: meta.interactions };
          }
          // Native widgets: tag the layer so a capable player renders the widget
          // natively on-device (fetching data from /protocol/widget-data/:uuid)
          // instead of the PNG. The PNG stays as a fallback for older players.
          const nativeType = getNativeWidgetType(uuid);
          if (nativeType) {
            out.nativeWidget = { type: nativeType, uuid, refreshInterval: meta?.refreshInterval ?? 300000 };
          }
        }

        return out;
      }));

      return { ...metadata, layers: enrichedLayers };
    } catch (err) {
      logger.warn(`enrichLayerMetadata failed: ${err.message}`);
      return metadata;
    }
  }

  async function handleSlideLayers(castId, slideIndex, params) {
    const resolvedCastId = await resolveCastId(castId);
    const idx = parseInt(slideIndex, 10);

    // Check cache status
    const isRendering = renderTracker && renderTracker.isRendering(resolvedCastId, idx);

    const rawMetadata = await slideImageRenderer?.getSlideLayerMetadata(resolvedCastId, idx);
    const metadata = rawMetadata ? await enrichLayerMetadata(resolvedCastId, idx, rawMetadata) : null;
    if (metadata) {
      // Serve existing layers even while re-rendering (old files still on disk).
      // Enriched with created_at + widget_refresh_interval_ms per #1143.
      return { status: isRendering ? 'rendering' : 'cached', ...metadata };
    }

    if (isRendering) {
      return { status: 'rendering', retry_after: 2 };
    }

    return { status: 'not_rendered' };
  }

  async function handleWidgetVersions(params) {
    const { cast_id } = params;
    if (!cast_id) throw new Error('cast_id required');

    const cast = await castManager.getByUuid(cast_id);
    if (!cast) throw new Error('Cast not found');

    const widgetUuids = extractWidgetUuids(cast.definition);

    const versions = {};
    for (const uuid of widgetUuids) {
      versions[uuid] = 'cached'; // Simplified for batch
    }

    return { widgets: versions };
  }

  async function handleContent(params) {
    const { token } = params;
    if (!token) throw new Error('Token required');

    const validation = await pairingManager.validateToken(token);
    if (!validation.valid) throw new Error('Invalid token');

    const { assigned_cast } = validation;
    if (!assigned_cast) return { cast: null };

    const cast = await castManager.getByUuid(assigned_cast);
    if (!cast) throw new Error('Cast not found');

    return { cast_id: cast.uuid, name: cast.name, slide_count: (cast.definition?.groups || []).flatMap((g) => g.slides || []).length };
  }

  async function handleCastVersion(params) {
    const { token } = params;
    if (!token) throw new Error('Token required');

    const validation = await pairingManager.validateToken(token);
    if (!validation.valid) throw new Error('Invalid token');

    const { assigned_cast } = validation;
    if (!assigned_cast) return { version: null };

    const cast = await castManager.getByUuid(assigned_cast);
    if (!cast) return { version: null };

    return { version: getCastVersion(cast) };
  }

  async function handleScreenStatus(token) {
    if (!token) throw new Error('Token required');

    const validation = await pairingManager.validateToken(token);
    if (!validation.valid) throw new Error('Invalid token');

    const {
      device_serial, assigned_cast, screen_name, device_name,
    } = validation;

    // Get screen from manager if exists
    const screen = device_serial ? await screenManager.getBySerial(device_serial) : null;

    // Get cast info if assigned
    let castInfo = null;
    if (assigned_cast) {
      const cast = await castManager.getByUuid(assigned_cast);
      if (cast) {
        castInfo = {
          uuid: cast.uuid,
          name: cast.name,
          updated_at: cast.updated_at,
          slide_count: (cast.definition?.groups || []).flatMap((g) => g.slides || []).length,
        };
      }
    }

    return {
      status: 'online',
      device_serial,
      screen_name: screen?.name || screen_name || device_name,
      assigned_cast,
      cast: castInfo,
      settings: screen?.settings || {},
    };
  }

  // ==================== ROUTE DEFINITIONS ====================

  return {
    // ==================== PAIRING FLOW ====================

    // Request pairing code (TV app calls this on first launch)
    // Auto-pairing ONLY works if there's a discovered Roku device available
    'POST /protocol/request-pairing [public]': async (ctx) => {
      const {
        serial, platform, model, app_version, capabilities, hardware_serial,
      } = ctx.body;

      if (!serial) {
        return { success: false, error: 'Serial number required', status: 400 };
      }

      logger.info(`Pairing request: channelClientId=${serial}, hardware_serial=${hardware_serial || '(none)'}, platform=${platform}, model=${model}`);

      // ==================== DISCOVERY-BASED AUTO-PAIRING ====================
      // hardware_serial (Roku GetDeviceUniqueId) is stable across channel sideloads;
      // ChannelClientId rotates. Prefer hardware-serial matching for auto-recovery (#1139).
      const { discoveredDevice, existingScreen } = await findDiscoveredRokuForPairing(serial, {
        screenManager,
        queryFn: (table) => api.queryBuilder(table),
        logger,
        hardwareSerial: hardware_serial,
      });

      if (discoveredDevice || existingScreen) {
        // ==================== PENDING-CANDIDATE AUTO-ADMIT (#1671) ====================
        // The Roku app connecting IS the consent. If the matched device is a
        // PENDING (unclaimed) discovery candidate, admit it now: emit
        // discovery:claim-device so device-discovery registers the device,
        // clears `ignored`, and the existing subscribeToRokuClaims path creates
        // the screen. No approval gate is enforced on the app-connect path.
        if (discoveredDevice?.pendingCandidate && api.globalEventBus) {
          logger.info(`Auto-admitting pending Roku candidate ${discoveredDevice.candidate_id} on app connect (serial=${hardware_serial || discoveredDevice.serial_number || 'unknown'})`);
          api.globalEventBus.emit('discovery:claim-device', {
            candidate: {
              id: discoveredDevice.candidate_id,
              ip: discoveredDevice.ip_address,
              ip_address: discoveredDevice.ip_address,
              mac: discoveredDevice.mac_address,
              mac_address: discoveredDevice.mac_address,
              deviceType: 'roku',
              ignored: 0,
            },
            deviceId: discoveredDevice.device_id,
            name: discoveredDevice.name,
            extensionName: 'roku-integration',
            metadata: { deviceType: 'roku', serialNumber: discoveredDevice.serial_number },
          });
        }

        // We have either a discovered device or an existing screen - auto-pair
        const deviceName = discoveredDevice?.name || existingScreen?.name || 'Roku Device';
        const deviceModel = discoveredDevice?.model || existingScreen?.model || model;
        const deviceSerial = discoveredDevice?.serial_number || existingScreen?.serial;

        logger.info(`Auto-pairing: device="${deviceName}", existingScreen=${existingScreen ? 'yes' : 'no'}`);

        let screen = existingScreen;
        let isNewScreen = !existingScreen;

        if (existingScreen) {
          // ==================== EXISTING SCREEN - SYNC WITH DISCOVERY ====================
          logger.info(`Existing screen found: ${existingScreen.serial} (${existingScreen.name})`);

          const updatedMetadata = {
            ...(existingScreen.metadata || {}),
            // Discovery linkage (if we have discovery info)
            ...(discoveredDevice ? {
              roku_device_id: discoveredDevice.device_id,
              discovery_linked: true,
              last_discovered: new Date().toISOString(),
              ip_address: discoveredDevice.ip_address,
              serial_number: discoveredDevice.serial_number,
              discovery_name: deviceName,
            } : {}),
            // App info (always update)
            channel_client_id: serial,
            app_version,
            capabilities,
          };

          await screenManager.update(existingScreen.serial, {
            ...(discoveredDevice ? {
              name: deviceName,
              ip_address: discoveredDevice.ip_address,
            } : {}),
            metadata: updatedMetadata,
          });

          screen = await screenManager.getBySerial(existingScreen.serial);
          logger.info(`Updated existing screen ${screen.serial} with discovery name: "${deviceName}"`);
        } else if (discoveredDevice) {
          // ==================== NEW SCREEN - CREATE WITH DISCOVERY INFO ====================
          logger.info(`Creating new screen from discovery: ${deviceSerial} (${deviceName})`);
          isNewScreen = true;

          screen = await screenManager.register({
            serial: deviceSerial,
            name: deviceName,
            platform: 'roku',
            model: deviceModel,
            metadata: {
              roku_device_id: discoveredDevice.device_id,
              discovery_linked: true,
              auto_created: true,
              ip_address: discoveredDevice.ip_address,
              serial_number: discoveredDevice.serial_number,
              channel_client_id: serial,
              app_version,
              capabilities,
              discovery_name: deviceName,
              mac_address: discoveredDevice.mac_address,
            },
          });

          logger.info(`Created new screen ${screen.serial} from discovery`);
        }

        // Generate device token for the Roku app
        const token = await pairingManager.autoPairDevice(serial, {
          platform: 'roku',
          model: deviceModel,
          app_version,
          capabilities,
          linked_screen_serial: screen.serial,
          ...(discoveredDevice ? {
            roku_device_id: discoveredDevice.device_id,
            discovery_linked: true,
          } : {}),
        });

        // Tag the device in device_registry with slidecast info
        if (discoveredDevice) {
          try {
            await api.tagDevice(discoveredDevice.device_id, {
              role: 'screen',
              screen_serial: screen.serial,
              screen_name: screen.name,
            });
          } catch (tagError) {
            logger.warn(`Failed to tag device: ${tagError.message}`);
          }
        }

        // ==================== DEFAULT CAST ASSIGNMENT ====================
        let autoAssignedCast = null;

        if (isNewScreen) {
          autoAssignedCast = await tryAutoAssignDefaultCast(ctx, screen.serial);
          if (autoAssignedCast) {
            // Refresh screen to get updated cast assignment
            screen = await screenManager.getBySerial(screen.serial);
          }
        } else {
          logger.debug(`Existing screen - preserving current cast assignment: ${existingScreen.assigned_cast_id || 'none'}`);
        }

        // Broadcast event for UI updates
        api.broadcast('slidecast:device-auto-paired', {
          screen,
          discoveredDevice,
          isNewScreen,
          autoAssignedCast,
        });

        return {
          success: true,
          auto_paired: true,
          device_token: token,
          device_serial: serial,
          screen_serial: screen.serial,
          screen_name: screen.name,
          assigned_cast: screen.assigned_cast_id || null,
          is_new_screen: isNewScreen,
          discovery_linked: !!discoveredDevice,
          message: isNewScreen
            ? `New screen created: ${screen.name}`
            : `Linked to existing screen: ${screen.name}`,
        };
      }

      // ==================== NO DISCOVERY = MANUAL PAIRING REQUIRED ====================
      logger.info(`No discovered device for serial ${serial} - requiring manual pairing`);

      const result = await pairingManager.generatePairingCode({
        serial,
        platform,
        model,
        app_version,
        capabilities,
        reason: 'not_in_discovery',
      });

      // Generate QR code URL
      const serverUrl = api.getServerUrl?.() || '';
      const qrImageUrl = `${serverUrl}/api/extensions/slidecast/protocol/pairing-qr/${result.pairing_code}`;

      return {
        success: true,
        auto_paired: false,
        pairing_code: result.pairing_code,
        qr_image_url: qrImageUrl,
        expires_at: result.expires_at,
        expires_in: result.expires_in,
        message: 'Device not found in discovery - manual pairing required',
      };
    },

    // Check pairing status (TV app polls this)
    'GET /protocol/pairing-status/:code [public]': async (ctx) => {
      const result = await pairingManager.getPairingStatus(ctx.params.code);
      return result;
    },

    // Generate QR code image for pairing code
    'GET /protocol/pairing-qr/:code [public]': async (ctx) => {
      const serverUrl = api.getServerUrl?.() || 'http://localhost:5173';
      const pairingUrl = `${serverUrl}/ext/slidecast/screens?pair=${ctx.params.code}`;
      const size = ctx.query.size || 300;

      try {
        const qrDataUrl = await QRCode.toDataURL(pairingUrl, {
          width: parseInt(size, 10),
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        });

        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        return {
          __raw: true,
          contentType: 'image/png',
          data: buffer,
        };
      } catch (err) {
        logger.error(`Pairing QR generation failed: ${err.message}`);
        return { success: false, error: 'QR code generation failed', status: 500 };
      }
    },

    // Complete pairing (Web UI calls this after user approves)
    'POST /protocol/complete-pairing': async (ctx) => {
      const { code, screen_name } = ctx.body;

      if (!ctx.user) {
        return { success: false, error: 'Authentication required', status: 401 };
      }

      if (!code) {
        return { success: false, error: 'Pairing code required', status: 400 };
      }

      const result = await pairingManager.completePairing(code, ctx.user.id, screen_name);

      // Auto-assign default cast ONLY if this is a new screen without an existing cast
      if (result.success && result.device_serial) {
        try {
          const screen = await screenManager.getBySerial(result.device_serial);
          const hasExistingCast = screen && screen.assigned_cast_id;

          if (hasExistingCast) {
            logger.debug(`Screen ${result.device_serial} already has cast assigned - preserving`);
            result.existing_cast_preserved = true;
          } else {
            const assigned = await tryAutoAssignDefaultCast(ctx, result.device_serial);
            if (assigned) {
              result.auto_assigned_cast = assigned;
            }
          }
        } catch (err) {
          logger.warn(`Failed to check/assign default cast: ${err.message}`);
        }
      }

      return result;
    },

    // Validate device token (TV app calls to verify stored token is still valid)
    'GET /protocol/validate [public]': async (ctx) => {
      const hdrs = ctx.headers || {};
      const authHeader = hdrs.authorization || hdrs.Authorization || ctx.query?.token;

      if (!authHeader) {
        return { valid: false, reason: 'No token provided' };
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
      const result = await pairingManager.validateToken(token);
      return result;
    },

    // Check cast version (lightweight endpoint for polling)
    //
    // #1141: Roku channels poll this endpoint every interval but historically
    // did NOT also hit /protocol/heartbeat, so app_connected / app_last_heartbeat
    // never got updated and ScreenManager.markOfflineScreens() would flip the
    // screen to status=offline after 60s. That in turn excluded the screen
    // from WidgetRefreshService.getActivelyPlayingScreens(), so server-side
    // widgets (e.g. weather layer PNGs) would never regenerate even though
    // the channel was actively displaying them. We now treat every successful
    // cast-version poll as an implicit heartbeat, with a 5s debounce so
    // aggressive poll intervals don't hammer the DB.
    'GET /protocol/cast-version [public]': async (ctx) => {
      const token = ctx.query?.token;

      if (!token) {
        return { success: false, error: 'Token required', status: 401 };
      }

      const validation = await pairingManager.validateToken(token);
      if (!validation.valid) {
        return { success: false, error: 'Invalid token', status: 401 };
      }

      const { assigned_cast } = validation;

      // Implicit-heartbeat: bump app_last_heartbeat + status=online on each
      // successful poll so the screen is visible to WidgetRefreshService.
      // Debounce to at most one write per CAST_VERSION_HEARTBEAT_DEBOUNCE_MS.
      const screenSerial = validation.screen_id || validation.device_serial;
      if (screenSerial && screenManager) {
        await maybeHeartbeatFromCastVersion(screenSerial);
      }

      if (!assigned_cast) {
        return { success: true, version: null, cast_id: null };
      }

      const cast = await castManager.getByUuid(assigned_cast);
      if (!cast) {
        return { success: true, version: null, cast_id: null };
      }

      const version = getCastVersion(cast);

      // #1144 / #1145: include per-widget versions so the Roku can refetch
      // individual widget layer PNGs without reloading the whole cast. The
      // Roku compares incoming widget_versions to its locally-tracked map and
      // triggers a lazy-swap preloader fetch for any widget whose version
      // bumped.
      //
      // Source-of-truth: the rendered layer PNG's mtime on disk. This matches
      // /debug/widgets (#1142) which uses fs.stat on layer files. Previously
      // this queried slidecast_widget_cache, which returned zero rows for
      // casts whose widgets had been rendered via the per-slide layer
      // pipeline but never through the legacy widget-cache table — leaving
      // widget_versions perpetually empty (#1145).
      const widgetVersions = await buildWidgetVersionsMap(cast);

      return {
        success: true,
        cast_id: cast.uuid,
        version,
        updated_at: cast.updated_at || cast.created_at || Date.now(),
        widget_versions: widgetVersions,
      };
    },

    // Launch app on Roku via ECP (proxied through server because Roku blocks self-ECP)
    'POST /protocol/roku-launch [public]': async (ctx) => {
      const { roku_ip, channel_id } = ctx.body || {};

      if (!roku_ip || !channel_id) {
        return { success: false, error: 'roku_ip and channel_id required', status: 400 };
      }

      // Validate IP format (basic security check)
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(roku_ip)) {
        return { success: false, error: 'Invalid IP address format', status: 400 };
      }

      try {
        logger.info(`Sending ECP launch command to Roku ${roku_ip}: channel ${channel_id}`);

        const ecpUrl = `http://${roku_ip}:8060/launch/${channel_id}`;

        const response = await fetch(ecpUrl, {
          method: 'POST',
          headers: { 'Content-Length': '0' },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          logger.info(`Successfully launched channel ${channel_id} on Roku ${roku_ip}`);
          return { success: true, message: `Launched channel ${channel_id}` };
        }
        logger.error(`ECP request failed: ${response.status} ${response.statusText}`);
        return { success: false, error: `ECP failed: ${response.status}`, status: response.status };
      } catch (error) {
        logger.error(`ECP request error: ${error.message}`);
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Widget interaction: a focusable widget region on a screen was OK-pressed.
    // Dispatch the named action to the widget's provider, which runs in its own
    // extension ctx (e.g. a Home Assistant thermostat widget commanding the
    // thermostat via ctx.platform). After the action, refresh the cast's widgets
    // so the display reflects the new state. The device-agnostic dispatch path.
    'POST /protocol/interaction [public]': async (ctx) => {
      const body = ctx.body || {};
      const token = ctx.query?.token || body.token;
      // BrightScript's FormatJson lowercases associative-array keys, so a Roku
      // sends castid/slideindex/elementid; accept both cases (and any other JSON
      // client using camelCase).
      const castId = body.castId ?? body.castid;
      const slideIndex = body.slideIndex ?? body.slideindex;
      const elementId = body.elementId ?? body.elementid;
      const { action } = body;
      const params = body.params || {};

      if (!token) return { success: false, error: 'Token required', status: 401 };
      const validation = await pairingManager.validateToken(token);
      if (!validation.valid) return { success: false, error: 'Invalid token', status: 401 };
      const screenSerial = validation.screen_id || validation.device_serial;

      if (!castId || slideIndex === undefined || slideIndex === null || !elementId || !action) {
        return { success: false, error: 'castId, slideIndex, elementId, action required', status: 400 };
      }
      if (!widgetResolver) {
        return { success: false, error: 'Widget resolver unavailable', status: 503 };
      }

      // Look up the placed element to get its widget id + per-instance config.
      let element = null;
      try {
        const cast = await castManager.getByUuid(castId);
        if (cast) {
          const def = cast.definition || {};
          const slides = [];
          for (const g of def.groups || []) for (const s of (g.slides || [])) slides.push(s);
          for (const s of def.slides || []) slides.push(s);
          const slide = slides[slideIndex];
          if (slide && slide.elements) element = slide.elements.find((el) => el.id === elementId);
        }
      } catch (e) { /* fall through to 404 */ }

      if (!element || element.type !== 'widget' || !element.widgetUuid) {
        return { success: false, error: 'Widget element not found', status: 404 };
      }

      const config = element.widgetConfig || element.config || {};
      try {
        const result = await widgetResolver.dispatchAction(element.widgetUuid, action, {
          config,
          params,
          instance: {
            castId, slideIndex, elementId, screenSerial,
          },
        });
        // Reflect the change on-screen: re-refresh this cast's widgets.
        if (widgetRefreshService?.refreshCastWidgets) {
          widgetRefreshService.refreshCastWidgets(castId).catch(() => {});
        }
        return { success: true, result };
      } catch (err) {
        logger.warn(`interaction dispatch failed (${element.widgetUuid}.${action}): ${err.message}`);
        return { success: false, error: err.message, status: 500 };
      }
    },

    // Get content for device (TV app calls this to fetch assigned cast)
    'GET /protocol/content [public]': async (ctx) => {
      const token = ctx.query?.token;

      if (!token) {
        return { success: false, error: 'Token required', status: 401 };
      }

      const validation = await pairingManager.validateToken(token);
      if (!validation.valid) {
        return { success: false, error: 'Invalid token', status: 401 };
      }

      const { assigned_cast } = validation;

      if (!assigned_cast) {
        return { success: true, cast: null, message: 'No cast assigned' };
      }

      const cast = await castManager.getByUuid(assigned_cast);
      if (!cast) {
        return { success: false, error: 'Assigned cast not found', status: 404 };
      }

      const formattedCast = await formatCastForTV(cast);

      logger.debug(`TV device ${validation.device_serial} fetched cast: ${cast.name} (${formattedCast.slides.length} slides)`);

      return { success: true, cast: formattedCast };
    },

    // ==================== FAST BOOT ENDPOINT ====================
    // Combines validation, content, first slide data, and widget versions into one request

    'GET /protocol/boot [public]': async (ctx) => {
      const token = ctx.query?.token;

      // 1. Check if token provided
      if (!token) {
        return { valid: false, reason: 'No token provided' };
      }

      // 2. Validate token and get device info
      const validation = await pairingManager.validateToken(token);
      if (!validation.valid) {
        return { success: false, valid: false, error: 'Invalid token' };
      }

      const { assigned_cast, screen } = validation;

      // 3. If no cast assigned, return success with nulls
      if (!assigned_cast) {
        return {
          success: true,
          valid: true,
          screen: screen || null,
          assigned_cast: null,
          cast: null,
          firstSlideData: null,
          firstSlideStatus: null,
          widgetVersions: {},
        };
      }

      // 4. Fetch the cast
      const cast = await castManager.getByUuid(assigned_cast);
      if (!cast) {
        return {
          success: true,
          valid: true,
          screen: screen || null,
          assigned_cast,
          cast: null,
          firstSlideData: null,
          firstSlideStatus: null,
          widgetVersions: {},
          error: 'Assigned cast not found',
        };
      }

      // 5. Format cast for TV
      const formattedCast = await formatCastForTV(cast);

      // 6. Get first slide layer data (if available)
      let firstSlideData = null;
      let firstSlideStatus = null;

      if (slideImageRenderer && formattedCast.slides.length > 0) {
        const castId = cast.uuid;
        const variables = cast.definition?.variables || {};

        // Check if render previously failed
        if (renderTracker && renderTracker.hasFailed(castId, 0)) {
          firstSlideStatus = 'failed';
        } else if (renderTracker && renderTracker.isRendering(castId, 0)) {
          // Check if currently rendering
          firstSlideStatus = 'rendering';
        } else {
          // Check if already rendered
          const metadata = await slideImageRenderer.getSlideLayerMetadata(castId, 0);

          if (metadata) {
            // Check if render is stale
            const renderTime = new Date(metadata.generatedAt || 0).getTime();
            const updateTime = new Date(cast.updated_at || 0).getTime();

            if (updateTime > renderTime) {
              // Stale - trigger background render
              firstSlideStatus = 'stale';

              const slides = flattenSlides(cast.definition);
              if (slides.length > 0) {
                triggerBackgroundRender(castId, 0, slides[0], variables, { priority: true });
              }

              // Still return the stale data - better than nothing
              firstSlideData = metadata;
            } else {
              // Fresh cached data
              firstSlideStatus = 'cached';
              firstSlideData = metadata;
            }
          } else {
            // Not rendered yet - trigger background render
            firstSlideStatus = 'not_rendered';

            const slides = flattenSlides(cast.definition);
            if (slides.length > 0) {
              triggerBackgroundRender(castId, 0, slides[0], variables, { priority: true });
            }
          }
        }
      }

      // 7. Collect widget versions
      const widgetVersions = {};
      const widgetUuids = extractWidgetUuids(cast.definition);

      for (const uuid of widgetUuids) {
        try {
          if (widgetCache) {
            const entries = await ctx.data.slidecast_widget_cache?.findAll?.({ where: { widget_uuid: uuid } });

            if (entries && entries.length > 0) {
              const latestEntry = entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
              widgetVersions[uuid] = latestEntry.content_hash || latestEntry.data_hash || 'unknown';
            } else {
              widgetVersions[uuid] = 'not_cached';
            }
          } else {
            widgetVersions[uuid] = 'cache_unavailable';
          }
        } catch (err) {
          widgetVersions[uuid] = 'error';
        }
      }

      logger.debug(`Boot: device=${validation.device_serial} cast=${cast.name} slides=${formattedCast.slides.length} firstSlideStatus=${firstSlideStatus}`);

      return {
        success: true,
        valid: true,
        screen: screen || null,
        assigned_cast,
        cast: formattedCast,
        firstSlideData,
        firstSlideStatus,
        widgetVersions,
      };
    },

    // ==================== LONG-POLLING UPDATES ====================

    'GET /protocol/updates [public]': async (ctx) => {
      const token = ctx.query?.token;
      const since = parseInt(ctx.query?.since, 10) || 0;
      const timeout = parseInt(ctx.query?.timeout, 10) || 30000;

      if (!token) {
        return { success: false, error: 'Token required', status: 401 };
      }

      const validation = await pairingManager.validateToken(token);
      if (!validation.valid) {
        return { success: false, error: 'Invalid token', status: 401 };
      }

      const screenSerial = validation.screen_id || validation.device_serial;

      if (!updateTracker) {
        return {
          success: true,
          updates: [],
          serverTime: Date.now(),
          message: 'Long-polling not enabled',
        };
      }

      const result = await updateTracker.waitForUpdates(
        screenSerial,
        since,
        Math.min(timeout, 60000),
      );

      return {
        success: true,
        ...result,
      };
    },

    // ==================== PREFETCH MANIFEST ====================

    'GET /protocol/manifest/:castId [public]': async (ctx) => {
      const token = ctx.query?.token;
      const castId = await resolveCastId(ctx.params.castId);

      // Optional token validation
      if (token) {
        const validation = await pairingManager.validateToken(token);
        if (!validation.valid) {
          return { success: false, error: 'Invalid token', status: 401 };
        }
      }

      return await handleManifest(castId, { ...ctx.query, token });
    },

    // ==================== BATCH API ====================

    'POST /protocol/batch [public]': async (ctx) => {
      const { requests } = ctx.body || {};

      if (!requests || !Array.isArray(requests) || requests.length === 0) {
        return { success: false, error: 'requests array required', status: 400 };
      }

      const MAX_BATCH_SIZE = 10;
      if (requests.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Maximum ${MAX_BATCH_SIZE} requests per batch`, status: 400 };
      }

      const startTime = Date.now();
      const results = {};
      let succeeded = 0;
      let failed = 0;

      const promises = requests.map(async (req) => {
        const { id, endpoint, params = {} } = req;

        if (!id || !endpoint) {
          return {
            id: id || 'unknown', success: false, error: 'id and endpoint required', status: 400,
          };
        }

        try {
          let result = null;

          // Extract token from params or headers
          const token = params.token || ctx.headers?.authorization?.replace('Bearer ', '');

          if (endpoint.match(/^\/protocol\/manifest\/([^/]+)$/) || endpoint.match(/^\/api\/extensions\/slidecast\/protocol\/manifest\/([^/]+)$/)) {
            const castId = endpoint.split('/manifest/')[1];
            result = await handleManifest(castId, { ...params, token });
          } else if (endpoint.match(/^\/protocol\/slide-layers\/([^/]+)\/(\d+)$/) || endpoint.match(/^\/api\/extensions\/slidecast\/protocol\/slide-layers\/([^/]+)\/(\d+)$/)) {
            const match = endpoint.match(/slide-layers\/([^/]+)\/(\d+)/);
            const castId = match[1];
            const slideIndex = match[2];
            result = await handleSlideLayers(castId, slideIndex, params);
          } else if (endpoint.match(/^\/protocol\/widget-versions$/) || endpoint.match(/^\/api\/extensions\/slidecast\/protocol\/widget-versions$/)) {
            result = await handleWidgetVersions(params);
          } else if (endpoint.match(/^\/protocol\/content$/) || endpoint.match(/^\/api\/extensions\/slidecast\/protocol\/content$/)) {
            result = await handleContent({ ...params, token });
          } else if (endpoint.match(/^\/protocol\/cast-version$/) || endpoint.match(/^\/api\/extensions\/slidecast\/protocol\/cast-version$/)) {
            result = await handleCastVersion({ ...params, token });
          } else if (endpoint.match(/^\/(api\/)?health$/)) {
            result = { status: 'ok', timestamp: new Date().toISOString() };
          } else if (endpoint.match(/^\/protocol\/screen-status$/) || endpoint.match(/^\/api\/extensions\/slidecast\/screens\/([^/]+)\/status$/)) {
            result = await handleScreenStatus(token || params.token);
          } else if (endpoint.match(/^\/api\/screens\/([^/]+)\/status$/)) {
            const screenToken = endpoint.split('/screens/')[1].split('/')[0];
            result = await handleScreenStatus(screenToken);
          } else {
            return {
              id, success: false, error: `Unsupported endpoint: ${endpoint}`, status: 400,
            };
          }

          return { id, success: true, data: result };
        } catch (err) {
          logger.warn(`Batch request ${id} failed: ${err.message}`);
          return {
            id, success: false, error: err.message, status: 500,
          };
        }
      });

      const responses = await Promise.all(promises);

      for (const resp of responses) {
        results[resp.id] = resp;
        if (resp.success) {
          succeeded++;
        } else {
          failed++;
        }
      }

      const totalMs = Date.now() - startTime;

      return {
        success: true,
        responses: results,
        meta: {
          succeeded,
          failed,
          totalMs,
        },
      };
    },

    // ==================== ADMIN ACTIONS ====================

    // Revoke device token (admin action)
    'POST /protocol/revoke-token': async (ctx) => {
      if (!ctx.user) {
        return { success: false, error: 'Authentication required', status: 401 };
      }

      const { device_serial } = ctx.body;

      if (!device_serial) {
        return { success: false, error: 'Device serial required', status: 400 };
      }

      const result = await pairingManager.revokeToken(device_serial, ctx.user.id);
      return result;
    },

    // Get all paired devices (admin view)
    'GET /protocol/paired-devices': async (ctx) => {
      if (!ctx.user) {
        return { success: false, error: 'Authentication required', status: 401 };
      }

      const tokens = await pairingManager.getDeviceTokens();
      return {
        success: true,
        devices: tokens.map((t) => ({
          serial: t.device_serial,
          device_info: typeof t.device_info === 'string' ? JSON.parse(t.device_info) : t.device_info,
          paired_at: t.created_at,
          last_used: t.last_used_at,
          revoked: t.revoked,
        })),
      };
    },

    // ==================== LEGACY REGISTRATION ====================

    // Register screen
    'POST /protocol/register [public]': async (ctx) => {
      const {
        serial, platform, model, app_version, capabilities,
      } = ctx.body;

      const screen = await screenManager.register({
        serial,
        platform,
        model,
        metadata: { app_version, capabilities },
      });

      // Fire automation trigger
      api.fireTrigger('screen_connected', {
        screen_id: screen.serial,
        screen_name: screen.name,
        serial: screen.serial,
        platform: screen.platform,
      });

      return {
        success: true,
        screen_id: screen.serial,
        name: screen.name,
        assigned_cast: screen.assigned_cast_id,
      };
    },

    // Heartbeat - supports both token-based and serial-based authentication
    'POST /protocol/heartbeat [public]': async (ctx) => {
      const {
        token, serial, current_cast_id, current_slide_index, status, latency_ms,
      } = ctx.body;
      const serverTime = new Date().toISOString();

      let screenSerial = serial;
      let validation = null;

      if (token) {
        validation = await pairingManager.validateToken(token);
        if (!validation.valid) {
          return {
            success: false,
            error: 'Invalid token',
            status: 401,
            server_time: serverTime,
          };
        }
        screenSerial = validation.screen_id || validation.device_serial;
      }

      if (!screenSerial) {
        return {
          success: false,
          error: 'Token or serial required',
          status: 400,
          server_time: serverTime,
        };
      }

      const screen = await screenManager.heartbeat(screenSerial, {
        current_cast_id,
        current_slide_index,
        status,
      });

      const assignedCast = screen?.assigned_cast_id || validation?.assigned_cast;
      const needsRefresh = assignedCast && current_cast_id && assignedCast !== current_cast_id;

      let castVersion = null;
      if (assignedCast) {
        const cast = await castManager.getByUuid(assignedCast);
        if (cast) {
          castVersion = getCastVersion(cast);
        }
      }

      return {
        success: true,
        action: needsRefresh ? 'refresh' : null,
        server_time: serverTime,
        assigned_cast: assignedCast || null,
        cast_version: castVersion,
        screen_name: screen?.name || validation?.screen_name || null,
        latency_ack: latency_ms ? parseInt(latency_ms, 10) : null,
      };
    },

    // Tune (what should I play?)
    'GET /protocol/tune [public]': async (ctx) => {
      const { serial, roku_id } = ctx.query;
      let screen = null;

      if (serial) {
        screen = await screenManager.getBySerial(serial);
      }

      if (!screen && (roku_id || serial)) {
        const lookupId = roku_id || serial;
        const allScreens = await screenManager.getAll();

        screen = allScreens.find((s) => {
          const meta = s.metadata || {};
          return meta.roku_device_id === lookupId
                 || meta.roku_device_id === `roku:${lookupId}`
                 || meta.serial_number === lookupId
                 || s.serial === meta.serial_number;
        });
      }

      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      if (!screen.assigned_cast_id) {
        return { assigned: false, message: 'No cast assigned to this screen' };
      }

      const cast = await castManager.getByUuid(screen.assigned_cast_id);

      return {
        assigned: true,
        cast_id: screen.assigned_cast_id,
        cast_name: cast?.name || 'Unknown',
        updated_at: cast?.updated_at || null,
        etag: cast?.uuid || null,
        screen_serial: screen.serial,
      };
    },

    // Get full cast for TV - no auth required for TV apps
    'GET /protocol/cast/:id [public]': async (ctx) => {
      const cast = await castManager.getByUuid(ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const assets = await mediaLibrary.getAssetsForCast(cast.definition);

      return {
        cast: {
          id: cast.uuid,
          name: cast.name,
          ...cast.definition,
        },
        meta: {
          etag: cast.uuid,
          updated_at: cast.updated_at,
          assets,
        },
      };
    },

    // Get TV-optimized rendering format
    'GET /protocol/render/:id [public]': async (ctx) => {
      const cast = await castManager.getByUuid(ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const { definition } = cast;
      const baseUrl = ctx.query.base_url || '';

      const slides = (definition.slides || []).map((slide) => {
        const slideAutoAdvance = slide.autoAdvance !== false;
        const effectiveDuration = slideAutoAdvance ? (slide.duration || definition.settings?.defaultDuration || 10000) : null;

        return {
          id: slide.id,
          name: slide.name,
          duration: effectiveDuration,
          backgroundColor: slide.backgroundColor || definition.settings?.backgroundColor || '#000000',
          elements: (slide.elements || [])
            .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
            .map((el) => formatElementForTV(el, definition.variables || {}, baseUrl)),
        };
      });

      return {
        success: true,
        cast_id: cast.uuid,
        name: cast.name,
        settings: {
          width: definition.settings?.resolution?.width || 1920,
          height: definition.settings?.resolution?.height || 1080,
          loop: definition.settings?.loop !== false,
          transition: definition.settings?.transition || { type: 'fade', duration: 500 },
        },
        slides,
        variables: definition.variables || {},
        feeds: [],
        version: cast.updated_at,
      };
    },

    // Get single slide for TV (useful for partial updates)
    'GET /protocol/render/:id/slide/:slideIndex [public]': async (ctx) => {
      const cast = await castManager.getByUuid(ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const slideIndex = parseInt(ctx.params.slideIndex, 10);
      const { definition } = cast;
      const slide = definition.slides?.[slideIndex];

      if (!slide) {
        return { success: false, error: 'Slide not found', status: 404 };
      }

      const baseUrl = ctx.query.base_url || '';

      const slideAutoAdvance = slide.autoAdvance !== false;
      const effectiveDuration = slideAutoAdvance ? (slide.duration || definition.settings?.defaultDuration || 10000) : null;

      return {
        success: true,
        slide: {
          id: slide.id,
          name: slide.name,
          index: slideIndex,
          duration: effectiveDuration,
          backgroundColor: slide.backgroundColor || definition.settings?.backgroundColor || '#000000',
          elements: (slide.elements || [])
            .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
            .map((el) => formatElementForTV(el, definition.variables || {}, baseUrl)),
        },
        totalSlides: definition.slides?.length || 0,
      };
    },

    // Receive ping from TV
    'POST /protocol/ping [public]': async (ctx) => {
      const {
        serial, ping_name, cast_id, slide_id, element_id,
      } = ctx.body;

      const screen = await screenManager.getBySerial(serial);

      // Fire automation trigger
      api.fireTrigger('ping_received', {
        screen_id: serial,
        screen_name: screen?.name || serial,
        ping_name,
        cast_id,
        slide_id,
      });

      logger.info(`Ping received: ${ping_name} from ${serial}`);

      return { success: true, message: 'Ping received' };
    },

    // ==================== MEDIA SERVING ====================

    // Serve media assets to TV (no auth required for TV apps)
    'GET /protocol/asset/:uuid [public]': async (ctx) => {
      const filePath = await mediaLibrary.getFilePath(ctx.params.uuid);

      if (!filePath) {
        return { success: false, error: 'Asset not found', status: 404 };
      }

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        return { success: false, error: 'Asset file not found', status: 404 };
      }

      const media = await mediaLibrary.getById(ctx.params.uuid);
      const contentType = media?.mime_type || 'video/mp4';
      const fileSize = stat.size;

      if (fileSize === 0) {
        return { success: false, error: 'Asset file is empty', status: 204 };
      }

      // Handle Range requests for video streaming
      const range = ctx.headers?.range;

      logger.debug(`Asset request ${ctx.params.uuid}: range=${range || 'none'}, size=${fileSize}`);

      if (range) {
        // Parse `bytes=start-end`, including the suffix form `bytes=-500`
        // (last 500 bytes). The old split-on-'-' set start=parseInt('')=NaN for
        // suffix ranges → chunkSize NaN → broken response (minor fix).
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        let start;
        let end;
        if (m && m[1] === '' && m[2] !== '') {
          // Suffix range: final N bytes
          const suffixLen = parseInt(m[2], 10);
          start = Math.max(0, fileSize - suffixLen);
          end = fileSize - 1;
        } else if (m) {
          start = m[1] === '' ? 0 : parseInt(m[1], 10);
          end = m[2] === '' ? fileSize - 1 : parseInt(m[2], 10);
        } else {
          // Malformed Range — serve the whole file rather than NaN math.
          start = 0;
          end = fileSize - 1;
        }
        // Clamp into [0, fileSize-1]; fall back to full file if incoherent.
        if (!Number.isFinite(start) || start < 0) { start = 0; }
        if (!Number.isFinite(end) || end >= fileSize) { end = fileSize - 1; }
        if (start > end) { start = 0; end = fileSize - 1; }
        const chunkSize = (end - start) + 1;

        logger.debug(`Streaming asset ${ctx.params.uuid}: bytes ${start}-${end}/${fileSize}`);

        return {
          __stream: true,
          path: filePath,
          contentType,
          start,
          end,
          fileSize,
          chunkSize,
        };
      }

      // Full file response
      logger.debug(`Serving full asset ${ctx.params.uuid}: ${fileSize} bytes`);

      return {
        __stream: true,
        path: filePath,
        contentType,
        start: 0,
        end: fileSize - 1,
        fileSize,
        chunkSize: fileSize,
        fullFile: true,
      };
    },

    // ==================== FONT FILE SERVING (#1009) ====================
    // The render-element page injects @font-face declarations that point here.
    // Without this route Chromium falls back to default sans-serif and bold
    // text un-bolds (#1009). Public so the headless render-worker can fetch.
    'GET /protocol/font/:filename [public]': async (ctx) => {
      const filename = decodeURIComponent(ctx.params.filename || '');
      // Hard whitelist: filename must be a single TTF/OTF basename, no path traversal
      if (!/^[A-Za-z0-9._-]+\.(ttf|otf)$/.test(filename)) {
        return { success: false, error: 'Invalid font filename', status: 400 };
      }
      // Resolve from the data-dir override first (custom/uploaded fonts), then
      // the fonts bundled with the extension image. The bundled dir is the
      // reliable default so fresh installs never 404 (the data dir starts empty).
      const candidateDirs = [
        `${process.env.DATA_DIR || '/app/data'}/slidecast/fonts`,
        path.resolve(__dirname, '../fonts'),
      ];
      let fontPath = null;
      let stat = null;
      for (const dir of candidateDirs) {
        const p = path.join(dir, filename);
        // Defence-in-depth against path traversal
        if (!p.startsWith(dir + path.sep)) continue;
        try {
          stat = await fs.stat(p);
          fontPath = p;
          break;
        } catch { /* not in this dir — try the next candidate */ }
      }
      if (!fontPath) {
        return { success: false, error: 'Font not found', status: 404 };
      }
      return {
        __stream: true,
        path: fontPath,
        contentType: filename.endsWith('.otf') ? 'font/otf' : 'font/ttf',
        start: 0,
        end: stat.size - 1,
        fileSize: stat.size,
        chunkSize: stat.size,
        fullFile: true,
      };
    },

    // ==================== WIDGET REFRESH HEALTH (#1010) ====================
    // Per-widget last-refresh + next-scheduled timestamps so Studio can show
    // an observable indicator. Without this endpoint the refresh pipeline is
    // a black box — refreshes happen but nobody knows when.
    'GET /health/widget-refresh': async (_ctx) => {
      if (!widgetRefreshService) {
        return { success: false, error: 'WidgetRefreshService not initialised', status: 503 };
      }
      const status = widgetRefreshService.getStatus();
      const intervalMs = status.intervalMs || 60000;
      const now = Date.now();

      // Build per-widget detail. Use the widget registry to resolve names.
      const widgets = [];
      const { widgetRegistry } = widgetRefreshService;
      for (const [uuid, lastRefreshTs] of Object.entries(status.lastRefreshed || {})) {
        let name = null;
        try {
          if (widgetRegistry?.getByUuid) {
            const w = await widgetRegistry.getByUuid(uuid);
            name = w?.name || null;
          }
        } catch (_e) { /* registry miss is fine */ }
        widgets.push({
          uuid,
          name,
          last_refresh_ts: lastRefreshTs,
          next_scheduled_ts: lastRefreshTs + intervalMs,
          age_ms: now - lastRefreshTs,
        });
      }

      return {
        success: true,
        is_running: status.isRunning,
        interval_ms: intervalMs,
        now_ts: now,
        // Gating diagnostics (#1114/#1125/#1129) — surfaces why a tick produced
        // no work, when the last tick/instant refresh ran, and the current
        // gate mode. Null when the service hasn't ticked yet.
        last_skip_reason: status.lastSkipReason ?? null,
        last_tick_at: status.lastTickAt ?? null,
        last_instant_refresh_at: status.lastInstantRefreshAt ?? null,
        gate_mode: status.gateMode ?? null,
        widgets,
      };
    },

    // ==================== DEBUG: ACTIVE WIDGETS (#1117) ====================
    // Lists every widget instance currently in use on an actively-playing
    // screen. Unlike /health/widget-refresh (which lists widgets that have
    // ever been refreshed), this endpoint enumerates the *live* set —
    // (screen × cast × slide × widget) instances — so operators can see
    // exactly which widgets should be refreshing on which TVs right now.
    //
    // Per-instance fields (keep stable — debug UI depends on this shape):
    //   widget_uuid, widget_name, cast_id, cast_name, slide_idx, element_id,
    //   screen_serial, screen_name, interval_ms, last_refresh_ts,
    //   next_scheduled_ts, age_ms, health ('green'|'yellow'|'red'),
    //   job_id (coarse scheduler job today; per-widget micro-jobs = phase 2)
    //
    // Health bands: age < 1.5 × interval → green; < 3 × interval → yellow;
    // otherwise red. Never-refreshed widgets (no last_refresh_ts) → red.
    'GET /debug/widgets': async (_ctx) => {
      if (!widgetRefreshService) {
        return { success: false, error: 'WidgetRefreshService not initialised', status: 503 };
      }
      if (!screenManager) {
        return { success: false, error: 'ScreenManager not initialised', status: 503 };
      }

      const status = widgetRefreshService.getStatus();
      const intervalMs = status.intervalMs || 60000;
      const now = Date.now();
      const lastRefreshed = status.lastRefreshed || {};
      const { widgetRegistry } = widgetRefreshService;

      // #1200: coarse_job_id removed — phase 2 (#1134) decomposed
      // widget-refresh into per-instance micro-jobs, so WidgetRefreshService
      // no longer has a single `refreshJobId`. Each widget row below carries
      // its own per-instance `job_id` from getJobIdForInstance().

      // Gather active (online + assigned_cast_id) screens.
      let activeScreens = [];
      try {
        activeScreens = await widgetRefreshService.getActivelyPlayingScreens();
      } catch (err) {
        return { success: false, error: `Failed to list active screens: ${err.message}`, status: 500 };
      }

      if (activeScreens.length === 0) {
        return {
          success: true,
          now_ts: now,
          interval_ms: intervalMs,
          widgets: [],
          note: 'No screens currently playing a cast',
        };
      }

      // Cache cast + widgetRegistry lookups so N screens × M widgets doesn't
      // hit the DB redundantly.
      const castCache = new Map(); // castId -> cast
      const widgetNameCache = new Map(); // widgetUuid -> name|null
      // Cache slide layers.json lookups so N widgets on the same slide only
      // read layers.json once (#1142).
      const layersMetadataCache = new Map(); // `${castId}:${slideIdx}` -> layers.json | null

      async function resolveLayersMetadata(castId, slideIdx) {
        const key = `${castId}:${slideIdx}`;
        if (layersMetadataCache.has(key)) return layersMetadataCache.get(key);
        let meta = null;
        try {
          if (slideImageRenderer?.getSlideLayerMetadata) {
            meta = await slideImageRenderer.getSlideLayerMetadata(castId, slideIdx);
          }
        } catch (_e) { /* missing layers.json is fine */ }
        layersMetadataCache.set(key, meta);
        return meta;
      }

      // Given a widget instance (cast/slide/element), return
      // { image_url, image_created_at } where image_created_at is the
      // PNG file's mtime in ms. Both may be null when the PNG hasn't been
      // rendered yet or the slide hasn't been through the render pipeline
      // (no layers.json). Swallows all errors — this is a debug endpoint
      // and a missing file is expected for never-rendered widgets.
      async function resolveWidgetImage(castId, slideIdx, elementId) {
        if (!slideImageRenderer || slideIdx === null || slideIdx === undefined || !elementId) {
          return { image_url: null, image_created_at: null };
        }
        const metadata = await resolveLayersMetadata(castId, slideIdx);
        if (!metadata || !Array.isArray(metadata.layers)) {
          return { image_url: null, image_created_at: null };
        }
        const layerEntry = metadata.layers.find((l) => l.id === elementId);
        if (!layerEntry || !layerEntry.file) {
          return { image_url: null, image_created_at: null };
        }
        const imageUrl = `/api/extensions/slidecast/protocol/slide-layer/${castId}/${slideIdx}/${layerEntry.file}`;
        let createdAt = null;
        try {
          const slideDir = slideImageRenderer.getSlideDir(castId, slideIdx);
          const filePath = path.join(slideDir, layerEntry.file);
          const stat = await fs.stat(filePath);
          createdAt = new Date(stat.mtimeMs).toISOString();
        } catch (_e) {
          // File doesn't exist yet — image_created_at stays null, URL is
          // still useful (user can click through to see 404 + investigate).
        }
        return { image_url: imageUrl, image_created_at: createdAt };
      }

      async function resolveCast(castId) {
        if (castCache.has(castId)) return castCache.get(castId);
        try {
          const cast = await castManager.getByUuid(castId);
          castCache.set(castId, cast || null);
          return cast || null;
        } catch (_e) {
          castCache.set(castId, null);
          return null;
        }
      }
      async function resolveWidgetName(uuid) {
        if (widgetNameCache.has(uuid)) return widgetNameCache.get(uuid);
        let name = null;
        try {
          if (widgetRegistry?.getByUuid) {
            const w = await widgetRegistry.getByUuid(uuid);
            name = w?.name || null;
          }
        } catch (_e) { /* registry miss is fine */ }
        widgetNameCache.set(uuid, name);
        return name;
      }
      // Cache renderMode lookups so we can filter natives (#1151).
      const widgetRenderModeCache = new Map();
      async function resolveWidgetRenderMode(uuid) {
        if (widgetRenderModeCache.has(uuid)) return widgetRenderModeCache.get(uuid);
        let mode = 'native';
        try {
          // Resolver handles both DB and extension-provider widgets; a provider
          // widget resolves to its real (non-native) mode instead of defaulting
          // to 'native' (which would hide it from the render/version path).
          if (widgetResolver) {
            const resolved = await widgetResolver.resolve(uuid);
            mode = (resolved && resolved.renderMode) || 'native';
          } else if (widgetRegistry?.getByUuid) {
            const w = await widgetRegistry.getByUuid(uuid);
            mode = (w && w.renderMode) || 'native';
          }
        } catch (_e) { /* miss → treat as native, hide */ }
        widgetRenderModeCache.set(uuid, mode);
        return mode;
      }

      // Health is computed from the PNG's ground-truth mtime
      // (image_created_at) when available, falling back to the scheduler's
      // last_refresh_ts, and last to 'red' if neither exists. This is what
      // actually determines whether the viewer sees stale pixels (#1151).
      function healthFor(lastTs, imageCreatedAtMs) {
        const referenceTs = imageCreatedAtMs || lastTs;
        if (!referenceTs) return 'red';
        const age = now - referenceTs;
        if (age < intervalMs * 1.5) return 'green';
        if (age < intervalMs * 3) return 'yellow';
        return 'red';
      }

      const instances = [];
      for (const screen of activeScreens) {
        const castId = screen.assigned_cast_id;
        if (!castId) continue;
        const cast = await resolveCast(castId);
        if (!cast || !cast.definition) continue;

        // Reuse WidgetRefreshService's extractor so definitional edge cases
        // (groups vs flat slides, missing widgetUuid, etc.) stay consistent.
        const widgetRefs = widgetRefreshService.extractWidgetsFromDefinition(cast.definition, castId);
        for (const ref of widgetRefs) {
          // #1151: hide native widgets — they're rendered on-Roku so the
          // server-side scheduler neither can nor should refresh them.
          const renderMode = await resolveWidgetRenderMode(ref.uuid);
          if (renderMode === 'native') continue;

          const lastTs = lastRefreshed[ref.uuid] ?? null;
          const name = await resolveWidgetName(ref.uuid);
          const slideIdx = ref.location?.slideIndex ?? null;
          const elementId = ref.location?.elementId ?? null;
          // Ground-truth PNG creation time (#1142) — the scheduler's
          // last_refresh_ts records when WidgetRefreshService *asked* for a
          // re-render; image_created_at is when the rendered PNG was
          // actually written to disk by the Playwright pipeline. These
          // diverge when the renderer is slow, errors, or skips the write.
          const { image_url, image_created_at } = await resolveWidgetImage(
            castId,
            slideIdx,
            elementId,
          );
          const imageCreatedAtMs = image_created_at ? Date.parse(image_created_at) : null;
          // Per-instance micro-job id (#1134). #1200: coarseJobId fallback
          // removed — it was always null post-refactor.
          let instanceJobId = null;
          try {
            instanceJobId = widgetRefreshService.getJobIdForInstance?.({
              screenSerial: screen.serial,
              castId,
              slideIdx,
              elementId,
              widgetUuid: ref.uuid,
            }) ?? null;
          } catch (_e) {
            instanceJobId = null;
          }

          instances.push({
            widget_uuid: ref.uuid,
            widget_name: name,
            render_mode: renderMode,
            cast_id: castId,
            cast_name: cast.name || null,
            slide_idx: slideIdx,
            element_id: elementId,
            screen_serial: screen.serial,
            screen_name: screen.name || null,
            interval_ms: intervalMs,
            last_refresh_ts: lastTs,
            next_scheduled_ts: lastTs ? lastTs + intervalMs : null,
            age_ms: lastTs ? now - lastTs : null,
            health: healthFor(lastTs, imageCreatedAtMs),
            job_id: instanceJobId,
            image_url,
            image_created_at,
          });
        }
      }

      // Sort: red first (most urgent), then yellow, then green. Stable within
      // a band by screen_serial + slide_idx so the UI is predictable.
      const rank = { red: 0, yellow: 1, green: 2 };
      instances.sort((a, b) => {
        const r = rank[a.health] - rank[b.health];
        if (r !== 0) return r;
        if (a.screen_serial !== b.screen_serial) return String(a.screen_serial).localeCompare(String(b.screen_serial));
        return (a.slide_idx ?? 0) - (b.slide_idx ?? 0);
      });

      return {
        success: true,
        now_ts: now,
        interval_ms: intervalMs,
        widgets: instances,
      };
    },

    // Serve widget assets
    'GET /protocol/widget/:uuid/asset/:filename [public]': async (ctx) => {
      try {
        const entries = await ctx.data.slidecast_widget_assets?.findAll?.({
          where: {
            widget_uuid: ctx.params.uuid,
            filename: decodeURIComponent(ctx.params.filename),
          },
        });

        if (!entries || entries.length === 0) {
          return { success: false, error: 'Asset not found', status: 404 };
        }

        const asset = entries[0];

        // Serve the bytes straight from the DB row via __raw. The old path
        // wrote a temp file to /tmp/widget-assets on every request and never
        // cleaned it up (minor: /tmp accumulation). __raw sends the buffer
        // directly — same content-type/body on the wire, no disk write.
        const dataBuffer = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data);

        return {
          __raw: true,
          data: dataBuffer,
          contentType: asset.mime_type || 'application/octet-stream',
          filename: ctx.params.filename,
        };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Serve static media files by type and filename
    'GET /protocol/static/:type/:filename [public]': async (ctx) => {
      const { type, filename } = ctx.params;

      if (!['images', 'videos'].includes(type)) {
        return { success: false, error: 'Invalid type', status: 400 };
      }

      const sanitizedFilename = path.basename(filename);
      const filePath = path.join(process.env.DATA_DIR || '/app/data', 'slidecast/media', type, sanitizedFilename);

      try {
        await fs.access(filePath);
      } catch {
        return { success: false, error: 'File not found', status: 404 };
      }

      const ext = path.extname(sanitizedFilename).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
      };

      return {
        __file: true,
        path: filePath,
        contentType: contentTypes[ext] || 'application/octet-stream',
        filename: sanitizedFilename,
      };
    },

    // ==================== PER-LAYER RENDERING API ====================

    // Get layer metadata for a slide (returns layers.json)
    // NON-BLOCKING: Returns immediately with status if render needed
    // Structured data for a NATIVE widget the player renders on-device (no PNG).
    // Polled by capable players at the widget's refreshInterval; result is cached.
    'GET /protocol/widget-data/:uuid [public]': async (ctx) => {
      const { uuid } = ctx.params;
      const type = getNativeWidgetType(uuid);
      if (!type) return { success: false, error: 'Not a native widget', status: 404 };
      let castId = ctx.query.castId || ctx.query.cast_id;
      if (castId) castId = await resolveCastId(castId);
      const elementId = ctx.query.elementId || ctx.query.element_id;
      try {
        const data = await getNativeWidgetData(uuid, castId, elementId);
        return { success: true, type, data };
      } catch (err) {
        logger.warn(`widget-data failed for ${uuid}: ${err.message}`);
        return { success: false, error: err.message, status: 500 };
      }
    },

    'GET /protocol/slide-layers/:castId/:slideIndex [public]': async (ctx) => {
      if (!slideImageRenderer) {
        return { success: false, error: 'Slide image renderer not available', status: 503 };
      }

      const castId = await resolveCastId(ctx.params.castId);
      const slideIndex = parseInt(ctx.params.slideIndex, 10);
      const forceRender = ctx.query.force === 'true';
      const screenSerial = ctx.query.screen_serial;

      if (isNaN(slideIndex) || slideIndex < 0) {
        return { success: false, error: 'Invalid slide index', status: 400 };
      }

      const cast = await castManager.getByUuid(castId);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      // ==================== NON-BLOCKING RENDER CHECKS ====================

      // Check if render previously failed
      if (renderTracker && renderTracker.hasFailed(castId, slideIndex)) {
        const failure = renderTracker.getFailure(castId, slideIndex);
        return {
          success: false,
          status: 'failed',
          error: failure.error,
          retry_after: 10,
          message: 'Render failed, will retry',
        };
      }

      // Check if currently rendering
      const isCurrentlyRendering = renderTracker && renderTracker.isRendering(castId, slideIndex);

      // Check if already rendered — serve existing layers even while re-rendering
      let metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIndex);

      if (isCurrentlyRendering && !metadata) {
        return {
          success: true,
          status: 'rendering',
          retry_after: 2,
          message: 'Render in progress',
        };
      }

      // Check if render is stale
      let needsRender = !metadata || forceRender;
      if (metadata && !forceRender) {
        const renderTime = new Date(metadata.generatedAt || 0).getTime();
        const updateTime = new Date(cast.updated_at || 0).getTime();
        if (updateTime > renderTime) {
          logger.debug(`Stale render detected: cast updated at ${cast.updated_at}, rendered at ${metadata.generatedAt}`);
          needsRender = true;
        }
      }

      // ==================== NON-BLOCKING RENDER START ====================

      if (needsRender) {
        const slides = flattenSlides(cast.definition);

        const slide = slides[slideIndex];
        if (!slide) {
          return { success: false, error: 'Slide not found', status: 404 };
        }

        const variables = cast.definition?.variables || {};

        // Determine if this is a priority request (from active screen)
        let isActiveScreen = false;
        if (screenSerial && widgetRefreshService) {
          isActiveScreen = await widgetRefreshService.isScreenConnected(screenSerial);
        }

        if (renderTracker) {
          if (renderTracker.canStartRender()) {
            triggerBackgroundRender(castId, slideIndex, slide, variables, { force: forceRender, priority: isActiveScreen });
            // Serve existing layers while re-rendering (old files still on disk)
            if (metadata) {
              const enriched = await enrichLayerMetadata(castId, slideIndex, metadata);
              return { success: true, status: 'rendering', ...enriched };
            }
            return {
              success: true,
              status: 'rendering',
              retry_after: 2,
              message: 'Render started',
            };
          }
          const doRender = () => {
            console.log(`[RenderTracker] doRender called (queued): cast=${castId} slide=${slideIndex} active=${renderTracker.activeRenders.size} queued=${renderTracker.getQueueSize()}`);
            renderTracker.startRender(castId, slideIndex);
            (async () => {
              try {
                await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { force: forceRender });
                console.log(`[RenderTracker] renderSlide complete (queued): cast=${castId} slide=${slideIndex}`);
                renderTracker.completeRender(castId, slideIndex);
                logger.debug(`Render complete: cast=${castId} slide=${slideIndex}`);
              } catch (err) {
                console.log(`[RenderTracker] renderSlide failed (queued): cast=${castId} slide=${slideIndex} err=${err.message}`);
                logger.error(`Render failed: ${castId}/${slideIndex} - ${err.message}`);
                renderTracker.failRender(castId, slideIndex, err);
              }
            })();
          };

          const queued = renderTracker.queueRender(castId, slideIndex, doRender, isActiveScreen);

          if (!queued) {
            return {
              success: false,
              status: 'queue_full',
              retry_after: 10,
              message: 'Render queue full, try again later',
            };
          }

          // Serve existing layers while queued (old files still on disk)
          if (metadata) {
            const enriched = await enrichLayerMetadata(castId, slideIndex, metadata);
            return { success: true, status: 'queued', ...enriched };
          }
          return {
            success: true,
            status: 'queued',
            priority: isActiveScreen,
            queue_position: isActiveScreen ? renderTracker.priorityQueue.length : renderTracker.pendingQueue.length,
            retry_after: isActiveScreen ? 2 : 5,
            message: isActiveScreen ? 'Priority queued (active screen)' : 'Render queued',
          };
        }
        // Fallback: blocking render if no tracker
        logger.warn(`Blocking render (no tracker): cast=${castId} slide=${slideIndex}`);
        try {
          await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { force: forceRender });
          metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIndex);
        } catch (err) {
          logger.error(`On-demand render failed: ${err.message}`);
          return { success: false, error: `Render failed: ${err.message}`, status: 500 };
        }
      }

      if (!metadata) {
        return { success: false, error: 'Slide layers not rendered', status: 500 };
      }

      // ==================== LAYER MERGING OPTION ====================
      const mergeStatic = ctx.query.merge_static === 'true';

      if (mergeStatic) {
        const mergeResult = await slideImageRenderer.mergeStaticLayers(castId, slideIndex, metadata);

        if (mergeResult && mergeResult.mergedFile) {
          return {
            success: true,
            slideIndex: metadata.slideIndex,
            width: metadata.width,
            height: metadata.height,
            background: metadata.background,
            generatedAt: metadata.generatedAt,
            mergedBackground: {
              file: mergeResult.mergedFile,
              url: mergeResult.mergedUrl,
              size: mergeResult.mergedSize,
            },
            dynamicLayers: mergeResult.dynamicLayers,
            layerCount: mergeResult.layerCount,
          };
        }
      }

      const enriched = await enrichLayerMetadata(castId, slideIndex, metadata);
      return { success: true, ...enriched };
    },

    // Get widget version hashes for Roku to detect widget content changes
    'GET /protocol/widget-versions [public]': async (ctx) => {
      const castId = ctx.query.cast_id;

      if (!castId) {
        return { success: false, error: 'cast_id required', status: 400 };
      }

      const cast = await castManager.getByUuid(castId);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const widgetUuids = extractWidgetUuids(cast.definition);

      const versions = {};

      for (const uuid of widgetUuids) {
        try {
          if (widgetCache) {
            const cacheStats = await widgetCache.getStats();
            const entries = await ctx.data.slidecast_widget_cache?.findAll?.({ where: { widget_uuid: uuid } });

            if (entries && entries.length > 0) {
              const latestEntry = entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

              versions[uuid] = {
                version: latestEntry.content_hash || latestEntry.data_hash || 'unknown',
                refreshedAt: latestEntry.created_at,
                expiresAt: latestEntry.expires_at,
              };
            } else {
              versions[uuid] = {
                version: 'not_cached',
                refreshedAt: null,
              };
            }
          } else {
            versions[uuid] = {
              version: 'cache_unavailable',
              refreshedAt: null,
            };
          }
        } catch (err) {
          logger.debug(`Failed to get widget version for ${uuid}: ${err.message}`);
          versions[uuid] = {
            version: 'error',
            error: err.message,
          };
        }
      }

      return {
        success: true,
        cast_id: castId,
        widget_count: widgetUuids.size,
        widgets: versions,
      };
    },

    // Get render tracker status (for diagnostics)
    'GET /protocol/render-status': async (ctx) => {
      if (!renderTracker) {
        return { success: false, error: 'Render tracker not available', status: 503 };
      }

      return {
        success: true,
        ...renderTracker.getStatus(),
      };
    },

    // Pre-render slides for a cast (called by Roku on cast assignment)
    'POST /protocol/pre-render/:castId [public]': async (ctx) => {
      if (!slideImageRenderer || !renderTracker) {
        return { success: false, error: 'Render services not available', status: 503 };
      }

      const castId = await resolveCastId(ctx.params.castId);
      const requestedCount = parseInt(ctx.query.count, 10) || 3;
      const count = Math.min(Math.max(requestedCount, 1), 10);

      const cast = await castManager.getByUuid(castId);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const slides = flattenSlides(cast.definition);

      if (slides.length === 0) {
        return { success: true, queued: 0, message: 'No slides to pre-render' };
      }

      const slidesToRender = Math.min(count, slides.length);
      let queued = 0;
      let alreadyRendered = 0;

      logger.info(`Pre-render request: cast=${castId}, slides=${slidesToRender}`);

      for (let i = 0; i < slidesToRender; i++) {
        const slide = slides[i];
        const slideIndex = i;
        const variables = cast.definition?.variables || {};

        // Check if already rendered and up-to-date
        const metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIndex);
        if (metadata) {
          const renderTime = new Date(metadata.generatedAt || 0).getTime();
          const updateTime = new Date(cast.updated_at || 0).getTime();
          if (renderTime >= updateTime) {
            alreadyRendered++;
            continue;
          }
        }

        // Check if already rendering or queued
        if (renderTracker.isRendering(castId, slideIndex)) {
          continue;
        }

        // Define the render function
        const doRender = () => {
          console.log(`[RenderTracker] doRender called (pre-render): cast=${castId} slide=${slideIndex} active=${renderTracker.activeRenders.size} queued=${renderTracker.getQueueSize()}`);
          renderTracker.startRender(castId, slideIndex);
          (async () => {
            try {
              await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables);
              console.log(`[RenderTracker] renderSlide complete (pre-render): cast=${castId} slide=${slideIndex}`);
              renderTracker.completeRender(castId, slideIndex);
              logger.debug(`Pre-render complete: cast=${castId} slide=${slideIndex}`);
            } catch (err) {
              console.log(`[RenderTracker] renderSlide failed (pre-render): cast=${castId} slide=${slideIndex} err=${err.message}`);
              logger.warn(`Pre-render failed: ${castId}/${slideIndex} - ${err.message}`);
              renderTracker.failRender(castId, slideIndex, err);
            }
          })();
        };

        // Queue at low priority (active screen requests jump ahead)
        if (renderTracker.canStartRender()) {
          doRender();
          queued++;
        } else {
          const wasQueued = renderTracker.queueRender(castId, slideIndex, doRender, false);
          if (wasQueued) queued++;
        }
      }

      return {
        success: true,
        cast_id: castId,
        requested: slidesToRender,
        queued,
        already_rendered: alreadyRendered,
        message: queued > 0
          ? `Queued ${queued} slide(s) for pre-rendering`
          : `All ${slidesToRender} slide(s) already rendered`,
      };
    },

    // Re-render a single element layer PNG for a specific slide.
    // Useful for forcing a refresh of one element without re-rendering the entire slide.
    'POST /protocol/rerender-element [public]': async (ctx) => {
      if (!slideImageRenderer) {
        return { success: false, error: 'Slide image renderer not available', status: 503 };
      }

      const { castId: rawCastId, slideIndex: rawSlideIndex, elementId } = ctx.body || {};

      if (!rawCastId || rawSlideIndex === undefined || rawSlideIndex === null || !elementId) {
        return { success: false, error: 'castId, slideIndex, and elementId are required', status: 400 };
      }

      const castId = await resolveCastId(rawCastId);
      const slideIndex = parseInt(rawSlideIndex, 10);

      if (isNaN(slideIndex) || slideIndex < 0) {
        return { success: false, error: 'Invalid slideIndex', status: 400 };
      }

      // Load the cast
      const cast = await castManager.getByUuid(castId);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      // Flatten slides and find the target slide
      const slides = flattenSlides(cast.definition);
      const slide = slides[slideIndex];
      if (!slide) {
        return { success: false, error: 'Slide not found', status: 404 };
      }

      // Find the element by ID in the slide
      const element = (slide.elements || []).find((el) => el.id === elementId);
      if (!element) {
        return { success: false, error: 'Element not found', status: 404 };
      }

      // Native elements are rendered by the display device — no server-side re-render needed
      if (isNativeElement(element)) {
        return { success: false, error: 'Native elements are rendered by the display device' };
      }

      // Load existing layer metadata
      const metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIndex);
      if (!metadata) {
        return { success: false, error: 'No layer metadata found for this slide — render the slide first', status: 404 };
      }

      // Find the layer entry for this element
      const layerEntry = (metadata.layers || []).find((l) => l.id === elementId);
      if (!layerEntry || !layerEntry.file) {
        return { success: false, error: 'Layer entry not found for this element', status: 404 };
      }

      // Build render context
      const variables = cast.definition?.variables || {};
      const renderContext = {
        currentGroupId: slide.groupId || null,
        currentSlideIndex: slideIndex,
        assetBaseUrl: `${slideImageRenderer.baseUrl}/api/extensions/slidecast/protocol/asset`,
      };

      // For widgets: pre-fetch primitives (same as renderSlide does)
      if (element.type === 'widget') {
        renderContext.widgetUuid = element.widgetUuid;
        renderContext.widgetConfig = element.widgetConfig || element.config || {};
        renderContext.widgetStyles = element.widgetStyles || element.styles || {};

        try {
          const widgetUuid = element.widgetUuid || element.widget_name || '';
          const renderUrl = `${slideImageRenderer.baseUrl}/api/extensions/slidecast/protocol/widget/${encodeURIComponent(widgetUuid)}/render`;
          const res = await fetch(renderUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: element.widgetConfig || element.config || {},
              styles: element.widgetStyles || element.styles || {},
              size: element.size,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.primitives) {
              renderContext.widgetPrimitives = data.primitives;
            }
          }
        } catch (err) {
          logger.warn(`rerender-element: pre-fetch widget primitives failed for ${elementId}: ${err.message}`);
        }
      }

      // Render element to buffer via the Playwright page
      let buffer;
      try {
        buffer = await slideImageRenderer.renderElementViaPage(castId, slideIndex, element, variables, renderContext);
      } catch (err) {
        logger.error(`rerender-element: renderElementViaPage failed for ${elementId}: ${err.message}`);
        return {
          success: false,
          status: 'failed',
          reason: `Render failed: ${err.message}`,
          error: `Render failed: ${err.message}`,
          elementId,
          file: layerEntry.file,
          httpStatus: 500,
        };
      }

      // Compute hash of the newly-rendered buffer
      const newHash = crypto.createHash('md5').update(buffer).digest('hex');
      const slideDir = slideImageRenderer.getSlideDir(castId, slideIndex);
      const pngPath = path.join(slideDir, layerEntry.file);
      const metadataPath = path.join(slideDir, 'layers.json');

      // Cache-hit: contentHash matches — do not rewrite file or metadata
      if (layerEntry.contentHash && layerEntry.contentHash === newHash) {
        logger.info(`rerender-element: cache-hit for ${layerEntry.file} (element ${elementId} cast=${castId} slide=${slideIndex})`);
        return {
          success: true,
          status: 'cache-hit',
          elementId,
          file: layerEntry.file,
          contentHash: layerEntry.contentHash,
          renderedAt: layerEntry.renderedAt || null,
        };
      }

      // New content: write file + update metadata
      try {
        await fs.writeFile(pngPath, buffer);
        layerEntry.contentHash = newHash;
        layerEntry.renderedAt = new Date().toISOString();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (err) {
        logger.error(`rerender-element: write failed for ${elementId}: ${err.message}`);
        return {
          success: false,
          status: 'failed',
          reason: `Write failed: ${err.message}`,
          error: `Write failed: ${err.message}`,
          elementId,
          file: layerEntry.file,
          httpStatus: 500,
        };
      }

      logger.info(`rerender-element: re-rendered ${layerEntry.file} for element ${elementId} (cast=${castId} slide=${slideIndex})`);

      return {
        success: true,
        status: 'rendered',
        elementId,
        file: layerEntry.file,
        contentHash: layerEntry.contentHash,
        renderedAt: layerEntry.renderedAt,
      };
    },

    // Serve individual layer PNG image
    // Supports ETag/304 caching for efficient Roku updates
    'GET /protocol/slide-layer/:castId/:slideIndex/:filename [public]': async (ctx) => {
      // [#1174] Temporary end-to-end observability trace for widget refresh debugging.
      try {
        const ua = (ctx.headers && (ctx.headers['user-agent'] || ctx.headers['User-Agent'])) || '';
        const ip = ctx.ip || (ctx.req && (ctx.req.ip || ctx.req.socket?.remoteAddress)) || '';
        const qs = ctx.query ? JSON.stringify(ctx.query) : '';
        const inm = (ctx.headers && (ctx.headers['if-none-match'] || ctx.headers['If-None-Match'])) || '';
        console.log(`[slidecast:slide-layer] GET cast=${ctx.params.castId} slide=${ctx.params.slideIndex} layer=${ctx.params.filename} ua=${ua} ip=${ip} qs=${qs} inm=${inm}`);
      } catch (_logErr) {
        // never let the debug log break the route
      }

      if (!slideImageRenderer) {
        return { success: false, error: 'Slide image renderer not available', status: 503 };
      }

      const castId = await resolveCastId(ctx.params.castId);
      const slideIndex = parseInt(ctx.params.slideIndex, 10);
      const { filename } = ctx.params;

      if (isNaN(slideIndex) || slideIndex < 0) {
        return { success: false, error: 'Invalid slide index', status: 400 };
      }

      // Validate filename to prevent directory traversal
      if (!filename.match(/^(background|layer-\d+(-nav-(\d+|none))?|merged-static)\.png$/)) {
        return { success: false, error: 'Invalid layer filename', status: 400 };
      }

      const slideDir = slideImageRenderer.getSlideDir(castId, slideIndex);
      const filePath = path.join(slideDir, filename);

      try {
        const stat = await fs.stat(filePath);

        // Generate ETag from mtime + size
        const etag = `"${stat.mtimeMs}-${stat.size}"`;

        // Check If-None-Match header for conditional request (304 support)
        const ifNoneMatch = ctx.headers?.['if-none-match'] || ctx.headers?.['If-None-Match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
          return {
            success: true,
            notModified: true,
            etag,
            status: 304,
          };
        }

        return {
          __stream: true,
          path: filePath,
          contentType: 'image/png',
          start: 0,
          end: stat.size - 1,
          fileSize: stat.size,
          chunkSize: stat.size,
          fullFile: true,
          headers: {
            // #1150: layer PNG filenames are NOT hash-versioned (they're
            // `layer-N.png`), so `immutable` was a lie — the same URL returns
            // different bytes after a widget refresh re-writes the file. The
            // old aggressive cache told intermediaries/Roku to never
            // revalidate, which defeated the ETag/Last-Modified headers we're
            // sending. Switch to no-cache so clients ALWAYS revalidate via
            // If-None-Match and get 304 when bytes haven't changed, or fresh
            // bytes when they have.
            'Cache-Control': 'no-cache, must-revalidate',
            ETag: etag,
            'Last-Modified': stat.mtime.toUTCString(),
          },
        };
      } catch (err) {
        logger.debug(`Layer image not found: ${castId}/${slideIndex}/${filename}`);
        return { success: false, error: 'Layer image not found', status: 404 };
      }
    },

    // Legacy: Serve pre-rendered slide PNG images
    'GET /protocol/slide-image/:castId/:slideIndex [public]': async (ctx) => {
      if (!slideImageRenderer) {
        return { success: false, error: 'Slide image renderer not available', status: 503 };
      }

      const castId = await resolveCastId(ctx.params.castId);
      const slideIndex = parseInt(ctx.params.slideIndex, 10);

      if (isNaN(slideIndex) || slideIndex < 0) {
        return { success: false, error: 'Invalid slide index', status: 400 };
      }

      const pngPath = slideImageRenderer.getSlideImagePath(castId, slideIndex);

      try {
        const stat = await fs.stat(pngPath);

        return {
          __stream: true,
          path: pngPath,
          contentType: 'image/png',
          start: 0,
          end: stat.size - 1,
          fileSize: stat.size,
          chunkSize: stat.size,
          fullFile: true,
        };
      } catch (err) {
        logger.debug(`Slide image not found: ${castId}/${slideIndex} - ${err.message}`);
        return { success: false, error: 'Slide image not rendered yet', status: 404 };
      }
    },

    // Debug: recent render errors
    'GET /render-errors': async (_ctx) => {
      return { success: true, errors: slideImageRenderer?.renderErrors || [] };
    },

    // ==================== SLIDE ELEMENTS (for direct render) ====================

    // Return raw element definitions for a slide from the cast definition.
    // Used by the render-element page in direct mode (no token needed).
    'GET /protocol/slide-elements/:castId/:slideIndex [public]': async (ctx) => {
      const rawCastId = ctx.params.castId;
      const rawSlideIndex = ctx.params.slideIndex;

      const castId = await resolveCastId(rawCastId);
      const idx = parseInt(rawSlideIndex, 10);

      if (isNaN(idx) || idx < 0) {
        return { success: false, error: 'Invalid slideIndex', status: 400 };
      }

      const cast = await castManager.getByUuid(castId);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const slides = flattenSlides(cast.definition);
      const slide = slides[idx];
      if (!slide) {
        return { success: false, error: 'Slide not found', status: 404 };
      }

      const variables = cast.definition?.variables || {};

      // Filter elements the render-element page can render as PNGs.
      // IMPORTANT: use the shared-renderer's definition of "native" here, not
      // ProtocolFormatter's.  ProtocolFormatter marks nav as native (Roku renders
      // it interactively), but the batch render path in SlideImageRenderer uses the
      // shared-renderer which marks nav as non-native (it IS rendered as a PNG layer
      // so Roku can do pixel-perfect nav highlighting).  Filtering nav out here was
      // the root cause of nav PNGs being 186-byte transparent images: the render-element
      // page couldn't find the nav element in the response and rendered nothing.
      //
      // Shared-renderer native types: video, image, and simple clock/date/countdown widgets.
      // Nav must be INCLUDED so the render page can produce nav-layer PNGs.
      const RENDER_NATIVE_TYPES = ['video', 'image'];
      const RENDER_NATIVE_WIDGET_TYPES = ['clock', 'date', 'countdown'];
      const elements = (slide.elements || []).filter((el) => {
        if (RENDER_NATIVE_TYPES.includes(el.type)) return false;
        if (el.type === 'widget') {
          const widgetUuid = el.widgetUuid || el.widget_name || '';
          const widgetType = el.widgetType || el.widget?.type || '';
          const isSimpleClock = widgetUuid.includes('digital-clock') || widgetType === 'clock';
          const isSimpleDate = widgetUuid.includes('date-display') || widgetType === 'date';
          const isSimpleCountdown = widgetUuid.includes('countdown') || widgetType === 'countdown';
          if (isSimpleClock || isSimpleDate || isSimpleCountdown) return false;
        }
        return true;
      });

      // #1157: pre-fetch primitives for every widget element so the render-element
      // page renders widget DOM with fidelity matching the studio renderer.
      // Previously this was done by SlideImageRenderer for slide-mode renders but
      // NOT for single-element renders (renderElementViaPage dispatches with only
      // cast/slide/element coordinates — the worker's page fetches slide-elements
      // which returned raw DB records without _widgetPrimitives, so the fallback
      // renderWidgetElement() produced placeholders for anything that wasn't a
      // hardcoded clock/date UUID).
      const widgetElements = elements.filter((el) => el.type === 'widget');
      if (widgetElements.length > 0 && widgetRegistry && widgetRuntime) {
        await Promise.all(widgetElements.map(async (el) => {
          try {
            const widgetUuid = el.widgetUuid || el.widget_name || '';
            if (!widgetUuid) return;
            const config = el.widgetConfig || el.config || {};
            const styles = el.widgetStyles || el.styles || {};
            // Extension-provided widget ("<provider>:<type>") — resolver produces
            // primitives. DB widgets keep the existing execute path (zero regression).
            if (widgetResolver && widgetUuid.includes(':')) {
              const resolved = await widgetResolver.resolve(widgetUuid);
              if (resolved) {
                const produced = await resolved.produce({ config, styles, size: el.size || resolved.defaultSize });
                if (produced && produced.primitives) el._widgetPrimitives = produced.primitives;
              }
              return;
            }
            const widget = await widgetRegistry.getByUuid(widgetUuid);
            if (!widget) return;
            const result = await widgetRuntime.execute(widget, config, styles);
            if (result && result.success && result.primitives) {
              el._widgetPrimitives = result.primitives;
            }
          } catch (err) {
            logger.warn(`slide-elements: pre-fetch primitives failed for widget ${el.id}: ${err.message}`);
          }
        }));
      }

      return {
        success: true,
        elements,
        variables,
        context: {
          currentGroupId: slide.groupId || null,
          currentSlideIndex: idx,
        },
      };
    },

    // ==================== RENDER ELEMENT PAGE ====================

    // Serve the self-contained element render page.
    // Direct param mode: ?cast=UUID&slide=N&element=M (or &mode=slide for all elements).
    // The page fetches element data from /protocol/slide-elements at render time.
    'GET /protocol/render-element [public]': async (_ctx) => {
      return {
        __raw: true,
        contentType: 'text/html; charset=utf-8',
        data: Buffer.from(buildRenderElementPage(), 'utf8'),
      };
    },

    // Generate QR code as PNG (for TV and preview)
    'GET /protocol/qrcode [public]': async (ctx) => {
      const {
        data, size = 200, fgColor = '000000', bgColor = 'ffffff',
      } = ctx.query;

      if (!data) {
        return { success: false, error: 'Data parameter required', status: 400 };
      }

      try {
        const qrDataUrl = await QRCode.toDataURL(decodeURIComponent(data), {
          width: parseInt(size, 10),
          margin: 1,
          color: {
            dark: `#${fgColor}`,
            light: `#${bgColor}`,
          },
        });

        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        return {
          __raw: true,
          contentType: 'image/png',
          data: buffer,
        };
      } catch (err) {
        logger.error(`QR code generation failed: ${err.message}`);
        return { success: false, error: 'QR code generation failed', status: 500 };
      }
    },
  };
}
