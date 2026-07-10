/**
 * SlideImageRenderer - Per-layer PNG rendering using Playwright
 *
 * Uses the shared @waiveo/slide-renderer package for HTML generation.
 * This ensures pixel-perfect consistency with the frontend.
 *
 * Structure:
 *   {castId}/{slideIndex}/layers.json - layer metadata
 *   {castId}/{slideIndex}/layer-{index}.png - individual layer PNG
 *   {castId}/{slideIndex}/background.png - slide background (if not video)
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import QRCode from 'qrcode';
import crypto from 'crypto';
import logger from './utils/Logger.js';
import { UpdateTypes } from './UpdateTracker.js';
import { pngHasDimensions } from './utils/pngDimensions.js';
import { expandRectForEffects } from './shared-renderer/styleBuilder.js';

// Canvas the Roku composites layers onto — clip/metadata rects are clamped here.
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

// Bound for the per-(castId,slideIndex) layers.json parse cache. WHY: the
// per-screen ~10s /protocol/cast-version poll (plus slide-layers, boot, manifest)
// re-reads + JSON.parses the SAME layers.json over and over — identical work per
// cast. Capped so a long-uptime appliance can't grow the cache without bound.
const SLIDE_META_CACHE_MAX = 512;

// Marker stashed on the (persistent) global event bus for the single canonical
// widget:layer_updated handler this class registers. Uses the GLOBAL symbol
// registry (Symbol.for) so it stays identical across the cache-busting module
// re-import that hot-reload performs — a plain Symbol() would differ between the
// old and new module scopes and defeat the dedupe. See setupEventListeners /
// teardownEventListeners (EventEmitter leak fix, BUG-3a).
const LAYER_UPDATED_HANDLER = Symbol.for('slidecast.SlideImageRenderer.layerUpdatedHandler');

// Detach a listener regardless of whether the bus exposes off() (Node ≥10) or
// only the legacy removeListener(). No-op for a null bus/handler.
function removeBusListener(bus, event, handler) {
  if (!bus || !handler) return;
  if (typeof bus.off === 'function') bus.off(event, handler);
  else if (typeof bus.removeListener === 'function') bus.removeListener(event, handler);
}

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get current rendering status
 * @param {import('./RenderBridge.js').RenderBridge} [bridge]
 */
export function getGpuStatus(bridge) {
  return {
    mode: 'software',
    isARM: process.arch === 'arm64' || process.arch === 'arm',
    arch: process.arch,
    description: 'Render worker (child process) with software rendering',
    worker: bridge ? bridge.getHealth() : { status: 'not-initialized' },
    queue: bridge ? bridge.getQueueDepth() : { high: 0, normal: 0, active: 0 },
  };
}

// Shared renderer functions - loaded dynamically for hot-reload support
let sharedRenderer = null;

/**
 * Load/reload the shared renderer with cache-busting
 * This allows extension updates to take effect without Docker restart
 */
async function loadSharedRenderer() {
  const timestamp = Date.now();
  const modulePath = `${pathToFileURL(path.join(__dirname, 'shared-renderer', 'index.js')).href}?t=${timestamp}`;

  const module = await import(modulePath);
  sharedRenderer = {
    isNativeElement: module.isNativeElement,
    NATIVE_ELEMENT_TYPES: module.NATIVE_ELEMENT_TYPES,
  };

  return sharedRenderer;
}

/**
 * Generate QR code as data URL for inline embedding
 */
async function generateQRDataUrl(element) {
  const qrData = element.data || element.config?.url || element.config?.data || 'https://example.com';
  const size = Math.min(element.size?.width || 200, element.size?.height || 200);
  const fgColor = element.style?.foreground || '#000000';
  const bgColor = element.style?.background || element.style?.backgroundColor || '#ffffff';

  try {
    const dataUrl = await QRCode.toDataURL(qrData, {
      width: size,
      margin: 1,
      color: {
        dark: fgColor,
        light: bgColor,
      },
    });
    return dataUrl;
  } catch (error) {
    logger.error(`Failed to generate QR code: ${error.message}`);
    return null;
  }
}

/**
 * Calculate load priority for a layer element
 * Priority determines order in which Roku loads layers:
 *   0 = Critical (background, video backgrounds)
 *   1 = Important (large text, main images, key content)
 *   2 = Normal (nav, medium elements)
 *   3 = Low (decorative, small elements)
 */
function calculateLoadPriority(element, layerType = null) {
  const type = layerType || element?.type;

  // Priority 0: Critical - must show immediately
  if (type === 'background') return 0;
  if (type === 'video') return 0;

  // Priority 1: Important content
  if (type === 'image') return 1;
  if (type === 'clock' || type === 'date' || type === 'countdown') return 1;

  // Check text size for priority
  if (type === 'text') {
    const fontSize = element?.style?.fontSize || 16;
    if (fontSize > 40) return 1; // Large text is important
    if (fontSize > 24) return 2; // Medium text is normal
    return 3; // Small text is low priority
  }

  // Priority 2: Normal interactive elements
  if (type === 'nav') return 2;
  if (type === 'widget') return 2;
  if (type === 'shape') return 2;
  if (type === 'qr' || type === 'qrcode') return 2;

  // Priority 3: Everything else (decorative)
  return 3;
}

/**
 * Deterministic JSON serialization that recursively sorts object keys.
 *
 * NOTE (#1021): Do NOT use `JSON.stringify(value, Object.keys(value).sort())`
 * for canonicalization. The array-form replacer parameter is a key allowlist
 * that is applied to EVERY nested object, so nested keys absent from the
 * top-level allowlist are silently stripped (e.g. {size: {width, height}}
 * becomes {size: {}}, hiding visual changes from the hash). This walker
 * emits a canonical JSON string with full nested fidelity and stable key
 * ordering at every depth.
 *
 * @param {*} value - Any JSON-compatible value
 * @returns {string} - Canonical JSON string
 */
function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined) continue; // mirror JSON.stringify behavior
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Generate a content hash for an element to detect changes
 * This hash captures all properties that affect rendering output
 *
 * IMPORTANT (#1020): the contentHash MUST be derived from the element's
 * INPUT data (id, type, position, size, style, content, widget config/styles,
 * widget code hash, variables) — never from the rendered PNG bytes. PNG bytes vary across
 * renders due to font load timing, anti-aliasing, and asset preload order,
 * which would cause Roku to re-fetch identical-looking layers and visibly
 * blink. See reRenderWidgetLayer() for the consumer that depends on this
 * stability invariant.
 *
 * IMPORTANT (#1021): nested objects (size, position, style, config, styles,
 * widgetConfig) MUST contribute their full contents to the hash. Use
 * stableStringify (above) for canonicalization — never the array-form
 * replacer of JSON.stringify, which strips nested keys.
 *
 * @param {Object} element - The element to hash
 * @param {Object} variables - Variables that may affect rendering
 * @returns {string} - MD5 hash of the element's visual properties
 */
export function generateElementHash(element, variables = {}) {
  // Extract properties that affect visual output
  const hashData = {
    id: element.id,
    type: element.type,
    // Position & size
    position: element.position || {},
    size: element.size || {},
    // Style properties
    style: element.style || {},
    // Content (text, URLs, etc.)
    content: element.content,
    src: element.src,
    url: element.url,
    // Widget-specific
    widgetUuid: element.widgetUuid,
    widgetType: element.widgetType,
    config: element.config,
    styles: element.styles,
    _primitivesHash: element._primitivesHash,
    // Widget CODE (server_code + client_code + html_template) hash. Folded in so
    // that shipping new widget code invalidates the per-element render skip-hash.
    // Without it the hash only reflects config/styles/primitives, so an unchanged
    // config leaves the stale layer-N.png cached and every rendered slide serves
    // OLD pixels after a code edit. Attached upstream via _computeWidgetCodeHash()
    // (renderSlide pre-fetch + reRenderWidgetLayer); undefined for non-widgets, so
    // stableStringify simply omits it and their hashes are unchanged.
    _widgetCodeHash: element._widgetCodeHash,
    // Nav-specific
    items: element.items,
    layout: element.layout,
    // QR-specific
    qrContent: element.qrContent,
    qrConfig: element.qrConfig,
    // Image-specific
    imageId: element.imageId,
    mediaId: element.mediaId,
    // Z-index affects compositing
    zIndex: element.zIndex,
    // Variables that might be interpolated into content
    usedVariables: {},
  };

  // Include only variables that are actually used in this element's content
  if (element.content && typeof element.content === 'string') {
    const varMatches = element.content.match(/\{\{(\w+)\}\}/g) || [];
    for (const match of varMatches) {
      const varName = match.replace(/\{\{|\}\}/g, '');
      if (variables[varName] !== undefined) {
        hashData.usedVariables[varName] = variables[varName];
      }
    }
  }

  // Create deterministic JSON string and hash it
  const jsonStr = stableStringify(hashData);
  return crypto.createHash('md5').update(jsonStr).digest('hex');
}

/**
 * Generate a content hash for a background
 */
function generateBackgroundHash(background) {
  const hashData = {
    type: background.type,
    color: background.color,
    gradient: background.gradient,
    imageUrl: background.imageUrl,
    imageId: background.imageId,
    mediaId: background.mediaId,
    opacity: background.opacity,
    blur: background.blur,
    style: background.style,
  };

  const jsonStr = stableStringify(hashData);
  return crypto.createHash('md5').update(jsonStr).digest('hex');
}

class SlideImageRenderer {
  constructor(api, options = {}) {
    this.api = api;
    this.dataDir = options.dataDir || '/app/data';
    this.renderDir = path.join(this.dataDir, 'slidecast', 'slide-renders');
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:5173';
    this.isInitialized = false;
    this.castManager = options.castManager || null;
    this.widgetRuntime = options.widgetRuntime || null;
    this.widgetRegistry = options.widgetRegistry || null;
    this.widgetImageRenderer = options.widgetImageRenderer || null;
    this.bridge = options.bridge || null;
    this.renderErrors = []; // Recent render errors for debugging
    // Per-element render circuit breaker. Map<castId|slide|elementId, {failedAt,count}>.
    // A persistently-failing element (e.g. a widget that hangs or corrupts its
    // render page) would otherwise time out (20s) and force a Chromium context
    // rebuild on EVERY re-render attempt — a thrash spiral that pins the box.
    // After a failure we back off worker calls for that element (exponential from
    // 60s, capped at 10min); a later success clears it. Lives in the main process
    // so it survives worker respawns.
    this._elementBreaker = new Map();
    // mtime-keyed cache for getSlideLayerMetadata (parsed layers.json).
    // Map<`${castId}:${slideIndex}`, { mtimeMs, data }>. See SLIDE_META_CACHE_MAX.
    this._slideMetaCache = new Map();
    // widget:layer_updated subscription bookkeeping so setupEventListeners is
    // idempotent across hot-reloads and teardownEventListeners can detach the
    // exact handler it registered (EventEmitter leak fix, BUG-3a).
    this._eventBus = null;
    this._layerUpdatedHandler = null;
  }

  async init() {
    try {
      if (!existsSync(this.renderDir)) {
        mkdirSync(this.renderDir, { recursive: true });
      }

      // Load shared renderer dynamically (supports hot-reload)
      await loadSharedRenderer();
      logger.info(`SlideImageRenderer initialized - NATIVE_ELEMENT_TYPES: ${sharedRenderer.NATIVE_ELEMENT_TYPES.join(', ')}`);

      this.isInitialized = true;
    } catch (error) {
      logger.error(`Failed to initialize SlideImageRenderer: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reload the shared renderer module (for hot-reload support)
   * Call this when the extension is updated to pick up changes
   */
  async reloadSharedRenderer() {
    try {
      await loadSharedRenderer();
      logger.info(`Shared renderer reloaded - NATIVE_ELEMENT_TYPES: ${sharedRenderer.NATIVE_ELEMENT_TYPES.join(', ')}`);
    } catch (error) {
      logger.error(`Failed to reload shared renderer: ${error.message}`);
    }
  }

  /**
   * Get slide metadata (layers.json) for change detection
   * Returns null if no cached metadata exists
   */
  async getSlideMetadata(castId, slideIndex) {
    try {
      const metadataPath = path.join(this.renderDir, castId, String(slideIndex), 'layers.json');
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(metadataJson);
    } catch (e) {
      // No cached metadata
      return null;
    }
  }

  /**
   * Set the render bridge (called after construction when bridge is ready)
   * @param {import('./RenderBridge.js').RenderBridge} bridge
   */
  setBridge(bridge) {
    this.bridge = bridge;
  }

  /**
   * Hash a widget element's CODE (server_code + client_code + html_template) so
   * a widget code edit forces the layer to re-render. generateElementHash reads
   * the result off `element._widgetCodeHash`; callers must attach it BEFORE
   * hashing (renderSlide's widget pre-fetch and reRenderWidgetLayer both do).
   *
   * Best-effort: returns '' when there is no registry, no widget UUID, or the
   * UUID isn't a DB widget (e.g. provider "<provider>:<type>" widgets that
   * resolve via WidgetResolver, not the registry). '' means the hash simply
   * omits the code contribution — never throws into the render path.
   *
   * @param {Object} element
   * @returns {Promise<string>} md5 of the widget code, or '' when unavailable
   */
  async _computeWidgetCodeHash(element) {
    if (!this.widgetRegistry) return '';
    const uuid = element.widgetUuid || element.widget_name || '';
    if (!uuid) return '';
    try {
      const widget = await this.widgetRegistry.getByUuid(uuid);
      if (!widget) return '';
      const codeStr = stableStringify({
        // Include the legacy single-file `code` too: widgets whose logic lives there
        // (all three new fields empty) would otherwise hash to a constant and keep
        // serving stale pixels after an edit — the exact BUG-1 symptom.
        code: widget.code || '',
        serverCode: widget.serverCode || '',
        clientCode: widget.clientCode || '',
        htmlTemplate: widget.htmlTemplate || '',
      });
      return crypto.createHash('md5').update(codeStr).digest('hex');
    } catch (err) {
      logger.warn(`_computeWidgetCodeHash failed for widget ${uuid}: ${err.message}`);
      return '';
    }
  }

  /**
   * Render a single non-native element via the render worker.
   * Passes cast/slide/element coordinates directly — no token, no main-thread
   * roundtrip.  The render-element page in the worker fetches the element by
   * ID from /protocol/slide-elements at render time.
   *
   * Works for text, shape, widget, qr, ping, and nav elements.
   */
  async renderElementViaPage(castId, slideIndex, element, variables, context) {
    if (!this.bridge?.isReady()) {
      throw new Error('Render worker not ready');
    }

    // Circuit breaker: skip an element whose render keeps failing, so a hung or
    // corrupting render (e.g. a bad widget) can't loop 20s-timeout + context
    // rebuild and pin the box. Backoff is exponential from 60s, capped at 10min.
    const breakerKey = `${castId}|${slideIndex}|${element.id}`;
    const breaker = this._elementBreaker.get(breakerKey);
    if (breaker) {
      const cooldownMs = Math.min(600000, 60000 * 2 ** (breaker.count - 1));
      const sinceMs = Date.now() - breaker.failedAt;
      if (sinceMs < cooldownMs) {
        const err = new Error(`render circuit open: element ${element.id} failed ${breaker.count}x — retry in ${Math.ceil((cooldownMs - sinceMs) / 1000)}s`);
        err.code = 'RENDER_CIRCUIT_OPEN';
        throw err;
      }
    }

    const rawWidth = element.size?.width || element.width || 100;
    const rawHeight = element.size?.height || element.height || 100;

    // Single-element PNGs (widget hot-refresh, /rerender-element) reuse the
    // layer's EXISTING metadata rect, which the batch/reused paths already
    // expanded for blur/box-shadow/scale/skew. So this PNG must be rendered at
    // the SAME expanded size or it would be stretched/mispositioned against
    // that rect. Enlarge the viewport; the render-element page offsets the
    // element inside it (window.__renderPad). No-op for effect-free elements.
    const rawX = element.position?.x ?? element.x ?? 0;
    const rawY = element.position?.y ?? element.y ?? 0;
    const expanded = expandRectForEffects(
      {
        x: rawX, y: rawY, width: rawWidth, height: rawHeight,
      },
      element.style || {},
      { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT },
    );
    const { width, height } = expanded;

    // Temporary output path — worker writes the PNG here
    const outputPath = path.join(this.renderDir, castId, String(slideIndex), `_tmp_${element.id}.png`);

    // Pull out optional context overrides used for nav-highlight multi-state
    // rendering.  variables is currently unused by the direct-param path — the
    // render-element page reads variables from the cast definition itself via
    // slide-elements.  It's still a parameter for API stability.
    void variables;
    const contextOverrides = {};
    if (context && typeof context === 'object') {
      if (context.focusedNavItemIndex !== undefined) {
        contextOverrides.focusedNavItem = context.focusedNavItemIndex;
      }
      if (context.currentGroupId !== undefined && context.currentGroupId !== null) {
        contextOverrides.currentGroup = context.currentGroupId;
      }
      if (context.currentSlideIndex !== undefined) {
        contextOverrides.currentSlide = context.currentSlideIndex;
      }
    }

    try {
      // Dispatch to child process with direct params (no token).
      // The render-element page looks up the element by ID via slide-elements
      // and applies any context overrides (focusedNavItem etc) from the URL.
      await this.bridge.renderElement({
        castId,
        slideIndex,
        cast: castId,
        slide: slideIndex,
        element: element.id,
        contextOverrides,
        baseUrl: this.baseUrl,
        width,
        height,
        clip: {
          x: 0, y: 0, width, height,
        },
        outputPath,
      });
      // Success — reset the circuit breaker for this element.
      this._elementBreaker.delete(breakerKey);
    } catch (err) {
      logger.error(`renderElementViaPage failed: cast=${castId} slide=${slideIndex} element=${element.id}: ${err.message}`);
      this.renderErrors.push({
        id: element.id, type: element.type, error: err.message, time: new Date().toISOString(),
      });
      if (this.renderErrors.length > 50) this.renderErrors.shift();
      // Open / escalate the circuit breaker so we stop hammering this element.
      const rec = this._elementBreaker.get(breakerKey) || { count: 0 };
      rec.count += 1;
      rec.failedAt = Date.now();
      this._elementBreaker.set(breakerKey, rec);
      if (this._elementBreaker.size > 1000) {
        // Soft cap: drop the oldest entry to bound memory.
        let oldestKey = null; let
          oldestAt = Infinity;
        for (const [k, v] of this._elementBreaker) { if (v.failedAt < oldestAt) { oldestAt = v.failedAt; oldestKey = k; } }
        if (oldestKey) this._elementBreaker.delete(oldestKey);
      }
      logger.warn(`render breaker: element ${element.id} failed ${rec.count}x — backing off ${Math.round(Math.min(600000, 60000 * 2 ** (rec.count - 1)) / 1000)}s`);
      throw err;
    }

    // Read the rendered buffer back (for callers that expect a Buffer)
    const buffer = await fs.readFile(outputPath);
    // Clean up temp file — caller will write to final location
    await fs.unlink(outputPath).catch(() => {});
    return buffer;
  }

  /**
   * Render all non-native elements for a slide via the render worker.
   * One page load in the child process, clipped screenshots per element.
   *
   * @param {string} castId
   * @param {number} slideIndex
   * @param {Array}  elements   - Elements to render (non-native, already enriched with QR/widget context).
   *                              Each element MAY carry a non-enumerable `_layerIndex` attached by the
   *                              caller indicating its slot in the cached layers.json. When present,
   *                              this is used for the output PNG filename so that incremental renders
   *                              (only some layers re-rendered) write to the correct slot rather than
   *                              clobbering cached PNGs at the dense array index. (#1001)
   * @param {Object} variables
   * @param {Object} renderContext - { currentGroupId, currentSlideIndex, assetBaseUrl, ... }
   * @returns {Array} Array of { element, buffer } in the same order as `elements`
   */
  async renderSlideViaFullPage(castId, slideIndex, elements, variables, renderContext) {
    if (!this.bridge?.isReady()) {
      throw new Error('Render worker not ready');
    }

    // Build element list for child process — direct cast/slide params, no token.
    // The render-element page (mode=slide) loads all elements + variables +
    // context from /protocol/slide-elements at render time.
    //
    // Filename slot resolution (#1001):
    // Use element._layerIndex (the caller's sparse index in layers.json) when present,
    // falling back to the dense map index `idx` for backward compatibility. Without this,
    // an incremental render where only some elements are re-rendered would write the new
    // PNG to layer-${idx}.png — overwriting whichever cached PNG happened to occupy that
    // slot — producing the symptom in #1001 where a 306x195 widget PNG ended up at
    // layer-0.png (whose metadata bounds were 1920x1080), causing the Roku preview to
    // stretch the widget content across the full slide.
    const slideDir = path.join(this.renderDir, castId, String(slideIndex));
    const childElements = elements.map((element, idx) => {
      const pos = element.position || {};
      const size = element.size || {};
      const x = pos.x || 0;
      const y = pos.y || 0;
      const width = size.width || 100;
      const height = size.height || 100;
      const slotIdx = (typeof element._layerIndex === 'number') ? element._layerIndex : idx;

      // Expand the screenshot clip so paint-outside-the-box effects (blur,
      // box-shadow, scale>1, skew) aren't truncated at the raw element bounds.
      // No-op (identical rect) for elements without those effects. The worker
      // screenshots this clip verbatim for BOTH the base render and each nav
      // highlight state (they share entry.clip), and the layer metadata below
      // carries the SAME expanded rect so the larger PNG lands correctly.
      const clip = expandRectForEffects(
        {
          x, y, width, height,
        },
        element.style || {},
        { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT },
      );

      const entry = {
        id: element.id,
        clip,
        outputPath: path.join(slideDir, `layer-${slotIdx}.png`),
      };

      // Nav elements need highlight state renders
      if (element.type === 'nav' && element.items?.length > 0) {
        entry.navItems = element.items.map((item, itemIdx) => ({
          index: itemIdx,
          label: item.label || '',
          groupId: item.action?.group_id || item.groupId || '',
          outputPath: path.join(slideDir, `layer-${slotIdx}-nav-${itemIdx}.png`),
        }));
      }

      return entry;
    });

    try {
      // Dispatch to child process with direct params (no token).
      await this.bridge.renderSlide({
        castId,
        slideIndex,
        cast: castId,
        slide: slideIndex,
        baseUrl: this.baseUrl,
        elements: childElements,
      });
    } catch (err) {
      logger.error(`renderSlideViaFullPage failed: cast=${castId} slide=${slideIndex}: ${err.message}`);
      this.renderErrors.push({
        id: `slide-${slideIndex}`, type: 'slide', error: err.message, time: new Date().toISOString(),
      });
      if (this.renderErrors.length > 50) this.renderErrors.shift();
      throw err;
    }

    // 4. Read results back for callers that expect buffers
    // Mirror the slot-index logic from above so we read from the file the worker
    // actually wrote to (#1001).
    const results = [];
    for (let idx = 0; idx < elements.length; idx++) {
      const element = elements[idx];
      const slotIdx = (typeof element._layerIndex === 'number') ? element._layerIndex : idx;
      const pngPath = path.join(slideDir, `layer-${slotIdx}.png`);
      const buffer = await fs.readFile(pngPath);
      const result = { element, buffer };

      // Read nav state buffers
      if (element.type === 'nav' && element.items?.length > 0) {
        result.navStates = [];
        for (let itemIdx = 0; itemIdx < element.items.length; itemIdx++) {
          const statePath = path.join(slideDir, `layer-${slotIdx}-nav-${itemIdx}.png`);
          const stateBuffer = await fs.readFile(statePath);
          result.navStates.push({
            index: itemIdx,
            label: element.items[itemIdx].label || '',
            groupId: element.items[itemIdx].action?.group_id || '',
            actionType: element.items[itemIdx].action?.type || 'group',
            buffer: stateBuffer,
          });
        }
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Render all slides for a cast (called on save)
   */
  async renderCast(cast) {
    if (!cast || !cast.id) {
      logger.error('Cannot render cast: invalid cast data');
      return;
    }

    // Reload shared renderer to pick up any hot-reload changes
    await loadSharedRenderer();

    const startTime = Date.now();
    logger.info(`Starting per-layer pre-render for cast ${cast.id}`);

    try {
      const allSlides = this.flattenSlides(cast);

      // Create cast render directory
      const castDir = path.join(this.renderDir, cast.id);
      if (!existsSync(castDir)) {
        mkdirSync(castDir, { recursive: true });
      }

      // Render each slide
      for (let i = 0; i < allSlides.length; i++) {
        await this.renderSlide(cast.id, i, allSlides[i], cast.variables);
      }

      const duration = Date.now() - startTime;
      logger.info(`Completed per-layer render for cast ${cast.id}: ${allSlides.length} slides in ${duration}ms`);
    } catch (error) {
      logger.error(`Failed to render cast ${cast.id}: ${error.message}`);
      throw error;
    }
  }

  flattenSlides(cast) {
    const slides = [];

    if (cast.groups && Array.isArray(cast.groups)) {
      for (const group of cast.groups) {
        if (group.slides && Array.isArray(group.slides)) {
          for (const slide of group.slides) {
            slides.push({
              ...slide,
              groupId: group.id,
              groupName: group.name,
            });
          }
        }
      }
    }

    return slides;
  }

  /**
   * Render a single slide - creates per-layer PNGs and metadata
   * Uses content hashing to skip unchanged layers (incremental rendering)
   */
  async renderSlide(castId, slideIndex, slide, variables = {}, options = {}) {
    const slideDir = path.join(this.renderDir, castId, String(slideIndex));
    const forceRender = options.force || false;

    // Try to load existing metadata for incremental rendering
    let existingMetadata = null;
    const existingLayerHashes = new Map(); // id/type -> { hash, file }

    if (!forceRender) {
      try {
        const metadataPath = path.join(slideDir, 'layers.json');
        const metadataJson = await fs.readFile(metadataPath, 'utf-8');
        existingMetadata = JSON.parse(metadataJson);

        // Build map of existing layer hashes
        for (const layer of (existingMetadata.layers || [])) {
          if (layer.contentHash) {
            existingLayerHashes.set(layer.id, {
              hash: layer.contentHash,
              file: layer.file,
              files: layer.files, // For nav elements with multiple states
            });
          }
        }

        // Also check background hash
        if (existingMetadata.backgroundHash) {
          existingLayerHashes.set('background', {
            hash: existingMetadata.backgroundHash,
            file: 'background.png',
          });
        }
      } catch (e) {
        // No existing metadata - full render needed
      }
    }

    // Ensure slide directory exists
    if (!existsSync(slideDir)) {
      mkdirSync(slideDir, { recursive: true });
    }

    const layers = [];
    const elements = slide.elements || [];
    let skippedLayers = 0;
    let renderedLayers = 0;
    const pendingWrites = [];

    // Sort elements by zIndex (lower zIndex = rendered first = behind)
    const sortedElements = [...elements].sort((a, b) => {
      const zA = a.zIndex ?? a.style?.zIndex ?? 0;
      const zB = b.zIndex ?? b.style?.zIndex ?? 0;
      return zA - zB;
    });

    // Render background first (zIndex -1)
    if (slide.background && slide.background.type !== 'video') {
      const bgHash = generateBackgroundHash(slide.background);
      const existingBg = existingLayerHashes.get('background');

      // Check if background needs re-rendering
      const bgFile = path.join(slideDir, 'background.png');
      const bgFileExists = existsSync(bgFile);

      // ==== PNG DIMENSION VALIDATION (#924) ====
      // Validate the cached PNG actually has the expected dimensions
      // before counting it as a cache hit. This prevents stale renders
      // from a previous pipeline (e.g. pre-#583 100x100 placeholders)
      // from being reused indefinitely just because their input hash
      // is unchanged. Cheap: 24-byte read of the PNG header.
      const bgFileValid = bgFileExists && pngHasDimensions(bgFile, 1920, 1080);

      if (!forceRender && existingBg && existingBg.hash === bgHash && bgFileValid) {
        // Background unchanged AND cached PNG is valid — reuse existing metadata
        skippedLayers++;
        layers.push({
          id: 'background',
          type: 'background',
          native: false,
          zIndex: -1,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
          file: 'background.png',
          loadPriority: 0,
          contentHash: bgHash,
        });
      } else {
        if (bgFileExists && !bgFileValid) {
          logger.warn(`Background cache invalid for ${slideDir}: dimensions mismatch (expected 1920x1080); re-rendering.`);
        }
        // Background changed or cached PNG was wrong dimensions - re-render
        const bgLayer = await this.renderBackgroundLayer(slideDir, slide.background);
        if (bgLayer) {
          bgLayer.contentHash = bgHash;
          layers.push(bgLayer);
          renderedLayers++;
        }
      }
    }

    // Render each element as a separate layer
    let layerIndex = 0;

    // Build render context (shared across all elements in this slide)
    const currentGroupId = slide.groupId || null;
    const renderContext = {
      currentGroupId,
      currentSlideIndex: slideIndex,
      assetBaseUrl: `${this.baseUrl}/api/extensions/slidecast/protocol/asset`,
    };

    // Pre-fetch all widget primitives in parallel (avoids per-element HTTP calls in loop)
    const widgetElements = sortedElements.filter((el) => el.type === 'widget' && !sharedRenderer.isNativeElement(el));
    if (widgetElements.length > 0) {
      logger.debug(`Pre-fetching primitives for ${widgetElements.length} widget(s)...`);
      await Promise.all(widgetElements.map(async (el) => {
        // Fold the widget's code into the element hash so a code edit re-renders
        // this layer even when config/styles are unchanged (BUG-1). Independent
        // of the primitives fetch below — a primitives failure must not skip it.
        el._widgetCodeHash = await this._computeWidgetCodeHash(el);
        try {
          const widgetUuid = el.widgetUuid || el.widget_name || '';
          const renderUrl = `${this.baseUrl}/api/extensions/slidecast/protocol/widget/${encodeURIComponent(widgetUuid)}/render`;
          const res = await fetch(renderUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: el.widgetConfig || el.config || {},
              styles: el.widgetStyles || el.styles || {},
              size: el.size,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.primitives) {
              el._widgetPrimitives = data.primitives;
            }
          }
        } catch (err) {
          logger.warn(`Pre-fetch widget primitives failed for ${el.id}: ${err.message}`);
        }
      }));
      logger.debug('Widget primitives pre-fetched');
    }

    // First pass: categorise every element as native, skipped, or needing render.
    // Elements that need rendering are collected into toRender[] for a single batch call.
    // Nav elements are collected separately — they need N+1 PNGs (highlight states).
    const toRender = []; // { element, zIndex, layerIndex, elementHash, elementContext }
    const navElements = []; // { element, zIndex, layerIndex, elementHash }

    for (let i = 0; i < sortedElements.length; i++) {
      const element = sortedElements[i];
      const zIndex = element.zIndex ?? element.style?.zIndex ?? i;

      // Native elements — metadata only, no PNG
      if (sharedRenderer.isNativeElement(element)) {
        const nativeMeta = this.createNativeLayerMetadata(element, zIndex);
        nativeMeta.contentHash = generateElementHash(element, variables);
        layers.push(nativeMeta);
        continue;
      }

      const elementHash = generateElementHash(element, variables);
      const existingLayer = existingLayerHashes.get(element.id);

      // Nav elements need N+1 PNGs (one per highlight state + one no-highlight).
      // Exclude them from the full-page batch and handle them after.
      if (element.type === 'nav') {
        // Check cache using the nav-specific "none" file as the sentinel.
        const navNoneFile = path.join(slideDir, `layer-${layerIndex}-nav-none.png`);
        const navNoneExists = existsSync(navNoneFile);

        if (!forceRender && existingLayer && existingLayer.hash === elementHash && navNoneExists) {
          skippedLayers++;
          const reusedMeta = this.createReusedLayerMetadata(element, zIndex, layerIndex, existingLayer, elementHash);
          layers.push(reusedMeta);
          layerIndex++;
          continue;
        }

        // Nav goes through batch path (single state for now — multi-state is a future optimization)
        // Falls through to toRender collection below
      }

      // Determine whether the cached file exists for non-nav elements.
      const layerFile = path.join(slideDir, `layer-${layerIndex}.png`);
      const layerFileExists = existsSync(layerFile);

      // Skip unchanged layers
      if (!forceRender && existingLayer && existingLayer.hash === elementHash && layerFileExists) {
        skippedLayers++;
        const reusedMeta = this.createReusedLayerMetadata(element, zIndex, layerIndex, existingLayer, elementHash);
        layers.push(reusedMeta);
        layerIndex++;
        continue;
      }

      // Build per-element render context (QR needs pre-generated data URL; widgets need primitives).
      const elementContext = { ...renderContext };

      if (element.type === 'qr' || element.type === 'qrcode') {
        const qrDataUrl = await generateQRDataUrl(element);
        if (qrDataUrl) elementContext.qrDataUrl = qrDataUrl;
      }

      if (element.type === 'widget') {
        elementContext.widgetUuid = element.widgetUuid;
        elementContext.widgetConfig = element.widgetConfig || element.config || {};
        elementContext.widgetStyles = element.widgetStyles || element.styles || {};
        if (element._widgetPrimitives) {
          elementContext.widgetPrimitives = element._widgetPrimitives;
        }
      }

      toRender.push({
        element, zIndex, layerIndex, elementHash, elementContext,
      });
      layerIndex++;
    }

    // Flag set when Playwright batch render fails — prevents writing a corrupt layers.json
    let renderFailed = false;

    // Second pass: batch-render all collected elements in a single page load.
    if (toRender.length > 0) {
      // Pass the per-element contexts alongside the elements so the render page can
      // use them. We merge elementContext into the element's own context field so
      // the render-element protocol can pick them up.
      //
      // Attach the caller's sparse layerIndex onto each element via `_layerIndex`
      // so renderSlideViaFullPage writes the worker output to the correct
      // layer-${layerIndex}.png slot, not the dense map index. Without this,
      // incremental renders (only some elements re-rendered) overwrite cached
      // PNGs at wrong slots — see #1001.
      const renderElements = toRender.map((t) => ({ ...t.element, _layerIndex: t.layerIndex }));

      // Build a merged context that carries all per-element sub-contexts keyed by id.
      const batchContext = {
        ...renderContext,
        perElement: Object.fromEntries(
          toRender.map((t) => [t.element.id, t.elementContext]),
        ),
      };

      try {
        const results = await this.renderSlideViaFullPage(castId, slideIndex, renderElements, variables, batchContext);

        for (const { element, buffer, navStates } of results) {
          const info = toRender.find((t) => t.element.id === element.id);
          if (!info) continue;

          const pos = element.position || {};
          const size = element.size || {};
          const style = element.style || {};
          const filename = `layer-${info.layerIndex}.png`;
          const pngPath = path.join(slideDir, filename);

          pendingWrites.push({ path: pngPath, buffer });

          // Match the expanded screenshot clip (renderSlideViaFullPage) so the
          // Roku positions the PNG's true painted extent. No-op for elements
          // without blur/box-shadow/scale/skew — identical to the raw rect.
          const rect = expandRectForEffects(
            {
              x: pos.x ?? 0,
              y: pos.y ?? 0,
              width: size.width ?? 100,
              height: size.height ?? 100,
            },
            style,
            { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT },
          );

          const layerEntry = {
            id: element.id,
            type: element.type,
            native: false,
            zIndex: info.zIndex,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            opacity: style.opacity ?? element.opacity ?? 1,
            rotation: pos.rotation ?? style.rotation ?? 0,
            file: filename,
            loadPriority: calculateLoadPriority(element),
            contentHash: info.elementHash,
          };

          if (element.type === 'widget' && element.widgetUuid) {
            layerEntry.widgetUuid = element.widgetUuid;
          }

          // Handle nav highlight state PNGs
          if (navStates && navStates.length > 0) {
            const navFiles = [];
            for (const state of navStates) {
              const stateFilename = `layer-${info.layerIndex}-nav-${state.index}.png`;
              pendingWrites.push({ path: path.join(slideDir, stateFilename), buffer: state.buffer });
              navFiles.push({
                file: stateFilename,
                index: state.index,
                label: state.label,
                groupId: state.groupId,
                actionType: state.actionType,
              });
            }
            layerEntry.files = navFiles;
            layerEntry.items = element.items || [];
            layerEntry.layout = element.layout || 'horizontal';
            layerEntry.navOrder = element.navOrder ?? 0;
            layerEntry.activeIndex = -1;
          }

          layers.push(layerEntry);
          renderedLayers++;
        }
      } catch (err) {
        logger.error(`Slide ${slideIndex} render FAILED — not writing cache. Reason: ${err.message}`);
        renderFailed = true;
      }
    }

    // Nav elements now render in the batch (single state). Multi-state is a future optimization.

    // Batch write all PNG buffers collected during the render loop
    if (pendingWrites.length > 0) {
      await Promise.all(pendingWrites.map((w) => fs.writeFile(w.path, w.buffer)));
      logger.debug(`Wrote ${pendingWrites.length} layer PNGs to disk`);
    }

    // Sort layers by zIndex for proper compositing order
    layers.sort((a, b) => a.zIndex - b.zIndex);

    // Save layer metadata
    const backgroundHash = slide.background ? generateBackgroundHash(slide.background) : null;
    const metadata = {
      slideIndex,
      width: 1920,
      height: 1080,
      background: slide.background,
      backgroundHash,
      layers,
      generatedAt: new Date().toISOString(),
      // Store slide hash for change detection (only queue changed slides on save)
      slideHash: options.slideHash || null,
      renderStats: {
        rendered: renderedLayers,
        skipped: skippedLayers,
        total: renderedLayers + skippedLayers,
      },
    };

    if (skippedLayers > 0) {
      logger.debug(`Slide ${slideIndex}: ${renderedLayers} rendered, ${skippedLayers} skipped (unchanged)`);
    }

    // If Playwright failed, do not write layers.json — leave slide uncached so it retries next time
    if (renderFailed) {
      logger.error(`Slide ${slideIndex} render FAILED — not writing cache. Slide will be retried on next rebuild.`);
      return null;
    }

    await fs.writeFile(
      path.join(slideDir, 'layers.json'),
      JSON.stringify(metadata, null, 2),
    );

    logger.debug(`Rendered slide ${slideIndex}: ${layers.length} layers`);
    return metadata;
  }

  /**
   * Create metadata for native elements (rendered by client)
   */
  createNativeLayerMetadata(element, zIndex) {
    const pos = element.position || {};
    const size = element.size || {};

    // Determine the actual type for the layer
    // For widgets, we need to specify clock/date/countdown so Roku knows how to render
    let layerType = element.type;

    if (element.type === 'widget') {
      const widgetUuid = element.widgetUuid || element.widget_name || '';
      const widgetType = element.widgetType || element.widget?.type || '';

      // Map widget to specific native type
      if (widgetUuid.includes('digital-clock') || widgetType === 'clock') {
        layerType = 'clock';
      } else if (widgetUuid.includes('date-display') || widgetType === 'date') {
        layerType = 'date';
      } else if (widgetUuid.includes('countdown') || widgetType === 'countdown') {
        layerType = 'countdown';
      }
      // Other widgets stay as 'widget' type (should not happen as they're rendered as PNG)
    }

    return {
      id: element.id,
      type: layerType,
      native: true,
      zIndex,
      x: pos.x ?? 0,
      y: pos.y ?? 0,
      width: size.width ?? 100,
      height: size.height ?? 100,
      opacity: element.style?.opacity ?? element.opacity ?? 1,
      rotation: pos.rotation ?? element.style?.rotation ?? 0,
      element, // Include full element data for native rendering
      loadPriority: calculateLoadPriority(element, layerType),
    };
  }

  /**
   * Create metadata for an unchanged layer (reused from cache)
   * Rebuilds metadata structure from element properties without re-rendering
   */
  createReusedLayerMetadata(element, zIndex, layerIndex, existingLayer, contentHash) {
    const pos = element.position || {};
    const size = element.size || {};
    const style = element.style || {};

    // Expanded to match the cached PNG's painted extent (the PNG on disk was
    // rendered with the expanded clip). No-op for effect-free elements.
    const rect = expandRectForEffects(
      {
        x: pos.x ?? 0,
        y: pos.y ?? 0,
        width: size.width ?? 100,
        height: size.height ?? 100,
      },
      style,
      { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT },
    );
    const {
      x, y, width, height,
    } = rect;
    const opacity = style.opacity ?? element.opacity ?? 1;
    const rotation = pos.rotation ?? style.rotation ?? 0;

    // Base metadata
    const meta = {
      id: element.id,
      type: element.type,
      native: false,
      zIndex,
      x,
      y,
      width,
      height,
      opacity,
      rotation,
      file: existingLayer.file || `layer-${layerIndex}.png`,
      loadPriority: calculateLoadPriority(element),
      contentHash,
    };

    // Nav elements have additional properties
    if (element.type === 'nav' && existingLayer.files) {
      meta.files = existingLayer.files;
      meta.layout = element.layout || 'horizontal';
      meta.navOrder = element.navOrder ?? 0;
      meta.items = (element.items || []).map((item, i) => ({
        index: i,
        label: item.label,
        groupId: item.action?.group_id,
        action: item.action,
      }));
      meta.activeIndex = -1;
    }

    return meta;
  }

  /**
   * Render background as a layer
   */
  async renderBackgroundLayer(slideDir, background) {
    const html = this.generateBackgroundHtml(background);
    const pngPath = path.join(slideDir, 'background.png');

    try {
      await this.renderHtmlToPng(html, pngPath, { width: 1920, height: 1080 });

      return {
        id: 'background',
        type: 'background',
        native: false,
        zIndex: -1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        file: 'background.png',
        loadPriority: 0, // Critical - background loads first
      };
    } catch (error) {
      logger.error(`Failed to render background: ${error.message}`);
      return null;
    }
  }

  /**
   * Render nav element as multiple PNGs - one for each highlight state + one "no highlight" state
   * This enables pixel-perfect nav highlighting on Roku
   * Uses renderElementViaPage() for each state, passing focusedNavItemIndex in context.
   */
  async renderNavElementLayers(castId, slideIndex, slideDir, element, zIndex, layerIndex, variables, baseContext) {
    const pos = element.position || {};
    const size = element.size || {};
    const style = element.style || {};
    const x = pos.x ?? 0;
    const y = pos.y ?? 0;
    const width = size.width ?? 100;
    const height = size.height ?? 100;
    const opacity = style.opacity ?? element.opacity ?? 1;
    const rotation = pos.rotation ?? style.rotation ?? 0;

    const items = element.items || [];
    const files = [];
    const writes = [];

    logger.debug(`Rendering nav with ${items.length + 1} states (${items.length} highlighted + 1 none)`);

    // First, render a "no highlight" PNG (focusedNavItemIndex = -1 means no highlight)
    const noHighlightFilename = `layer-${layerIndex}-nav-none.png`;
    const noHighlightPath = path.join(slideDir, noHighlightFilename);

    try {
      const noHighlightContext = {
        ...baseContext,
        currentGroupId: '__none__', // Special value that won't match any group
        currentSlideIndex: -1,
        focusedNavItemIndex: -1,
      };
      const buffer = await this.renderElementViaPage(castId, slideIndex, element, variables, noHighlightContext);
      writes.push({ path: noHighlightPath, buffer });
      files.push({
        index: -1,
        file: noHighlightFilename,
        groupId: null,
        label: 'none',
      });
    } catch (error) {
      logger.error(`Failed to render nav no-highlight state: ${error.message}`);
    }

    // Render one PNG for each nav item highlighted
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Get the group_id from the item's action to set as "current" for highlighting
      const currentGroupId = item.action?.group_id || null;
      const targetSlideIndex = item.action?.slide_index;

      const filename = `layer-${layerIndex}-nav-${i}.png`;
      const pngPath = path.join(slideDir, filename);

      try {
        const navItemContext = {
          ...baseContext,
          currentGroupId,
          currentSlideIndex: targetSlideIndex || 0,
          // Pass the focused nav item index for highlighting (important for launch_app, remote_command)
          focusedNavItemIndex: i,
        };
        const buffer = await this.renderElementViaPage(castId, slideIndex, element, variables, navItemContext);
        writes.push({ path: pngPath, buffer });
        files.push({
          index: i,
          file: filename,
          groupId: currentGroupId,
          slideIndex: targetSlideIndex, // Include slide index for matching when action.type = "slide"
          actionType: item.action?.type || 'group',
          label: item.label,
        });
      } catch (error) {
        logger.error(`Failed to render nav state ${i}: ${error.message}`);
      }
    }

    if (files.length === 0) {
      return { layerMeta: null, writes: [] };
    }

    // Default file is the "no highlight" state
    const defaultFile = files.find((f) => f.index === -1) || files[0];

    return {
      layerMeta: {
        id: element.id,
        type: 'nav',
        native: false,
        zIndex,
        x,
        y,
        width,
        height,
        opacity,
        rotation,
        // Nav layout and order for multi-nav support
        layout: element.layout || 'horizontal', // horizontal or vertical
        navOrder: element.navOrder ?? 0, // Lower = higher priority (first to be active)
        // Nav-specific metadata for multi-state rendering
        files, // Array of {index, file, groupId, label} - includes index=-1 for "none"
        items: items.map((item, i) => ({
          index: i,
          label: item.label,
          groupId: item.action?.group_id,
          action: item.action,
        })),
        activeIndex: -1, // Default to no highlight
        file: defaultFile.file, // Default file for backwards compatibility (no highlight)
        loadPriority: 2, // Normal - nav loads after important content
      },
      writes,
    };
  }

  /**
   * Render HTML to PNG file via the render worker.
   * Used for background rendering (solid colors, gradients).
   *
   * The HTML is encoded as a data: URL and passed directly to the worker — no
   * server roundtrip, no in-memory token store.  This makes the worker self-
   * sufficient and keeps the render path stateless.  The page must signal
   * completion by setting `document.body.dataset.renderReady = 'true'`.
   */
  async renderHtmlToPng(html, outputPath, options = {}) {
    if (!this.bridge?.isReady()) {
      throw new Error('Render worker not ready');
    }

    const width = options.width || 1920;
    const height = options.height || 1080;

    // Inject the renderReady signal so the worker's waitForFunction resolves.
    const htmlWithReadySignal = html.includes('renderReady')
      ? html
      : html.replace(
        /<\/body>/i,
        '<script>document.body.dataset.renderReady = "true";</script></body>',
      );

    const dataUrl = `data:text/html;base64,${Buffer.from(htmlWithReadySignal, 'utf8').toString('base64')}`;

    await this.bridge.renderElement({
      dataUrl,
      width,
      height,
      outputPath,
    });
  }

  /**
   * Generate HTML for background rendering
   */
  generateBackgroundHtml(background) {
    let bgStyle = 'background: transparent;';

    if (background.type === 'color') {
      bgStyle = `background-color: ${background.color || '#000000'};`;
    } else if (background.type === 'gradient') {
      const g = background;
      bgStyle = `background: linear-gradient(${g.angle || 0}deg, ${g.startColor || '#000'}, ${g.endColor || '#333'});`;
    } else if (background.type === 'image' && background.url) {
      bgStyle = `background-image: url('${background.url}'); background-size: cover; background-position: center;`;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1920px; height: 1080px; overflow: hidden; }
    .bg { width: 1920px; height: 1080px; ${bgStyle} }
  </style>
</head>
<body><div class="bg"></div></body>
</html>`;
  }

  /**
   * Get slide directory path
   */
  getSlideDir(castId, slideIndex) {
    return path.join(this.renderDir, castId, String(slideIndex));
  }

  /**
   * Get layer metadata for a slide
   */
  async getSlideLayerMetadata(castId, slideIndex) {
    const metadataPath = path.join(this.getSlideDir(castId, slideIndex), 'layers.json');
    const key = `${castId}:${slideIndex}`;

    // mtime-based invalidation: stat() is far cheaper than readFile + JSON.parse,
    // and every writer of layers.json (renderSlide, reRenderWidgetLayer, the
    // rerender-element route) rewrites the file — bumping mtime — so a stale
    // parse is never served. WHY cache at all: the per-screen ~10s cast-version
    // poll fans this call out across every screen on a cast, and cast-version
    // itself calls it once per widget-bearing slide via buildWidgetVersionsMap.
    let mtimeMs;
    try {
      const st = await fs.stat(metadataPath);
      mtimeMs = st.mtimeMs;
    } catch (error) {
      // Missing/unreadable file — drop any stale entry and behave as before (null).
      this._slideMetaCache.delete(key);
      return null;
    }

    const cached = this._slideMetaCache.get(key);
    if (cached && cached.mtimeMs === mtimeMs) {
      // Clone on the way out: callers may mutate the metadata (e.g. the
      // rerender-element route sets layerEntry.contentHash before rewriting
      // layers.json). Cloning keeps the cached copy pristine so the memoized
      // value stays identical to a fresh parse.
      return structuredClone(cached.data);
    }

    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(data);
      this._cacheSlideMeta(key, mtimeMs, parsed);
      return structuredClone(parsed);
    } catch (error) {
      this._slideMetaCache.delete(key);
      return null;
    }
  }

  /**
   * Store a parsed layers.json in the bounded cache with LRU eviction.
   * Map insertion order is oldest-first, so the first key is the eldest.
   */
  _cacheSlideMeta(key, mtimeMs, data) {
    if (this._slideMetaCache.has(key)) this._slideMetaCache.delete(key);
    this._slideMetaCache.set(key, { mtimeMs, data });
    while (this._slideMetaCache.size > SLIDE_META_CACHE_MAX) {
      const oldest = this._slideMetaCache.keys().next().value;
      this._slideMetaCache.delete(oldest);
    }
  }

  /**
   * Drop the cached layers.json for a slide. mtime invalidation already covers
   * on-disk rewrites; this is a prompt, explicit belt-and-suspenders call for
   * in-process rewriters (reRenderWidgetLayer).
   */
  invalidateSlideMeta(castId, slideIndex) {
    this._slideMetaCache.delete(`${castId}:${slideIndex}`);
  }

  /**
   * Re-render a single widget layer PNG after a widget refresh
   * Called when widget:layer_updated event fires from WidgetRefreshService
   * @param {string} castId - Cast UUID
   * @param {number} slideIndex - Slide index (flattened, across all groups)
   * @param {string} elementId - Element ID to find in layers.json
   */
  async reRenderWidgetLayer(castId, slideIndex, elementId) {
    const slideDir = path.join(this.renderDir, castId, String(slideIndex));

    // Read layers.json
    const metadataPath = path.join(slideDir, 'layers.json');
    let metadata;
    try {
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(metadataJson);
    } catch (e) {
      logger.debug(`reRenderWidgetLayer: no layers.json for cast=${castId} slide=${slideIndex}, skipping`);
      return;
    }

    // Find the layer entry for this element
    const layerEntry = (metadata.layers || []).find((l) => l.id === elementId);
    if (!layerEntry) {
      logger.debug(`reRenderWidgetLayer: element ${elementId} not found in layers.json for cast=${castId} slide=${slideIndex}`);
      return;
    }

    // Re-render via page.setContent() — need the full element object
    if (!layerEntry.file) {
      logger.debug(`reRenderWidgetLayer: element ${elementId} has no file field, skipping`);
      return;
    }

    // Load the cast to find the full element object (needed for widgetUuid, config, styles, size)
    let element = null;
    if (this.castManager) {
      try {
        const cast = await this.castManager.getByUuid(castId);
        if (cast) {
          const allSlides = this.flattenSlides(cast);
          const slide = allSlides[slideIndex];
          if (slide && slide.elements) {
            element = slide.elements.find((el) => el.id === elementId);
          }
        }
      } catch (err) {
        logger.warn(`reRenderWidgetLayer: failed to load cast ${castId} for element lookup: ${err.message}`);
      }
    }

    if (!element) {
      // Fallback: construct a minimal element from layers.json metadata
      logger.debug(`reRenderWidgetLayer: element ${elementId} not found in cast, using layers.json metadata`);
      element = {
        id: elementId,
        type: layerEntry.type || 'widget',
        widgetUuid: layerEntry.widgetUuid,
        size: { width: layerEntry.width || 100, height: layerEntry.height || 100 },
      };
    }

    const pngPath = path.join(slideDir, layerEntry.file);

    // Build context for render-element page
    const renderContext = {
      currentGroupId: null,
      currentSlideIndex: slideIndex,
      assetBaseUrl: `${this.baseUrl}/api/extensions/slidecast/protocol/asset`,
    };
    if (element.type === 'widget') {
      renderContext.widgetUuid = element.widgetUuid;
      renderContext.widgetConfig = element.widgetConfig || element.config || {};
      renderContext.widgetStyles = element.widgetStyles || element.styles || {};
    }

    // #1150: renderElementViaPage returns a Buffer (it renders to a _tmp_ file,
    // reads it back, and unlinks the tmp). Prior code passed pngPath as a 6th
    // arg expecting the function to write directly there, but that arg was
    // silently ignored — so the real layer PNG on disk was NEVER overwritten
    // when a widget refresh fired. This is why the debug page's "Image created"
    // timestamp stayed pinned to the original full-slide render (mtime never
    // changed) even though contentHash in layers.json advanced, AND why Roku
    // kept seeing stale bytes from /protocol/slide-layer/... — the file bytes
    // themselves never updated.
    let buffer;
    try {
      buffer = await this.renderElementViaPage(castId, slideIndex, element, {}, renderContext);
    } catch (err) {
      logger.warn(`reRenderWidgetLayer: renderElementViaPage failed for element ${elementId}: ${err.message}`);
      return;
    }

    // Write the freshly rendered bytes to the real layer PNG path. This also
    // refreshes mtime, which is what the debug page's `image_created_at` reads
    // (routes/protocol.js resolveWidgetImage — mtimeMs → ISO).
    try {
      await fs.writeFile(pngPath, buffer);
    } catch (err) {
      logger.error(`reRenderWidgetLayer: failed to write ${pngPath}: ${err.message}`);
      return;
    }

    // Update contentHash in layers.json — derive from the element INPUT data,
    // NOT from the rendered PNG bytes. (#1020) PNG bytes vary across renders
    // due to font load timing (#1009), anti-aliasing, and asset preload order,
    // which would silently change the contentHash and cause Roku to re-fetch
    // identical-looking layers — producing the visible "weather widget blink"
    // on the Hanger Roku. The full-slide pipeline already uses this same
    // input-hash function (renderSlide path) — reRenderWidgetLayer must match,
    // including the widget-code hash (BUG-1) so the two paths agree and a code
    // edit isn't silently un-hashed here (which would churn on the next render).
    element._widgetCodeHash = await this._computeWidgetCodeHash(element);
    layerEntry.contentHash = generateElementHash(element, {});

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    // The layer PNG + layers.json were just rewritten (new mtime). Drop our own
    // parse cache promptly so slide-layers/boot see the fresh metadata.
    this.invalidateSlideMeta(castId, slideIndex);
    logger.info(`reRenderWidgetLayer: re-rendered ${layerEntry.file} for element ${elementId} (cast=${castId} slide=${slideIndex})`);
  }

  /**
   * Set up event listeners for widget layer refresh events
   * @param {EventEmitter} eventBus - Platform or local event bus
   */
  setupEventListeners(eventBus, { updateTracker, screenManager } = {}) {
    if (!eventBus) return;

    // Idempotency (BUG-3a): api.globalEventBus is a single, persistent object
    // that outlives extension reloads, so a fresh init()'s setupEventListeners
    // would otherwise stack another 'widget:layer_updated' listener on top of the
    // prior instance's — leaking one handler per reload and firing
    // reRenderWidgetLayer N times per event. Detach whatever a previous instance
    // stashed on the bus (via the global-registry Symbol so it survives the
    // cache-busting module re-import), plus our own if called twice on one
    // instance. Only OUR marker is removed, so protocol.js's separate
    // widget:layer_updated listener is left untouched.
    removeBusListener(eventBus, 'widget:layer_updated', eventBus[LAYER_UPDATED_HANDLER]);
    removeBusListener(eventBus, 'widget:layer_updated', this._layerUpdatedHandler);

    const handler = async ({
      castId, slideIndex, elementId, widgetUuid, contentHash,
    }) => {
      try {
        await this.reRenderWidgetLayer(castId, slideIndex, elementId);

        // Notify Roku screens showing this cast that the slide layer changed
        if (updateTracker && screenManager) {
          const screens = await screenManager.getScreensForCast(castId);
          if (screens && screens.length > 0) {
            const update = UpdateTypes.slideRendered(castId, slideIndex);
            for (const screen of screens) {
              const serial = screen.serial || screen.screen_serial;
              if (serial) updateTracker.pushUpdate(serial, update);
            }
          }
        }
      } catch (err) {
        logger.error(`Failed to re-render widget layer: cast=${castId} slide=${slideIndex} element=${elementId}: ${err.message}`);
      }
    };

    eventBus.on('widget:layer_updated', handler);
    this._eventBus = eventBus;
    this._layerUpdatedHandler = handler;
    eventBus[LAYER_UPDATED_HANDLER] = handler;
    logger.debug('SlideImageRenderer: listening for widget:layer_updated events');
  }

  /**
   * Detach the widget:layer_updated listener registered by setupEventListeners.
   * Register from init via ctx.onDestroy so unload/hot-reload doesn't leave a
   * dangling handler on the persistent global event bus (BUG-3a). Idempotent and
   * safe to call when nothing was registered. (setupEventListeners is also
   * self-healing across reloads, so the leak is bounded even if this isn't wired.)
   */
  teardownEventListeners() {
    if (this._eventBus && this._layerUpdatedHandler) {
      removeBusListener(this._eventBus, 'widget:layer_updated', this._layerUpdatedHandler);
      // Only clear the shared bus marker if it still points at OUR handler — a
      // newer instance may have already replaced it via setupEventListeners.
      if (this._eventBus[LAYER_UPDATED_HANDLER] === this._layerUpdatedHandler) {
        this._eventBus[LAYER_UPDATED_HANDLER] = null;
      }
    }
    this._eventBus = null;
    this._layerUpdatedHandler = null;
  }

  /**
   * Get layer image stream
   */
  getLayerImageStream(castId, slideIndex, filename) {
    const imagePath = path.join(this.getSlideDir(castId, slideIndex), filename);
    if (existsSync(imagePath)) {
      return createReadStream(imagePath);
    }
    return null;
  }

  /**
   * Legacy method for backwards compatibility - returns background PNG path
   */
  getSlideImagePath(castId, slideIndex) {
    return path.join(this.getSlideDir(castId, slideIndex), 'background.png');
  }

  /**
   * Legacy method for backwards compatibility - returns background PNG stream
   */
  getSlideImageStream(castId, slideIndex) {
    const imagePath = this.getSlideImagePath(castId, slideIndex);
    if (existsSync(imagePath)) {
      return createReadStream(imagePath);
    }
    return null;
  }

  /**
   * Check if slide has been rendered
   */
  async hasRenderedSlide(castId, slideIndex) {
    const metadataPath = path.join(this.getSlideDir(castId, slideIndex), 'layers.json');
    return existsSync(metadataPath);
  }

  /**
   * Clear all renders for a cast
   */
  async clearCastRenders(castId) {
    const castDir = path.join(this.renderDir, castId);
    try {
      await fs.rm(castDir, { recursive: true, force: true });
      logger.debug(`Cleared renders for cast ${castId}`);
    } catch (error) {
      // Directory might not exist
    }
  }

  /**
   * Alias for clearCastRenders (used by casts.js delete route)
   */
  async deleteCastRenders(castId) {
    return this.clearCastRenders(castId);
  }

  /**
   * Return the newest file mtime (ms) anywhere under `dir`, walking one level
   * of slide subdirectories (renderDir/{cast}/{slide}/{files}). Returns 0 when
   * no files are found. Best-effort — unreadable entries are skipped (SL5).
   * @param {string} dir - Cast render directory
   * @returns {Promise<number>} Newest mtimeMs, or 0
   */
  async _newestFileMtime(dir) {
    let newest = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this._newestFileMtime(entryPath);
        if (nested > newest) { newest = nested; }
      } else {
        const st = await fs.stat(entryPath).catch(() => null);
        if (st && st.mtimeMs > newest) { newest = st.mtimeMs; }
      }
    }
    return newest;
  }

  /**
   * Cleanup rendered images older than maxAgeDays
   * Used for automatic disk space management
   * @param {number} maxAgeDays - Maximum age of renders to keep (default: 7 days)
   * @returns {Object} Cleanup result with success status and count
   */
  async cleanupOldRenders(maxAgeDays = 7) {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;
    let errors = 0;

    try {
      // List all cast directories
      const castDirs = await fs.readdir(this.renderDir).catch(() => []);

      for (const castDir of castDirs) {
        const castPath = path.join(this.renderDir, castDir);

        try {
          const stats = await fs.stat(castPath);

          // Skip if not a directory
          if (!stats.isDirectory()) continue;

          // SL5: base staleness on the NEWEST file mtime inside the cast dir,
          // not the cast dir's own mtime. In-place re-renders (the common case)
          // rewrite slide PNGs but never touch the parent dir's mtime, so a
          // dir-mtime check flagged actively-served casts as "old" and wiped
          // them every maxAgeDays — forcing a full re-render of unchanged casts.
          const newestMtime = await this._newestFileMtime(castPath);
          // Fall back to the dir mtime if the tree has no files at all.
          const effectiveMtime = newestMtime > 0 ? newestMtime : stats.mtimeMs;

          if (now - effectiveMtime > maxAgeMs) {
            await fs.rm(castPath, { recursive: true, force: true });
            cleaned++;
            logger.debug(`Cleaned old render: ${castDir} (${Math.round((now - effectiveMtime) / (24 * 60 * 60 * 1000))} days old)`);
          }
        } catch (err) {
          errors++;
          logger.warn(`Error cleaning render ${castDir}: ${err.message}`);
        }
      }

      if (cleaned > 0) {
        logger.info(`Render cleanup: removed ${cleaned} old cast render(s), ${errors} error(s)`);
      }

      return { success: true, cleaned, errors };
    } catch (error) {
      logger.error(`Render cleanup error: ${error.message}`);
      return {
        success: false, error: error.message, cleaned, errors,
      };
    }
  }

  /**
   * Get render directory statistics for diagnostics
   */
  async getStats() {
    try {
      const castDirs = await fs.readdir(this.renderDir).catch(() => []);
      let totalSize = 0;
      let totalSlides = 0;

      for (const castDir of castDirs) {
        const castPath = path.join(this.renderDir, castDir);
        const stats = await fs.stat(castPath).catch(() => null);

        if (stats?.isDirectory()) {
          const slideDirs = await fs.readdir(castPath).catch(() => []);
          totalSlides += slideDirs.length;

          // Estimate size by counting files
          for (const slideDir of slideDirs) {
            const slidePath = path.join(castPath, slideDir);
            const files = await fs.readdir(slidePath).catch(() => []);

            for (const file of files) {
              const fileStats = await fs.stat(path.join(slidePath, file)).catch(() => null);
              if (fileStats) totalSize += fileStats.size;
            }
          }
        }
      }

      return {
        castCount: castDirs.length,
        slideCount: totalSlides,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Merge static layers into a single background PNG
   * Reduces number of downloads for Roku - instead of N layers, get 1 merged + M dynamic
   * Uses Sharp for high-performance image compositing
   *
   * @param {string} castId - Cast UUID
   * @param {number} slideIndex - Slide index
   * @param {Object} metadata - Layer metadata from getSlideLayerMetadata
   * @returns {Object} { mergedFile, dynamicLayers, mergedCount }
   */
  async mergeStaticLayers(castId, slideIndex, metadata) {
    if (!metadata || !metadata.layers) {
      return null;
    }

    const slideDir = this.getSlideDir(castId, slideIndex);
    const mergedPath = path.join(slideDir, 'merged-static.png');

    // Separate static and dynamic layers
    const staticLayers = [];
    const dynamicLayers = [];

    for (const layer of metadata.layers) {
      // Dynamic layers: native elements, videos, widgets that need updates
      if (layer.native || layer.type === 'video') {
        dynamicLayers.push(layer);
      } else {
        staticLayers.push(layer);
      }
    }

    // If no static layers or only 1, don't merge
    if (staticLayers.length <= 1) {
      return {
        mergedFile: null,
        dynamicLayers,
        staticLayers,
        mergedCount: 0,
      };
    }

    try {
      // Lazy load Sharp
      const sharp = (await import('sharp')).default;

      // Create base image (1920x1080 transparent)
      const composite = sharp({
        create: {
          width: 1920,
          height: 1080,
          channels: 4,
          background: {
            r: 0, g: 0, b: 0, alpha: 0,
          },
        },
      });

      // Build composite operations for each static layer
      const compositeOperations = [];

      for (const layer of staticLayers) {
        if (!layer.file) continue;

        const layerPath = path.join(slideDir, layer.file);

        // Check if file exists
        if (!existsSync(layerPath)) {
          logger.warn(`Layer file not found for merge: ${layer.file}`);
          continue;
        }

        // For nav layers, use the default (no highlight) state
        let filePath = layerPath;
        if (layer.type === 'nav' && layer.files) {
          const noneFile = layer.files.find((f) => f.index === -1);
          if (noneFile) {
            filePath = path.join(slideDir, noneFile.file);
          }
        }

        compositeOperations.push({
          input: filePath,
          left: Math.round(layer.x || 0),
          top: Math.round(layer.y || 0),
          // Note: Sharp doesn't support per-layer opacity in composite directly
          // Would need to process each layer first if opacity < 1
        });
      }

      if (compositeOperations.length === 0) {
        return {
          mergedFile: null,
          dynamicLayers,
          staticLayers,
          mergedCount: 0,
        };
      }

      // Perform the composite
      await composite
        .composite(compositeOperations)
        .png()
        .toFile(mergedPath);

      logger.debug(`Merged ${compositeOperations.length} static layers into merged-static.png for slide ${slideIndex}`);

      // Get merged file stats
      const stats = await fs.stat(mergedPath);

      return {
        mergedFile: 'merged-static.png',
        mergedUrl: `/api/extensions/slidecast/protocol/slide-layer/${castId}/${slideIndex}/merged-static.png`,
        mergedSize: stats.size,
        dynamicLayers,
        staticLayers, // Still returned for reference
        mergedCount: compositeOperations.length,
        layerCount: {
          merged: compositeOperations.length,
          dynamic: dynamicLayers.length,
          total: metadata.layers.length,
        },
      };
    } catch (error) {
      logger.error(`Failed to merge static layers: ${error.message}`);
      return {
        mergedFile: null,
        dynamicLayers,
        staticLayers,
        mergedCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get cache status for all slides in a cast
   * @param {string} castId - The cast UUID
   * @param {number} totalSlides - Total number of slides in the cast
   * @param {Date} castUpdatedAt - When the cast was last updated
   * @returns {Object} Cache status with per-slide details
   */
  async getCastCacheStatus(castId, totalSlides, castUpdatedAt) {
    const slides = [];
    let cachedCount = 0;
    let staleCount = 0;
    let totalSize = 0;

    const castUpdateTime = new Date(castUpdatedAt || 0).getTime();

    for (let i = 0; i < totalSlides; i++) {
      const metadata = await this.getSlideLayerMetadata(castId, i);

      if (metadata) {
        const renderTime = new Date(metadata.generatedAt || 0).getTime();
        const isStale = castUpdateTime > renderTime;

        // Calculate slide size
        let size = 0;
        const slideDir = this.getSlideDir(castId, i);
        try {
          const files = await fs.readdir(slideDir);
          for (const file of files) {
            if (file.endsWith('.png') || file.endsWith('.jpg')) {
              const stats = await fs.stat(path.join(slideDir, file));
              size += stats.size;
            }
          }
        } catch (e) {
          // Directory might not exist
        }

        totalSize += size;

        if (isStale) {
          staleCount++;
        } else {
          cachedCount++;
        }

        slides.push({
          index: i,
          status: isStale ? 'stale' : 'cached',
          generatedAt: metadata.generatedAt,
          layerCount: metadata.layers?.length || 0,
          renderStats: metadata.renderStats || null,
          size,
        });
      } else {
        slides.push({
          index: i,
          status: 'not_cached',
          generatedAt: null,
          layerCount: 0,
          renderStats: null,
          size: 0,
        });
      }
    }

    return {
      castId,
      totalSlides,
      cachedCount,
      staleCount,
      notCachedCount: totalSlides - cachedCount - staleCount,
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
      slides,
      isFullyCached: cachedCount === totalSlides,
      hasStale: staleCount > 0,
    };
  }
}

export default SlideImageRenderer;
