/**
 * Protocol Formatter - Helper functions for TV protocol rendering
 * Formats slidecast elements for TV/device consumption
 *
 * This formatter mirrors the SlideRenderer.svelte styling to ensure
 * pixel-perfect rendering on TV devices.
 */

/**
 * Helper: Resolve {{variable}} syntax
 */
function resolveVariables(text, variables) {
  if (!text || typeof text !== 'string') return text || '';
  let resolved = text;
  for (const [key, value] of Object.entries(variables || {})) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return resolved;
}

/**
 * Helper: Format element for TV rendering
 * Matches SlideRenderer.svelte getElementStyle, getTextStyle, getShapeStyle, etc.
 */
export function formatElementForTV(element, variables, baseUrl = '') {
  const el = {
    id: element.id,
    type: element.type,
    position: {
      x: element.position?.x || 0,
      y: element.position?.y || 0,
    },
    size: {
      width: element.size?.width || 100,
      height: element.size?.height || 100,
    },
    zIndex: element.zIndex || 0,
  };

  // Common style properties (from getElementStyle in SlideRenderer.svelte)
  const s = element.style || {};
  el.commonStyle = {
    opacity: s.opacity ?? 1,
    // Transforms
    rotation: s.rotation || 0,
    scale: s.scale || 1,
    flipX: s.flipX || false,
    flipY: s.flipY || false,
    skewX: s.skewX || 0,
    skewY: s.skewY || 0,
    // Blur
    blur: s.blur || 0,
    // Shadow
    shadowEnabled: s.shadowEnabled || false,
    shadowX: s.shadowX ?? 4,
    shadowY: s.shadowY ?? 4,
    shadowBlur: s.shadowBlur ?? 8,
    shadowColor: s.shadowColor || '#000000',
    shadowOpacity: s.shadowOpacity ?? 0.5,
    // Border
    borderEnabled: s.borderEnabled || false,
    borderWidth: s.borderWidth || 2,
    borderStyle: s.borderStyle || 'solid',
    borderColor: s.borderColor || '#ffffff',
    borderRadius: s.borderRadius || 0,
    // Gradient mask
    gradientMaskEnabled: s.gradientMaskEnabled || false,
    gradientDirection: s.gradientDirection || 'to-right',
    gradientStart: s.gradientStart ?? 0,
    gradientEnd: s.gradientEnd ?? 100,
  };

  // Type-specific formatting
  switch (element.type) {
    case 'text':
      el.content = resolveVariables(element.content || '', variables);
      el.style = {
        fontFamily: s.fontFamily || 'Inter',
        fontSize: s.fontSize || 24,
        fontWeight: s.fontWeight || 'normal',
        fontStyle: s.fontStyle || 'normal',
        color: s.color || '#ffffff',
        textAlign: s.textAlign || 'left',
        lineHeight: s.lineHeight || 1.2,
        letterSpacing: s.letterSpacing || 0,
        textDecoration: s.textDecoration || 'none',
        backgroundColor: s.backgroundColor || 'transparent',
        padding: s.padding || 0,
        textShadow: s.textShadow || 'none',
        // Text stroke
        strokeColor: s.strokeColor || '#000000',
        strokeWidth: s.strokeWidth || 0,
        opacity: s.opacity ?? 1,
      };
      break;

    case 'image':
      el.url = element.asset_id ? `${baseUrl}/api/extensions/slidecast/protocol/asset/${element.asset_id}` : (element.src || null);
      el.asset_id = element.asset_id;
      el.style = {
        objectFit: s.objectFit || 'cover',
        opacity: s.opacity ?? 1,
        borderRadius: s.borderRadius || 0,
        borderWidth: s.borderWidth || 0,
        borderColor: s.borderColor || '#ffffff',
        shadow: s.shadow || 'none',
      };
      break;

    case 'video':
      el.url = element.asset_id ? `${baseUrl}/api/extensions/slidecast/protocol/asset/${element.asset_id}` : (element.src || null);
      el.asset_id = element.asset_id;
      el.playback = {
        loop: element.playback?.loop !== false && element.config?.loop !== false,
        muted: element.playback?.muted !== false && element.config?.muted !== false,
        autoplay: element.playback?.autoplay !== false && element.config?.autoplay !== false,
      };
      el.style = {
        objectFit: s.objectFit || 'cover',
        opacity: s.opacity ?? 1,
        borderRadius: s.borderRadius || 0,
      };
      break;

    case 'shape': {
      el.shape = element.shape || 'rectangle';
      // Support both UI format (backgroundColor) and legacy format (fill)
      const fillColor = s.backgroundColor || s.fill || '#3b82f6';
      const fillOpacity = s.fillOpacity !== undefined ? s.fillOpacity : (s.opacity ?? 1);
      el.style = {
        fill: fillColor,
        fillOpacity,
        stroke: s.stroke || 'none',
        strokeWidth: s.strokeWidth || 0,
        borderRadius: s.borderRadius || 0,
        opacity: s.opacity ?? 1,
        // Check for gradient
        isGradient: fillColor?.includes?.('gradient') || false,
        gradient: fillColor?.includes?.('gradient') ? fillColor : null,
      };
      break;
    }

    case 'nav':
      el.layout = element.layout || 'horizontal';
      el.items = (element.items || []).map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        iconClass: item.iconClass,
        iconSvg: item.iconSvg,
        action: item.action,
      }));
      el.style = {
        // Container styles
        containerBackground: s.containerBackground || '#000000',
        containerOpacity: s.containerOpacity ?? 0.6,
        containerRadius: s.containerRadius ?? 16,
        containerPadding: s.containerPadding ?? 8,
        containerBlur: s.containerBlur || 0,
        // Item styles
        itemBackgroundColor: s.itemBackgroundColor || '#ffffff',
        itemBackgroundOpacity: s.itemBackgroundOpacity ?? 0,
        itemColor: s.itemColor || '#ffffff',
        itemPadding: s.itemPadding || 12,
        itemBorderRadius: s.itemBorderRadius || 8,
        itemGap: s.itemGap || 4,
        fontSize: s.fontSize || 15,
        iconSize: s.iconSize || 20,
        iconPosition: s.iconPosition || 'left',
        // Active state
        activeBackgroundColor: s.activeBackgroundColor || '#6366f1',
        activeBackgroundOpacity: s.activeBackgroundOpacity ?? 0.9,
        activeTextColor: s.activeTextColor || '#ffffff',
        activeIndicator: s.activeIndicator || 'background',
        // Hover (for interactive devices)
        hoverBackgroundColor: s.hoverBackgroundColor || '#ffffff',
        hoverBackgroundOpacity: s.hoverBackgroundOpacity ?? 0.15,
        hoverScale: s.hoverScale || 1.02,
        // Overall
        opacity: s.opacity ?? 1,
      };
      break;

    case 'ping':
      el.label = element.label;
      el.icon = element.icon;
      el.ping_name = element.ping_name;
      el.pingUrl = `${baseUrl}/api/extensions/slidecast/protocol/ping`;
      el.style = {
        background: s.background || '#ef4444',
        color: s.color || '#ffffff',
        fontSize: s.fontSize || 20,
        borderRadius: s.borderRadius || 8,
        fontWeight: '600',
      };
      break;

    case 'qr':
    case 'qrcode': {
      el.type = 'qr';
      el.data = element.data || element.config?.url || element.config?.data || 'https://example.com';
      el.style = {
        background: s.background || s.backgroundColor || '#ffffff',
        foreground: s.foreground || '#000000',
        padding: s.padding || 8,
        borderRadius: s.borderRadius || 4,
      };
      // QR code render URL
      const qrSize = Math.min(el.size.width, el.size.height);
      const fgColor = el.style.foreground.replace('#', '');
      const bgColor = el.style.background.replace('#', '');
      el.qrUrl = `${baseUrl}/api/extensions/slidecast/protocol/qrcode?data=${encodeURIComponent(el.data)}&size=${qrSize}&fgColor=${fgColor}&bgColor=${bgColor}`;
      break;
    }

    case 'widget': {
      // widgetId is the template ID, widgetUuid is the unique instance ID
      el.widgetId = element.widgetId || element.widgetUuid;
      el.widgetUuid = element.widgetUuid;
      el.widgetName = element.widgetName || 'Widget';
      el.widgetType = element.widgetType || null;
      el.config = element.config || {};
      el.styles = element.styles || {};
      // Refresh interval in milliseconds (0 = no refresh, default 60s)
      // Can be overridden per-widget instance in the cast
      el.refreshInterval = element.refreshInterval ?? element.config?.refreshInterval ?? 60000;
      // Widget image render URL (server-side rendered PNG)
      // Use widgetUuid for rendering if available, fallback to widgetId
      const widgetRenderKey = el.widgetUuid || el.widgetId;
      if (widgetRenderKey) {
        const configParam = encodeURIComponent(JSON.stringify(el.config));
        const stylesParam = encodeURIComponent(JSON.stringify(el.styles));
        el.renderUrl = `${baseUrl}/api/extensions/slidecast/widgets/${widgetRenderKey}/render?config=${configParam}&styles=${stylesParam}&width=${el.size.width}&height=${el.size.height}&format=png`;
      }
      break;
    }

    case 'background':
      el.style = {
        backgroundColor: s.backgroundColor || '#1a1a2e',
      };
      break;

    default:
      // Copy unknown elements as-is with their styles
      el.style = element.style || {};
  }

  return el;
}

// Must match shared-renderer/index.js NATIVE_ELEMENT_TYPES — these are elements rendered natively by the Roku, not via Playwright PNG
const NATIVE_ELEMENT_TYPES = ['video', 'image'];
const NATIVE_WIDGET_TYPES = ['clock', 'date', 'countdown'];

/**
 * Check if an element should be rendered natively on the device
 * (video, nav, or native widgets like clock/date/countdown)
 */
export function isNativeElement(element) {
  if (NATIVE_ELEMENT_TYPES.includes(element.type)) {
    return true;
  }
  if (element.type === 'widget') {
    const widgetType = element.widgetType || element.widget?.type;
    if (NATIVE_WIDGET_TYPES.includes(widgetType)) {
      return true;
    }
  }
  return false;
}

/**
 * Format a slide for TV protocol consumption.
 *
 * Handles background types (image/video/gradient/color), separates native vs
 * static elements, computes auto-advance logic, and returns a TV-optimized
 * slide object.
 *
 * @param {Object} slide - The slide definition
 * @param {number} slideIndex - Index of this slide in the flat list
 * @param {Object|null} group - The group this slide belongs to (null for direct/legacy slides)
 * @param {Object} variables - Template variables for {{variable}} resolution
 * @param {string} castUuid - The cast UUID (used for layersUrl)
 */
export function formatSlide(slide, slideIndex, group, variables, castUuid) {
  const groupId = group?.id || null;
  // Format background
  let background = { type: 'color', color: '#1a1a2e' };
  let backgroundVideo = null;

  if (slide.background) {
    if (slide.background.type === 'image' && slide.background.asset_id) {
      background = {
        type: 'image',
        url: `/api/extensions/slidecast/protocol/asset/${slide.background.asset_id}`,
        asset_id: slide.background.asset_id,
      };
    } else if (slide.background.type === 'video' && slide.background.asset_id) {
      // For PNG rendering, use fallback color; for Roku, provide video separately
      background = {
        type: 'color',
        color: slide.background.fallbackColor || '#000000',
      };
      backgroundVideo = {
        url: `/api/extensions/slidecast/protocol/asset/${slide.background.asset_id}`,
        asset_id: slide.background.asset_id,
        loop: slide.background.loop !== false,
        muted: slide.background.muted !== false,
        fallbackColor: slide.background.fallbackColor || '#000000',
      };
    } else if (slide.background.type === 'gradient') {
      background = {
        type: 'gradient',
        gradient: slide.background.gradient,
        fallbackColor: slide.background.fallbackColor || '#1a1a2e',
      };
    } else {
      background = {
        type: 'color',
        color: slide.background.color || slide.backgroundColor || '#1a1a2e',
      };
    }
  } else if (slide.backgroundColor) {
    background = { type: 'color', color: slide.backgroundColor };
  }

  // Separate native elements from static elements
  const allElements = [...(slide.elements || [])]
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  const nativeElements = allElements
    .filter(isNativeElement)
    .map((el) => formatElementForTV(el, variables, ''));

  const staticElements = allElements
    .filter((el) => !isNativeElement(el))
    .map((el) => formatElementForTV(el, variables, ''));

  // Extract native widgets specifically
  const nativeWidgets = allElements
    .filter((el) => el.type === 'widget' && NATIVE_WIDGET_TYPES.includes(el.widgetType || el.widget?.type))
    .map((el) => formatElementForTV(el, variables, ''));

  // Extract nav element if present
  const navElement = allElements.find((el) => el.type === 'nav');
  const nav = navElement ? formatElementForTV(navElement, variables, '') : null;

  // Check if slide should auto-advance
  // If slide.autoAdvance is undefined, inherit from group (default true)
  // If slide.autoAdvance is explicitly false, no auto-advance
  const groupAutoAdvance = group?.autoAdvance !== false;
  const slideAutoAdvance = slide.autoAdvance === undefined ? groupAutoAdvance : slide.autoAdvance;

  // Only include duration if auto-advance is enabled
  const effectiveDuration = slideAutoAdvance ? (slide.duration || group?.defaultDuration || 10000) : null;

  return {
    id: slide.id || `slide-${slideIndex}`,
    name: slide.name || `Slide ${slideIndex + 1}`,
    duration: effectiveDuration, // null means no auto-advance
    durationSeconds: effectiveDuration ? Math.round(effectiveDuration / 1000) : null,
    groupId,
    background,
    backgroundVideo, // Separate video background for Roku native playback
    backgroundColor: slide.backgroundColor || '#1a1a2e',
    // URL to fetch layer metadata (new per-layer architecture)
    layersUrl: `/api/extensions/slidecast/protocol/slide-layers/${castUuid}/${slideIndex}`,
    // All elements for backwards compatibility
    elements: allElements.map((el) => formatElementForTV(el, variables, '')),
    // Separated elements for new Roku architecture
    staticElements, // Rendered in PNG
    nativeElements, // Rendered by Roku
    nativeWidgets, // Clock, date, countdown widgets
    nav, // Navigation bar (needs interactivity)
  };
}

/**
 * Format slide background for TV
 */
export function formatBackgroundForTV(slide, baseUrl = '') {
  const bg = slide?.background || {};

  if (bg.type === 'image' && bg.asset_id) {
    return {
      type: 'image',
      url: `${baseUrl}/api/extensions/slidecast/protocol/asset/${bg.asset_id}`,
      asset_id: bg.asset_id,
    };
  } if (bg.type === 'video' && bg.asset_id) {
    return {
      type: 'video',
      url: `${baseUrl}/api/extensions/slidecast/protocol/asset/${bg.asset_id}`,
      asset_id: bg.asset_id,
      loop: bg.loop !== false,
      muted: bg.muted !== false,
    };
  } if (bg.type === 'gradient') {
    return {
      type: 'gradient',
      gradient: bg.gradient || 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      // Fallback solid color for devices that don't support gradients
      fallbackColor: bg.fallbackColor || '#1a1a2e',
    };
  }
  return {
    type: 'color',
    color: bg.color || slide?.backgroundColor || '#1a1a2e',
  };
}
