/**
 * Studio Actions - Element, Slide, and Group CRUD operations
 *
 * This module contains all the business logic for creating, updating, and deleting
 * elements, slides, and groups in the Slidecast Studio.
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
// HELPERS
// =============================================================================

export function generateId() {
  return `el-${Math.random().toString(36).substr(2, 9)}`;
}

function getCast() {
  return get(store.cast);
}

function getCurrentGroup() {
  const cast = getCast();
  const currentGroupId = get(store.currentGroupId);
  return cast?.definition?.groups?.find((g) => g.id === currentGroupId);
}

function getCurrentSlide() {
  const group = getCurrentGroup();
  const currentSlideIndex = get(store.currentSlideIndex);
  return group?.slides?.[currentSlideIndex];
}

// =============================================================================
// ELEMENT OPERATIONS
// =============================================================================

/**
 * Add a new element to the current slide
 * @param {string} type - Element type (text, image, shape, widget, nav, etc.)
 * @param {Object} config - Configuration options for the element
 */
export function addElement(type, config = {}) {
  const slide = getCurrentSlide();
  if (!slide) return;

  const cast = getCast();
  const currentGroupId = get(store.currentGroupId);
  const availableWidgets = get(store.availableWidgets);

  // Count elements of this type for naming
  const typeCount = slide.elements.filter((el) => el.type === type).length + 1;
  const typeName = type.charAt(0).toUpperCase() + type.slice(1);

  const element = {
    id: generateId(),
    type,
    name: `${typeName} ${typeCount}`,
    position: { x: 100, y: 100 },
    size: { width: 200, height: 100 },
    zIndex: slide.elements.length,
    style: { opacity: 1 },
  };

  switch (type) {
    case 'text':
      element.content = 'Double-click to edit';
      element.size = { width: 400, height: 80 };
      element.style = {
        fontFamily: 'Inter',
        fontSize: 48,
        fontWeight: 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        color: '#ffffff',
        textAlign: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        strokeColor: '#000000',
        strokeWidth: 0,
        opacity: 1,
      };
      break;

    case 'shape':
      element.shape = config.shape || 'rectangle';
      element.size = { width: 200, height: 200 };
      element.style = {
        fill: '#3b82f6',
        borderRadius: 8,
        opacity: 1,
      };
      break;

    case 'image':
      element.asset_id = config.asset_id;
      element.size = { width: 400, height: 300 };
      element.style = { opacity: 1, objectFit: 'cover' };
      break;

    case 'video':
      element.asset_id = config.asset_id;
      element.position = { x: 0, y: 0 };
      element.size = { width: 1920, height: 1080 };
      element.zIndex = 1; // Above background
      element.playback = { loop: true, muted: true, autoplay: true };
      element.style = { opacity: 1, objectFit: 'cover' };
      break;

    case 'nav':
      element.layout = 'horizontal';
      element.position = { x: 100, y: 900 };
      element.size = { width: 280, height: 56 };
      element.items = [
        {
          id: generateId(), label: 'Home', iconClass: 'fa-solid fa-house', action: { type: 'slide', slide_index: 0, group_id: currentGroupId },
        },
        {
          id: generateId(), label: 'Info', iconClass: 'fa-solid fa-circle-info', action: { type: 'slide', slide_index: 1, group_id: currentGroupId },
        },
      ];
      // Scope settings - determines inheritance
      element.scope = 'slide'; // 'cast' | 'group' | 'slide'
      element.sourceGroupId = currentGroupId; // For group-scoped navs
      element.syncPosition = true; // Position synced across slides?
      element.syncStyle = true; // Style synced across slides?
      // Default: Unified Bar preset
      element.style = {
        preset: 'unified-bar',
        // Container
        containerBackground: '#000000',
        containerOpacity: 0.6,
        containerRadius: 16,
        containerPadding: 8,
        containerBlur: 0,
        // Items
        itemBackgroundColor: '#ffffff',
        itemBackgroundOpacity: 0,
        itemColor: '#ffffff',
        itemPadding: 12,
        itemGap: 4,
        itemBorderRadius: 8,
        fontSize: 15,
        iconSize: 18,
        iconPosition: 'left',
        // Active state
        activeBackgroundColor: '#6366f1',
        activeBackgroundOpacity: 0.9,
        activeTextColor: '#ffffff',
        activeIndicator: 'background',
        // Hover
        hoverBackgroundColor: '#ffffff',
        hoverBackgroundOpacity: 0.15,
        hoverScale: 1.02,
        // Overall
        opacity: 1,
      };
      break;

    case 'ping':
      element.label = 'Press for Help';
      element.icon = '●';
      element.ping_name = 'help_requested';
      element.position = { x: 100, y: 950 };
      element.size = { width: 250, height: 60 };
      element.style = {
        background: '#ef4444',
        color: '#ffffff',
        fontSize: 20,
        borderRadius: 8,
        opacity: 1,
      };
      break;

    case 'qr':
    case 'qrcode':
      element.qrType = 'url';
      element.data = 'https://example.com';
      element.qrUrl = 'https://example.com';
      element.size = { width: 200, height: 200 };
      element.style = {
        foreground: '#000000',
        background: '#ffffff',
        opacity: 1,
      };
      break;

    case 'widget': {
      const widget = availableWidgets.find((w) => w.uuid === config.widgetUuid);
      element.widgetUuid = config.widgetUuid;
      element.widgetName = widget?.name || 'Widget';
      element.name = widget?.name || 'Widget';

      debugLog('widget', 'add.start', {
        widgetUuid: config.widgetUuid,
        widgetName: widget?.name,
        widgetVersion: widget?.version,
        renderMode: widget?.render_mode,
      });

      const defaultConfig = {};
      if (widget?.configSchema) {
        for (const [key, schema] of Object.entries(widget.configSchema)) {
          if (key !== '_tabs') defaultConfig[key] = schema.default;
        }
      }
      element.widgetConfig = { ...defaultConfig, ...(config.widgetConfig || {}) };

      const defaultStyles = {};
      if (widget?.styleSchema) {
        for (const [key, schema] of Object.entries(widget.styleSchema)) {
          if (key !== '_tabs') defaultStyles[key] = schema.default;
        }
      }
      element.widgetStyles = { ...defaultStyles, ...(config.widgetStyles || {}) };

      element.size = widget?.defaultSize || { width: 300, height: 150 };
      element.refreshInterval = widget?.refreshInterval || 60000;
      element.style = { opacity: 1 };

      // Show loading state initially (will be replaced by actual render)
      element._widgetLoading = true;
      element._widgetRenderMode = 'native';

      debugLog('widget', 'add.complete', {
        elementId: element.id,
        widgetName: element.widgetName,
        config: element.widgetConfig,
        styles: element.widgetStyles,
        size: element.size,
        refreshInterval: element.refreshInterval,
      });

      // Queue this widget for auto-render after adding
      store.pendingWidgetRenders.update((q) => [...q, element.id]);
      debugLog('widget', 'render.queued', { elementId: element.id });
      break;
    }
  }

  slide.elements.push(element);
  store.selectedElementId.set(element.id);
  store.triggerCastUpdate();
  store.pushHistory(`Add ${element.name}`);

  debugLog('layer', 'add', {
    id: element.id,
    type: element.type,
    name: element.name,
    position: element.position,
    size: element.size,
  });
}

/**
 * Delete an element (shows confirmation modal)
 * @param {string} elementId - ID of element to delete
 */
export function deleteElement(elementId) {
  store.pendingDeleteLayerId.set(elementId);
  store.openModal('deleteLayer');
}

/**
 * Execute element deletion after confirmation
 */
export function executeDeleteLayer() {
  const pendingDeleteLayerId = get(store.pendingDeleteLayerId);
  if (!pendingDeleteLayerId) return;

  const slide = getCurrentSlide();
  const index = slide.elements.findIndex((el) => el.id === pendingDeleteLayerId);
  if (index === -1) {
    store.pendingDeleteLayerId.set(null);
    store.closeModal('deleteLayer');
    return;
  }

  const element = slide.elements[index];
  const name = element.name || element.type;
  slide.elements.splice(index, 1);

  const selectedElementId = get(store.selectedElementId);
  if (selectedElementId === pendingDeleteLayerId) {
    store.selectedElementId.set(null);
  }

  store.triggerCastUpdate();
  store.pushHistory(`Delete "${name}"`);
  store.closeModal('deleteLayer');
  store.pendingDeleteLayerId.set(null);

  debugLog('layer', 'delete', { id: pendingDeleteLayerId, type: element.type, name });
}

/**
 * Duplicate an element
 * @param {Object} element - Element to duplicate
 */
export function duplicateElement(element) {
  if (!element || element.type === 'background') return;
  const slide = getCurrentSlide();
  if (!slide) return;

  const typeCount = slide.elements.filter((el) => el.type === element.type).length + 1;
  const typeName = element.type.charAt(0).toUpperCase() + element.type.slice(1);

  const newElement = JSON.parse(JSON.stringify(element));
  newElement.id = generateId();
  newElement.name = `${typeName} ${typeCount}`;
  newElement.position.x += 20;
  newElement.position.y += 20;
  newElement.zIndex = slide.elements.length;
  slide.elements.push(newElement);
  store.selectedElementId.set(newElement.id);
  store.triggerCastUpdate();
  const origName = element.name || element.type;
  store.pushHistory(`Duplicate "${origName}"`);

  debugLog('layer', 'duplicate', { sourceId: element.id, newId: newElement.id, name: newElement.name });
}

// =============================================================================
// SLIDE OPERATIONS
// =============================================================================

/**
 * Add a new slide to the current group
 */
export function addSlide() {
  const group = getCurrentGroup();
  if (!group) return;

  const cast = getCast();
  const currentGroupId = get(store.currentGroupId);

  // Helper functions for nav inheritance (these would need to be passed in or extracted)
  // For now, we'll create a simplified version
  const inheritedElements = [];

  const slideName = 'Slide';
  const defaultBgColor = group.defaultBackgroundColor || cast.definition.settings?.backgroundColor || '#1a1a2e';
  const newSlide = {
    id: generateId(),
    name: slideName,
    duration: group.defaultDuration || 10000,
    backgroundColor: defaultBgColor,
    navOverrides: {},
    elements: [
      {
        id: generateId(),
        type: 'background',
        name: 'Background',
        locked: true,
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        zIndex: 0,
        style: { backgroundColor: defaultBgColor },
      },
      ...inheritedElements,
    ],
  };

  group.slides.push(newSlide);
  store.currentSlideIndex.set(group.slides.length - 1);
  store.selectedElementId.set(null);
  store.triggerCastUpdate();
  store.pushHistory(`Add "${slideName}"`);

  debugLog('slide', 'add', {
    id: newSlide.id, name: slideName, index: group.slides.length - 1, groupId: currentGroupId,
  });
}

/**
 * Delete a slide (shows confirmation modal)
 * @param {number} index - Index of slide to delete
 */
export function deleteSlide(index) {
  store.pendingDeleteSlideIndex.set(index);
  store.openModal('deleteSlide');
}

/**
 * Execute slide deletion after confirmation
 */
export function executeDeleteSlide() {
  const pendingDeleteSlideIndex = get(store.pendingDeleteSlideIndex);
  if (pendingDeleteSlideIndex === null) return;

  const group = getCurrentGroup();
  if (!group || group.slides.length <= 1) {
    store.closeModal('deleteSlide');
    store.pendingDeleteSlideIndex.set(null);
    return;
  }

  const slideName = group.slides[pendingDeleteSlideIndex].name || `Slide ${pendingDeleteSlideIndex + 1}`;
  group.slides.splice(pendingDeleteSlideIndex, 1);

  const currentSlideIndex = get(store.currentSlideIndex);
  if (currentSlideIndex >= group.slides.length) {
    store.currentSlideIndex.set(group.slides.length - 1);
  }

  store.selectedElementId.set(null);
  store.triggerCastUpdate();
  store.pushHistory(`Delete "${slideName}"`);
  store.closeModal('deleteSlide');
  store.pendingDeleteSlideIndex.set(null);

  debugLog('slide', 'delete', { index: pendingDeleteSlideIndex, name: slideName });
}

/**
 * Select a slide by index
 * @param {number} index - Index of slide to select
 */
export function selectSlide(index) {
  const previousIndex = get(store.currentSlideIndex);
  store.currentSlideIndex.set(index);
  store.selectedElementId.set(null);
  // Note: runAllWidgetsOnSlide() would need to be called from the main component

  debugLog('slide', 'select', { from: previousIndex, to: index });
}

/**
 * Duplicate a slide
 * @param {number} index - Index of slide to duplicate
 */
export function duplicateSlide(index) {
  const group = getCurrentGroup();
  if (!group || !group.slides[index]) return;

  const origName = group.slides[index].name || `Slide ${index + 1}`;
  const duplicatedSlide = JSON.parse(JSON.stringify(group.slides[index]));
  duplicatedSlide.id = generateId();
  duplicatedSlide.name = `${duplicatedSlide.name} (copy)`;
  duplicatedSlide.elements = duplicatedSlide.elements.map((el) => ({
    ...el,
    id: generateId(),
  }));

  group.slides.splice(index + 1, 0, duplicatedSlide);
  store.triggerCastUpdate();
  store.currentSlideIndex.set(index + 1);
  store.pushHistory(`Duplicate "${origName}"`);

  debugLog('slide', 'duplicate', { sourceIndex: index, newIndex: index + 1, name: duplicatedSlide.name });
}

/**
 * Cut a slide (moves to clipboard)
 * @param {number} index - Index of slide to cut
 */
export function cutSlide(index) {
  const group = getCurrentGroup();
  if (!group || !group.slides[index]) return;

  const currentGroupId = get(store.currentGroupId);
  const slideName = group.slides[index].name || `Slide ${index + 1}`;
  store.slideClipboard.set({
    slide: JSON.parse(JSON.stringify(group.slides[index])),
    sourceGroupId: currentGroupId,
    sourceIndex: index,
  });
  store.clipboardOperation.set('cut');
  store.openModal('pasteSlide');

  debugLog('slide', 'cut', { index, name: slideName, groupId: currentGroupId });
}

/**
 * Copy a slide (copies to clipboard)
 * @param {number} index - Index of slide to copy
 */
export function copySlide(index) {
  const group = getCurrentGroup();
  if (!group || !group.slides[index]) return;

  const currentGroupId = get(store.currentGroupId);
  const slideName = group.slides[index].name || `Slide ${index + 1}`;
  store.slideClipboard.set({
    slide: JSON.parse(JSON.stringify(group.slides[index])),
    sourceGroupId: currentGroupId,
    sourceIndex: index,
  });
  store.clipboardOperation.set('copy');

  debugLog('slide', 'copy', { index, name: slideName, groupId: currentGroupId });
}

/**
 * Paste a slide to a target group
 * @param {string} targetGroupId - ID of group to paste into
 */
export function pasteSlideToGroup(targetGroupId) {
  const slideClipboard = get(store.slideClipboard);
  if (!slideClipboard) return;

  const cast = getCast();
  const targetGroup = cast.definition.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) return;

  const slideName = slideClipboard.slide.name || 'Slide';
  const clipboardOperation = get(store.clipboardOperation);
  const operation = clipboardOperation === 'cut' ? 'Move' : 'Paste';

  const newSlide = JSON.parse(JSON.stringify(slideClipboard.slide));
  newSlide.id = generateId();
  newSlide.elements = newSlide.elements.map((el) => ({
    ...el,
    id: generateId(),
  }));

  if (clipboardOperation === 'cut') {
    const sourceGroup = cast.definition.groups.find((g) => g.id === slideClipboard.sourceGroupId);
    if (sourceGroup) {
      const sourceIndex = sourceGroup.slides.findIndex((s) => s.id === slideClipboard.slide.id);
      if (sourceIndex >= 0) {
        sourceGroup.slides.splice(sourceIndex, 1);
        const currentGroupId = get(store.currentGroupId);
        const currentSlideIndex = get(store.currentSlideIndex);
        if (currentGroupId === slideClipboard.sourceGroupId && currentSlideIndex >= sourceIndex) {
          store.currentSlideIndex.set(Math.max(0, currentSlideIndex - 1));
        }
      }
    }
    store.slideClipboard.set(null);
    store.clipboardOperation.set(null);
  }

  targetGroup.slides.push(newSlide);
  store.currentGroupId.set(targetGroupId);
  store.currentSlideIndex.set(targetGroup.slides.length - 1);
  store.triggerCastUpdate();
  store.pushHistory(`${operation} "${slideName}" to ${targetGroup.name}`);
  store.closeModal('pasteSlide');

  debugLog('slide', 'paste', {
    operation: clipboardOperation,
    name: slideName,
    targetGroup: targetGroup.name,
    targetGroupId,
    newIndex: targetGroup.slides.length - 1,
  });
}

// =============================================================================
// GROUP OPERATIONS
// =============================================================================

/**
 * Add a new group
 * @param {string} name - Name for the new group
 */
export function addGroup(name) {
  const cast = getCast();
  if (!cast?.definition?.groups) return;

  const groupName = name || `Group ${cast.definition.groups.length}`;
  const newGroup = {
    id: `group-${generateId()}`,
    name: groupName,
    isDefault: false,
    loop: true,
    defaultDuration: 10000,
    slides: [{
      id: generateId(),
      name: 'Slide',
      duration: 10000,
      backgroundColor: cast.definition.settings.backgroundColor || '#1a1a2e',
      elements: [{
        id: generateId(),
        type: 'background',
        name: 'Background',
        locked: true,
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        zIndex: 0,
        style: { backgroundColor: cast.definition.settings.backgroundColor || '#1a1a2e' },
      }],
    }],
  };

  cast.definition.groups.push(newGroup);
  store.currentGroupId.set(newGroup.id);
  store.currentSlideIndex.set(0);
  store.selectedElementId.set(null);
  store.triggerCastUpdate();
  store.pushHistory(`Add group "${groupName}"`);

  debugLog('group', 'add', { id: newGroup.id, name: groupName });
}

/**
 * Delete a group (shows confirmation modal)
 * @param {string} groupId - ID of group to delete
 */
export function deleteGroup(groupId) {
  store.pendingDeleteGroupId.set(groupId);
  store.openModal('deleteGroup');
}

/**
 * Execute group deletion after confirmation
 */
export function executeDeleteGroup() {
  const pendingDeleteGroupId = get(store.pendingDeleteGroupId);
  if (!pendingDeleteGroupId) return;

  const cast = getCast();
  if (!cast?.definition?.groups || pendingDeleteGroupId === 'home') {
    store.closeModal('deleteGroup');
    store.pendingDeleteGroupId.set(null);
    return;
  }

  const index = cast.definition.groups.findIndex((g) => g.id === pendingDeleteGroupId);
  if (index >= 0) {
    const groupName = cast.definition.groups[index].name;
    cast.definition.groups.splice(index, 1);

    const currentGroupId = get(store.currentGroupId);
    if (currentGroupId === pendingDeleteGroupId) {
      store.currentGroupId.set('home');
      store.currentSlideIndex.set(0);
    }
    store.selectedElementId.set(null);
    store.triggerCastUpdate();
    store.pushHistory(`Delete group "${groupName}"`);

    debugLog('group', 'delete', { id: pendingDeleteGroupId, name: groupName });
  }
  store.closeModal('deleteGroup');
  store.pendingDeleteGroupId.set(null);
}

/**
 * Select a group by ID
 * @param {string} groupId - ID of group to select
 */
export function selectGroup(groupId) {
  const currentGroupId = get(store.currentGroupId);
  if (currentGroupId === groupId) return;
  store.currentGroupId.set(groupId);
  store.currentSlideIndex.set(0);
  store.selectedElementId.set(null);

  debugLog('group', 'select', { from: currentGroupId, to: groupId });
}
