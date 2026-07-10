/**
 * @waiveo/slide-renderer
 *
 * Shared slide rendering library for Slidecast
 * Used by both frontend (Svelte) and backend (Playwright PNG rendering)
 *
 * This is the SINGLE SOURCE OF TRUTH for all slide rendering.
 * Any changes here will affect both web preview and Roku PNG generation.
 */

// Style utilities
export {
  hexToRgba,
  styleToString,
  getElementStyle,
  expandRectForEffects,
  getTextStyle,
  getShapeStyle,
  getImageStyle,
  getVideoStyle,
  getQRStyle,
  getNavContainerStyle,
  getNavStyle,
  getNavItemStyle,
  getPingStyle,
} from './styleBuilder.js';

// Widget rendering
export {
  escapeHtml,
  renderPrimitivesToHtml,
  isNativeWidget,
} from './widgetRenderer.js';

// Element rendering
export {
  resolveVariables,
  renderElementToHtml,
} from './elementRenderer.js';

// Native element detection for Roku rendering
// These elements are loaded directly by Roku rather than rendered as PNG:
// - video: Roku plays video natively
// - image: Roku loads images directly from asset URL (avoids Playwright network issues)
// Nav is static content - render as PNG for pixel-perfect matching
export const NATIVE_ELEMENT_TYPES = ['video', 'image'];
// Only these simple widgets can be rendered natively by Roku
// Complex widgets (weather, etc.) MUST be pre-rendered as PNG
export const NATIVE_WIDGET_TYPES = ['clock', 'date', 'countdown'];

/**
 * Check if an element should be rendered natively (not as PNG)
 * Used by Roku PNG renderer to skip certain elements
 *
 * IMPORTANT: Only video and simple clock/date/countdown widgets should be native.
 * All other widgets (weather, stocks, etc.) must be rendered as PNG because
 * Roku doesn't have the capability to render them natively.
 */
export function isNativeElement(element) {
  if (NATIVE_ELEMENT_TYPES.includes(element.type)) {
    return true;
  }

  if (element.type === 'widget') {
    // Get widget identifier
    const widgetUuid = element.widgetUuid || element.widget_name || '';
    const widgetType = element.widgetType || element.widget?.type || '';

    // Only allow truly simple widgets to be native
    // These are widgets Roku can actually render: basic clock, date, countdown
    const isSimpleClock = widgetUuid.includes('digital-clock') || widgetType === 'clock';
    const isSimpleDate = widgetUuid.includes('date-display') || widgetType === 'date';
    const isSimpleCountdown = widgetUuid.includes('countdown') || widgetType === 'countdown';

    // Complex widgets like weather, quotes, etc. should ALWAYS render as PNG
    // Even if _widgetRenderMode is 'native', Roku can't render them
    if (isSimpleClock || isSimpleDate || isSimpleCountdown) {
      return true;
    }

    // All other widgets (weather, stocks, quotes, etc.) render as PNG
    return false;
  }

  return false;
}
