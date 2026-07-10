/**
 * Shared widget primitive rendering module.
 * Converts widget primitive trees (box, stack, text, icon, image, etc.)
 * into HTML strings for native browser rendering.
 *
 * Used by SlideRenderer.svelte, PreviewPanel.svelte, and the unified render page.
 */

// Render widget primitives to HTML for native rendering
export function renderPrimitivesToHtml(primitive) {
  if (!primitive) return '';
  if (Array.isArray(primitive)) {
    return primitive.map((p) => renderPrimitivesToHtml(p)).join('');
  }

  const { type } = primitive;
  switch (type) {
    case 'box':
      return renderBoxPrimitive(primitive);
    case 'stack':
      return renderStackPrimitive(primitive);
    case 'text':
      return renderTextPrimitive(primitive);
    case 'icon':
      return renderIconPrimitive(primitive);
    case 'image':
      return renderImagePrimitive(primitive);
    case 'spacer':
      return `<div style="flex: ${primitive.flex || 1};"></div>`;
    case 'divider': {
      const orient = primitive.orientation || 'horizontal';
      const divStyle = orient === 'horizontal'
        ? `width: 100%; height: ${primitive.thickness || 1}px; background: ${primitive.color || 'rgba(255,255,255,0.2)'};`
        : `width: ${primitive.thickness || 1}px; height: 100%; background: ${primitive.color || 'rgba(255,255,255,0.2)'};`;
      return `<div style="${divStyle}"></div>`;
    }
    default:
      if (primitive.children) {
        return renderBoxPrimitive(primitive);
      }
      return '';
  }
}

function renderBoxPrimitive(p) {
  const styles = [];
  if (p.background) styles.push(`background: ${p.background}`);
  if (p.borderRadius) styles.push(`border-radius: ${p.borderRadius}px`);
  if (p.padding) styles.push(`padding: ${p.padding}px`);
  if (p.border) styles.push(`border: ${p.border}`);
  if (p.shadow) styles.push(`box-shadow: ${p.shadow}`);
  if (p.opacity !== undefined) styles.push(`opacity: ${p.opacity}`);
  if (p.backdropBlur) styles.push(`backdrop-filter: blur(${p.backdropBlur}px)`);
  if (p.width) styles.push(`width: ${typeof p.width === 'number' ? `${p.width}px` : p.width}`);
  if (p.height) styles.push(`height: ${typeof p.height === 'number' ? `${p.height}px` : p.height}`);
  if (p.justify) styles.push(`justify-content: ${p.justify}`);
  if (p.align) styles.push(`align-items: ${p.align}`);
  // Position properties for absolute positioning
  if (p.position) styles.push(`position: ${p.position}`);
  if (p.top !== undefined) styles.push(`top: ${typeof p.top === 'number' ? `${p.top}px` : p.top}`);
  if (p.left !== undefined) styles.push(`left: ${typeof p.left === 'number' ? `${p.left}px` : p.left}`);
  if (p.right !== undefined) styles.push(`right: ${typeof p.right === 'number' ? `${p.right}px` : p.right}`);
  if (p.bottom !== undefined) styles.push(`bottom: ${typeof p.bottom === 'number' ? `${p.bottom}px` : p.bottom}`);
  if (p.overflow) styles.push(`overflow: ${p.overflow}`);
  if (p.zIndex !== undefined) styles.push(`z-index: ${p.zIndex}`);
  styles.push('display: flex');

  const children = p.children
    ? (Array.isArray(p.children)
      ? p.children.filter(Boolean).map((c) => renderPrimitivesToHtml(c)).join('')
      : renderPrimitivesToHtml(p.children))
    : '';

  return `<div class="widget-box" style="${styles.join('; ')}">${children}</div>`;
}

function renderStackPrimitive(p) {
  const styles = [];
  styles.push('display: flex');
  styles.push(`flex-direction: ${p.direction === 'vertical' ? 'column' : 'row'}`);
  if (p.gap) styles.push(`gap: ${p.gap}px`);
  if (p.padding) styles.push(`padding: ${p.padding}px`);
  if (p.background) styles.push(`background: ${p.background}`);
  if (p.borderRadius) styles.push(`border-radius: ${p.borderRadius}px`);
  if (p.align) styles.push(`align-items: ${p.align}`);
  if (p.justify) styles.push(`justify-content: ${p.justify}`);
  if (p.wrap) styles.push('flex-wrap: wrap');
  if (p.width) styles.push(`width: ${typeof p.width === 'number' ? `${p.width}px` : p.width}`);
  if (p.height) styles.push(`height: ${typeof p.height === 'number' ? `${p.height}px` : p.height}`);
  if (p.position) styles.push(`position: ${p.position}`);
  if (p.zIndex !== undefined) styles.push(`z-index: ${p.zIndex}`);

  const children = p.children
    ? p.children.filter(Boolean).map((c) => renderPrimitivesToHtml(c)).join('')
    : '';

  return `<div class="widget-stack" style="${styles.join('; ')}">${children}</div>`;
}

function renderTextPrimitive(p) {
  const styles = [];
  const s = p.style || {};
  if (s.fontSize) styles.push(`font-size: ${s.fontSize}px`);
  if (s.fontWeight) styles.push(`font-weight: ${s.fontWeight}`);
  if (s.fontFamily) styles.push(`font-family: '${s.fontFamily}', sans-serif`);
  if (s.fontStyle) styles.push(`font-style: ${s.fontStyle}`);
  if (s.color) styles.push(`color: ${s.color}`);
  if (s.textAlign) styles.push(`text-align: ${s.textAlign}`);
  if (s.lineHeight) styles.push(`line-height: ${s.lineHeight}`);
  if (s.letterSpacing) styles.push(`letter-spacing: ${s.letterSpacing}px`);
  if (s.textDecoration) styles.push(`text-decoration: ${s.textDecoration}`);
  if (s.textShadow) styles.push(`text-shadow: ${s.textShadow}`);
  if (s.backgroundColor) styles.push(`background-color: ${s.backgroundColor}`);
  if (s.padding) styles.push(`padding: ${s.padding}px`);
  if (s.opacity !== undefined) styles.push(`opacity: ${s.opacity}`);

  const content = escapeHtml(p.content || '');
  return `<span class="widget-text" style="${styles.join('; ')}">${content}</span>`;
}

// Font Awesome icon primitive
function renderIconPrimitive(p) {
  const styles = [];
  const s = p.style || {};
  if (s.fontSize) styles.push(`font-size: ${s.fontSize}px`);
  if (s.color) styles.push(`color: ${s.color}`);
  if (s.opacity !== undefined) styles.push(`opacity: ${s.opacity}`);
  if (s.textShadow) styles.push(`text-shadow: ${s.textShadow}`);
  styles.push('display: inline-flex');
  styles.push('align-items: center');
  styles.push('justify-content: center');

  // Use Font Awesome class (e.g., "fa-solid fa-sun")
  const iconClass = escapeHtml(p.class || 'fa-solid fa-circle');
  return `<i class="widget-icon ${iconClass}" style="${styles.join('; ')}"></i>`;
}

function renderImagePrimitive(p) {
  const styles = [];
  const s = p.style || {};
  if (p.width) styles.push(`width: ${p.width}px`);
  if (p.height) styles.push(`height: ${p.height}px`);
  if (s.objectFit) styles.push(`object-fit: ${s.objectFit}`);
  if (s.borderRadius) styles.push(`border-radius: ${s.borderRadius}px`);
  if (s.opacity !== undefined) styles.push(`opacity: ${s.opacity}`);
  if (s.border) styles.push(`border: ${s.border}`);

  const src = escapeHtml(p.src || '');
  const alt = escapeHtml(p.alt || '');
  return `<img class="widget-image" src="${src}" alt="${alt}" style="${styles.join('; ')}" />`;
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
