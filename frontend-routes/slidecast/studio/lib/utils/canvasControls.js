/**
 * Canvas Controls - Zoom, Pan, and Resize operations
 *
 * This module handles all canvas manipulation including zoom, pan, and sidebar resizing.
 */

import { get } from 'svelte/store';
import * as store from '../stores/studioStore.js';

// =============================================================================
// DEBUG LOGGING HELPER
// =============================================================================

function debugLog(category, action, data = {}) {
  if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
    window.WaiveoDebug.log('slidecast', category, action, data);
  }
}

// =============================================================================
// ZOOM CONTROLS
// =============================================================================

/**
 * Zoom in by 0.1 (max 2.0)
 */
export function zoomIn() {
  const before = get(store.canvasZoom);
  store.canvasZoom.update((z) => Math.min(z + 0.1, 2));
  const after = get(store.canvasZoom);
  debugLog('canvas', 'zoom', {
    method: 'button', direction: 'in', before, after,
  });
}

/**
 * Zoom out by 0.1 (min 0.1)
 */
export function zoomOut() {
  const before = get(store.canvasZoom);
  store.canvasZoom.update((z) => Math.max(z - 0.1, 0.1));
  const after = get(store.canvasZoom);
  debugLog('canvas', 'zoom', {
    method: 'button', direction: 'out', before, after,
  });
}

/**
 * Zoom to fit the canvas in the available viewport
 * @param {HTMLElement} canvasContainer - The canvas container element
 */
export function zoomFit(canvasContainer) {
  if (!canvasContainer) return;
  const rect = canvasContainer.getBoundingClientRect();

  // TV Frame dimensions (from CSS):
  // - Bezel: padding 16px top, 16px sides, 28px bottom
  // - Stand: neck 16px + base 6px = 22px
  // Total: width = 1920+32 = 1952, height = 1080+16+28+22 = 1146
  const canvasW = 1920; const
    canvasH = 1080;
  const bezelTop = 16; const
    bezelBottom = 28;
  const bezelW = 16 + 16; // left + right bezel
  const standH = 22; // neck + base
  const tvWidth = canvasW + bezelW;
  const tvHeight = canvasH + bezelTop + bezelBottom + standH;

  // Calculate scale with generous padding to ensure full TV + stand is visible
  const paddingX = 120;
  const paddingY = 160; // Extra vertical padding for stand visibility
  const availW = rect.width - paddingX;
  const availH = rect.height - paddingY;

  // Use the smaller scale to ensure full TV fits
  const scaleX = availW / tvWidth;
  const scaleY = availH / tvHeight;
  const newZoom = Math.min(scaleX, scaleY, 0.95); // Cap at 95% max
  store.canvasZoom.set(newZoom);

  // The TV frame center is offset from canvas center due to stand
  // Move UP (negative Y) to center the full TV frame including stand
  // Empirically determined: -92px unscaled centers the TV properly
  const verticalOffset = -92;
  store.canvasPan.set({ x: 0, y: verticalOffset * newZoom });

  debugLog('canvas', 'zoom', {
    method: 'fit', zoom: newZoom, viewportWidth: rect.width, viewportHeight: rect.height,
  });
}

/**
 * Reset pan to center (0, 0)
 */
export function resetPan() {
  store.canvasPan.set({ x: 0, y: 0 });
}

// =============================================================================
// SIDEBAR RESIZE
// =============================================================================

/**
 * Start resizing the right sidebar
 * @param {MouseEvent} e - Mouse event
 */
export function startSidebarResize(e) {
  store.isResizingSidebar.set(true);
  const rightSidebarWidth = get(store.rightSidebarWidth);
  store.sidebarResizeStart.set({ x: e.clientX, width: rightSidebarWidth });
  document.addEventListener('mousemove', handleSidebarResize);
  document.addEventListener('mouseup', stopSidebarResize);
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
}

/**
 * Handle sidebar resize mouse move
 * @param {MouseEvent} e - Mouse event
 */
function handleSidebarResize(e) {
  if (!get(store.isResizingSidebar)) return;
  const start = get(store.sidebarResizeStart);
  const delta = start.x - e.clientX;
  const { SIDEBAR_MIN_WIDTH } = store;
  const { SIDEBAR_MAX_WIDTH } = store;
  const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, start.width + delta));
  store.rightSidebarWidth.set(newWidth);
}

/**
 * Stop resizing the sidebar
 */
function stopSidebarResize() {
  store.isResizingSidebar.set(false);
  document.removeEventListener('mousemove', handleSidebarResize);
  document.removeEventListener('mouseup', stopSidebarResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

/**
 * Toggle right sidebar collapsed state
 */
export function toggleRightSidebar() {
  store.rightSidebarCollapsed.update((v) => !v);
}

/**
 * Handle window resize - zoom to fit
 * @param {HTMLElement} canvasContainer - The canvas container element
 */
export function handleResize(canvasContainer) {
  zoomFit(canvasContainer);
}

// =============================================================================
// CANVAS PAN (Mouse/Wheel)
// =============================================================================

/**
 * Handle canvas wheel event (zoom by default, pan with hand tool)
 * @param {WheelEvent} e - Wheel event
 * @param {HTMLElement} canvasContainer - The canvas container element
 */
export function handleCanvasWheel(e, canvasContainer) {
  if (!canvasContainer) return;

  const activeTool = get(store.activeTool);

  // Hand tool: wheel pans instead of zooming
  if (activeTool === 'hand') {
    e.preventDefault();
    const currentPan = get(store.canvasPan);
    store.canvasPan.set({
      x: currentPan.x - e.deltaX,
      y: currentPan.y - e.deltaY,
    });
    return;
  }

  // Default: wheel zooms (no modifier needed)
  e.preventDefault();

  // Use deltaY for zoom - scroll up = zoom in, scroll down = zoom out
  // Smaller delta for smoother zooming
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  const currentZoom = get(store.canvasZoom);
  const newZoom = Math.max(0.1, Math.min(2, currentZoom + delta));
  store.canvasZoom.set(newZoom);

  // Only log significant zoom changes to avoid spam
  if (Math.abs(newZoom - currentZoom) > 0.01) {
    debugLog('canvas', 'zoom', { method: 'wheel', before: currentZoom, after: newZoom });
  }
}

/**
 * Handle canvas mouse down for panning
 * @param {MouseEvent} e - Mouse event
 */
export function handleCanvasMouseDown(e) {
  const activeTool = get(store.activeTool);
  // Middle mouse button (button 1) always pans
  // Left click (button 0) pans only when hand tool is active
  if (e.button === 1 || (e.button === 0 && activeTool === 'hand')) {
    e.preventDefault();
    e.stopPropagation();

    const currentPan = get(store.canvasPan);
    store.isPanning.set(true);
    store.panStart.set({
      x: e.clientX,
      y: e.clientY,
      panX: currentPan.x,
      panY: currentPan.y,
    });

    document.body.style.cursor = 'grabbing';
  }
}

/**
 * Handle canvas mouse move for panning
 * @param {MouseEvent} e - Mouse event
 */
export function handleCanvasPanMove(e) {
  if (!get(store.isPanning)) return;

  const start = get(store.panStart);
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;

  store.canvasPan.set({
    x: start.panX + dx,
    y: start.panY + dy,
  });
}

/**
 * Handle canvas mouse up/leave for panning
 * @param {MouseEvent} e - Mouse event
 */
export function handleCanvasPanEnd(e) {
  if (get(store.isPanning)) {
    const finalPan = get(store.canvasPan);
    const start = get(store.panStart);
    store.isPanning.set(false);
    document.body.style.cursor = '';

    // Log pan completion with delta
    const deltaX = finalPan.x - start.panX;
    const deltaY = finalPan.y - start.panY;
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      debugLog('canvas', 'pan', {
        deltaX, deltaY, finalX: finalPan.x, finalY: finalPan.y,
      });
    }
  }
}
