<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import SlideRenderer from '../lib/SlideRenderer.svelte';
  
  // Panel Components (extracted for better organization)
  import SlidesPanel from './lib/panels/SlidesPanel.svelte';
  import LayersPanel from './lib/panels/LayersPanel.svelte';
  import HistoryPanel from './lib/panels/HistoryPanel.svelte';
  import PropertiesPanel from './lib/panels/PropertiesPanel.svelte';
  
  // Studio Components (header, toolbar, canvas)
  import StudioHeader from './lib/components/StudioHeader.svelte';
  import StudioToolbar from './lib/components/StudioToolbar.svelte';
  import StudioCanvas from './lib/components/StudioCanvas.svelte';
  
  // Config Windows (floating, draggable)
  import WidgetConfigWindow from './lib/config-windows/WidgetConfigWindow.svelte';
  import TextConfigWindow from './lib/config-windows/TextConfigWindow.svelte';
  import NavConfigWindow from './lib/config-windows/NavConfigWindow.svelte';
  import QRConfigWindow from './lib/config-windows/QRConfigWindow.svelte';
  
  // Modals
  import MediaModal from './lib/modals/MediaModal.svelte';
  import WidgetModal from './lib/modals/WidgetModal.svelte';
  import KeyboardShortcutsModal from './lib/modals/KeyboardShortcutsModal.svelte';
  import VariablesModal from './lib/modals/VariablesModal.svelte';
  import AddGroupModal from './lib/modals/AddGroupModal.svelte';
  import DeleteConfirmModal from './lib/modals/DeleteConfirmModal.svelte';
  import CanvasSizeModal from './lib/modals/CanvasSizeModal.svelte';
  import PasteSlideModal from './lib/modals/PasteSlideModal.svelte';
  import IconPickerModal from './lib/modals/IconPickerModal.svelte';
  import UnsavedChangesModal from './lib/modals/UnsavedChangesModal.svelte';
  import SaveAsTemplateModal from './lib/modals/SaveAsTemplateModal.svelte';
  import SlideSettingsModal from './lib/modals/SlideSettingsModal.svelte';
  import GroupSettingsModal from './lib/modals/GroupSettingsModal.svelte';
  
  // Data files (moved out to reduce main file size)
  import { iconCategories, allIcons } from './lib/data/iconCategories.js';
  import { getMenuDefinitions } from './lib/data/menuDefinitions.js';

  // Store imports - centralized state management
  // Import individual stores for proper Svelte reactivity with $ prefix
  import {
    // Core state
    cast as castStore,
    castId as castIdStore,
    loading as loadingStore,
    saving as savingStore,
    error as errorStore,
    hasUnsavedChanges as hasUnsavedChangesStore,
    // Navigation
    currentGroupId as currentGroupIdStore,
    currentSlideIndex as currentSlideIndexStore,
    selectedElementId as selectedElementIdStore,
    // Group management
    newGroupName as newGroupNameStore,
    // Settings modals
    editingSlideIndex as editingSlideIndexStore,
    // Slide drag reorder
    draggedSlideIndex as draggedSlideIndexStore,
    dragOverSlideIndex as dragOverSlideIndexStore,
    // Layer drag reorder
    draggedLayerId as draggedLayerIdStore,
    dragOverLayerId as dragOverLayerIdStore,
    // Clipboard
    slideClipboard as slideClipboardStore,
    clipboardOperation as clipboardOperationStore,
    clipboardElement as clipboardElementStore,
    // Available data
    mediaLibrary as mediaLibraryStore,
    onlineScreens as onlineScreensStore,
    availableWidgets as availableWidgetsStore,
    widgetCategories as widgetCategoriesStore,
    // Widget search/filter
    widgetSearchQuery as widgetSearchQueryStore,
    selectedWidgetCategory as selectedWidgetCategoryStore,
    // Template saving
    templateName as templateNameStore,
    templateDescription as templateDescriptionStore,
    savingTemplate as savingTemplateStore,
    // Menu/Panel state
    openMenu as openMenuStore,
    showLayersPanel as showLayersPanelStore,
    showPropertiesPanel as showPropertiesPanelStore,
    showSlidesPanel as showSlidesPanelStore,
    showHistoryPanel as showHistoryPanelStore,
    // Sidebar resize
    rightSidebarWidth as rightSidebarWidthStore,
    rightSidebarCollapsed as rightSidebarCollapsedStore,
    isResizingSidebar as isResizingSidebarStore,
    sidebarResizeStart as sidebarResizeStartStore,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
    // Canvas state
    canvasZoom as canvasZoomStore,
    canvasPan as canvasPanStore,
    activeTool as activeToolStore,
    isPanning as isPanningStore,
    panStart as panStartStore,
    // Drag & resize state
    isDragging as isDraggingStore,
    isResizing as isResizingStore,
    dragStart as dragStartStore,
    resizeHandle as resizeHandleStore,
    originalElement as originalElementStore,
    // Panel collapse state
    slidesPanelCollapsed as slidesPanelCollapsedStore,
    propertiesPanelCollapsed as propertiesPanelCollapsedStore,
    layersPanelCollapsed as layersPanelCollapsedStore,
    historyPanelCollapsed as historyPanelCollapsedStore,
    // History state
    historyStack as historyStackStore,
    historyIndex as historyIndexStore,
    // Config windows
    widgetConfig as widgetConfigStore,
    textConfig as textConfigStore,
    navConfig as navConfigStore,
    qrConfig as qrConfigStore,
    // Pending operations
    pendingNavigation as pendingNavigationStore,
    pendingDeleteLayerId as pendingDeleteLayerIdStore,
    pendingDeleteSlideIndex as pendingDeleteSlideIndexStore,
    pendingDeleteGroupId as pendingDeleteGroupIdStore,
    // Nav Icon Picker
    navIconPicker as navIconPickerStore,
    // Media upload
    importUrl as importUrlStore,
    importingUrl as importingUrlStore,
    isDraggingMedia as isDraggingMediaStore,
    uploadingMedia as uploadingMediaStore,
    // Widget rendering
    runningWidgetId as runningWidgetIdStore,
    pendingWidgetRenders as pendingWidgetRendersStore,
    // Modal state
    modals as modalsStore,
    // Derived stores
    currentGroup as currentGroupStore,
    currentSlides as currentSlidesStore,
    currentSlide as currentSlideStore,
    selectedElement as selectedElementStore
  } from './lib/stores/studioStore.js';
  
  // Also import the store module for functions and constants
  import * as store from './lib/stores/studioStore.js';
  import { get } from 'svelte/store';
  
  // Business logic modules
  import * as actions from './lib/utils/studioActions.js';
  import * as canvas from './lib/utils/canvasControls.js';
  import { handleRefreshIntercept as keyboardRefreshIntercept } from './lib/utils/keyboardHandler.js';
  import * as menu from './lib/utils/menuActions.js';
  import * as configWindows from './lib/utils/configWindows.js';
  
  // Debug logging helper
  function debugLog(category, action, data = {}) {
    if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
      window.WaiveoDebug.log('slidecast', category, action, data);
    }
  }

  // Store subscriptions - reactive bindings using $ prefix on actual stores
  $: cast = $castStore;
  $: castId = $castIdStore;
  $: loading = $loadingStore;
  $: saving = $savingStore;
  $: error = $errorStore;
  $: hasUnsavedChanges = $hasUnsavedChangesStore;
  
  // Current group and slide
  $: currentGroupId = $currentGroupIdStore;
  $: currentSlideIndex = $currentSlideIndexStore;
  $: selectedElementId = $selectedElementIdStore;
  
  // Group management
  $: newGroupName = $newGroupNameStore;
  
  // Settings modals
  $: editingSlideIndex = $editingSlideIndexStore;
  
  // Slide drag reorder
  $: draggedSlideIndex = $draggedSlideIndexStore;
  $: dragOverSlideIndex = $dragOverSlideIndexStore;
  
  // Layer drag reorder
  $: draggedLayerId = $draggedLayerIdStore;
  $: dragOverLayerId = $dragOverLayerIdStore;
  
  // Slide clipboard (cut/copy/paste)
  $: slideClipboard = $slideClipboardStore;
  $: clipboardOperation = $clipboardOperationStore;
  
  // Available media and widgets
  $: mediaLibrary = $mediaLibraryStore;
  $: onlineScreens = $onlineScreensStore;
  $: availableWidgets = $availableWidgetsStore;
  $: widgetCategories = $widgetCategoriesStore;
  
  // Widget search/filter
  $: widgetSearchQuery = $widgetSearchQueryStore;
  $: selectedWidgetCategory = $selectedWidgetCategoryStore;
  
  // Template saving
  $: templateName = $templateNameStore;
  $: templateDescription = $templateDescriptionStore;
  $: savingTemplate = $savingTemplateStore;
  
  // Menu Bar State
  $: openMenu = $openMenuStore;
  $: showLayersPanel = $showLayersPanelStore;
  $: showPropertiesPanel = $showPropertiesPanelStore;
  $: showSlidesPanel = $showSlidesPanelStore;
  $: showHistoryPanel = $showHistoryPanelStore;
  
  // Right sidebar resize
  $: rightSidebarWidth = $rightSidebarWidthStore;
  $: rightSidebarCollapsed = $rightSidebarCollapsedStore;
  $: isResizingSidebar = $isResizingSidebarStore;
  $: sidebarResizeStart = $sidebarResizeStartStore;
  
  // Canvas state
  $: canvasZoom = $canvasZoomStore;
  $: canvasPan = $canvasPanStore;
  $: activeTool = $activeToolStore;
  $: isPanning = $isPanningStore;
  $: panStart = $panStartStore;
  
  // Deselect layers when switching to hand tool
  $: if (activeTool === 'hand') {
    store.selectedElementId.set(null);
  }
  
  // Drag & resize state
  $: isDragging = $isDraggingStore;
  $: isResizing = $isResizingStore;
  $: dragStart = $dragStartStore;
  $: resizeHandle = $resizeHandleStore;
  $: originalElement = $originalElementStore;
  
  // Panel collapse state
  $: slidesPanelCollapsed = $slidesPanelCollapsedStore;
  $: propertiesPanelCollapsed = $propertiesPanelCollapsedStore;
  $: layersPanelCollapsed = $layersPanelCollapsedStore;
  $: historyPanelCollapsed = $historyPanelCollapsedStore;
  
  // History state
  $: historyStack = $historyStackStore;
  $: historyIndex = $historyIndexStore;
  const MAX_HISTORY = 100;
  
  // Config windows (stored in store as objects)
  $: widgetConfig = $widgetConfigStore;
  $: textConfig = $textConfigStore;
  $: navConfig = $navConfigStore;
  $: qrConfig = $qrConfigStore;
  
  // Derived config window state
  $: showWidgetConfigModal = widgetConfig?.show || false;
  $: widgetConfigElement = widgetConfig?.element || null;
  $: widgetConfigPos = widgetConfig?.position || { x: 100, y: 100 };
  $: isDraggingWidgetConfig = widgetConfig?.isDragging || false;
  $: widgetConfigDragOffset = widgetConfig?.dragOffset || { x: 0, y: 0 };
  // studioElements contribution (if any) whose widgetType matches the widget
  // currently open in the config window — passed to WidgetConfigWindow so it
  // can swap in the contributing extension's own config panel (Slice 5.4).
  $: widgetConfigContribution = (widgetConfigElement?.type === 'widget' && widgetConfigElement.widgetUuid)
    ? (studioElementContributions.find(
        (c) => c.widgetType && `${c.extension}:${c.widgetType}` === widgetConfigElement.widgetUuid,
      ) || null)
    : null;

  $: showTextConfigModal = textConfig?.show || false;
  $: textConfigElement = textConfig?.element || null;
  $: textConfigPos = textConfig?.position || { x: 150, y: 120 };
  $: isDraggingTextConfig = textConfig?.isDragging || false;
  $: textConfigDragOffset = textConfig?.dragOffset || { x: 0, y: 0 };
  
  $: showNavConfigModal = navConfig?.show || false;
  $: navConfigElement = navConfig?.element || null;
  $: navConfigPos = navConfig?.position || { x: 100, y: 80 };
  $: isDraggingNavConfig = navConfig?.isDragging || false;
  $: navConfigDragOffset = navConfig?.dragOffset || { x: 0, y: 0 };
  $: navConfigTab = navConfig?.tab || 'style';
  
  $: showQRConfigModal = qrConfig?.show || false;
  $: qrConfigElement = qrConfig?.element || null;
  $: qrConfigPos = qrConfig?.position || { x: 200, y: 150 };
  $: isDraggingQRConfig = qrConfig?.isDragging || false;
  $: qrConfigDragOffset = qrConfig?.dragOffset || { x: 0, y: 0 };
  
  // Clipboard
  $: clipboardElement = $clipboardElementStore;
  
  // Pending operations
  $: pendingNavigation = $pendingNavigationStore;
  $: pendingDeleteLayerId = $pendingDeleteLayerIdStore;
  $: pendingDeleteSlideIndex = $pendingDeleteSlideIndexStore;
  $: pendingDeleteGroupId = $pendingDeleteGroupIdStore;
  
  // Nav Icon Picker
  $: navIconPicker = $navIconPickerStore;
  $: showNavIconPicker = navIconPicker?.show || false;
  $: navIconPickerItemIndex = navIconPicker?.itemIndex || null;
  $: iconSearchQuery = navIconPicker?.searchQuery || '';
  $: activeIconCategory = navIconPicker?.activeCategory || 'all';
  
  // Media upload
  $: importUrl = $importUrlStore;
  $: importingUrl = $importingUrlStore;
  $: isDraggingMedia = $isDraggingMediaStore;
  $: uploadingMedia = $uploadingMediaStore;
  
  // Widget rendering
  $: runningWidgetId = $runningWidgetIdStore;
  
  // Modal state subscriptions
  $: modals = $modalsStore;
  $: showAddGroupModal = modals.addGroup;
  $: showSlideSettingsModal = modals.slideSettings;
  $: showGroupSettingsModal = modals.groupSettings;
  $: showPasteSlideModal = modals.pasteSlide;
  $: showMediaModal = modals.media;
  $: showWidgetModal = modals.widget;
  $: showVariablesModal = modals.variables;
  $: showPreviewModal = modals.preview;
  $: showSaveAsTemplateModal = modals.saveAsTemplate;
  $: showUnsavedChangesModal = modals.unsavedChanges;
  $: showDeleteLayerModal = modals.deleteLayer;
  $: showDeleteSlideModal = modals.deleteSlide;
  $: showDeleteGroupModal = modals.deleteGroup;
  $: showCanvasSizeModal = modals.canvasSize;
  $: showKeyboardShortcutsModal = modals.keyboardShortcuts;
  
  // Local state (not in store - UI helpers, refs, etc.)
  let mediaFileInput = null;
  let canvasContainer = null;
  let canvasNeedsScroll = false;
  let isMac = false;
  // studioElements contributions (spec §6 / D9, Wave 5 Slice 5.4) — fetched
  // once at mount, passed to StudioToolbar (extra placeable buttons) and used
  // here to find the contribution (if any) matching the widget currently open
  // in the config window, threaded into WidgetConfigWindow so it can swap in
  // the contributing extension's own config panel.
  let studioElementContributions = [];
  $: modKey = isMac ? '⌘' : 'Ctrl';
  let propertyChangeTimer = null;
  let pendingPropertyAction = null;
  let tooltipElement = null;
  let tooltipShowTimeout = null;
  let tooltipHideTimeout = null;
  let currentTooltipTarget = null;
  let studioStyleElement = null;
  let tooltipObserver = null;
  let slowLoadingWidgets = new Set();
  let widgetLoadingTimers = {};
  let lastNavSyncHash = '';
  let elementClipboardOperation = null;
  let cutElementSourceGroupId = null;
  let cutElementSourceSlideIndex = null;
  let cutElementSourceId = null;
  
  // Menu definitions
  const menuDefinitions = {
    file: {
      label: 'File',
      items: [
        { label: 'New Cast', action: 'newCast', shortcut: null },
        { type: 'separator' },
        { label: 'Save', action: 'save', shortcut: '⌘S' },
        { label: 'Save as Template...', action: 'saveAsTemplate', shortcut: null },
        { type: 'separator' },
        { label: 'Export Cast...', action: 'exportCast', shortcut: null },
        { type: 'separator' },
        { label: 'Close', action: 'close', shortcut: null }
      ]
    },
    edit: {
      label: 'Edit',
      items: [
        { label: 'Undo', action: 'undo', shortcut: '⌘Z', disabled: () => historyIndex <= 0 },
        { label: 'Redo', action: 'redo', shortcut: '⌘⇧Z', disabled: () => historyIndex >= historyStack.length - 1 },
        { type: 'separator' },
        { label: 'Cut', action: 'cut', shortcut: '⌘X', disabled: () => !selectedElement },
        { label: 'Copy', action: 'copy', shortcut: '⌘C', disabled: () => !selectedElement },
        { label: 'Paste', action: 'paste', shortcut: '⌘V', disabled: () => !clipboardElement },
        { label: 'Duplicate', action: 'duplicate', shortcut: '⌘D', disabled: () => !selectedElement },
        { type: 'separator' },
        { label: 'Delete', action: 'delete', shortcut: '⌫', disabled: () => !selectedElement },
        { type: 'separator' },
        { label: 'Select All', action: 'selectAll', shortcut: '⌘A' }
      ]
    },
    view: {
      label: 'View',
      items: [
        { label: 'Zoom In', action: 'zoomIn', shortcut: '⌘+' },
        { label: 'Zoom Out', action: 'zoomOut', shortcut: '⌘-' },
        { label: 'Zoom to Fit', action: 'zoomFit', shortcut: '⌘0' },
        { type: 'separator' },
        { label: 'Show Slides Panel', action: 'toggleSlidesPanel', checked: () => showSlidesPanel },
        { label: 'Show Layers Panel', action: 'toggleLayersPanel', checked: () => showLayersPanel },
        { label: 'Show Properties Panel', action: 'togglePropertiesPanel', checked: () => showPropertiesPanel },
        { label: 'Show History Panel', action: 'toggleHistoryPanel', checked: () => showHistoryPanel }
      ]
    },
    insert: {
      label: 'Insert',
      items: [
        { label: 'Text', action: 'insertText', icon: 'fa-solid fa-font' },
        { label: 'Image...', action: 'insertImage', icon: 'fa-solid fa-image' },
        { label: 'Widget...', action: 'insertWidget', icon: 'fa-solid fa-puzzle-piece' },
        { type: 'separator' },
        { label: 'Shape', action: 'insertShape', icon: 'fa-solid fa-shapes', submenu: [
          { label: 'Rectangle', action: 'insertRectangle' },
          { label: 'Circle', action: 'insertCircle' }
        ]},
        { type: 'separator' },
        { label: 'Ping Button', action: 'insertPing', icon: 'fa-solid fa-bell' }
        // NOTE: QR Code and Navigation menu items removed - use widgets instead
      ]
    },
    arrange: {
      label: 'Arrange',
      items: [
        { label: 'Bring to Front', action: 'bringToFront', shortcut: '⌘⇧]', disabled: () => !selectedElement },
        { label: 'Bring Forward', action: 'bringForward', shortcut: '⌘]', disabled: () => !selectedElement },
        { label: 'Send Backward', action: 'sendBackward', shortcut: '⌘[', disabled: () => !selectedElement },
        { label: 'Send to Back', action: 'sendToBack', shortcut: '⌘⇧[', disabled: () => !selectedElement },
        { type: 'separator' },
        { label: 'Align', submenu: [
          { label: 'Align Left', action: 'alignLeft', disabled: () => !selectedElement },
          { label: 'Align Center', action: 'alignCenter', disabled: () => !selectedElement },
          { label: 'Align Right', action: 'alignRight', disabled: () => !selectedElement },
          { type: 'separator' },
          { label: 'Align Top', action: 'alignTop', disabled: () => !selectedElement },
          { label: 'Align Middle', action: 'alignMiddle', disabled: () => !selectedElement },
          { label: 'Align Bottom', action: 'alignBottom', disabled: () => !selectedElement }
        ]}
      ]
    },
    cast: {
      label: 'Cast',
      items: [
        { label: 'Canvas Size...', action: 'canvasSize', icon: 'fa-solid fa-expand' },
        { label: 'Background...', action: 'background', icon: 'fa-solid fa-fill-drip' },
        { type: 'separator' },
        { label: 'Variables...', action: 'variables', icon: 'fa-solid fa-code' },
        { label: 'Groups...', action: 'groups', icon: 'fa-solid fa-layer-group' },
        { type: 'separator' },
        { label: 'Slide Timing...', action: 'slideTiming', icon: 'fa-solid fa-clock' }
      ]
    },
    help: {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', action: 'keyboardShortcuts', shortcut: '⌘?' },
        { label: 'Debug Layers', action: 'debugLayers', icon: 'fa-solid fa-layer-group' },
        { label: 'Documentation', action: 'documentation', icon: 'fa-solid fa-book' }
      ]
    }
  };
  
  // Icon categories and allIcons are now imported from ./lib/data/iconCategories.js
  // (Saves ~370 lines in this file)
  
  // Reactive filtered icons
  
  // Tool mode: 'pointer' (default selection) or 'hand' (pan mode)
  // (activeTool is now from store)
  
  // Check if canvas needs scrollbars (scaled canvas larger than container)
  $: if (canvasContainer && typeof window !== 'undefined') {
    const scaledWidth = 1920 * canvasZoom;
    const scaledHeight = 1080 * canvasZoom;
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    canvasNeedsScroll = scaledWidth > containerWidth || scaledHeight > containerHeight;
  }
  
  // Check if canvas needs scrollbars (scaled canvas larger than container)
  $: if (canvasContainer && typeof window !== 'undefined') {
    const scaledWidth = 1920 * canvasZoom;
    const scaledHeight = 1080 * canvasZoom;
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    canvasNeedsScroll = scaledWidth > containerWidth || scaledHeight > containerHeight;
  }
  
  // History functions are now in store - use store.initHistory(), store.pushHistory(), etc.
  
  
  function trackPropertyChange(action) {
    // Use store's debounced history push for property changes
    store.pushHistoryDebounced(action);
  }
  
  // Helper for element property changes
  function onElementChange(property) {
    store.triggerCastUpdate();
    const name = selectedElement?.name || selectedElement?.type || 'element';
    trackPropertyChange(`Change "${name}" ${property}`);
    // Auto-run widget when any property changes
    scheduleWidgetAutoRun(selectedElement);
  }
  
  // Helper for slide property changes
  function onSlideChange(property) {
    store.triggerCastUpdate();
    const slide = currentSlides?.[editingSlideIndex];
    const name = slide?.name || `Slide ${editingSlideIndex + 1}`;
    trackPropertyChange(`Change "${name}" ${property}`);
  }
  
  // Helper for group property changes
  function onGroupChange(property) {
    store.triggerCastUpdate();
    const name = currentGroup?.name || 'group';
    trackPropertyChange(`Change "${name}" ${property}`);
  }

  // Navigation with unsaved changes check
  function goto(path) {
    if (hasUnsavedChanges) {
      pendingNavigation = path;
      showUnsavedChangesModal = true;
    } else {
      window.location.href = path;
    }
  }
  
  function confirmNavigateAway() {
    showUnsavedChangesModal = false;
    store.hasUnsavedChanges.set(false);
    if (pendingNavigation === 'reload') {
      window.location.reload();
    } else if (pendingNavigation === 'back') {
      // Go back twice: once to undo our pushState, once for actual back
      history.go(-2);
    } else if (pendingNavigation) {
      window.location.href = pendingNavigation;
    }
  }
  
  async function saveAndNavigate() {
    await saveCast();
    showUnsavedChangesModal = false;
    store.hasUnsavedChanges.set(false);
    if (pendingNavigation === 'reload') {
      window.location.reload();
    } else if (pendingNavigation === 'back') {
      history.go(-2);
    } else if (pendingNavigation) {
      window.location.href = pendingNavigation;
    }
  }
  
  function cancelNavigation() {
    showUnsavedChangesModal = false;
    pendingNavigation = null;
  }

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  // Fast tooltip system - uses fixed positioning to avoid overflow clipping
  
  function createTooltipElement() {
    if (tooltipElement) return tooltipElement;
    const element = document.createElement('div');
    tooltipElement = element;
    tooltipElement.className = 'fast-tooltip';
    tooltipElement.style.cssText = `
      position: fixed;
      padding: 0.4rem 0.65rem;
      background: rgba(15, 15, 20, 0.95);
      color: white;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      border-radius: 5px;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.12s ease;
      z-index: 100000;
      border: 1px solid rgb(var(--color-border));
    `;
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  }
  
  function showTooltip(el) {
    if (!el || el !== currentTooltipTarget) return;
    
    const tooltip = el.getAttribute('data-tooltip');
    if (!tooltip) return;
    
    const tip = createTooltipElement();
    tip.textContent = tooltip;
    
    // Make visible briefly to measure
    tip.style.visibility = 'hidden';
    tip.style.opacity = '0';
    tip.style.display = 'block';
    
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    
    // Position above by default
    let top = rect.top - tipRect.height - 6;
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    
    // If would go off top, show below instead
    if (top < 5) {
      top = rect.bottom + 6;
    }
    
    // Keep within horizontal bounds
    if (left < 5) left = 5;
    if (left + tipRect.width > window.innerWidth - 5) {
      left = window.innerWidth - tipRect.width - 5;
    }
    
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.style.visibility = 'visible';
    tip.style.opacity = '1';
  }
  
  function hideTooltip() {
    if (tooltipElement) {
      tooltipElement.style.opacity = '0';
      tooltipElement.style.visibility = 'hidden';
    }
  }
  
  function handleTooltipMouseOver(e) {
    const el = e.target.closest('[data-tooltip]');
    
    // Clear any pending hide
    clearTimeout(tooltipHideTimeout);
    
    if (!el) {
      // Mouse moved to non-tooltip element, schedule hide
      tooltipHideTimeout = setTimeout(() => {
        currentTooltipTarget = null;
        hideTooltip();
      }, 50);
      return;
    }
    
    // Same element, keep showing
    if (el === currentTooltipTarget) return;
    
    // New element - update immediately if we already have a tooltip showing
    clearTimeout(tooltipShowTimeout);
    currentTooltipTarget = el;
    
    if (tooltipElement && tooltipElement.style.opacity === '1') {
      // Already showing a tooltip, switch instantly
      showTooltip(el);
    } else {
      // No tooltip showing, use short delay
      tooltipShowTimeout = setTimeout(() => showTooltip(el), 80);
    }
  }
  
  function handleTooltipMouseOut(e) {
    // Only hide if we're leaving to something without a tooltip
    const relatedTarget = e.relatedTarget;
    const newTooltipEl = relatedTarget?.closest?.('[data-tooltip]');
    
    if (!newTooltipEl) {
      clearTimeout(tooltipShowTimeout);
      tooltipHideTimeout = setTimeout(() => {
        currentTooltipTarget = null;
        hideTooltip();
      }, 100);
    }
  }

  // Convert title attributes to data-tooltip for fast tooltips
  function convertTitlesToTooltips(container = document) {
    container.querySelectorAll('[title]').forEach(el => {
      const title = el.getAttribute('title');
      if (title) {
        el.setAttribute('data-tooltip', title);
        el.removeAttribute('title');
      }
    });
  }

  // Dynamic CSS loading
  
  async function loadStudioStyles() {
    try {
      const response = await fetch('/api/extensions/slidecast/static/studio.css', {
        credentials: 'same-origin'
      });
      if (response.ok) {
        const css = await response.text();
        studioStyleElement = document.createElement('style');
        studioStyleElement.id = 'slidecast-studio-styles';
        studioStyleElement.textContent = css;
        document.head.appendChild(studioStyleElement);
      }
    } catch (e) {
      console.warn('Failed to load studio styles:', e);
    }
  }

  onMount(async () => {
    debugLog('studio', 'mount.start', { url: window.location.href });
    
    // Load external CSS
    await loadStudioStyles();
    
    // Detect Mac for keyboard shortcut display
    isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || 
            navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
    
    // Convert existing titles to fast tooltips
    setTimeout(() => convertTitlesToTooltips(), 100);
    
    // Add tooltip event listeners (using mouseover/mouseout for better bubbling)
    document.addEventListener('mouseover', handleTooltipMouseOver, true);
    document.addEventListener('mouseout', handleTooltipMouseOut, true);
    
    // Watch for new elements with title attributes
    tooltipObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            convertTitlesToTooltips(node);
            if (node.hasAttribute?.('title')) {
              const title = node.getAttribute('title');
              node.setAttribute('data-tooltip', title);
              node.removeAttribute('title');
            }
          }
        });
      });
    });
    tooltipObserver.observe(document.body, { childList: true, subtree: true });
    
    castId = getQueryParam('id');
    castIdStore.set(castId);
    
    await Promise.all([
      loadCast(),
      loadWidgets(),
      loadMedia(),
      loadScreens(),
      loadStudioElements()
    ]);
    
    store.loading.set(false);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('testMode') === '1') {
        window.__slidecastTestApi = {
          openModal: (name) => store.openModal(name),
          openNavIconPicker: (itemIndex = 0) => {
            store.navIconPicker.set({
              show: true,
              itemIndex,
              searchQuery: '',
              activeCategory: 'all'
            });
          },
          addElement: (type, config = {}) => {
            actions.addElement(type, config);
          }
        };
      }
    }
    
    // Initial zoom
    await tick();
    canvas.zoomFit(canvasContainer);
    
    // Auto-run all widgets on the current slide
    await runAllWidgetsOnSlide();
    
    debugLog('studio', 'mount.complete', { 
      castId, 
      castName: cast?.name,
      slides: cast?.definition?.groups?.reduce((acc, g) => acc + (g.slides?.length || 0), 0),
      widgets: availableWidgets?.length || 0
    });
    
    // Event listeners
    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', handleKeyboard);
    document.addEventListener('keydown', handleRefreshIntercept);
    document.addEventListener('click', handleLinkClick, true); // Capture phase to intercept all link clicks
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Push initial state so we can intercept back button
    if (typeof window !== 'undefined') {
      history.pushState({ slidecastStudio: true }, '');
    }
  });
  
  // Intercept browser back/forward buttons
  function handlePopState(e) {
    if (hasUnsavedChanges) {
      // Push state back to prevent navigation, then show modal
      history.pushState({ slidecastStudio: true }, '');
      pendingNavigation = 'back';
      showUnsavedChangesModal = true;
    } else {
      // No unsaved changes, allow normal back navigation
      history.back();
    }
  }
  
  // Only for tab close - shows Chrome's native dialog
  function handleBeforeUnload(e) {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes.';
      return e.returnValue;
    }
  }
  
  // Intercept browser refresh shortcuts (Cmd+R, Ctrl+R, F5) to show our modal
  function handleRefreshIntercept(e) {
    // F5 or Cmd/Ctrl+R
    const isRefresh = e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'r');
    if (isRefresh && hasUnsavedChanges) {
      e.preventDefault();
      pendingNavigation = 'reload';
      showUnsavedChangesModal = true;
    }
  }
  
  // Intercept all link clicks to check for unsaved changes
  function handleLinkClick(e) {
    // Find if click was on or inside an <a> tag
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.getAttribute('href');
    // Skip if no href, javascript:, or # links
    if (!href || href.startsWith('javascript:') || href === '#') return;
    
    // Skip if it's the same page
    if (href === window.location.pathname + window.location.search) return;
    
    // If we have unsaved changes, show our modal instead of navigating
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.stopPropagation();
      pendingNavigation = href;
      showUnsavedChangesModal = true;
    }
  }

  onDestroy(() => {
    // Remove dynamically loaded styles
    if (studioStyleElement && studioStyleElement.parentNode) {
      studioStyleElement.parentNode.removeChild(studioStyleElement);
    }
    
    document.removeEventListener('paste', handlePaste);
    document.removeEventListener('keydown', handleKeyboard);
    document.removeEventListener('keydown', handleRefreshIntercept);
    document.removeEventListener('click', handleLinkClick, true);
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('popstate', handlePopState);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    // Cleanup tooltip system
    if (tooltipObserver) {
      tooltipObserver.disconnect();
    }
    document.removeEventListener('mouseover', handleTooltipMouseOver, true);
    document.removeEventListener('mouseout', handleTooltipMouseOut, true);
    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
    }
    clearTimeout(tooltipShowTimeout);
    clearTimeout(tooltipHideTimeout);
    // Clear widget auto-run timer
    if (widgetAutoRunTimer) {
      clearTimeout(widgetAutoRunTimer);
    }
    // Clear property change timer
    if (propertyChangeTimer) {
      clearTimeout(propertyChangeTimer);
    }
  });

  // Data loading
  async function loadCast() {
    if (!castId || castId === 'new') {
      store.cast.set(createNewCast());
      store.initHistory(); // Initialize history for new cast (no unsaved changes yet)
        return;
      }
      
    try {
      const response = await fetch(`/api/extensions/slidecast/casts/${castId}?skipRefresh=true`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        const migratedCast = migrateCastToGroups(data.cast);
        // Ensure definition structure
        if (!migratedCast.definition) {
          migratedCast.definition = { settings: {}, variables: {}, groups: [] };
        }
        store.cast.set(migratedCast);
        // Set initial group
        const defaultGroup = migratedCast.definition.groups?.find(g => g.isDefault) || migratedCast.definition.groups?.[0];
        store.currentGroupId.set(defaultGroup?.id || 'home');
        store.currentSlideIndex.set(0);
        // Initialize history with loaded state (no unsaved changes yet)
        store.initHistory();
      } else {
        error = 'Cast not found';
      }
    } catch (err) {
      error = err.message;
    }
  }

  function createNewCast() {
    const bgId = actions.generateId();
    return {
      name: 'Untitled Cast',
      definition: {
        settings: {
          resolution: { width: 1920, height: 1080 },
          transition: { type: 'fade', duration: 1000 },
          backgroundColor: '#1a1a2e'
        },
        variables: {},
        groups: [{
          id: 'home',
          name: 'Home',
          isDefault: true,
          loop: true,
          defaultDuration: 10000,
          slides: [{
            id: actions.generateId(),
            name: 'Slide',
            duration: 10000,
            backgroundColor: '#1a1a2e',
            elements: [
              {
                id: bgId,
                type: 'background',
                name: 'Background',
                locked: true,
                position: { x: 0, y: 0 },
                size: { width: 1920, height: 1080 },
                zIndex: 0,
                style: { backgroundColor: '#1a1a2e' }
              }
            ]
          }]
        }]
      }
    };
  }
  
  // Migrate legacy casts to groups structure
  function migrateCastToGroups(castData) {
    if (!castData?.definition) return castData;
    
    // Already has groups
    if (castData.definition.groups) return castData;
    
    // Has legacy slides array - wrap in Home group
    if (castData.definition.slides) {
      castData.definition = {
        settings: {
          resolution: castData.definition.settings?.resolution || { width: 1920, height: 1080 },
          transition: castData.definition.settings?.transition || { type: 'fade', duration: 500 },
          backgroundColor: castData.definition.settings?.backgroundColor || '#000000'
        },
        variables: castData.definition.variables || {},
        groups: [{
          id: 'home',
          name: 'Home',
          isDefault: true,
          loop: castData.definition.settings?.loop !== false,
          defaultDuration: castData.definition.settings?.defaultDuration || 10000,
          slides: castData.definition.slides
        }]
      };
    }
    
    return castData;
  }

  async function loadWidgets() {
    debugLog('widget', 'loadAll.start', {});
    try {
      const [widgetsRes, categoriesRes] = await Promise.all([
        fetch('/api/extensions/slidecast/widgets?published=true'),
        fetch('/api/extensions/slidecast/widgets/meta/categories')
      ]);
      const widgetsData = await widgetsRes.json();
      const categoriesData = await categoriesRes.json();
      availableWidgets = widgetsData.widgets || [];
      widgetCategories = categoriesData.categories || [];
      debugLog('widget', 'loadAll.success', {
        widgetCount: availableWidgets.length,
        categoryCount: widgetCategories.length,
        widgets: availableWidgets.map(w => ({ name: w.name, uuid: w.uuid, renderMode: w.render_mode }))
      });
    } catch (err) {
      console.error('Failed to load widgets:', err);
      debugLog('widget', 'loadAll.error', { error: err.message });
    }
  }

  // studioElements contributions (spec §6 / D9, Wave 5 Slice 5.4) — every
  // extension's declarative studio-placeable elements, generic across
  // extensions (mirrors loadWidgets above, one level up: the widget CATALOG
  // vs. the studio TOOLBAR entries + custom config panels layered on top).
  async function loadStudioElements() {
    try {
      const res = await fetch('/api/extensions/contributions/studioElements');
      const data = await res.json();
      studioElementContributions = data.contributions || [];
    } catch (err) {
      console.error('Failed to load studioElements contributions:', err);
      studioElementContributions = [];
    }
  }

  // Run a widget to execute its code and render on canvas
  let runningWidgetId = null;
  let widgetAutoRunTimer = null;
  
  // Track widgets that have been loading for > 500ms (show spinner below widget)
  
  // Debounced auto-run when widget properties change
  function scheduleWidgetAutoRun(element) {
    if (!element || element.type !== 'widget') return;
    
    // Clear any pending auto-run
    if (widgetAutoRunTimer) {
      clearTimeout(widgetAutoRunTimer);
    }
    
    // Schedule a new run after 300ms of no changes
    widgetAutoRunTimer = setTimeout(() => {
      runWidget(element);
    }, 300);
  }
  
  
  // Run all widgets on the current slide (called on cast load)
  async function runAllWidgetsOnSlide() {
    const slide = getCurrentSlide();
    if (!slide?.elements) return;
    
    const widgetElements = slide.elements.filter(el => el.type === 'widget' && el.widgetUuid);
    
    debugLog('widget', 'renderAll.start', {
      slideIndex: currentSlideIndex,
      widgetCount: widgetElements.length,
      widgets: widgetElements.map(w => ({ id: w.id, name: w.widgetName, uuid: w.widgetUuid }))
    });
    
    // Run all widgets in parallel
    await Promise.all(widgetElements.map(el => runWidget(el)));
    
    debugLog('widget', 'renderAll.complete', { widgetCount: widgetElements.length });
  }
  
  // Process pending widget renders queue (auto-render newly added widgets)
  $: if ($pendingWidgetRendersStore.length > 0) {
    processPendingWidgetRenders();
  }
  
  async function processPendingWidgetRenders() {
    const pendingIds = [...$pendingWidgetRendersStore];
    // Clear the queue immediately to avoid re-processing
    store.pendingWidgetRenders.set([]);
    
    debugLog('widget', 'autoRender.start', { count: pendingIds.length, elementIds: pendingIds });
    
    const slide = getCurrentSlide();
    if (!slide?.elements) return;
    
    for (const elementId of pendingIds) {
      const element = slide.elements.find(el => el.id === elementId);
      if (element && element.type === 'widget' && element.widgetUuid) {
        await runWidget(element);
      }
    }
    
    debugLog('widget', 'autoRender.complete', { count: pendingIds.length });
  }
  
  async function runWidget(element) {
    if (!element || element.type !== 'widget' || !element.widgetUuid) return;
    
    debugLog('widget', 'render.start', {
      elementId: element.id,
      widgetUuid: element.widgetUuid,
      widgetName: element.widgetName,
      config: element.widgetConfig,
      styles: element.widgetStyles,
      size: element.size
    });
    
    runningWidgetId = element.id;
    element._widgetLoading = true;
    element._widgetError = null;
    store.cast.update(c => ({ ...c })); // Trigger reactivity
    
    // Clear any existing timer for this widget
    if (widgetLoadingTimers[element.id]) {
      clearTimeout(widgetLoadingTimers[element.id]);
    }
    
    // Set timer to show spinner below widget after 500ms
    widgetLoadingTimers[element.id] = setTimeout(() => {
      slowLoadingWidgets.add(element.id);
      slowLoadingWidgets = new Set(slowLoadingWidgets); // Trigger reactivity
      debugLog('widget', 'render.slow', { elementId: element.id, widgetName: element.widgetName });
    }, 500);
    
    const startTime = performance.now();
    
    try {
      // Determine if we should force image mode
      // For hybrid widgets, respect user's choice; otherwise use widget's default
      const userWantsImage = element._widgetRenderMode === 'image';
      
      const response = await fetch(`/api/extensions/slidecast/protocol/widget/${element.widgetUuid}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          // Fall back to element.config/styles — seed-created widget elements
          // store config under `config`, not `widgetConfig` (matches the
          // backend fallback in SlideImageRenderer.js — #1655: Studio canvas
          // showed "Your text here" placeholder for seeded text-block widgets
          // because an empty config was sent to /widget/:uuid/render).
          config: element.widgetConfig || element.config || {},
          styles: element.widgetStyles || element.styles || {},
          size: element.size,
          forceImage: userWantsImage  // Tell server to render as image
        })
      });
      const result = await response.json();
      const duration = Math.round(performance.now() - startTime);
      
      if (result.success) {
        // For hybrid widgets, preserve user's render mode choice ONLY if it's a valid choice
        // Valid choices are 'native' or 'image' - 'hybrid' is NOT a valid render mode for the renderer
        // If _widgetRenderMode is 'hybrid' or undefined, use the server's effective render mode
        const hasValidUserChoice = element._widgetRenderMode === 'native' || element._widgetRenderMode === 'image';
        if (result.originalRenderMode === 'hybrid' && hasValidUserChoice) {
          // Keep user's valid choice for hybrid widgets
        } else {
          element._widgetRenderMode = result.renderMode;
        }
        element._widgetPrimitives = result.primitives;
        element._widgetImageUrl = result.imageUrl;
        element._widgetError = null;
        
        debugLog('widget', 'render.success', {
          elementId: element.id,
          widgetName: element.widgetName,
          renderMode: element._widgetRenderMode,
          primitivesCount: result.primitives?.length || 0,
          hasImage: !!result.imageUrl,
          duration: `${duration}ms`
        });
      } else {
        element._widgetError = result.error || 'Widget execution failed';
        debugLog('widget', 'render.error', {
          elementId: element.id,
          widgetName: element.widgetName,
          error: result.error,
          duration: `${duration}ms`
        });
      }
    } catch (err) {
      element._widgetError = `Network error: ${err.message}`;
      debugLog('widget', 'render.networkError', {
        elementId: element.id,
        widgetName: element.widgetName,
        error: err.message
      });
    } finally {
      // Clear the slow loading timer and state
      if (widgetLoadingTimers[element.id]) {
        clearTimeout(widgetLoadingTimers[element.id]);
        delete widgetLoadingTimers[element.id];
      }
      slowLoadingWidgets.delete(element.id);
      slowLoadingWidgets = new Set(slowLoadingWidgets); // Trigger reactivity
      
      element._widgetLoading = false;
      runningWidgetId = null;
      
      // CRITICAL: Force Svelte reactivity by creating new object references
      // Svelte doesn't detect deep property mutations, so we need to replace
      // the element in the slide's elements array with a new object reference
      // Force Svelte reactivity by creating new object references
      // Svelte doesn't detect deep property mutations, so we need to replace
      // the element in the slide's elements array with a new object reference
      const slide = getCurrentSlide();
      if (slide?.elements) {
        const elementIndex = slide.elements.findIndex(el => el.id === element.id);
        if (elementIndex !== -1) {
          // Replace with spread to create new reference, triggering Svelte reactivity
          slide.elements[elementIndex] = { ...element };
          // Also create new elements array reference
          slide.elements = [...slide.elements];
        }
      }
      
      store.cast.update(c => ({ ...c })); // Trigger reactivity
    }
  }

  async function loadMedia() {
    try {
      const response = await fetch('/api/extensions/slidecast/media', {
        credentials: 'same-origin'
      });
      const data = await response.json();
      mediaLibrary = data.media || [];
    } catch (err) {
      console.error('Failed to load media:', err);
    }
  }

  async function loadScreens() {
    try {
      const response = await fetch('/api/extensions/slidecast/screens', {
        credentials: 'same-origin'
      });
      const data = await response.json();
      onlineScreens = (data.screens || []).filter(s => s.status === 'online');
    } catch (err) {
      console.error('Failed to load screens:', err);
    }
  }

  // Helpers - generateId is now in studioActions.js

  // Get current group object
  function getCurrentGroup() {
    return cast?.definition?.groups?.find(g => g.id === currentGroupId);
  }
  
  // Get slides for current group
  function getCurrentSlides() {
    return getCurrentGroup()?.slides || [];
  }

  function getCurrentSlide() {
    return getCurrentSlides()[currentSlideIndex];
  }

  function getSelectedElement() {
    if (!selectedElementId) return null;
    const slide = getCurrentSlide();
    return slide?.elements?.find(el => el.id === selectedElementId);
  }

  // Update background color for a specific slide (both slide property and background element)
  function updateSlideBackgroundColor(slide, color) {
    if (!slide) return;
    // Update slide's backgroundColor property (used by SlideRenderer's main background)
    slide.backgroundColor = color;
    // Also update the background element if it exists
    if (slide.elements) {
      const bgElement = slide.elements.find(el => el.type === 'background');
      if (bgElement && bgElement.style) {
        bgElement.style.backgroundColor = color;
      }
    }
  }

  // Update background for all slides using default in a group
  // Only updates slides that don't have a custom backgroundColor override
  function updateGroupDefaultBackgrounds(group, defaultColor) {
    if (!group?.slides) return;
    for (const slide of group.slides) {
      // Only update slides that are using the default (no custom backgroundColor set)
      if (!slide._hasCustomBackground) {
        updateSlideBackgroundColor(slide, defaultColor);
      }
    }
  }
  
  // Update a slide's background element only (without setting the slide's backgroundColor)
  function updateSlideBackgroundElement(slide, color) {
    if (!slide?.elements) return;
    const bgElement = slide.elements.find(el => el.type === 'background');
    if (bgElement && bgElement.style) {
      bgElement.style.backgroundColor = color;
    }
  }

  // Get effective background color for a slide (slide override or group default)
  function getEffectiveBackgroundColor(slide, group) {
    return slide?.backgroundColor || group?.defaultBackgroundColor || '#1a1a2e';
  }

  // Reactive statements - using store's derived stores
  $: currentGroup = $currentGroupStore;
  $: currentSlides = $currentSlidesStore;
  $: currentSlide = $currentSlideStore;
  $: selectedElement = $selectedElementStore;

  // Track previous slide to detect changes
  let previousSlideId = null;
  
  // Refresh widgets when switching slides
  $: if (currentSlide && currentSlide.id !== previousSlideId) {
    const oldSlideId = previousSlideId;
    previousSlideId = currentSlide.id;
    
    debugLog('slide', 'change.detected', {
      from: oldSlideId,
      to: currentSlide.id,
      slideName: currentSlide.name
    });
    
    // Run all widgets on the new slide (with a small delay to ensure DOM is ready)
    setTimeout(async () => {
      debugLog('widget', 'slideChange.refresh.start', {
        slideId: currentSlide.id,
        slideName: currentSlide.name
      });
      await runAllWidgetsOnSlide();
      debugLog('widget', 'slideChange.refresh.complete', {
        slideId: currentSlide.id
      });
    }, 100);
  }

  // Ensure widget defaults are filled in when selecting a widget element
  $: if (selectedElement?.type === 'widget' && availableWidgets.length > 0) {
    ensureWidgetDefaults(selectedElement);
  }

  // Fill in missing widget config/style defaults from the widget schema
  function ensureWidgetDefaults(element) {
    if (!element || element.type !== 'widget') return;
    
    const widget = availableWidgets.find(w => w.uuid === element.widgetUuid);
    if (!widget) return;
    
    let needsUpdate = false;
    
    // Ensure widgetConfig exists
    if (!element.widgetConfig) {
      element.widgetConfig = {};
      needsUpdate = true;
    }
    
    // Fill in missing config defaults
    if (widget.configSchema) {
      for (const [key, schema] of Object.entries(widget.configSchema)) {
        if (element.widgetConfig[key] === undefined && schema.default !== undefined) {
          element.widgetConfig[key] = schema.default;
          needsUpdate = true;
        }
      }
    }
    
    // Ensure widgetStyles exists
    if (!element.widgetStyles) {
      element.widgetStyles = {};
      needsUpdate = true;
    }
    
    // Fill in missing style defaults
    if (widget.styleSchema) {
      for (const [key, schema] of Object.entries(widget.styleSchema)) {
        if (element.widgetStyles[key] === undefined && schema.default !== undefined) {
          element.widgetStyles[key] = schema.default;
          needsUpdate = true;
        }
      }
    }
    
    // Sync size with config width/height if present
    if (element.widgetConfig.width && element.size.width !== element.widgetConfig.width) {
      element.size.width = element.widgetConfig.width;
      needsUpdate = true;
    }
    if (element.widgetConfig.height && element.size.height !== element.widgetConfig.height) {
      element.size.height = element.widgetConfig.height;
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      store.cast.update(c => ({ ...c })); // Trigger reactivity
    }
  }

  // Auto-sync ALL scoped nav changes when editing
  $: if (selectedElement?.type === 'nav' && selectedElement.scope !== 'slide' && !selectedElement._isInheritedCopy) {
    // Create a hash of ALL nav properties to detect any changes
    const navHash = JSON.stringify({
      position: selectedElement.position,
      size: selectedElement.size,
      style: selectedElement.style,
      items: selectedElement.items,
      layout: selectedElement.layout,
      name: selectedElement.name
    });
    if (navHash !== lastNavSyncHash) {
      lastNavSyncHash = navHash;
      // Defer sync to avoid infinite loops
      setTimeout(() => syncNavChanges(selectedElement), 0);
    }
  }

  
  // Canvas event handlers (wrappers for canvas module)
  function handleCanvasWheel(e) {
    canvas.handleCanvasWheel(e, canvasContainer);
  }
  
  function handleCanvasMouseDown(e) {
    canvas.handleCanvasMouseDown(e);
  }
  
  function handleCanvasPanMove(e) {
    canvas.handleCanvasPanMove(e);
  }
  
  function handleCanvasPanEnd(e) {
    canvas.handleCanvasPanEnd(e);
  }

  function handleResize() {
    canvas.handleResize(canvasContainer);
  }
  
  // Menu bar functions (wrappers that pass context to menu module)
  function toggleMenu(menuKey) {
    menu.toggleMenu(menuKey);
  }
  
  function closeMenu() {
    menu.closeMenu();
  }
  
  function handleMenuAction(action) {
    menu.handleMenuAction(action, {
      goto,
      hasUnsavedChanges,
      showUnsavedChangesModal,
      pendingNavigation: store.pendingNavigation,
      saveCast,
      exportCast,
      getSelectedElement: () => get(store.selectedElement),
      getCurrentSlide,
      setSelectedElementId: (id) => store.selectedElementId.set(id),
      deleteSelectedElement,
      duplicateSelectedElement,
      pasteElement,
      clipboardElement: get(store.clipboardElement),
      elementClipboardOperation,
      cutElementSourceGroupId,
      cutElementSourceSlideIndex,
      cutElementSourceId,
      setClipboardElement: (el) => store.clipboardElement.set(el),
      setElementClipboardOperation: (op) => { elementClipboardOperation = op; },
      setCutElementSource: (src) => {
        if (src) {
          cutElementSourceGroupId = src.groupId;
          cutElementSourceSlideIndex = src.slideIndex;
          cutElementSourceId = src.elementId;
        } else {
          cutElementSourceGroupId = null;
          cutElementSourceSlideIndex = null;
          cutElementSourceId = null;
        }
      },
      bringToFront,
      bringForward,
      sendBackward,
      sendToBack,
      alignElement,
      showSlidesPanel: get(store.showSlidesPanel),
      setShowSlidesPanel: (val) => store.showSlidesPanel.set(val),
      slidesPanelCollapsed: get(store.slidesPanelCollapsed),
      setSlidesPanelCollapsed: (val) => store.slidesPanelCollapsed.set(val),
      showLayersPanel: get(store.showLayersPanel),
      setShowLayersPanel: (val) => store.showLayersPanel.set(val),
      showPropertiesPanel: get(store.showPropertiesPanel),
      setShowPropertiesPanel: (val) => store.showPropertiesPanel.set(val),
      showHistoryPanel: get(store.showHistoryPanel),
      setShowHistoryPanel: (val) => store.showHistoryPanel.set(val),
      showSaveAsTemplateModal: get(store.modals).saveAsTemplate,
      setShowSaveAsTemplateModal: (val) => store.openModal('saveAsTemplate', val),
      showCanvasSizeModal: get(store.modals).canvasSize,
      setShowCanvasSizeModal: (val) => store.openModal('canvasSize', val),
      showGroupSettingsModal: get(store.modals).groupSettings,
      setShowGroupSettingsModal: (val) => store.openModal('groupSettings', val),
      showSlideSettingsModal: get(store.modals).slideSettings,
      setShowSlideSettingsModal: (val) => store.openModal('slideSettings', val),
      showKeyboardShortcutsModal: get(store.modals).keyboardShortcuts,
      setShowKeyboardShortcutsModal: (val) => store.openModal('keyboardShortcuts', val),
      canvasContainer,
      currentGroupId: get(store.currentGroupId),
      currentSlideIndex: get(store.currentSlideIndex),
      setEditingSlideIndex: (idx) => { editingSlideIndex = idx; },
      setShowUnsavedChangesModal: (val) => store.openModal('unsavedChanges', val)
    });
  }
  
  // Layer ordering functions
  function bringToFront() {
    if (!selectedElement || selectedElement.locked) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    if (index === -1 || index === slide.elements.length - 1) return;
    
    const element = slide.elements.splice(index, 1)[0];
    slide.elements.push(element);
    store.cast.update(c => ({ ...c }));
    const name = selectedElement.name || selectedElement.type;
    store.pushHistory(`Bring "${name}" to front`);
  }
  
  function bringForward() {
    if (!selectedElement || selectedElement.locked) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    if (index === -1 || index === slide.elements.length - 1) return;
    
    const element = slide.elements[index];
    slide.elements[index] = slide.elements[index + 1];
    slide.elements[index + 1] = element;
    store.cast.update(c => ({ ...c }));
    const name = selectedElement.name || selectedElement.type;
    store.pushHistory(`Bring "${name}" forward`);
  }
  
  function sendBackward() {
    if (!selectedElement || selectedElement.locked) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    // Don't allow moving below the background (index 0)
    if (index <= 1) return;
    
    const element = slide.elements[index];
    slide.elements[index] = slide.elements[index - 1];
    slide.elements[index - 1] = element;
    store.cast.update(c => ({ ...c }));
    const name = selectedElement.name || selectedElement.type;
    store.pushHistory(`Send "${name}" backward`);
  }
  
  function sendToBack() {
    if (!selectedElement || selectedElement.locked) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    // Don't allow moving below the background (index 0)
    if (index <= 1) return;
    
    const element = slide.elements.splice(index, 1)[0];
    slide.elements.splice(1, 0, element); // Insert after background
    store.cast.update(c => ({ ...c }));
    const name = selectedElement.name || selectedElement.type;
    store.pushHistory(`Send "${name}" to back`);
  }
  
  // Alignment functions
  function alignElement(alignment) {
    if (!selectedElement || selectedElement.locked) return;
    const name = selectedElement.name || selectedElement.type;
    
    const canvasWidth = 1920;
    const canvasHeight = 1080;
    
    switch (alignment) {
      case 'left':
        selectedElement.position.x = 0;
        break;
      case 'center':
        selectedElement.position.x = (canvasWidth - selectedElement.size.width) / 2;
        break;
      case 'right':
        selectedElement.position.x = canvasWidth - selectedElement.size.width;
        break;
      case 'top':
        selectedElement.position.y = 0;
        break;
      case 'middle':
        selectedElement.position.y = (canvasHeight - selectedElement.size.height) / 2;
        break;
      case 'bottom':
        selectedElement.position.y = canvasHeight - selectedElement.size.height;
        break;
    }
    
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`Align "${name}" ${alignment}`);
    // Auto-run widget after alignment
    scheduleWidgetAutoRun(selectedElement);
  }
  
  // Export cast as JSON
  function exportCast() {
    const dataStr = JSON.stringify(cast, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cast.name || 'cast'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  // Close menu on click outside
  function handleClickOutside(e) {
    if (openMenu && !e.target.closest('.menu-bar')) {
      closeMenu();
    }
  }
  
  
  // Scroll wheel on number inputs
  function handleNumberInputWheel(e, getValue, setValue, min = -Infinity, max = Infinity, step = 1) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -step : step;
    const newValue = Math.max(min, Math.min(max, getValue() + delta));
    setValue(newValue);
    store.cast.update(c => ({ ...c }));
  }

  // Element clipboard (cut/copy/paste)
  // (clipboardElement, elementClipboardOperation, cutElementSource* declared above in local state section)

  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        await uploadAndAddImage(blob);
        break;
      }
    }
  }

  // Keyboard shortcuts
  function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    // Close menu on Escape
    if (e.key === 'Escape') {
      if (openMenu) {
        closeMenu();
        debugLog('shortcut', 'escape', { action: 'closeMenu' });
        return;
      }
      store.selectedElementId.set(null);
      debugLog('shortcut', 'escape', { action: 'deselect' });
    }
    
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      debugLog('shortcut', 'delete', { elementId: selectedElement.id, type: selectedElement.type });
      deleteSelectedElement();
    }
    
    // Cut: Ctrl+X (only allowed on unlocked elements)
    if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      clipboardElement = JSON.parse(JSON.stringify(selectedElement));
      elementClipboardOperation = 'cut';
      cutElementSourceGroupId = currentGroupId;
      cutElementSourceSlideIndex = currentSlideIndex;
      cutElementSourceId = selectedElement.id;
    }
    
    // Copy: Ctrl+C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedElement) {
      e.preventDefault();
      clipboardElement = JSON.parse(JSON.stringify(selectedElement));
      elementClipboardOperation = 'copy';
      cutElementSourceGroupId = null;
      cutElementSourceSlideIndex = null;
      cutElementSourceId = null;
    }
    
    // Paste: Ctrl+V
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardElement && !e.clipboardData?.items) {
        e.preventDefault();
      pasteElement();
    }
    
    // Duplicate: Ctrl+D (only allowed on unlocked elements)
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      duplicateSelectedElement();
    }
    
    // Save: Ctrl+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCast();
    }
    
    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    }
    
    // Redo: Ctrl+Y or Ctrl+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
      e.preventDefault();
      store.redo();
    }
    
    // Zoom: Ctrl+Plus/Minus/0
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      canvas.zoomIn();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      canvas.zoomOut();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      canvas.zoomFit(canvasContainer);
    }
    
    // Tool shortcuts (no modifier needed)
    if (e.key === 'v' || e.key === 'V') {
      if (!e.ctrlKey && !e.metaKey) {
        store.activeTool.set('pointer');
      }
    }
    if (e.key === 'h' || e.key === 'H') {
      store.activeTool.set('hand');
    }
    if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      store.selectedElementId.set(null);
      debugLog('shortcut', 'deselect', { action: 'deselect' });
    }

    // Layer ordering: Ctrl+]/[ and Ctrl+Shift+]/[ (only allowed on unlocked elements)
    if ((e.ctrlKey || e.metaKey) && e.key === ']' && !e.shiftKey && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      bringForward();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ']' && e.shiftKey && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      bringToFront();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '[' && !e.shiftKey && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      sendBackward();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '[' && e.shiftKey && selectedElement && !selectedElement.locked) {
      e.preventDefault();
      sendToBack();
    }
    
    // Keyboard shortcuts help: Ctrl+?
    if ((e.ctrlKey || e.metaKey) && e.key === '?') {
      e.preventDefault();
      showKeyboardShortcutsModal = true;
    }
    
    // Arrow keys to move element (only allowed on unlocked elements)
    if (selectedElement && !selectedElement.locked && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const slide = getCurrentSlide();
      const el = slide.elements.find(el => el.id === selectedElementId);
      if (el) {
        if (e.key === 'ArrowUp') el.position.y -= step;
        if (e.key === 'ArrowDown') el.position.y += step;
        if (e.key === 'ArrowLeft') el.position.x -= step;
        if (e.key === 'ArrowRight') el.position.x += step;
        store.cast.update(c => ({ ...c })); // Trigger reactivity
        
        // Sync to linked navs
        if (el.type === 'nav' && el.scope !== 'slide' && !el._isInheritedCopy) {
          syncNavChanges(el);
        }
      }
    }
  }

  function pasteElement() {
    const slide = getCurrentSlide();
    if (!slide || !clipboardElement) return;
    
    const newElement = JSON.parse(JSON.stringify(clipboardElement));
    newElement.id = actions.generateId();
    newElement.position.x += 20;
    newElement.position.y += 20;
    newElement.zIndex = slide.elements.length;
    slide.elements.push(newElement);
    store.selectedElementId.set(newElement.id);
    
    // If this was a cut operation, delete the original element silently (no modal)
    if (elementClipboardOperation === 'cut' && cutElementSourceGroupId && cutElementSourceSlideIndex !== null && cutElementSourceId) {
      deleteElementSilently(cutElementSourceGroupId, cutElementSourceSlideIndex, cutElementSourceId);
      // Clear the cut state - element can only be pasted once from a cut
      elementClipboardOperation = 'copy'; // Convert to copy so subsequent pastes don't re-delete
      cutElementSourceGroupId = null;
      cutElementSourceSlideIndex = null;
      cutElementSourceId = null;
    }
    
    store.cast.update(c => ({ ...c }));
    const name = newElement.name || newElement.type;
    store.pushHistory(`Paste "${name}"`);
  }
  
  // Delete an element without showing confirmation modal (used for cut/paste)
  function deleteElementSilently(groupId, slideIndex, elementId) {
    const group = cast?.definition?.groups?.find(g => g.id === groupId);
    if (!group?.slides?.[slideIndex]) return;
    
    const slide = group.slides[slideIndex];
    const index = slide.elements.findIndex(el => el.id === elementId);
    if (index !== -1) {
      slide.elements.splice(index, 1);
      // If the deleted element was selected, clear selection
      if (selectedElementId === elementId) {
        store.selectedElementId.set(null);
      }
    }
  }


  // Wrapper functions for selected element operations
  function deleteSelectedElement() {
    const selectedElementId = get(store.selectedElementId);
    if (!selectedElementId) return;
    const selectedElement = get(store.selectedElement);
    // Don't allow deleting locked elements
    if (selectedElement?.locked) return;
    actions.deleteElement(selectedElementId);
  }

  function duplicateSelectedElement() {
    const selectedElement = get(store.selectedElement);
    if (!selectedElement) return;
    // Don't allow duplicating locked elements
    if (selectedElement.locked) return;
    actions.duplicateElement(selectedElement);
  }
  
  function toggleElementLock(element) {
    if (!element || element.type === 'background') return;
    
    const slide = getCurrentSlide();
    if (!slide) return;
    
    const el = slide.elements.find(e => e.id === element.id);
    if (!el) return;
    
    // Toggle the locked state
    el.locked = !el.locked;
    
    const name = el.name || el.type;
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`${el.locked ? 'Lock' : 'Unlock'} "${name}"`);
    
    debugLog('element', el.locked ? 'lock' : 'unlock', { elementId: el.id, type: el.type });
  }
  
  // PropertiesPanel event handlers
  function handlePropertyChange(e) {
    const { property } = e.detail || {};
    store.triggerCastUpdate();
    if (property) {
      trackPropertyChange(`Change ${property}`);
    }
  }
  
  function handlePropertyUpdate() {
    store.triggerCastUpdate();
  }
  
  function handlePropertyHistory(e) {
    store.pushHistory(e.detail);
  }
  
  function handleOpenConfig(e) {
    const { type, element } = e.detail;
    switch (type) {
      case 'widget':
        configWindows.openWidgetConfig(element, runWidget);
        break;
      case 'text':
        configWindows.openTextConfig(element);
        break;
      case 'nav':
        configWindows.openNavConfig(element);
        break;
      case 'qr':
      case 'qrcode':
        configWindows.openQRConfig(element);
        break;
    }
  }

  // Media handling
  async function uploadAndAddImage(blob) {
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const response = await fetch('/api/extensions/slidecast/media/base64', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: `Pasted Image ${new Date().toLocaleTimeString()}`,
            data: base64,
            mime_type: blob.type
          })
        });
        
        const data = await response.json();
        if (data.success) {
          actions.addElement('image', { asset_id: data.media.uuid });
          await loadMedia();
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Failed to upload pasted image:', err);
    }
  }

  async function handleMediaDrop(e) {
    isDraggingMedia = false;
    const files = e.dataTransfer?.files;
    if (files?.length > 0) {
      await uploadMediaFile(files[0]);
    }
  }

  async function handleMediaFileSelect(e) {
    const files = e.target.files;
    if (files?.length > 0) {
      await uploadMediaFile(files[0]);
    }
    if (mediaFileInput) mediaFileInput.value = '';
  }

  // Handle multiple files from MediaModal upload event
  async function handleMediaUpload(files) {
    if (!files?.length) return;
    for (const file of files) {
      await uploadMediaFile(file);
    }
  }
  
  // Refresh widget data (trigger re-render by running the widget)
  function refreshWidget(widget) {
    if (!widget) return;
    // Actually run the widget to fetch fresh data
    runWidget(widget);
  }

  async function uploadMediaFile(file) {
    if (!file) return;
    uploadingMedia = true;
    
    try {
      console.log('Uploading file:', file.name, file.size, file.type);
      
      // Use proper multipart form upload
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/extensions/slidecast/media/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
        // Don't set Content-Type - browser sets it automatically with boundary
      });
      
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);
      
      if (data.success) {
        await loadMedia();
        selectMedia(data.media);
      } else {
        console.error('Upload failed:', data.error);
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to upload media:', err);
      alert('Upload failed: ' + err.message);
    } finally {
      uploadingMedia = false;
    }
  }

  function selectMedia(media) {
    if (media.type === 'video') {
      actions.addElement('video', { asset_id: media.uuid });
    } else {
      actions.addElement('image', { asset_id: media.uuid });
    }
    showMediaModal = false;
  }
  
  async function importFromUrl() {
    if (!importUrl) return;
    importingUrl = true;
    try {
      const response = await fetch('/api/extensions/slidecast/media/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url: importUrl })
      });
      const result = await response.json();
      if (result.success) {
        mediaLibrary = [...mediaLibrary, result.media];
        selectMedia(result.media);
        importUrl = '';
      } else {
        alert('Failed to import: ' + result.error);
      }
    } catch (error) {
      alert('Import failed: ' + error.message);
    } finally {
      store.importingUrl.set(false);
    }
  }
  
  // Get all cast-level navs (scope === 'cast')
  function getCastLevelNavs() {
    const cast = getCast();
    if (!cast?.definition?.groups) return [];
    const navs = [];
    for (const group of cast.definition.groups) {
      for (const slide of group.slides || []) {
        for (const element of slide.elements || []) {
          if (element.type === 'nav' && element.scope === 'cast') {
            // Only include if not already in the list (by original ID)
            if (!navs.find(n => n.id === element.id)) {
              navs.push(element);
            }
          }
        }
      }
    }
    return navs;
  }
  
  // Get all group-level navs for a specific group
  function getGroupLevelNavs(groupId) {
    const cast = getCast();
    const group = cast?.definition?.groups?.find(g => g.id === groupId);
    if (!group) return [];
    const navs = [];
    for (const slide of group.slides || []) {
      for (const element of slide.elements || []) {
        if (element.type === 'nav' && element.scope === 'group' && element.sourceGroupId === groupId) {
          if (!navs.find(n => n.id === element.id)) {
            navs.push(element);
          }
        }
      }
    }
    return navs;
  }
  
  // Get inherited navs for current slide (cast-level + group-level)
  function getInheritedNavs() {
    const castNavs = getCastLevelNavs();
    const groupNavs = getGroupLevelNavs(currentGroupId);
    return [...castNavs, ...groupNavs];
  }
  
  // Check if a nav element is inherited (not originally from this slide)
  function isNavInherited(element, slide) {
    if (element.type !== 'nav') return false;
    if (element.scope === 'slide') return false;
    // Check if this is the original source
    if (element._isInheritedCopy) return true;
    return false;
  }
  
  // Create an inherited copy of a nav for a new slide
  function createInheritedNavCopy(sourceNav, newSlideId) {
    return {
      ...JSON.parse(JSON.stringify(sourceNav)),
      _isInheritedCopy: true,
      _sourceNavId: sourceNav.id,
      // Keep same ID so it's treated as same nav across slides
      // But mark it so we know it's inherited
    };
  }
  
  // When nav scope changes, propagate to all relevant slides
  function propagateNavToScope(nav, newScope, oldScope, oldGroupId = null) {
    if (!cast?.definition?.groups) return;
    
    const sourceSlide = currentSlide;
    const sourceGroup = getCurrentGroup();
    const targetGroupId = nav.sourceGroupId || currentGroupId;
    const targetGroup = cast.definition.groups.find(g => g.id === targetGroupId);
    
    if (newScope === 'cast') {
      // Add nav to all slides in all groups
      for (const group of cast.definition.groups) {
        for (const slide of group.slides || []) {
          if (slide.id === sourceSlide.id) continue; // Skip source
          // Check if nav already exists
          const existing = slide.elements?.find(e => e.id === nav.id || e._sourceNavId === nav.id);
          if (!existing) {
            const copy = createInheritedNavCopy(nav, slide.id);
            slide.elements = slide.elements || [];
            slide.elements.push(copy);
          }
        }
      }
    } else if (newScope === 'group') {
      // If group changed, remove from old group first
      if (oldGroupId && oldGroupId !== targetGroupId) {
        const oldGroup = cast.definition.groups.find(g => g.id === oldGroupId);
        if (oldGroup) {
          for (const slide of oldGroup.slides || []) {
            slide.elements = (slide.elements || []).filter(e => 
              e.id !== nav.id && e._sourceNavId !== nav.id
            );
          }
        }
      }
      
      // Add nav to all slides in target group only
      if (targetGroup) {
        for (const slide of targetGroup.slides || []) {
          if (slide.id === sourceSlide.id) continue;
          const existing = slide.elements?.find(e => e.id === nav.id || e._sourceNavId === nav.id);
          if (!existing) {
            const copy = createInheritedNavCopy(nav, slide.id);
            slide.elements = slide.elements || [];
            slide.elements.push(copy);
          }
        }
      }
      
      // Remove from other groups if was cast-level
      if (oldScope === 'cast') {
        for (const group of cast.definition.groups) {
          if (group.id === targetGroupId) continue;
          for (const slide of group.slides || []) {
            slide.elements = (slide.elements || []).filter(e => 
              e.id !== nav.id && e._sourceNavId !== nav.id
            );
          }
        }
      }
    } else if (newScope === 'slide') {
      // Remove from all other slides
      for (const group of cast.definition.groups) {
        for (const slide of group.slides || []) {
          if (slide.id === sourceSlide.id) continue;
          slide.elements = (slide.elements || []).filter(e => 
            e.id !== nav.id && e._sourceNavId !== nav.id
          );
        }
      }
    }
    
    store.cast.update(c => ({ ...c }));
  }
  
  // Sync nav position/style changes to all inherited copies
  function syncNavChanges(nav) {
    if (!cast?.definition?.groups || nav.scope === 'slide') return;
    
    for (const group of cast.definition.groups) {
      if (nav.scope === 'group' && group.id !== nav.sourceGroupId) continue;
      
      for (const slide of group.slides || []) {
        for (const element of slide.elements || []) {
          // Skip the source element itself
          if (element.id === nav.id && !element._isInheritedCopy) continue;
          
          if (element.id === nav.id || element._sourceNavId === nav.id) {
            // Sync ALL properties - position, size, style, layout, items, everything
            element.position = { ...nav.position };
            element.size = { ...nav.size };
            element.style = JSON.parse(JSON.stringify(nav.style));
            element.layout = nav.layout;
            element.items = JSON.parse(JSON.stringify(nav.items));
            element.name = nav.name;
            // Sync scope settings
            element.scope = nav.scope;
            element.sourceGroupId = nav.sourceGroupId;
            element.syncPosition = nav.syncPosition;
            element.syncStyle = nav.syncStyle;
          }
        }
      }
    }
    
    // Trigger reactivity
    store.cast.update(c => ({ ...c }));
  }
  
  // Make a local copy of an inherited nav (detach from source)
  function makeNavLocal(element) {
    element.scope = 'slide';
    element._isInheritedCopy = false;
    element._sourceNavId = null;
    element.id = actions.generateId(); // New unique ID
    store.cast.update(c => ({ ...c }));
  }
  
  // Navigate to source slide of inherited nav
  function goToNavSource(element) {
    if (!element._sourceNavId) return;
    
    // Find the source slide
    for (const group of cast?.definition?.groups || []) {
      for (let slideIndex = 0; slideIndex < (group.slides || []).length; slideIndex++) {
        const slide = group.slides[slideIndex];
        const sourceNav = slide.elements?.find(e => e.id === element._sourceNavId && !e._isInheritedCopy);
        if (sourceNav) {
          store.currentGroupId.set(group.id);
          store.currentSlideIndex.set(slideIndex);
          store.selectedElementId.set(sourceNav.id);
          store.cast.update(c => ({ ...c }));
          return;
        }
      }
    }
  }
  
  function handleSlideDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    store.dragOverSlideIndex.set(index);
  }
  
  function handleSlideDragLeave(e) {
    // Only clear if leaving the slides list area
    if (!e.relatedTarget?.closest('.slides-list')) {
      store.dragOverSlideIndex.set(null);
    }
  }
  
  function handleSlideDrop(e, targetIndex) {
    e.preventDefault();
    if (draggedSlideIndex === null || draggedSlideIndex === targetIndex) {
      store.draggedSlideIndex.set(null);
      store.dragOverSlideIndex.set(null);
      return;
    }
    
    const group = getCurrentGroup();
    if (!group) return;
    
    // Remove slide from original position
    const [movedSlide] = group.slides.splice(draggedSlideIndex, 1);
    const slideName = movedSlide.name || `Slide ${draggedSlideIndex + 1}`;
    
    // Insert at new position (adjust if moving forward)
    const insertIndex = targetIndex > draggedSlideIndex ? targetIndex : targetIndex;
    group.slides.splice(insertIndex, 0, movedSlide);
    
    // Update current slide index if needed
    if (currentSlideIndex === draggedSlideIndex) {
      store.currentSlideIndex.set(insertIndex);
    } else if (currentSlideIndex > draggedSlideIndex && currentSlideIndex <= targetIndex) {
      store.currentSlideIndex.update(n => n - 1);
    } else if (currentSlideIndex < draggedSlideIndex && currentSlideIndex >= targetIndex) {
      store.currentSlideIndex.update(n => n + 1);
    }
    
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`Reorder "${slideName}"`);
    store.draggedSlideIndex.set(null);
    store.dragOverSlideIndex.set(null);
  }
  
  function handleSlideDragEnd(e) {
    e.target.classList.remove('dragging');
    store.draggedSlideIndex.set(null);
    store.dragOverSlideIndex.set(null);
  }
  
  // Layer drag reorder handlers
  function handleLayerDragStart(e, element) {
    if (element.locked || element.type === 'background') {
      e.preventDefault();
      return;
    }
    store.draggedLayerId.set(element.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', element.id);
    e.target.classList.add('dragging');
  }
  
  function handleLayerDragOver(e, element) {
    e.preventDefault();
    if (element.type === 'background' || element.locked) return;
    e.dataTransfer.dropEffect = 'move';
    store.dragOverLayerId.set(element.id);
  }
  
  function handleLayerDragLeave(e) {
    if (!e.relatedTarget?.closest('.layers-list-inline')) {
      store.dragOverLayerId.set(null);
    }
  }
  
  function handleLayerDrop(e, targetElement) {
    e.preventDefault();
    if (!draggedLayerId || draggedLayerId === targetElement.id || targetElement.type === 'background') {
      store.draggedLayerId.set(null);
      store.dragOverLayerId.set(null);
      return;
    }
    
    const slide = getCurrentSlide();
    if (!slide) return;
    
    const elements = slide.elements;
    const draggedIndex = elements.findIndex(el => el.id === draggedLayerId);
    const targetIndex = elements.findIndex(el => el.id === targetElement.id);
    
    if (draggedIndex === -1 || targetIndex === -1) {
      store.draggedLayerId.set(null);
      store.dragOverLayerId.set(null);
      return;
    }
    
    const draggedEl = elements[draggedIndex];
    const layerName = draggedEl.name || draggedEl.type;
    
    // Remove from original position
    elements.splice(draggedIndex, 1);
    
    // Insert at new position
    elements.splice(targetIndex, 0, draggedEl);
    
    // Update zIndex values to match new order
    elements.forEach((el, i) => el.zIndex = i);
    
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`Reorder "${layerName}" layer`);
    store.draggedLayerId.set(null);
    store.dragOverLayerId.set(null);
  }
  
  function handleLayerDragEnd(e) {
    e.target.classList.remove('dragging');
    store.draggedLayerId.set(null);
    store.dragOverLayerId.set(null);
  }
  
  // Save cast
  async function saveCast() {
    if (!cast) return;
    saving = true;
    
    debugLog('cast', 'save.start', { id: cast.id, name: cast.name, isNew: !cast.id });
    
    try {
      const method = cast.id ? 'PUT' : 'POST';
      const url = cast.id 
        ? `/api/extensions/slidecast/casts/${cast.id}`
        : '/api/extensions/slidecast/casts';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: cast.name,
          description: cast.description,
          definition: cast.definition
        })
      });

      const data = await response.json();
      if (data.success) {
        if (!cast.id) {
          const newUrl = `/ext/slidecast/studio?id=${data.cast.uuid}`;
          window.history.replaceState({}, '', newUrl);
          castId = data.cast.uuid;
          castIdStore.set(castId);
        }
        cast = data.cast;
        store.hasUnsavedChanges.set(false); // Reset after successful save
        debugLog('cast', 'save.success', { id: cast.id, name: cast.name });
      } else {
        debugLog('cast', 'save.error', { error: 'Server returned failure' });
      }
    } catch (err) {
      console.error('Failed to save:', err);
      debugLog('cast', 'save.error', { error: err.message });
    } finally {
      saving = false;
    }
  }

  // Save as Template
  async function saveAsTemplate() {
    if (!cast) return;
    savingTemplate = true;
    
    try {
      const response = await fetch('/api/extensions/slidecast/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: templateName || cast.name,
          description: templateDescription || cast.description || '',
          definition: {
            cast: cast.definition
          },
          author: 'User'
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showSaveAsTemplateModal = false;
        templateName = '';
        templateDescription = '';
        // Show success toast or message
        alert('Template saved successfully!');
      } else {
        alert('Failed to save template: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to save template:', err);
      alert('Failed to save template');
    } finally {
      savingTemplate = false;
    }
  }

  // Preview - shows current canvas state without saving
  function openBrowserPreview() {
    // Store current cast data in sessionStorage for preview to use
    const previewData = {
      ...cast,
      _previewTimestamp: Date.now() // Mark as preview data
    };
    sessionStorage.setItem('slidecast_preview_data', JSON.stringify(previewData));
    
    // Open preview as a true fullscreen popup (hides browser UI)
    const previewId = cast?.uuid || 'preview';
    const previewUrl = `/ext/slidecast/preview?id=${previewId}&live=true`;
    
    // Get screen dimensions for fullscreen
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    
    // Popup window features for minimal browser chrome
    const features = [
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      'left=0',
      'top=0',
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'resizable=yes',
      'scrollbars=no',
      'fullscreen=yes'
    ].join(',');
    
    const previewWindow = window.open(previewUrl, 'slidecast_preview', features);
    
    // Try to enter browser fullscreen mode in the new window
    if (previewWindow) {
      previewWindow.addEventListener('load', () => {
        // Request fullscreen after page loads
        try {
          const elem = previewWindow.document.documentElement;
          if (elem.requestFullscreen) {
            elem.requestFullscreen();
          } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
          } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
          } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
          }
        } catch (e) {
          // Fullscreen may be blocked, popup still works
          console.log('Fullscreen request blocked, using popup mode');
        }
      });
    }
  }

  // Element interaction handlers from SlideRenderer
  function handleElementSelect(event) {
    // Hand tool disables layer selection
    if (activeTool === 'hand') return;
    
    const { element } = event.detail;
    // Background elements cannot be selected
    if (element.type === 'background') return;
    store.selectedElementId.set(element.id);
  }
  
  // Handle double-click to open config windows
  function handleElementDoubleClick(event) {
    if (activeTool === 'hand') return;
    
    const { element } = event.detail;
    if (element.type === 'background') return;
    
    // Open appropriate config window based on element type
    if (element.type === 'nav') {
      configWindows.openNavConfig(element);
    } else if (element.type === 'qr' || element.type === 'qrcode') {
      configWindows.openQRConfig(element);
    } else if (element.type === 'text') {
      configWindows.openTextConfig(element);
    } else if (element.type === 'widget') {
      configWindows.openWidgetConfig(element, runWidget);
    }
  }

  function handleBackgroundClick() {
    store.selectedElementId.set(null);
  }

  // Drag and resize handlers
  function startDrag(e, element) {
    // Don't start drag if panning is active
    if (isPanning) return;
    
    // Don't start drag if middle mouse button (panning) is pressed
    if (e.button === 1) return;
    
    // Don't start drag if hand tool is active (hand tool is for panning)
    if (activeTool === 'hand') return;
    
    // Background elements cannot be dragged
    if (element.type === 'background') return;
    // Locked elements cannot be dragged
    if (element.locked) return;
    
    if (e.target.dataset.handle) {
      startResize(e, element, e.target.dataset.handle);
      return;
    }
    
    isDragging = true;
    originalElement = JSON.parse(JSON.stringify(element));
    
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = canvasContainer.getBoundingClientRect();
    
    dragStart = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elementX: element.position.x,
      elementY: element.position.y
    };
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function handleDrag(e) {
    if (!isDragging || !selectedElement) return;
    
    // Don't handle drag if panning is active
    if (isPanning) return;
    
    const deltaX = (e.clientX - dragStart.mouseX) / canvasZoom;
    const deltaY = (e.clientY - dragStart.mouseY) / canvasZoom;
    
    const slide = getCurrentSlide();
    const el = slide.elements.find(el => el.id === selectedElementId);
    if (el) {
      // Ensure position exists
      if (!el.position) el.position = { x: 0, y: 0 };
      el.position.x = Math.round(dragStart.elementX + deltaX);
      el.position.y = Math.round(dragStart.elementY + deltaY);
      store.cast.update(c => ({ ...c }));
    }
  }

  function stopDrag() {
    // Don't push history if panning was active (element didn't actually move)
    if (isPanning) {
      isDragging = false;
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
      return;
    }
    
    // Only push history if position actually changed
    if (isDragging && originalElement && selectedElement) {
      const moved = originalElement.position.x !== selectedElement.position.x || 
                    originalElement.position.y !== selectedElement.position.y;
      if (moved) {
        const name = selectedElement.name || selectedElement.type;
        store.pushHistory(`Move "${name}"`);
        // Auto-run widget after drag completes
        scheduleWidgetAutoRun(selectedElement);
      }
    }
    
    isDragging = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
    
    // Sync ALL changes to inherited copies if this is a scoped nav
    const el = selectedElement;
    if (el?.type === 'nav' && el.scope !== 'slide' && !el._isInheritedCopy) {
      syncNavChanges(el);
    }
  }

  function startResize(e, element, handle) {
    e.stopPropagation();
    // Locked elements cannot be resized
    if (element.locked) return;
    isResizing = true;
    resizeHandle = handle;
    originalElement = JSON.parse(JSON.stringify(element));
    
    dragStart = {
      mouseX: e.clientX,
      mouseY: e.clientY
    };
    
    document.addEventListener('mousemove', handleResizeDrag);
    document.addEventListener('mouseup', stopResize);
  }

  function handleResizeDrag(e) {
    if (!isResizing || !originalElement) return;
    
    const deltaX = (e.clientX - dragStart.mouseX) / canvasZoom;
    const deltaY = (e.clientY - dragStart.mouseY) / canvasZoom;
    
    const slide = getCurrentSlide();
    const el = slide.elements.find(el => el.id === selectedElementId);
    if (!el) return;
    
    // Ensure position and size exist
    if (!el.position) el.position = { x: 0, y: 0 };
    if (!el.size) el.size = { width: 100, height: 100 };
    
    const orig = originalElement;
    
    switch (resizeHandle) {
      case 'se':
        el.size.width = Math.max(20, (orig.size?.width ?? 100) + deltaX);
        el.size.height = Math.max(20, (orig.size?.height ?? 100) + deltaY);
        break;
      case 'sw':
        el.position.x = (orig.position?.x ?? 0) + deltaX;
        el.size.width = Math.max(20, (orig.size?.width ?? 100) - deltaX);
        el.size.height = Math.max(20, (orig.size?.height ?? 100) + deltaY);
        break;
      case 'ne':
        el.position.y = (orig.position?.y ?? 0) + deltaY;
        el.size.width = Math.max(20, (orig.size?.width ?? 100) + deltaX);
        el.size.height = Math.max(20, (orig.size?.height ?? 100) - deltaY);
        break;
      case 'nw':
        el.position.x = (orig.position?.x ?? 0) + deltaX;
        el.position.y = (orig.position?.y ?? 0) + deltaY;
        el.size.width = Math.max(20, (orig.size?.width ?? 100) - deltaX);
        el.size.height = Math.max(20, (orig.size?.height ?? 100) - deltaY);
        break;
      case 'n':
        el.position.y = (orig.position?.y ?? 0) + deltaY;
        el.size.height = Math.max(20, (orig.size?.height ?? 100) - deltaY);
        break;
      case 's':
        el.size.height = Math.max(20, (orig.size?.height ?? 100) + deltaY);
        break;
      case 'e':
        el.size.width = Math.max(20, (orig.size?.width ?? 100) + deltaX);
        break;
      case 'w':
        el.position.x = (orig.position?.x ?? 0) + deltaX;
        el.size.width = Math.max(20, (orig.size?.width ?? 100) - deltaX);
        break;
    }
    
    el.position.x = Math.round(el.position.x);
    el.position.y = Math.round(el.position.y);
    el.size.width = Math.round(el.size.width);
    el.size.height = Math.round(el.size.height);
    
    store.cast.update(c => ({ ...c }));
  }

  function stopResize() {
    // Only push history if size actually changed
    if (isResizing && originalElement && selectedElement) {
      const resized = originalElement.size.width !== selectedElement.size.width || 
                      originalElement.size.height !== selectedElement.size.height;
      if (resized) {
        const name = selectedElement.name || selectedElement.type;
        store.pushHistory(`Resize "${name}"`);
        // Auto-run widget after resize completes
        scheduleWidgetAutoRun(selectedElement);
      }
    }
    
    isResizing = false;
    resizeHandle = null;
    document.removeEventListener('mousemove', handleResizeDrag);
    document.removeEventListener('mouseup', stopResize);
    
    // Sync ALL changes to inherited copies if this is a scoped nav
    const el = selectedElement;
    if (el?.type === 'nav' && el.scope !== 'slide' && !el._isInheritedCopy) {
      syncNavChanges(el);
    }
  }

  // Layer management
  function moveLayerUp() {
    if (!selectedElement) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    if (index < slide.elements.length - 1) {
      const name = selectedElement.name || selectedElement.type;
      const temp = slide.elements[index];
      slide.elements[index] = slide.elements[index + 1];
      slide.elements[index + 1] = temp;
      slide.elements.forEach((el, i) => el.zIndex = i);
      store.cast.update(c => ({ ...c }));
      store.pushHistory(`Move "${name}" layer up`);
    }
  }

  function moveLayerDown() {
    if (!selectedElement) return;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    if (index > 0) {
      const name = selectedElement.name || selectedElement.type;
      const temp = slide.elements[index];
      slide.elements[index] = slide.elements[index - 1];
      slide.elements[index - 1] = temp;
      slide.elements.forEach((el, i) => el.zIndex = i);
      store.cast.update(c => ({ ...c }));
      store.pushHistory(`Move "${name}" layer down`);
    }
  }

  function moveLayerToTop() {
    if (!selectedElement) return;
    const name = selectedElement.name || selectedElement.type;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    const [element] = slide.elements.splice(index, 1);
    slide.elements.push(element);
    slide.elements.forEach((el, i) => el.zIndex = i);
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`Move "${name}" to top`);
  }

  function moveLayerToBottom() {
    if (!selectedElement) return;
    const name = selectedElement.name || selectedElement.type;
    const slide = getCurrentSlide();
    const index = slide.elements.findIndex(el => el.id === selectedElementId);
    const [element] = slide.elements.splice(index, 1);
    slide.elements.unshift(element);
    slide.elements.forEach((el, i) => el.zIndex = i);
    store.cast.update(c => ({ ...c }));
    store.pushHistory(`Move "${name}" to bottom`);
  }

  // Update QR data helper
  function updateQRData() {
    if (!selectedElement || (selectedElement.type !== 'qr' && selectedElement.type !== 'qrcode')) return;
    
    const el = selectedElement;
    switch (el.qrType) {
      case 'url':
        el.data = el.qrUrl || 'https://example.com';
        break;
      case 'text':
        el.data = el.qrText || 'Hello';
        break;
      case 'wifi':
        const hidden = el.qrWifiHidden ? 'true' : 'false';
        el.data = `WIFI:T:${el.qrWifiEncryption || 'WPA'};S:${el.qrWifiSsid || ''};P:${el.qrWifiPassword || ''};H:${hidden};;`;
        break;
      case 'email':
        const subject = el.qrEmailSubject ? `?subject=${encodeURIComponent(el.qrEmailSubject)}` : '';
        el.data = `mailto:${el.qrEmail || ''}${subject}`;
        break;
      case 'phone':
        el.data = `tel:${el.qrPhone || ''}`;
        break;
      case 'sms':
        const body = el.qrSmsMessage ? `?body=${encodeURIComponent(el.qrSmsMessage)}` : '';
        el.data = `sms:${el.qrSmsPhone || ''}${body}`;
        break;
    }
    store.cast.update(c => ({ ...c }));
  }
  
  // End of script section
</script>

<svelte:head>
  <title>Slidecast Studio - {cast?.name || 'Loading...'}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <!-- Roku-Compatible Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <!-- Roku-compatible fonts only -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Roboto+Slab:wght@400;500;700&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&family=Bebas+Neue&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{#if loading}
  <div class="loading-fullscreen">
    <div class="spinner"></div>
    <span>Loading Studio...</span>
  </div>
{:else}
<div class="studio-container">
  <!-- Header with Menu Bar -->
  <StudioHeader
    castName={cast?.name || 'Untitled Cast'}
    {hasUnsavedChanges}
    {saving}
    openMenu={openMenu}
    showSlidesPanel={showSlidesPanel}
    showLayersPanel={showLayersPanel}
    showPropertiesPanel={showPropertiesPanel}
    showHistoryPanel={showHistoryPanel}
    on:close={() => handleMenuAction('close')}
    on:menuAction={(e) => handleMenuAction(e.detail.action)}
    on:menuToggle={(e) => openMenu = e.detail.open}
    on:preview={openBrowserPreview}
    on:save={saveCast}
    on:openCanvasSize={() => showCanvasSizeModal = true}
    on:castNameChange={(e) => { if (cast) cast.name = e.detail.name; }}
  />

  <!-- Main Content -->
  <div class="studio-main">
    <!-- Slides Panel -->
    <SlidesPanel
      {cast}
      {currentGroupId}
      {currentSlideIndex}
      currentGroup={getCurrentGroup()}
      {currentSlides}
      {slideClipboard}
      {clipboardOperation}
      {draggedSlideIndex}
      {dragOverSlideIndex}
      show={showSlidesPanel}
      collapsed={slidesPanelCollapsed}
      on:selectGroup={(e) => actions.selectGroup(e.detail)}
      on:deleteGroup={(e) => actions.deleteGroup(e.detail)}
      on:addSlide={actions.addSlide}
      on:selectSlide={(e) => actions.selectSlide(e.detail)}
      on:deleteSlide={(e) => actions.deleteSlide(e.detail)}
      on:duplicateSlide={(e) => actions.duplicateSlide(e.detail)}
      on:copySlide={(e) => actions.copySlide(e.detail)}
      on:cutSlide={(e) => actions.cutSlide(e.detail)}
      on:openSlideSettings={(e) => { store.editingSlideIndex.set(e.detail); store.openModal('slideSettings'); }}
      on:openGroupSettings={() => store.openModal('groupSettings')}
      on:openAddGroupModal={() => store.openModal('addGroup')}
      on:showPasteOptions={() => store.openModal('pasteSlide')}
      on:toggleCollapse={(e) => store.slidesPanelCollapsed.set(e.detail)}
      on:slideDragStart={(e) => { store.draggedSlideIndex.set(e.detail.index); }}
      on:slideDragOver={(e) => handleSlideDragOver(e.detail.event, e.detail.index)}
      on:slideDragLeave={(e) => handleSlideDragLeave(e.detail.event)}
      on:slideDrop={(e) => handleSlideDrop(e.detail.event, e.detail.index)}
      on:slideDragEnd={(e) => handleSlideDragEnd(e.detail.event)}
    />

    <!-- Canvas Area -->
    <StudioCanvas
      zoom={canvasZoom}
      pan={canvasPan}
      activeTool={activeTool}
      isPanning={isPanning}
      currentSlide={currentSlide}
      variables={cast?.definition?.variables || {}}
      selectedElementId={selectedElementId}
      selectedElement={selectedElement}
      {availableWidgets}
      {currentGroupId}
      {currentSlideIndex}
      {slowLoadingWidgets}
      {runWidget}
      bind:canvasContainer
      on:select={(e) => handleElementSelect(e)}
      on:elementDoubleClick={(e) => handleElementDoubleClick(e)}
      on:backgroundClick={handleBackgroundClick}
      on:startDrag={(e) => startDrag(e.detail.event, e.detail.element)}
      on:openWidgetConfig={(e) => configWindows.openWidgetConfig(e.detail.element, e.detail.runWidgetFn)}
      on:openTextConfig={(e) => configWindows.openTextConfig(e.detail.element)}
      on:openNavConfig={(e) => configWindows.openNavConfig(e.detail.element)}
      on:openQRConfig={(e) => configWindows.openQRConfig(e.detail.element)}
    />

    <!-- Right Sidebar: Layers + Properties -->
    <aside class="right-sidebar" class:collapsed={rightSidebarCollapsed} style="width: {rightSidebarCollapsed ? '40px' : rightSidebarWidth + 'px'}">
      <!-- Resize Handle -->
      {#if !rightSidebarCollapsed}
        <div class="sidebar-resize-handle" on:mousedown={canvas.startSidebarResize}></div>
      {/if}
      <!-- Collapse Toggle -->
      <button class="sidebar-collapse-btn" on:click={canvas.toggleRightSidebar} title={rightSidebarCollapsed ? 'Expand Panel' : 'Collapse Panel'}>
        <svg viewBox="0 0 24 24" fill="currentColor" style="transform: rotate({rightSidebarCollapsed ? '180deg' : '0deg'})"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <!-- Layers Panel -->
      <LayersPanel
        {currentSlide}
        {selectedElementId}
        {draggedLayerId}
        {dragOverLayerId}
        {activeTool}
        show={showLayersPanel}
        collapsed={layersPanelCollapsed}
        on:selectElement={(e) => { if (activeTool !== 'hand') store.selectedElementId.set(e.detail); }}
        on:duplicateElement={(e) => actions.duplicateElement(e.detail)}
        on:deleteElement={(e) => actions.deleteElement(e.detail)}
        on:updateElementName={() => { store.cast.update(c => ({ ...c })); trackPropertyChange('Rename layer'); }}
        on:toggleLock={(e) => toggleElementLock(e.detail)}
        on:toggleCollapse={(e) => store.slidesPanelCollapsed.set(e.detail)}
        on:layerDragStart={(e) => handleLayerDragStart(e.detail.event, e.detail.element)}
        on:layerDragOver={(e) => handleLayerDragOver(e.detail.event, e.detail.element)}
        on:layerDragLeave={(e) => handleLayerDragLeave(e.detail.event)}
        on:layerDrop={(e) => handleLayerDrop(e.detail.event, e.detail.element)}
        on:layerDragEnd={(e) => handleLayerDragEnd(e.detail.event)}
      />

      <!-- History Panel -->
      <HistoryPanel
        {historyStack}
        {historyIndex}
        show={showHistoryPanel}
        collapsed={historyPanelCollapsed}
        on:jumpToHistory={(e) => store.jumpToHistory(e.detail)}
        on:toggleCollapse={(e) => store.historyPanelCollapsed.set(e.detail)}
      />

    <!-- Properties Panel - using extracted component -->
    <PropertiesPanel
      element={selectedElement}
      currentSlide={currentSlide}
      widgets={availableWidgets}
      show={showPropertiesPanel}
      collapsed={propertiesPanelCollapsed}
      on:toggleCollapse={(e) => store.propertiesPanelCollapsed.set(e.detail.collapsed)}
      on:change={handlePropertyChange}
      on:update={handlePropertyUpdate}
      on:history={handlePropertyHistory}
      on:duplicate={duplicateSelectedElement}
      on:delete={deleteSelectedElement}
      on:openConfig={handleOpenConfig}
      on:openMedia={() => store.openModal('media')}
      on:refreshWidget={(e) => refreshWidget(e.detail.element)}
    />
    </aside>
  </div>

  <!-- Toolbar -->
  <StudioToolbar
    {modKey}
    canvasZoom={canvasZoom}
    bind:canvasContainer
    contributions={studioElementContributions}
    on:openMedia={() => store.openModal('media')}
    on:addElement={(e) => actions.addElement(e.detail.type, e.detail.options)}
    on:openWidget={() => store.openModal('widget')}
  />
</div>
{/if}

<!-- Media Modal -->
<!-- Media Modal -->
<MediaModal 
  bind:show={showMediaModal}
  {mediaLibrary}
  {uploadingMedia}
  on:close={() => store.closeModal('media')}
  on:select={(e) => selectMedia(e.detail.media)}
  on:upload={(e) => handleMediaUpload(e.detail.files)}
  on:importUrl={(e) => importFromUrl(e.detail.url)}
/>

<!-- Widget Modal -->
<WidgetModal 
  bind:show={showWidgetModal}
  {availableWidgets}
  {widgetCategories}
  on:close={() => store.closeModal('widget')}
  on:select={(e) => { actions.addElement('widget', { widgetUuid: e.detail.widget.uuid }); }}
/>

<!-- Variables Modal -->
<VariablesModal 
  bind:show={showVariablesModal}
  {cast}
  on:close={() => store.closeModal('variables')}
  on:update={() => store.triggerCastUpdate()}
/>

<!-- Save as Template Modal -->
<SaveAsTemplateModal 
  bind:show={showSaveAsTemplateModal}
  defaultName={cast?.name || 'My Template'}
  saving={savingTemplate}
  on:close={() => store.closeModal('saveAsTemplate')}
  on:save={(e) => saveAsTemplate(e.detail.name, e.detail.description)}
/>

<!-- Keyboard Shortcuts Modal -->
<KeyboardShortcutsModal 
  bind:show={showKeyboardShortcutsModal}
  {modKey}
  on:close={() => store.closeModal('keyboardShortcuts')}
/>

<!-- Canvas Size Modal -->
{#if showCanvasSizeModal}
      <div class="modal-overlay" on:click={() => store.closeModal('canvasSize')}>
    <div class="modal modal-sm" on:click|stopPropagation>
          <div class="modal-header"><h2>Canvas Size</h2><button class="close-btn" on:click={() => store.closeModal('canvasSize')}>×</button></div>
      <div class="modal-body">
        <p class="help-text">Slidecast uses a fixed 16:9 aspect ratio optimized for modern displays and TVs.</p>
        <div class="canvas-size-display"><div class="size-preview"><div class="size-box"><span class="size-value">1920 × 1080</span><span class="size-label">Full HD (16:9)</span></div></div></div>
        <p class="info-text" style="margin-top: 1rem; font-size: 0.75rem; color: rgb(var(--color-text-secondary));"><i class="fa-solid fa-circle-info" style="margin-right: 0.25rem;"></i>Support for custom resolutions coming soon.</p>
      </div>
          <div class="modal-footer"><button class="btn btn-primary" on:click={() => store.closeModal('canvasSize')}>Done</button></div>
    </div>
  </div>
{/if}

<!-- Add Group Modal -->
<AddGroupModal 
  bind:show={showAddGroupModal}
  on:close={() => store.closeModal('addGroup')}
  on:create={(e) => actions.addGroup(e.detail.name)}
/>

<!-- Slide Settings Modal -->
<SlideSettingsModal
  show={showSlideSettingsModal && editingSlideIndex !== null}
  slide={currentSlides[editingSlideIndex]}
  slideIndex={editingSlideIndex}
  currentGroup={getCurrentGroup()}
  on:close={() => { store.closeModal('slideSettings'); store.editingSlideIndex.set(null); }}
  on:update={() => { store.triggerCastUpdate(); }}
  on:history={(e) => store.pushHistory(e.detail)}
  on:updateBackgroundColor={(e) => updateSlideBackgroundColor(e.detail.slide, e.detail.color)}
  on:resetBackground={(e) => {
    e.detail.slide._hasCustomBackground = false;
    e.detail.slide.backgroundColor = null;
    updateSlideBackgroundColor(e.detail.slide, e.detail.defaultColor);
  }}
/>

<!-- Group Settings Modal -->
<GroupSettingsModal
  show={showGroupSettingsModal}
  {currentGroup}
  {cast}
  on:close={() => store.closeModal('groupSettings')}
  on:update={() => { store.triggerCastUpdate(); }}
  on:history={(e) => store.pushHistory(e.detail)}
  on:updateDefaultBackgrounds={(e) => updateGroupDefaultBackgrounds(e.detail.group, e.detail.color)}
/>

<!-- Paste Slide Modal -->
<PasteSlideModal 
  bind:show={showPasteSlideModal}
  slideClipboard={get(store.slideClipboard)}
  clipboardOperation={get(store.clipboardOperation)}
  {cast}
  on:close={() => store.closeModal('pasteSlide')}
  on:cancelCut={() => {
    store.slideClipboard.set(null);
    store.clipboardOperation.set(null);
  }}
/>

<!-- Unsaved Changes Confirmation Modal -->
<UnsavedChangesModal 
  bind:show={showUnsavedChangesModal}
  on:cancel={cancelNavigation}
  on:discard={confirmNavigateAway}
  on:save={saveAndNavigate}
/>

<!-- Delete Layer Confirmation Modal -->
<DeleteConfirmModal 
  bind:show={showDeleteLayerModal}
  type="layer"
  on:close={() => { showDeleteLayerModal = false; pendingDeleteLayerId = null; }}
  on:confirm={actions.executeDeleteLayer}
/>

<!-- Delete Slide Confirmation Modal -->
<DeleteConfirmModal 
  bind:show={showDeleteSlideModal}
  type="slide"
  on:close={() => { showDeleteSlideModal = false; pendingDeleteSlideIndex = null; }}
  on:confirm={actions.executeDeleteSlide}
/>

<!-- Delete Group Confirmation Modal -->
{#if showDeleteGroupModal}
  {@const groupToDelete = cast?.definition?.groups?.find(g => g.id === pendingDeleteGroupId)}
  <DeleteConfirmModal 
    show={true}
    type="group"
    itemName={groupToDelete?.name || 'Unknown'}
    slideCount={groupToDelete?.slides?.length || 0}
    on:close={() => { showDeleteGroupModal = false; pendingDeleteGroupId = null; }}
    on:confirm={actions.executeDeleteGroup}
  />
{/if}

<!-- Nav Icon Picker Modal -->
<IconPickerModal 
  bind:show={showNavIconPicker}
  {selectedElement}
  itemIndex={navIconPickerItemIndex}
  on:close={() => {
    store.closeModal('navIconPicker');
                navIconPickerItemIndex = null;
  }}
  on:update={(e) => {
                    store.cast.update(c => ({ ...c }));
    store.triggerCastUpdate();
  }}
/>

<!-- Widget Configuration Floating Window -->
{#if showWidgetConfigModal && widgetConfigElement}
  <WidgetConfigWindow
    element={widgetConfigElement}
    widget={availableWidgets.find(w => w.uuid === widgetConfigElement.widgetUuid)}
    contribution={widgetConfigContribution}
    position={widgetConfigPos}
    isRunning={widgetConfigElement._isRunning}
    on:close={() => configWindows.closeWidgetConfig(runWidget)}
    on:update={() => { store.triggerCastUpdate(); }}
    on:refresh={() => refreshWidget(widgetConfigElement)}
    on:autoRun={() => refreshWidget(widgetConfigElement)}
    on:sizeChange={() => { store.cast.update(c => ({ ...c })); }}
    on:positionChange={(e) => store.widgetConfig.update(c => ({ ...c, position: e.detail }))}
    on:renderModeChange={(e) => {
      // Re-render widget with new render mode
      const el = e.detail.element;
      store.cast.update(c => ({ ...c })); // Trigger canvas update
      refreshWidget(el); // Re-fetch widget data with new mode
    }}
  />
{/if}



<!-- Text Configuration Floating Window -->
{#if showTextConfigModal && textConfigElement}
  <TextConfigWindow 
    element={textConfigElement}
    position={textConfigPos}
    on:close={configWindows.closeTextConfig}
    on:change={(e) => trackPropertyChange(e.detail.property)}
    on:update={() => { store.triggerCastUpdate(); }}
    on:history={(e) => store.pushHistory(e.detail.action)}
    on:positionChange={(e) => store.textConfig.update(c => ({ ...c, position: e.detail }))}
  />
{/if}

<!-- Nav Configuration Floating Window -->
{#if showNavConfigModal && navConfigElement}
  <NavConfigWindow 
    element={navConfigElement}
    bind:position={navConfigPos}
    {cast}
    {currentGroupId}
    {iconCategories}
    {allIcons}
    on:close={configWindows.closeNavConfig}
    on:sync={() => { store.cast.update(c => ({ ...c })); syncNavChanges(navConfigElement); }}
    on:goToSource={(e) => goToNavSource(e.detail.element)}
  />
{/if}

<!-- QR Code Configuration Floating Window -->
{#if showQRConfigModal && qrConfigElement}
  <QRConfigWindow 
    element={qrConfigElement}
    bind:position={qrConfigPos}
    on:close={configWindows.closeQRConfig}
    on:update={updateQRData}
  />
{/if}

<style>
  /* Styles loaded dynamically from /api/extensions/slidecast/static/studio.css */
</style>
