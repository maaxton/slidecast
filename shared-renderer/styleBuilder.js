/**
 * Style Builder - Extracts CSS styles from slide elements
 *
 * This is the SINGLE SOURCE OF TRUTH for how element styles are computed.
 * Used by both frontend (Svelte) and backend (Playwright PNG rendering).
 */

/**
 * Convert hex color to rgba string
 */
export function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) || 0;
  const g = parseInt(cleanHex.slice(2, 4), 16) || 0;
  const b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Convert style object to CSS string
 */
export function styleToString(styleObj) {
  if (!styleObj || typeof styleObj !== 'object') return '';
  return Object.entries(styleObj)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      // Convert camelCase to kebab-case, handle vendor prefixes
      let cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (cssKey.startsWith('webkit-') || cssKey.startsWith('moz-') || cssKey.startsWith('ms-') || cssKey.startsWith('o-')) {
        cssKey = `-${cssKey}`;
      }
      return `${cssKey}: ${value}`;
    })
    .join('; ');
}

/**
 * Get element wrapper/container style (position, size, transforms)
 */
export function getElementStyle(element, scale = 1) {
  const s = element.style || {};
  // DEFERRED (audit "Deferred (confirmed)" / blur-shadow-scale clip): effects
  // that paint OUTSIDE the element box — blur() (below), boxShadow (below),
  // scale()>1 and skew — are silently clipped because:
  //   1. `overflow: 'hidden'` here crops them to the element bounds, and
  //   2. the per-element screenshot clip in render-worker.js renderSlide() is
  //      the element's exact {x,y,width,height}, so even without (1) the
  //      overflow pixels wouldn't be captured.
  // A correct fix must (a) drop/relax overflow for effect-bearing elements,
  // (b) expand the screenshot clip by the effect's bounding-box growth
  // (blur radius, shadow offset+blur, (scale-1)*size/2 per side), AND
  // (c) propagate that expanded origin/size through the Roku LAYER METADATA so
  // the player positions the larger PNG correctly. (c) is a Roku-facing
  // wire-contract change spanning waiveo-roku-player — out of scope for this
  // pass and left deferred to avoid breaking existing rendered casts.
  const style = {
    position: 'absolute',
    left: `${(element.position?.x || 0) * scale}px`,
    top: `${(element.position?.y || 0) * scale}px`,
    width: `${(element.size?.width || 100) * scale}px`,
    height: `${(element.size?.height || 100) * scale}px`,
    zIndex: element.zIndex || 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  // Opacity
  if (s.opacity !== undefined) {
    style.opacity = s.opacity;
  }

  // Build transform string
  const transforms = [];
  if (s.rotation) transforms.push(`rotate(${s.rotation}deg)`);
  if (s.scale && s.scale !== 1) transforms.push(`scale(${s.scale})`);
  if (s.flipX) transforms.push('scaleX(-1)');
  if (s.flipY) transforms.push('scaleY(-1)');
  if (s.skewX) transforms.push(`skewX(${s.skewX}deg)`);
  if (s.skewY) transforms.push(`skewY(${s.skewY}deg)`);
  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
    style.transformOrigin = 'center center';
  }

  // Blur filter
  if (s.blur && s.blur > 0) {
    style.filter = `blur(${s.blur * scale}px)`;
  }

  // Drop shadow
  if (s.shadowEnabled) {
    const shadowX = (s.shadowX ?? 4) * scale;
    const shadowY = (s.shadowY ?? 4) * scale;
    const shadowBlur = (s.shadowBlur ?? 8) * scale;
    const shadowColor = s.shadowColor || '#000000';
    const shadowOpacity = s.shadowOpacity ?? 0.5;
    style.boxShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${hexToRgba(shadowColor, shadowOpacity)}`;
  }

  // Border
  if (s.borderEnabled) {
    const borderWidth = (s.borderWidth || 2) * scale;
    const borderRadius = (s.borderRadius || 0) * scale;
    style.border = `${borderWidth}px ${s.borderStyle || 'solid'} ${s.borderColor || '#ffffff'}`;
    if (borderRadius > 0) {
      style.borderRadius = `${borderRadius}px`;
    }
  }

  // Opacity gradient mask
  if (s.gradientMaskEnabled) {
    const dir = s.gradientDirection || 'to-right';
    const start = s.gradientStart ?? 0;
    const end = s.gradientEnd ?? 100;

    let gradient;
    switch (dir) {
      case 'to-right': gradient = `linear-gradient(to right, transparent ${start}%, black ${end}%)`; break;
      case 'to-left': gradient = `linear-gradient(to left, transparent ${start}%, black ${end}%)`; break;
      case 'to-bottom': gradient = `linear-gradient(to bottom, transparent ${start}%, black ${end}%)`; break;
      case 'to-top': gradient = `linear-gradient(to top, transparent ${start}%, black ${end}%)`; break;
      case 'to-bottom-right': gradient = `linear-gradient(to bottom right, transparent ${start}%, black ${end}%)`; break;
      case 'to-bottom-left': gradient = `linear-gradient(to bottom left, transparent ${start}%, black ${end}%)`; break;
      case 'radial-out': gradient = `radial-gradient(circle, black ${start}%, transparent ${end}%)`; break;
      case 'radial-in': gradient = `radial-gradient(circle, transparent ${start}%, black ${end}%)`; break;
      default: gradient = `linear-gradient(to right, transparent ${start}%, black ${end}%)`;
    }
    style.maskImage = gradient;
    style.webkitMaskImage = gradient;
  }

  return style;
}

/**
 * Compute the bounding box that fully contains an element once its
 * paint-outside-the-box effects are applied: blur, box-shadow, scale (>1) and
 * skew. Returns an EXPANDED {x, y, width, height} clamped to the canvas.
 *
 * This is the single source of truth for the render clip (SlideImageRenderer.js)
 * AND the Roku layer metadata (same file) — both call this so the PNG bytes and
 * the wire rect the player positions the PNG with are guaranteed to agree.
 *
 * Effects covered (magnitudes mirror getElementStyle above, so the same *scale
 * factors apply):
 *   - blur:        filter blur() scatters ~3× the radius each side (getBlurExpansion precedent)
 *   - box-shadow:  offsetX/Y ± (blur + spread) per side
 *   - scale (>1):  grows about transform-origin center
 *   - skewX/skewY: extra horizontal / vertical extent about center
 *
 * IMPORTANT: for an element with NONE of these effects this is a strict no-op —
 * it returns the SAME {x, y, width, height} numbers it was given (identical
 * clip + identical metadata), so unaffected slides render byte-identical.
 *
 * rotation and opacity are deliberately NOT considered here — the Roku applies
 * those natively to the flat PNG (see ProtocolFormatter/formatElementForTV), so
 * they must not grow the baked box.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect  Raw element box
 * @param {Object} style   element.style
 * @param {{canvasWidth?:number, canvasHeight?:number, scale?:number}} [options]
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function expandRectForEffects(rect, style = {}, options = {}) {
  const {
    x, y, width, height,
  } = rect;
  const s = style || {};
  const scale = options.scale ?? 1;
  const canvasWidth = options.canvasWidth ?? 1920;
  const canvasHeight = options.canvasHeight ?? 1080;

  const blur = (s.blur && s.blur > 0) ? s.blur * scale : 0;
  const elScale = (s.scale && s.scale !== 1) ? s.scale : 1;
  const skewXDeg = s.skewX || 0;
  const skewYDeg = s.skewY || 0;

  // Fast no-op path: nothing paints outside the raw box → return it unchanged
  // (same numbers in, same numbers out → byte-identical downstream).
  const hasEffect = blur > 0 || s.shadowEnabled || elScale > 1 || skewXDeg !== 0 || skewYDeg !== 0;
  if (!hasEffect) {
    return {
      x, y, width, height,
    };
  }

  // Per-side margins in element-local (pre-transform) space.
  // filter:blur blurs the element AND its box-shadow, so the two margins ADD.
  let mL = blur * 3;
  let mT = blur * 3;
  let mR = blur * 3;
  let mB = blur * 3;

  if (s.shadowEnabled) {
    const offX = (s.shadowX ?? 4) * scale;
    const offY = (s.shadowY ?? 4) * scale;
    const sBlur = (s.shadowBlur ?? 8) * scale;
    const spread = (s.shadowSpread ?? 0) * scale;
    mR += Math.max(0, offX + sBlur + spread);
    mL += Math.max(0, -offX + sBlur + spread);
    mB += Math.max(0, offY + sBlur + spread);
    mT += Math.max(0, -offY + sBlur + spread);
  }

  // Skew (transform-origin: center): horizontal extent grows with the vertical
  // half-extent and vice-versa. Use the already-margined half-extent.
  const tanX = skewXDeg ? Math.abs(Math.tan((skewXDeg * Math.PI) / 180)) : 0;
  const tanY = skewYDeg ? Math.abs(Math.tan((skewYDeg * Math.PI) / 180)) : 0;
  if (tanX > 0) {
    const sk = tanX * (height / 2 + Math.max(mT, mB));
    mL += sk;
    mR += sk;
  }
  if (tanY > 0) {
    const sk = tanY * (width / 2 + Math.max(mL, mR));
    mT += sk;
    mB += sk;
  }

  // Scale (transform-origin: center) grows the whole margined box about its
  // center. Growth beyond the ORIGINAL border edge, per side (clamped ≥ 0 so a
  // shrink, scale<1, never produces a negative expansion).
  const expandLeft = Math.max(0, elScale * (width / 2 + mL) - width / 2);
  const expandRight = Math.max(0, elScale * (width / 2 + mR) - width / 2);
  const expandTop = Math.max(0, elScale * (height / 2 + mT) - height / 2);
  const expandBottom = Math.max(0, elScale * (height / 2 + mB) - height / 2);

  // No net growth (e.g. scale<1 with a small blur that still fits) → no-op.
  if (expandLeft === 0 && expandRight === 0 && expandTop === 0 && expandBottom === 0) {
    return {
      x, y, width, height,
    };
  }

  // Expand, then clamp to the canvas. Floor the origin / ceil the far edge so the
  // integer rect FULLY contains the painted result.
  const left = Math.max(0, Math.floor(x - expandLeft));
  const top = Math.max(0, Math.floor(y - expandTop));
  const right = Math.min(canvasWidth, Math.ceil(x + width + expandRight));
  const bottom = Math.min(canvasHeight, Math.ceil(y + height + expandBottom));

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Get text element inner style
 */
export function getTextStyle(element, scale = 1) {
  const s = element.style || {};
  const strokeWidth = (parseFloat(s.strokeWidth) || 0) * scale;
  const strokeColor = s.strokeColor || '#000000';
  const fontSize = (s.fontSize || 24) * scale;
  const letterSpacing = s.letterSpacing ? s.letterSpacing * scale : 0;
  const padding = s.padding ? s.padding * scale : 0;
  const textAlign = s.textAlign || 'left';

  // Map textAlign to justifyContent for flex container
  const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' };

  const style = {
    width: '100%',
    height: '100%',
    fontFamily: `'${s.fontFamily || 'Inter'}', sans-serif`,
    fontSize: `${fontSize}px`,
    fontWeight: s.fontWeight || 'normal',
    fontStyle: s.fontStyle || 'normal',
    color: s.color || '#ffffff',
    textAlign,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: justifyMap[textAlign] || 'flex-start',
    lineHeight: s.lineHeight || 1.2,
    letterSpacing: letterSpacing ? `${letterSpacing}px` : 'normal',
    textDecoration: s.textDecoration || 'none',
    backgroundColor: s.backgroundColor || 'transparent',
    padding: padding ? `${padding}px` : '0',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    boxSizing: 'border-box',
  };

  // Text shadow
  if (s.textShadow) {
    style.textShadow = s.textShadow;
  }

  // Text stroke/outline
  if (strokeWidth > 0) {
    style.webkitTextStroke = `${strokeWidth}px ${strokeColor}`;
    style.paintOrder = 'stroke fill';
  }

  return style;
}

/**
 * Get shape element inner style
 */
export function getShapeStyle(element, scale = 1) {
  const s = element.style || {};
  const borderRadius = (s.borderRadius || 0) * scale;
  const strokeWidth = (s.strokeWidth || 0) * scale;

  // Support both UI format (backgroundColor, fillOpacity) and legacy format (fill, opacity)
  const fillColor = s.backgroundColor || s.fill || '#3b82f6';
  const fillOpacity = s.fillOpacity !== undefined ? s.fillOpacity : (s.opacity !== undefined ? s.opacity : 1);

  const style = {
    width: '100%',
    height: '100%',
    backgroundColor: fillColor,
    borderRadius: `${borderRadius}px`,
    opacity: fillOpacity,
  };

  // Stroke/border
  if (s.stroke && s.stroke !== 'none') {
    style.border = `${strokeWidth}px solid ${s.stroke}`;
  }

  // Handle gradient backgrounds - Satori requires backgroundImage not background!
  const fill = s.backgroundColor || s.fill;
  if (fill && fill.includes && fill.includes('gradient')) {
    style.backgroundImage = fill; // Satori requires backgroundImage for gradients
    style.backgroundColor = 'transparent';
  }

  // Circle support
  if (element.shape === 'circle') {
    style.borderRadius = '50%';
  }

  return style;
}

/**
 * Get image element inner style
 */
export function getImageStyle(element, scale = 1) {
  const s = element.style || {};
  const borderRadius = (s.borderRadius || 0) * scale;
  const borderWidth = (s.borderWidth || 0) * scale;

  return {
    width: '100%',
    height: '100%',
    objectFit: s.objectFit || 'cover',
    opacity: s.opacity !== undefined ? s.opacity : 1,
    borderRadius: `${borderRadius}px`,
    border: borderWidth ? `${borderWidth}px solid ${s.borderColor || '#ffffff'}` : 'none',
    boxShadow: s.shadow || 'none',
  };
}

/**
 * Get video element style (same as image)
 */
export function getVideoStyle(element, scale = 1) {
  return getImageStyle(element, scale);
}

/**
 * Get QR code container style
 */
export function getQRStyle(element, scale = 1) {
  const s = element.style || {};
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: s.background || s.backgroundColor || '#ffffff',
    padding: `${(s.padding || 8) * scale}px`,
    borderRadius: `${(s.borderRadius || 4) * scale}px`,
    boxSizing: 'border-box',
  };
}

/**
 * Get nav container style
 */
export function getNavContainerStyle(element, scale = 1) {
  const s = element.style || {};
  const containerBg = s.containerBackground || '#000000';
  const containerOpacity = s.containerOpacity ?? 0.6;
  const containerRgba = hexToRgba(containerBg, containerOpacity);
  const containerRadius = (s.containerRadius ?? 16) * scale;
  const containerPadding = (s.containerPadding ?? 8) * scale;
  const containerBlur = (s.containerBlur || 0) * scale;

  const style = {
    width: '100%',
    height: '100%',
    background: containerRgba,
    borderRadius: `${containerRadius}px`,
    padding: `${containerPadding}px`,
    boxSizing: 'border-box',
    opacity: s.opacity ?? 1,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  };

  if (containerBlur > 0) {
    style.backdropFilter = `blur(${containerBlur}px)`;
    style.webkitBackdropFilter = `blur(${containerBlur}px)`;
  }

  return style;
}

/**
 * Get nav inner flexbox style
 */
export function getNavStyle(element, scale = 1) {
  const s = element.style || {};
  const itemGap = (s.itemGap || 4) * scale;

  return {
    display: 'flex',
    flexDirection: element.layout === 'vertical' ? 'column' : 'row',
    flexWrap: element.layout === 'grid' ? 'wrap' : 'nowrap',
    gap: `${itemGap}px`,
    alignItems: 'stretch',
    width: '100%',
    height: '100%',
  };
}

/**
 * Get nav item button style
 */
export function getNavItemStyle(element, item = null, isActive = false, scale = 1) {
  const s = element.style || {};

  // Background colors
  const bgColor = s.itemBackgroundColor || '#ffffff';
  const bgOpacity = s.itemBackgroundOpacity ?? 0;
  const bgRgba = hexToRgba(bgColor, bgOpacity);

  const activeBgColor = s.activeBackgroundColor || '#6366f1';
  const activeBgOpacity = s.activeBackgroundOpacity ?? 0.9;
  const activeBgRgba = hexToRgba(activeBgColor, activeBgOpacity);

  // Icon position
  const iconPos = s.iconPosition || 'left';
  let flexDir = 'row';
  if (iconPos === 'top') flexDir = 'column';
  else if (iconPos === 'bottom') flexDir = 'column-reverse';
  else if (iconPos === 'right') flexDir = 'row-reverse';

  // Scaled sizes
  const itemPadding = (s.itemPadding || 12) * scale;
  const itemBorderRadius = (s.itemBorderRadius || 8) * scale;
  const fontSize = (s.fontSize || 15) * scale;
  const gap = (iconPos === 'only' ? 0 : 6) * scale;

  return {
    background: isActive ? activeBgRgba : bgRgba,
    color: isActive ? (s.activeTextColor || '#ffffff') : (s.itemColor || '#ffffff'),
    padding: `${itemPadding}px`,
    borderRadius: `${itemBorderRadius}px`,
    border: 'none',
    fontFamily: 'inherit',
    fontSize: `${fontSize}px`,
    fontWeight: '500',
    display: 'flex',
    flexDirection: flexDir,
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${gap}px`,
    flex: element.layout === 'grid' ? '1 1 auto' : '1',
  };
}

/**
 * Get ping button style
 */
export function getPingStyle(element, scale = 1) {
  const s = element.style || {};
  const fontSize = (s.fontSize || 20) * scale;
  const borderRadius = (s.borderRadius || 8) * scale;
  const gap = 8 * scale;

  return {
    width: '100%',
    height: '100%',
    background: s.background || '#ef4444',
    color: s.color || '#ffffff',
    fontSize: `${fontSize}px`,
    fontWeight: '600',
    borderRadius: `${borderRadius}px`,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${gap}px`,
  };
}
