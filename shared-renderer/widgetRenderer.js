/**
 * Widget Renderer - Renders widget primitives to HTML
 *
 * This is the SINGLE SOURCE OF TRUTH for how widgets are rendered.
 * Used by both frontend (Svelte) and backend (Playwright PNG rendering).
 */

import { styleToString } from './styleBuilder.js';

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render widget primitives to HTML string
 * @param {Object|Array} primitive - Primitive or array of primitives
 * @param {number} scale - Scale factor (default 1)
 * @returns {string} HTML string
 */
export function renderPrimitivesToHtml(primitive, scale = 1) {
  if (!primitive) return '';
  if (Array.isArray(primitive)) {
    return primitive.map((p) => renderPrimitivesToHtml(p, scale)).join('');
  }

  const { type } = primitive;
  switch (type) {
    case 'box':
      return renderBoxPrimitive(primitive, scale);
    case 'stack':
      return renderStackPrimitive(primitive, scale);
    case 'text':
      return renderTextPrimitive(primitive, scale);
    case 'icon':
      return renderIconPrimitive(primitive, scale);
    case 'image':
      return renderImagePrimitive(primitive, scale);
    case 'spacer':
      return `<div style="flex: ${primitive.flex || 1};"></div>`;
    case 'divider':
      return renderDividerPrimitive(primitive, scale);
    default:
      if (primitive.children) {
        return renderBoxPrimitive(primitive, scale);
      }
      return '';
  }
}

/**
 * Render box primitive
 */
function renderBoxPrimitive(p, scale = 1) {
  const styles = {};

  if (p.background) styles.background = p.background;
  if (p.borderRadius) styles.borderRadius = `${p.borderRadius * scale}px`;
  if (p.padding) styles.padding = `${p.padding * scale}px`;
  if (p.border) styles.border = p.border;
  if (p.shadow) styles.boxShadow = p.shadow;
  if (p.opacity !== undefined) styles.opacity = p.opacity;
  if (p.backdropBlur) styles.backdropFilter = `blur(${p.backdropBlur * scale}px)`;
  if (p.width) styles.width = typeof p.width === 'number' ? `${p.width * scale}px` : p.width;
  if (p.height) styles.height = typeof p.height === 'number' ? `${p.height * scale}px` : p.height;
  if (p.justify) styles.justifyContent = p.justify;
  if (p.align) styles.alignItems = p.align;
  if (p.position) styles.position = p.position;
  if (p.top !== undefined) styles.top = typeof p.top === 'number' ? `${p.top * scale}px` : p.top;
  if (p.left !== undefined) styles.left = typeof p.left === 'number' ? `${p.left * scale}px` : p.left;
  if (p.right !== undefined) styles.right = typeof p.right === 'number' ? `${p.right * scale}px` : p.right;
  if (p.bottom !== undefined) styles.bottom = typeof p.bottom === 'number' ? `${p.bottom * scale}px` : p.bottom;
  if (p.overflow) styles.overflow = p.overflow;
  if (p.zIndex !== undefined) styles.zIndex = p.zIndex;
  styles.display = 'flex';
  styles.boxSizing = 'border-box';

  const children = p.children
    ? (Array.isArray(p.children)
      ? p.children.filter(Boolean).map((c) => renderPrimitivesToHtml(c, scale)).join('')
      : renderPrimitivesToHtml(p.children, scale))
    : '';

  return `<div class="widget-box" style="${styleToString(styles)}">${children}</div>`;
}

/**
 * Render stack primitive
 */
function renderStackPrimitive(p, scale = 1) {
  const styles = {
    display: 'flex',
    flexDirection: p.direction === 'vertical' ? 'column' : 'row',
    boxSizing: 'border-box',
  };

  if (p.gap) styles.gap = `${p.gap * scale}px`;
  if (p.padding) styles.padding = `${p.padding * scale}px`;
  if (p.background) styles.background = p.background;
  if (p.borderRadius) styles.borderRadius = `${p.borderRadius * scale}px`;
  if (p.align) styles.alignItems = p.align;
  if (p.justify) styles.justifyContent = p.justify;
  if (p.wrap) styles.flexWrap = 'wrap';
  if (p.width) styles.width = typeof p.width === 'number' ? `${p.width * scale}px` : p.width;
  if (p.height) styles.height = typeof p.height === 'number' ? `${p.height * scale}px` : p.height;
  if (p.position) styles.position = p.position;
  if (p.zIndex !== undefined) styles.zIndex = p.zIndex;

  const children = p.children
    ? p.children.filter(Boolean).map((c) => renderPrimitivesToHtml(c, scale)).join('')
    : '';

  return `<div class="widget-stack" style="${styleToString(styles)}">${children}</div>`;
}

/**
 * Render text primitive
 */
function renderTextPrimitive(p, scale = 1) {
  const s = p.style || {};
  const styles = {};

  if (s.fontSize) styles.fontSize = `${s.fontSize * scale}px`;
  if (s.fontWeight) styles.fontWeight = s.fontWeight;
  if (s.fontFamily) styles.fontFamily = `'${s.fontFamily}', sans-serif`;
  if (s.fontStyle) styles.fontStyle = s.fontStyle;
  if (s.color) styles.color = s.color;
  if (s.textAlign) styles.textAlign = s.textAlign;
  if (s.lineHeight) styles.lineHeight = s.lineHeight;
  if (s.letterSpacing) styles.letterSpacing = `${s.letterSpacing * scale}px`;
  if (s.textDecoration) styles.textDecoration = s.textDecoration;
  if (s.textShadow) styles.textShadow = s.textShadow;
  if (s.backgroundColor) styles.backgroundColor = s.backgroundColor;
  if (s.padding) styles.padding = `${s.padding * scale}px`;
  if (s.opacity !== undefined) styles.opacity = s.opacity;
  if (s.width) styles.width = s.width;
  if (s.height) styles.height = s.height;
  if (s.display) styles.display = s.display;
  if (s.alignItems) styles.alignItems = s.alignItems;
  if (s.justifyContent) styles.justifyContent = s.justifyContent;

  styles.whiteSpace = 'pre-wrap';
  styles.wordWrap = 'break-word';

  const content = escapeHtml(p.content || '');
  return `<span class="widget-text" style="${styleToString(styles)}">${content}</span>`;
}

/**
 * Render icon primitive (Font Awesome)
 */
function renderIconPrimitive(p, scale = 1) {
  const s = p.style || {};
  const styles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (s.fontSize) styles.fontSize = `${s.fontSize * scale}px`;
  if (s.color) styles.color = s.color;
  if (s.opacity !== undefined) styles.opacity = s.opacity;
  if (s.textShadow) styles.textShadow = s.textShadow;

  const iconClass = escapeHtml(p.class || 'fa-solid fa-circle');
  return `<i class="widget-icon ${iconClass}" style="${styleToString(styles)}"></i>`;
}

/**
 * Render image primitive
 */
function renderImagePrimitive(p, scale = 1) {
  const s = p.style || {};
  const styles = {};

  if (p.width) styles.width = `${p.width * scale}px`;
  if (p.height) styles.height = `${p.height * scale}px`;
  if (s.objectFit) styles.objectFit = s.objectFit;
  if (s.borderRadius) styles.borderRadius = `${s.borderRadius * scale}px`;
  if (s.opacity !== undefined) styles.opacity = s.opacity;
  if (s.border) styles.border = s.border;

  const src = escapeHtml(p.src || '');
  const alt = escapeHtml(p.alt || '');
  return `<img class="widget-image" src="${src}" alt="${alt}" style="${styleToString(styles)}" />`;
}

/**
 * Render divider primitive
 */
function renderDividerPrimitive(p, scale = 1) {
  const orient = p.orientation || 'horizontal';
  const thickness = (p.thickness || 1) * scale;
  const color = p.color || 'rgba(255,255,255,0.2)';

  const styles = orient === 'horizontal'
    ? { width: '100%', height: `${thickness}px`, background: color }
    : { width: `${thickness}px`, height: '100%', background: color };

  return `<div style="${styleToString(styles)}"></div>`;
}

/**
 * Check if a widget should be rendered natively (client-side)
 * @param {Object} element - Widget element
 * @returns {boolean}
 */
export function isNativeWidget(element) {
  if (element.type !== 'widget') return false;

  // Check explicit render mode
  if (element._widgetRenderMode === 'native') return true;

  // Check widget type
  const widgetType = element.widgetType || element.widget?.type;
  const nativeTypes = ['clock', 'date', 'countdown'];
  if (nativeTypes.includes(widgetType)) return true;

  // Check widget UUID for known native widgets
  const widgetUuid = element.widgetUuid || element.widget_name || '';
  if (widgetUuid.includes('clock') || widgetUuid.includes('date') || widgetUuid.includes('countdown')) {
    return true;
  }

  return false;
}
