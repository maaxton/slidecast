/**
 * Config Windows - Floating configuration window management
 *
 * This module handles opening, closing, and dragging of floating configuration
 * windows for widgets and text elements.
 *
 * NOTE: Nav and QR config windows removed - use widgets instead
 */

import { get } from 'svelte/store';
import * as store from '../stores/studioStore.js';

/**
 * Calculate optimal position for a config window near an element
 * @param {Object} element - Element to position window near
 * @param {number} windowWidth - Width of the config window
 * @param {number} windowHeight - Height of the config window
 * @returns {Object} Position object with x and y coordinates
 */
function calculateConfigWindowPosition(element, windowWidth, windowHeight) {
  const margin = 20;

  // Safely get element position and size with defaults
  const elementX = element?.position?.x ?? 200;
  const elementY = element?.position?.y ?? 100;
  const elementWidth = element?.size?.width ?? 200;

  let x = elementX + elementWidth + margin;
  let y = elementY;

  // Adjust if would go off screen
  if (x + windowWidth > window.innerWidth - 300) { // 300 for right panel
    x = Math.max(margin, elementX - windowWidth - margin);
  }
  if (y + windowHeight > window.innerHeight - 100) {
    y = Math.max(margin, window.innerHeight - windowHeight - 100);
  }

  return { x: Math.max(200, x), y: Math.max(60, y) };
}

/**
 * Open widget configuration window
 * @param {Object} element - Widget element to configure
 * @param {Function} runWidget - Function to run the widget after config
 */
export function openWidgetConfig(element, runWidget) {
  if (!element || element.type !== 'widget') return;

  const windowWidth = 520;
  const windowHeight = 500;
  const position = calculateConfigWindowPosition(element, windowWidth, windowHeight);

  store.widgetConfig.set({
    show: true,
    element,
    position,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}

/**
 * Close widget config window and auto-run widget
 * @param {Function} runWidget - Function to run the widget
 */
export function closeWidgetConfig(runWidget) {
  const widgetConfig = get(store.widgetConfig);
  if (widgetConfig?.element && runWidget) {
    runWidget(widgetConfig.element);
  }
  store.widgetConfig.set({
    show: false,
    element: null,
    position: { x: 100, y: 100 },
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}

/**
 * Start dragging widget config window
 * @param {MouseEvent} e - Mouse event
 */
export function startWidgetConfigDrag(e) {
  if (e.target.closest('input, select, button, a, .toggle-switch')) return;

  const widgetConfig = get(store.widgetConfig);
  if (!widgetConfig) return;

  store.widgetConfig.update((config) => ({
    ...config,
    isDragging: true,
    dragOffset: {
      x: e.clientX - config.position.x,
      y: e.clientY - config.position.y,
    },
  }));

  window.addEventListener('mousemove', dragWidgetConfig);
  window.addEventListener('mouseup', stopWidgetConfigDrag);
}

/**
 * Drag widget config window
 * @param {MouseEvent} e - Mouse event
 */
function dragWidgetConfig(e) {
  const widgetConfig = get(store.widgetConfig);
  if (!widgetConfig?.isDragging) return;

  const windowWidth = 520;
  store.widgetConfig.update((config) => ({
    ...config,
    position: {
      x: Math.max(0, Math.min(window.innerWidth - windowWidth, e.clientX - config.dragOffset.x)),
      y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - config.dragOffset.y)),
    },
  }));
}

/**
 * Stop dragging widget config window
 */
function stopWidgetConfigDrag() {
  store.widgetConfig.update((config) => ({
    ...config,
    isDragging: false,
  }));
  window.removeEventListener('mousemove', dragWidgetConfig);
  window.removeEventListener('mouseup', stopWidgetConfigDrag);
}

/**
 * Open text configuration window
 * @param {Object} element - Text element to configure
 */
export function openTextConfig(element) {
  if (!element || element.type !== 'text') return;

  const windowWidth = 420;
  const windowHeight = 500;
  const position = calculateConfigWindowPosition(element, windowWidth, windowHeight);

  store.textConfig.set({
    show: true,
    element,
    position,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}

/**
 * Close text config window
 */
export function closeTextConfig() {
  store.textConfig.set({
    show: false,
    element: null,
    position: { x: 150, y: 120 },
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}

/**
 * Start dragging text config window
 * @param {MouseEvent} e - Mouse event
 */
export function startTextConfigDrag(e) {
  if (e.target.closest('input, select, button, textarea, .toggle-switch')) return;

  const textConfig = get(store.textConfig);
  if (!textConfig) return;

  store.textConfig.update((config) => ({
    ...config,
    isDragging: true,
    dragOffset: {
      x: e.clientX - config.position.x,
      y: e.clientY - config.position.y,
    },
  }));

  window.addEventListener('mousemove', dragTextConfig);
  window.addEventListener('mouseup', stopTextConfigDrag);
}

/**
 * Drag text config window
 * @param {MouseEvent} e - Mouse event
 */
function dragTextConfig(e) {
  const textConfig = get(store.textConfig);
  if (!textConfig?.isDragging) return;

  const windowWidth = 420;
  store.textConfig.update((config) => ({
    ...config,
    position: {
      x: Math.max(0, Math.min(window.innerWidth - windowWidth, e.clientX - config.dragOffset.x)),
      y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - config.dragOffset.y)),
    },
  }));
}

/**
 * Stop dragging text config window
 */
function stopTextConfigDrag() {
  store.textConfig.update((config) => ({
    ...config,
    isDragging: false,
  }));
  window.removeEventListener('mousemove', dragTextConfig);
  window.removeEventListener('mouseup', stopTextConfigDrag);
}

// ==================== NAV CONFIG ====================

/**
 * Open nav configuration window
 * @param {Object} element - Nav element to configure
 */
export function openNavConfig(element) {
  if (!element || element.type !== 'nav') {
    console.warn('openNavConfig: Invalid element', element);
    return;
  }

  const windowWidth = 520;
  const windowHeight = 600;
  const position = calculateConfigWindowPosition(element, windowWidth, windowHeight);

  store.navConfig.set({
    show: true,
    element,
    position,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    tab: 'style',
  });
}

/**
 * Close nav config window
 */
export function closeNavConfig() {
  store.navConfig.set({
    show: false,
    element: null,
    position: { x: 100, y: 80 },
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    tab: 'style',
  });
}

// ==================== QR CONFIG ====================

/**
 * Open QR configuration window
 * @param {Object} element - QR element to configure
 */
export function openQRConfig(element) {
  if (!element || (element.type !== 'qr' && element.type !== 'qrcode')) {
    console.warn('openQRConfig: Invalid element', element);
    return;
  }

  const windowWidth = 380;
  const windowHeight = 450;
  const position = calculateConfigWindowPosition(element, windowWidth, windowHeight);

  store.qrConfig.set({
    show: true,
    element,
    position,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}

/**
 * Close QR config window
 */
export function closeQRConfig() {
  store.qrConfig.set({
    show: false,
    element: null,
    position: { x: 200, y: 150 },
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
  });
}
