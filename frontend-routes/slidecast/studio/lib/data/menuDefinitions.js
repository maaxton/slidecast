/**
 * Menu definitions for the Studio Header
 * This is a function that takes panel states to enable reactive checked states
 */

export function getMenuDefinitions(panelStates = {}) {
  const {
    showSlidesPanel = true,
    showLayersPanel = true,
    showPropertiesPanel = true,
    showHistoryPanel = false,
    historyIndex = 0,
    historyStackLength = 0,
    selectedElement = null,
    clipboardElement = null,
  } = panelStates;

  return {
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
        { label: 'Close', action: 'close', shortcut: null },
      ],
    },
    edit: {
      label: 'Edit',
      items: [
        {
          label: 'Undo', action: 'undo', shortcut: '⌘Z', disabled: historyIndex <= 0,
        },
        {
          label: 'Redo', action: 'redo', shortcut: '⌘⇧Z', disabled: historyIndex >= historyStackLength - 1,
        },
        { type: 'separator' },
        {
          label: 'Cut', action: 'cut', shortcut: '⌘X', disabled: !selectedElement,
        },
        {
          label: 'Copy', action: 'copy', shortcut: '⌘C', disabled: !selectedElement,
        },
        {
          label: 'Paste', action: 'paste', shortcut: '⌘V', disabled: !clipboardElement,
        },
        {
          label: 'Duplicate', action: 'duplicate', shortcut: '⌘D', disabled: !selectedElement,
        },
        { type: 'separator' },
        {
          label: 'Delete', action: 'delete', shortcut: '⌫', disabled: !selectedElement,
        },
        { type: 'separator' },
        { label: 'Select All', action: 'selectAll', shortcut: '⌘A' },
      ],
    },
    view: {
      label: 'View',
      items: [
        { label: 'Zoom In', action: 'zoomIn', shortcut: '⌘+' },
        { label: 'Zoom Out', action: 'zoomOut', shortcut: '⌘-' },
        { label: 'Zoom to Fit', action: 'zoomFit', shortcut: '⌘0' },
        { type: 'separator' },
        { label: 'Show Slides Panel', action: 'toggleSlidesPanel', checked: showSlidesPanel },
        { label: 'Show Layers Panel', action: 'toggleLayersPanel', checked: showLayersPanel },
        { label: 'Show Properties Panel', action: 'togglePropertiesPanel', checked: showPropertiesPanel },
        { label: 'Show History Panel', action: 'toggleHistoryPanel', checked: showHistoryPanel },
      ],
    },
    insert: {
      label: 'Insert',
      items: [
        { label: 'Text', action: 'insertText', icon: 'fa-solid fa-font' },
        { label: 'Image...', action: 'insertImage', icon: 'fa-solid fa-image' },
        { label: 'Widget...', action: 'insertWidget', icon: 'fa-solid fa-puzzle-piece' },
        { type: 'separator' },
        {
          label: 'Shape',
          action: 'insertShape',
          icon: 'fa-solid fa-shapes',
          submenu: [
            { label: 'Rectangle', action: 'insertRectangle' },
            { label: 'Circle', action: 'insertCircle' },
          ],
        },
        { type: 'separator' },
        { label: 'Ping Button', action: 'insertPing', icon: 'fa-solid fa-bell' },
      ],
    },
    arrange: {
      label: 'Arrange',
      items: [
        {
          label: 'Bring to Front', action: 'bringToFront', shortcut: '⌘⇧]', disabled: !selectedElement,
        },
        {
          label: 'Bring Forward', action: 'bringForward', shortcut: '⌘]', disabled: !selectedElement,
        },
        {
          label: 'Send Backward', action: 'sendBackward', shortcut: '⌘[', disabled: !selectedElement,
        },
        {
          label: 'Send to Back', action: 'sendToBack', shortcut: '⌘⇧[', disabled: !selectedElement,
        },
        { type: 'separator' },
        {
          label: 'Align',
          submenu: [
            { label: 'Align Left', action: 'alignLeft', disabled: !selectedElement },
            { label: 'Align Center', action: 'alignCenter', disabled: !selectedElement },
            { label: 'Align Right', action: 'alignRight', disabled: !selectedElement },
            { type: 'separator' },
            { label: 'Align Top', action: 'alignTop', disabled: !selectedElement },
            { label: 'Align Middle', action: 'alignMiddle', disabled: !selectedElement },
            { label: 'Align Bottom', action: 'alignBottom', disabled: !selectedElement },
          ],
        },
      ],
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
        { label: 'Slide Timing...', action: 'slideTiming', icon: 'fa-solid fa-clock' },
      ],
    },
    help: {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', action: 'keyboardShortcuts', shortcut: '⌘?' },
        { label: 'Debug Layers', action: 'debugLayers', icon: 'fa-solid fa-layer-group' },
        { label: 'Documentation', action: 'documentation', icon: 'fa-solid fa-book' },
      ],
    },
  };
}
