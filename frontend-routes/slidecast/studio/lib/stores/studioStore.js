/**
 * Studio Store - Centralized state management for Slidecast Studio
 *
 * Uses Svelte writable stores for reactive state that can be shared across components.
 *
 * PERFORMANCE NOTES:
 * - History uses debounced pushes to avoid excessive JSON.stringify calls
 * - Derived stores are memoized by Svelte
 * - Use batch updates where possible
 */
import { writable, derived, get } from 'svelte/store';

// =============================================================================
// DEBUG LOGGING HELPER
// =============================================================================

function debugLog(category, action, data = {}) {
  if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
    window.WaiveoDebug.log('slidecast', category, action, data);
  }
}

// =============================================================================
// CORE STATE
// =============================================================================

// Cast data
export const cast = writable(null);
export const castId = writable(null);
export const loading = writable(true);
export const saving = writable(false);
export const error = writable(null);
export const hasUnsavedChanges = writable(false);

// Current navigation
export const currentGroupId = writable('home');
export const currentSlideIndex = writable(0);
export const selectedElementId = writable(null);

// =============================================================================
// AVAILABLE DATA
// =============================================================================

export const mediaLibrary = writable([]);
export const onlineScreens = writable([]);
export const availableWidgets = writable([]);
export const widgetCategories = writable([]);

// =============================================================================
// MENU & UI STATE
// =============================================================================

export const openMenu = writable(null);

// Template saving
export const templateName = writable('');
export const templateDescription = writable('');
export const savingTemplate = writable(false);

// Widget search/filter
export const widgetSearchQuery = writable('');
export const selectedWidgetCategory = writable('all');

// New group modal
export const newGroupName = writable('');

// Nav Icon Picker
export const navIconPicker = writable({
  show: false,
  itemIndex: null,
  searchQuery: '',
  activeCategory: 'all',
});

// URL import
export const importUrl = writable('');
export const importingUrl = writable(false);

// Media upload
export const isDraggingMedia = writable(false);
export const uploadingMedia = writable(false);

// Widget rendering
export const runningWidgetId = writable(null);

// Queue of widget element IDs that need to be rendered (used for auto-render on add)
export const pendingWidgetRenders = writable([]);

// =============================================================================
// UI PANEL STATE
// =============================================================================

export const showSlidesPanel = writable(true);
export const showLayersPanel = writable(true);
export const showPropertiesPanel = writable(true);
export const showHistoryPanel = writable(false);

export const slidesPanelCollapsed = writable(false);
export const layersPanelCollapsed = writable(false);
export const propertiesPanelCollapsed = writable(false);
export const historyPanelCollapsed = writable(false);

// Right sidebar
export const rightSidebarWidth = writable(300);
export const rightSidebarCollapsed = writable(false);

// =============================================================================
// MODAL STATE
// =============================================================================

export const modals = writable({
  addGroup: false,
  slideSettings: false,
  groupSettings: false,
  pasteSlide: false,
  media: false,
  widget: false,
  variables: false,
  preview: false,
  saveAsTemplate: false,
  unsavedChanges: false,
  deleteLayer: false,
  deleteSlide: false,
  deleteGroup: false,
  canvasSize: false,
  keyboardShortcuts: false,
});

// Modal helper functions
export function openModal(name) {
  modals.update((m) => ({ ...m, [name]: true }));
}

export function closeModal(name) {
  modals.update((m) => ({ ...m, [name]: false }));
}

export function closeAllModals() {
  modals.update((m) => Object.fromEntries(Object.keys(m).map((k) => [k, false])));
}

// =============================================================================
// CONFIG WINDOWS (Floating, Draggable)
// =============================================================================

export const widgetConfig = writable({
  show: false,
  element: null,
  position: { x: 100, y: 100 },
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
});

export const textConfig = writable({
  show: false,
  element: null,
  position: { x: 150, y: 120 },
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
});

export const navConfig = writable({
  show: false,
  element: null,
  position: { x: 100, y: 80 },
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
  tab: 'style',
});

export const qrConfig = writable({
  show: false,
  element: null,
  position: { x: 200, y: 150 },
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
});

// =============================================================================
// CANVAS STATE
// =============================================================================

export const canvasZoom = writable(0.5);
export const canvasPan = writable({ x: 0, y: 0 });
export const activeTool = writable('pointer'); // 'pointer' or 'hand'
export const isPanning = writable(false);
export const panStart = writable({
  x: 0, y: 0, panX: 0, panY: 0,
});

// Sidebar resize
export const isResizingSidebar = writable(false);
export const sidebarResizeStart = writable({ x: 0, width: 0 });
export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 500;

// =============================================================================
// DRAG & DROP STATE
// =============================================================================

// Slide reorder
export const draggedSlideIndex = writable(null);
export const dragOverSlideIndex = writable(null);

// Layer reorder
export const draggedLayerId = writable(null);
export const dragOverLayerId = writable(null);

// Element drag/resize
export const isDragging = writable(false);
export const isResizing = writable(false);
export const dragStart = writable({ x: 0, y: 0 });
export const resizeHandle = writable(null);
export const originalElement = writable(null);

// =============================================================================
// CLIPBOARD
// =============================================================================

export const clipboardElement = writable(null);
export const slideClipboard = writable(null);
export const clipboardOperation = writable(null); // 'cut' or 'copy'

// =============================================================================
// PENDING OPERATIONS
// =============================================================================

export const pendingNavigation = writable(null);
export const pendingDeleteLayerId = writable(null);
export const pendingDeleteSlideIndex = writable(null);
export const pendingDeleteGroupId = writable(null);
export const editingSlideIndex = writable(null);

// =============================================================================
// HISTORY (Undo/Redo) - OPTIMIZED
// =============================================================================

export const historyStack = writable([]); // Array of { state: string, action: string, timestamp: Date }
export const historyIndex = writable(-1);
const MAX_HISTORY = 100;

// Debounce timer for batching rapid changes
let historyDebounceTimer = null;
let pendingHistoryAction = null;

export function initHistory() {
  const currentCast = get(cast);
  if (!currentCast) return;

  // Clear any pending debounced push
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;
  }

  historyStack.set([{
    state: JSON.stringify(currentCast),
    action: 'Opened cast',
    timestamp: new Date(),
  }]);
  historyIndex.set(0);
  hasUnsavedChanges.set(false);

  debugLog('history', 'init', { castId: currentCast.id, castName: currentCast.name });
}

/**
 * Push to history immediately (for discrete actions like delete, add element)
 */
export function pushHistory(action = 'Change') {
  // Clear any pending debounced push
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;
  }

  _doPushHistory(action);
}

/**
 * Debounced push - batches rapid changes (like dragging, typing)
 * Only pushes after 500ms of inactivity
 */
export function pushHistoryDebounced(action = 'Change') {
  pendingHistoryAction = action;

  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
  }

  historyDebounceTimer = setTimeout(() => {
    if (pendingHistoryAction) {
      _doPushHistory(pendingHistoryAction);
      pendingHistoryAction = null;
    }
    historyDebounceTimer = null;
  }, 500);

  // Mark as changed immediately for UI feedback
  hasUnsavedChanges.set(true);
}

function _doPushHistory(action) {
  const currentCast = get(cast);
  if (!currentCast) return;

  const currentState = JSON.stringify(currentCast);
  const stack = get(historyStack);
  const index = get(historyIndex);

  // Skip if no actual change
  if (index >= 0 && stack[index]?.state === currentState) {
    return;
  }

  // Remove any redo states
  const newStack = stack.slice(0, index + 1);

  // Add current state
  newStack.push({
    state: currentState,
    action,
    timestamp: new Date(),
  });

  // Trim if too long
  if (newStack.length > MAX_HISTORY) {
    newStack.shift();
  }

  historyStack.set(newStack);
  historyIndex.set(newStack.length - 1);
  hasUnsavedChanges.set(true);

  debugLog('history', 'push', { action, stackSize: newStack.length, index: newStack.length - 1 });
}

export function undo() {
  // Flush any pending debounced changes first
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
    if (pendingHistoryAction) {
      _doPushHistory(pendingHistoryAction);
      pendingHistoryAction = null;
    }
    historyDebounceTimer = null;
  }

  const index = get(historyIndex);
  const stack = get(historyStack);

  if (index > 0) {
    const targetAction = stack[index - 1]?.action;
    historyIndex.set(index - 1);
    cast.set(JSON.parse(stack[index - 1].state));
    debugLog('history', 'undo', { from: index, to: index - 1, action: targetAction });
  }
}

export function redo() {
  const index = get(historyIndex);
  const stack = get(historyStack);

  if (index < stack.length - 1) {
    const targetAction = stack[index + 1]?.action;
    historyIndex.set(index + 1);
    cast.set(JSON.parse(stack[index + 1].state));
    debugLog('history', 'redo', { from: index, to: index + 1, action: targetAction });
  }
}

export function jumpToHistory(targetIndex) {
  // Flush any pending debounced changes first
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
    if (pendingHistoryAction) {
      _doPushHistory(pendingHistoryAction);
      pendingHistoryAction = null;
    }
    historyDebounceTimer = null;
  }

  const stack = get(historyStack);
  const currentIndex = get(historyIndex);

  if (targetIndex >= 0 && targetIndex < stack.length) {
    const targetAction = stack[targetIndex]?.action;
    historyIndex.set(targetIndex);
    cast.set(JSON.parse(stack[targetIndex].state));
    debugLog('history', 'jump', { from: currentIndex, to: targetIndex, action: targetAction });
  }
}

// Format history timestamp
export function formatHistoryTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// =============================================================================
// DERIVED STORES (Computed Values)
// =============================================================================

export const currentGroup = derived(
  [cast, currentGroupId],
  ([$cast, $currentGroupId]) => $cast?.definition?.groups?.find((g) => g.id === $currentGroupId),
);

export const currentSlides = derived(
  currentGroup,
  ($currentGroup) => $currentGroup?.slides || [],
);

export const currentSlide = derived(
  [currentSlides, currentSlideIndex],
  ([$currentSlides, $currentSlideIndex]) => $currentSlides[$currentSlideIndex],
);

export const selectedElement = derived(
  [currentSlide, selectedElementId],
  ([$currentSlide, $selectedElementId]) => ($selectedElementId ? $currentSlide?.elements?.find((el) => el.id === $selectedElementId) : null),
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function generateId() {
  return `el_${Math.random().toString(36).substr(2, 9)}`;
}

export function markChanged() {
  hasUnsavedChanges.set(true);
}

export function triggerCastUpdate() {
  cast.update((c) => ({ ...c }));
}

// Get current values synchronously (for non-reactive contexts)
export function getCast() { return get(cast); }
export function getCurrentGroup() { return get(currentGroup); }
export function getCurrentSlide() { return get(currentSlide); }
export function getSelectedElement() { return get(selectedElement); }
