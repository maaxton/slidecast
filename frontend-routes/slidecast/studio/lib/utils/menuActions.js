/**
 * Menu Actions - Menu bar action handlers
 *
 * This module handles menu action dispatching. The actual implementation
 * requires access to local component state, so it uses a context object
 * pattern to access necessary functions and state.
 */

import { get } from 'svelte/store';
import * as store from '../stores/studioStore.js';
import * as actions from './studioActions.js';
import * as canvas from './canvasControls.js';

// =============================================================================
// DEBUG LOGGING HELPER
// =============================================================================

function debugLog(category, action, data = {}) {
  if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
    window.WaiveoDebug.log('slidecast', category, action, data);
  }
}

/**
 * Handle menu action dispatch
 * @param {string} action - Action identifier
 * @param {Object} context - Context object with callbacks and state accessors
 */
export function handleMenuAction(action, context = {}) {
  const {
    // Navigation
    goto,
    hasUnsavedChanges,
    showUnsavedChangesModal,
    setShowUnsavedChangesModal,
    pendingNavigation,

    // Save/Export
    saveCast,
    exportCast,

    // Element operations
    getSelectedElement,
    getCurrentSlide,
    setSelectedElementId,
    deleteSelectedElement,
    duplicateSelectedElement,
    pasteElement,
    clipboardElement,
    elementClipboardOperation,
    cutElementSourceGroupId,
    cutElementSourceSlideIndex,
    cutElementSourceId,
    setClipboardElement,
    setElementClipboardOperation,
    setCutElementSource,

    // Layer ordering
    bringToFront,
    bringForward,
    sendBackward,
    sendToBack,
    alignElement,

    // Panels
    showSlidesPanel,
    setShowSlidesPanel,
    slidesPanelCollapsed,
    setSlidesPanelCollapsed,
    showLayersPanel,
    setShowLayersPanel,
    showPropertiesPanel,
    setShowPropertiesPanel,
    showHistoryPanel,
    setShowHistoryPanel,

    // Modals
    showSaveAsTemplateModal,
    setShowSaveAsTemplateModal,
    showCanvasSizeModal,
    setShowCanvasSizeModal,
    showGroupSettingsModal,
    setShowGroupSettingsModal,
    showSlideSettingsModal,
    setShowSlideSettingsModal,
    showKeyboardShortcutsModal,
    setShowKeyboardShortcutsModal,

    // Canvas
    canvasContainer,

    // Current state
    currentGroupId,
    currentSlideIndex,
    setEditingSlideIndex,
  } = context;

  // Close menu first
  store.openMenu.set(null);

  // Log menu action
  debugLog('menu', 'action', { action });

  switch (action) {
    // File menu
    case 'newCast':
      if (hasUnsavedChanges) {
        if (pendingNavigation) pendingNavigation.set('/ext/slidecast/studio?id=new');
        if (setShowUnsavedChangesModal) setShowUnsavedChangesModal(true);
      } else {
        goto('/ext/slidecast/studio?id=new');
      }
      break;

    case 'save':
      saveCast();
      break;

    case 'saveAsTemplate':
      if (setShowSaveAsTemplateModal) setShowSaveAsTemplateModal(true);
      break;

    case 'exportCast':
      exportCast();
      break;

    case 'close':
      if (hasUnsavedChanges) {
        if (pendingNavigation) pendingNavigation.set('/ext/slidecast');
        if (setShowUnsavedChangesModal) setShowUnsavedChangesModal(true);
      } else {
        goto('/ext/slidecast');
      }
      break;

    // Edit menu
    case 'undo':
      store.undo();
      break;

    case 'redo':
      store.redo();
      break;

    case 'cut': {
      const selectedElement = getSelectedElement ? getSelectedElement() : get(store.selectedElement);
      if (selectedElement) {
        const currentGroupId = get(store.currentGroupId);
        const currentSlideIndex = get(store.currentSlideIndex);
        if (setClipboardElement) {
          setClipboardElement(JSON.parse(JSON.stringify(selectedElement)));
        } else {
          store.clipboardElement.set(JSON.parse(JSON.stringify(selectedElement)));
        }
        if (setElementClipboardOperation) {
          setElementClipboardOperation('cut');
        }
        if (setCutElementSource) {
          setCutElementSource({
            groupId: currentGroupId,
            slideIndex: currentSlideIndex,
            elementId: selectedElement.id,
          });
        }
      }
      break;
    }

    case 'copy': {
      const selectedElement = getSelectedElement ? getSelectedElement() : get(store.selectedElement);
      if (selectedElement) {
        if (setClipboardElement) {
          setClipboardElement(JSON.parse(JSON.stringify(selectedElement)));
        } else {
          store.clipboardElement.set(JSON.parse(JSON.stringify(selectedElement)));
        }
        if (setElementClipboardOperation) {
          setElementClipboardOperation('copy');
        }
        if (setCutElementSource) {
          setCutElementSource(null);
        }
      }
      break;
    }

    case 'paste':
      if (clipboardElement || get(store.clipboardElement)) {
        pasteElement();
      }
      break;

    case 'duplicate':
      duplicateSelectedElement();
      break;

    case 'delete':
      deleteSelectedElement();
      break;

    case 'selectAll': {
      const slide = getCurrentSlide ? getCurrentSlide() : get(store.currentSlide);
      if (slide?.elements?.length > 0) {
        setSelectedElementId(slide.elements[slide.elements.length - 1].id);
      }
      break;
    }

    // View menu
    case 'zoomIn':
      canvas.zoomIn();
      break;

    case 'zoomOut':
      canvas.zoomOut();
      break;

    case 'zoomFit':
      canvas.zoomFit(canvasContainer);
      break;

    case 'toggleSlidesPanel':
      if (setShowSlidesPanel) {
        const newValue = !showSlidesPanel;
        setShowSlidesPanel(newValue);
        if (setSlidesPanelCollapsed) {
          setSlidesPanelCollapsed(!newValue);
        }
      }
      break;

    case 'toggleLayersPanel':
      if (setShowLayersPanel) {
        setShowLayersPanel(!showLayersPanel);
      }
      break;

    case 'togglePropertiesPanel':
      if (setShowPropertiesPanel) {
        setShowPropertiesPanel(!showPropertiesPanel);
      }
      break;

    case 'toggleHistoryPanel':
      if (setShowHistoryPanel) {
        setShowHistoryPanel(!showHistoryPanel);
      }
      break;

    // Insert menu
    case 'insertText':
      actions.addElement('text');
      break;

    case 'insertImage':
      store.openModal('media');
      break;

    case 'insertWidget':
      store.openModal('widget');
      break;

    case 'insertRectangle':
      actions.addElement('shape', { shape: 'rectangle' });
      break;

    case 'insertCircle':
      actions.addElement('shape', { shape: 'circle' });
      break;

      // NOTE: insertQrCode and insertNav removed - use widgets instead

    case 'insertPing':
      actions.addElement('ping');
      break;

    // Arrange menu
    case 'bringToFront':
      bringToFront();
      break;

    case 'bringForward':
      bringForward();
      break;

    case 'sendBackward':
      sendBackward();
      break;

    case 'sendToBack':
      sendToBack();
      break;

    case 'alignLeft':
      alignElement('left');
      break;

    case 'alignCenter':
      alignElement('center');
      break;

    case 'alignRight':
      alignElement('right');
      break;

    case 'alignTop':
      alignElement('top');
      break;

    case 'alignMiddle':
      alignElement('middle');
      break;

    case 'alignBottom':
      alignElement('bottom');
      break;

    // Cast menu
    case 'canvasSize':
      if (setShowCanvasSizeModal) setShowCanvasSizeModal(true);
      break;

    case 'background': {
      const slide = getCurrentSlide ? getCurrentSlide() : get(store.currentSlide);
      const bgElement = slide?.elements?.find((el) => el.type === 'background');
      if (bgElement) {
        setSelectedElementId(bgElement.id);
      }
      break;
    }

    case 'variables':
      store.openModal('variables');
      break;

    case 'groups':
      if (setShowGroupSettingsModal) setShowGroupSettingsModal(true);
      break;

    case 'slideTiming': {
      const currentSlideIndex = get(store.currentSlideIndex);
      if (setShowSlideSettingsModal) setShowSlideSettingsModal(true);
      if (setEditingSlideIndex) setEditingSlideIndex(currentSlideIndex);
      break;
    }

    // Help menu
    case 'keyboardShortcuts':
      if (setShowKeyboardShortcutsModal) {
        setShowKeyboardShortcutsModal(true);
      } else {
        store.openModal('keyboardShortcuts');
      }
      break;

    case 'debugLayers': {
      const castId = get(store.castId);
      const debugSlideIndex = get(store.currentSlideIndex);
      window.open(`/ext/slidecast/debug-studio?cast=${castId}&slide=${debugSlideIndex}`, '_blank');
      break;
    }

    case 'documentation':
      window.open('https://docs.waiveo.com/slidecast', '_blank');
      break;
  }
}

/**
 * Toggle menu open/closed state
 * @param {string} menuKey - Menu identifier
 */
export function toggleMenu(menuKey) {
  const current = get(store.openMenu);
  const willOpen = current !== menuKey;
  store.openMenu.update((c) => (c === menuKey ? null : menuKey));
  debugLog('menu', willOpen ? 'open' : 'close', { menu: menuKey });
}

/**
 * Close currently open menu
 */
export function closeMenu() {
  store.openMenu.set(null);
}
