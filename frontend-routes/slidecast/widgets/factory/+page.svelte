<script>
  import { onMount, onDestroy } from 'svelte';
  import { CODE_SNIPPETS } from './lib/data/snippets.js';
  import WidgetEditor from './lib/components/WidgetEditor.svelte';
  import SchemaBuilder from './lib/components/SchemaBuilder.svelte';
  import FileTree from './lib/components/FileTree.svelte';
  import AssetManager from './lib/components/AssetManager.svelte';
  // Studio components for canvas-like preview
  import SlideRenderer from '../../lib/SlideRenderer.svelte';
  import WidgetConfigWindow from '../../studio/lib/config-windows/WidgetConfigWindow.svelte';
  import { renderPrimitivesToHtml } from '../../lib/widget-primitives.js';
  // Rendering CSS comes from shared-renderer/styles.css via SlideRenderer's :global() rules

  // Debug logging helper
  function debugLog(category, action, data = {}) {
    if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
      window.WaiveoDebug.log('slidecast', category, action, data);
    }
  }

  // State
  let widget = null;
  let loading = true;
  let saving = false;
  let error = null;
  let isDirty = false;

  // Multi-file editor state
  let activeFile = 'client'; // 'server', 'client', 'template'
  let widgetAssets = [];
  let showAssetManager = false;

  // Editor state
  let editor = null;
  let editorContainer = null;
  let monaco = null;

  // Preview state
  let previewResult = null;
  let previewLoading = false;
  let previewError = null;
  let previewConfig = {};
  let previewStyles = {};

  // Widget Config Window state (like Studio)
  let showWidgetConfig = false;
  let widgetConfigPos = { x: 100, y: 100 };

  // Panel visibility
  let activePanel = 'preview'; // 'preview', 'debug', 'output', 'network', 'versions'
  let showSettings = false;

  // Fonts
  let fonts = [];
  let fontCategories = [];

  // Modal states
  let showPublishModal = false;
  let showDeleteModal = false;
  let showRestoreModal = false;
  let showSecretsModal = false;
  let selectedVersion = null;

  // Secrets
  let secrets = [];
  let newSecretKey = '';
  let newSecretValue = '';

  // Versions
  let versions = [];

  // Size preview
  let previewSize = { width: 300, height: 150 };

  // Get widget ID from URL
  let widgetId = null;

  // Toast state
  let toasts = [];
  let toastId = 0;

  // Auto-refresh state
  let autoRefresh = false;
  let autoRefreshTimer = null;

  // Preview mode: 'native' (browser rendering) or 'image' (server-rendered PNG, what Roku sees)
  let previewMode = 'native';

  // Animation preview state (for widgets with supportsAnimation: true)
  let animationMode = false;
  let animationPlaying = false;
  let animationFrame = 0;
  let animationFps = 12;
  let animationFrameCount = 12;
  let spriteMetadata = null;
  let spriteLoading = false;
  let animationTimer = null;

  // Left sidebar state
  let leftPanelTab = 'files'; // 'files', 'primitives', 'snippets', 'database'
  
  // Database panel state
  let dbTableName = null;
  let dbTableData = null;
  let showDbSchemaExample = false;

  // Panel collapse state
  let leftPanelCollapsed = false;
  let editorCollapsed = false;
  let rightPanelCollapsed = false;

  // Divider state - percentage of available space for editor (0-100)
  // Default 50% split, load from localStorage
  let editorWidthPercent = 50;
  let isDraggingDivider = false;
  let dividerContainerRef = null;
  const STORAGE_KEY = 'widget-factory-divider-position';
  const MIN_PANEL_WIDTH = 200; // Minimum width in pixels for each panel

  // Load divider position from localStorage on mount
  function loadDividerPosition() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 10 && parsed <= 90) {
          editorWidthPercent = parsed;
        }
      }
    }
  }

  // Save divider position to localStorage
  function saveDividerPosition() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, editorWidthPercent.toString());
    }
  }

  // Handle divider drag start
  function startDividerDrag(e) {
    e.preventDefault();
    isDraggingDivider = true;
    document.addEventListener('mousemove', handleDividerDrag);
    document.addEventListener('mouseup', stopDividerDrag);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // Handle divider dragging
  function handleDividerDrag(e) {
    if (!isDraggingDivider || !dividerContainerRef) return;
    
    const containerRect = dividerContainerRef.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const mouseX = e.clientX - containerRect.left;
    
    // Calculate percentage, respecting minimum widths
    const minPercent = (MIN_PANEL_WIDTH / containerWidth) * 100;
    const maxPercent = 100 - minPercent;
    
    let newPercent = (mouseX / containerWidth) * 100;
    newPercent = Math.max(minPercent, Math.min(maxPercent, newPercent));
    
    editorWidthPercent = newPercent;
  }

  // Handle divider drag end
  function stopDividerDrag() {
    if (isDraggingDivider) {
      isDraggingDivider = false;
      document.removeEventListener('mousemove', handleDividerDrag);
      document.removeEventListener('mouseup', stopDividerDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveDividerPosition();
      // Re-layout Monaco editor after resize
      if (editor) {
        setTimeout(() => editor.layout(), 0);
      }
    }
  }

  // Toggle panel collapse with constraint: max 2 panels can be collapsed
  function togglePanelCollapse(panel) {
    const currentCollapsedCount = [leftPanelCollapsed, editorCollapsed, rightPanelCollapsed].filter(Boolean).length;
    
    if (panel === 'left') {
      if (leftPanelCollapsed) {
        leftPanelCollapsed = false;
      } else if (currentCollapsedCount < 2) {
        leftPanelCollapsed = true;
      }
    } else if (panel === 'editor') {
      if (editorCollapsed) {
        editorCollapsed = false;
        // Re-layout Monaco editor when showing - need multiple delays for DOM update
        requestAnimationFrame(() => {
          if (editor) {
            editor.layout();
            // Double-check after CSS transition completes
            setTimeout(() => editor.layout(), 100);
          }
        });
      } else if (currentCollapsedCount < 2) {
        editorCollapsed = true;
      }
    } else if (panel === 'right') {
      if (rightPanelCollapsed) {
        rightPanelCollapsed = false;
      } else if (currentCollapsedCount < 2) {
        rightPanelCollapsed = true;
      }
    }
  }

  // Check if a panel can be collapsed
  function canCollapse(panel) {
    const currentCollapsedCount = [leftPanelCollapsed, editorCollapsed, rightPanelCollapsed].filter(Boolean).length;
    if (panel === 'left') return leftPanelCollapsed || currentCollapsedCount < 2;
    if (panel === 'editor') return editorCollapsed || currentCollapsedCount < 2;
    if (panel === 'right') return rightPanelCollapsed || currentCollapsedCount < 2;
    return false;
  }

  // Schema Builder state
  let showSchemaBuilderModal = false;
  let schemaBuilderType = 'config'; // 'config' or 'style'
  let editingSchema = {};
  let editingSchemaTabs = []; // Tabs being edited within schema builder
  let schemaBuilderActiveTab = null; // Currently selected tab in schema builder
  let newFieldKey = '';
  let newFieldType = 'string';
  
  // Inline tab creation in schema builder
  let showAddTabForm = false;
  let newSchemaTabId = '';
  let newSchemaTabLabel = '';
  let newSchemaTabIcon = '📋';
  
  // Schema field types
  const FIELD_TYPES = [
    { value: 'string', label: 'Text', icon: '📝' },
    { value: 'number', label: 'Number', icon: '🔢' },
    { value: 'boolean', label: 'Toggle', icon: '✓' },
    { value: 'select', label: 'Dropdown', icon: '▼' },
    { value: 'color', label: 'Color', icon: '🎨' },
    { value: 'slider', label: 'Slider', icon: '⟷' },
    { value: 'font', label: 'Font', icon: '🔤' },
    { value: 'entity', label: 'Entity ID', icon: '🏠' },
    { value: 'image', label: 'Media Asset', icon: '🖼️' }
  ];
  
  // Default tab icons
  const TAB_ICONS = ['📋', '⚙️', '🎨', '📊', '🔧', '🎯', '💡', '📦', '🌟', '🔔', '📍', '🏷️'];

  // Style groups for organizing styleSchema
  const STYLE_GROUPS = [
    { value: 'Background', label: 'Background' },
    { value: 'Typography', label: 'Typography' },
    { value: 'Layout', label: 'Layout' },
    { value: 'Effects', label: 'Effects' },
    { value: 'Border', label: 'Border' }
  ];

  // Help/Documentation state
  let showHelpModal = false;
  let helpTab = 'quickstart'; // 'quickstart', 'primitives', 'api', 'examples'


  function insertSnippet(snippet) {
    if (editor && widget) {
      widget.code = snippet.code;
      editor.setValue(snippet.code);
      isDirty = true;
      showToast(`Inserted "${snippet.name}" template`, 'success');
    }
  }

  // Toast functions
  function showToast(message, type = 'info', duration = 3000) {
    const id = ++toastId;
    toasts = [...toasts, { id, message, type }];
    setTimeout(() => {
      toasts = toasts.filter(t => t.id !== id);
    }, duration);
  }

  onMount(async () => {
    // Load saved divider position
    loadDividerPosition();
    
    const params = new URLSearchParams(window.location.search);
    widgetId = params.get('id');
    
    if (!widgetId) {
      error = 'No widget ID provided';
      loading = false;
      return;
    }

    await loadMonaco();
    await Promise.all([
      loadWidget(),
      loadFonts()
    ]);
  });

  onDestroy(() => {
    if (editor) {
      editor.dispose();
    }
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
    }
    if (animationTimer) {
      clearInterval(animationTimer);
    }
  });

  // Auto-refresh toggle
  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    if (autoRefresh) {
      startAutoRefresh();
      showToast(`Auto-refresh enabled (${widget?.refreshInterval || 60000}ms)`, 'info');
    } else {
      stopAutoRefresh();
      showToast('Auto-refresh disabled', 'info');
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    const interval = widget?.refreshInterval || 60000;
    runPreview(); // Run immediately
    autoRefreshTimer = setInterval(() => {
      if (autoRefresh && !previewLoading) {
        runPreview();
      }
    }, interval);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  // Update auto-refresh when refresh interval changes
  $: if (autoRefresh && widget?.refreshInterval) {
    startAutoRefresh();
  }

  // Create synthetic slide for SlideRenderer (canvas-like preview)
  // This creates a fake slide with just the widget element, filled with preview results
  $: widgetElement = widget ? {
    id: 'preview-widget',
    type: 'widget',
    widgetUuid: widget.uuid,
    widgetName: widget.name,
    widgetConfig: previewConfig,
    widgetStyles: previewStyles,
    position: { x: 0, y: 0 },
    size: previewSize,
    zIndex: 1,
    refreshInterval: widget.refreshInterval || 60000,
    // Runtime state from preview execution
    _widgetRenderMode: previewResult?.renderMode || 'native',
    _widgetPrimitives: previewResult?.primitives,
    _widgetImageUrl: previewResult?.imageUrl,
    _widgetLoading: previewLoading,
    _widgetError: previewError,
    _widgetName: widget.name
  } : null;

  $: previewSlide = widgetElement ? {
    id: 'factory-preview',
    background: { type: 'color', color: '#000000' },
    elements: [widgetElement]
  } : null;

  // Widget Config Window handlers
  function openWidgetConfigWindow() {
    if (!widgetElement) return;
    // Position the config window next to the canvas (right side of screen)
    // Account for the sidebar and code editor taking up left portion
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1600;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    // Position it on the right side, near the preview panel
    widgetConfigPos = { 
      x: Math.max(viewportWidth - 550, 400), // 550px from right edge, minimum 400px from left
      y: Math.min(100, viewportHeight - 600) // 100px from top, but ensure it fits
    };
    showWidgetConfig = true;
  }

  function closeWidgetConfigWindow() {
    showWidgetConfig = false;
    // Auto-run preview when config window closes
    runPreview();
  }

  function handleWidgetConfigUpdate() {
    // Config changed, trigger re-render
    isDirty = true;
    runPreview();
  }

  // Schema Builder functions
  function openSchemaBuilder(type) {
    schemaBuilderType = type;
    const sourceSchema = type === 'config' ? (widget?.configSchema || {}) : (widget?.styleSchema || {});
    editingSchema = JSON.parse(JSON.stringify(sourceSchema));
    
    // Extract tabs from configSchema._tabs (tabs are only in configSchema, shared by both)
    editingSchemaTabs = JSON.parse(JSON.stringify(widget?.configSchema?._tabs || []));
    
    // Set default active tab (first tab or 'default')
    schemaBuilderActiveTab = editingSchemaTabs.length > 0 ? editingSchemaTabs[0].id : 'default';
    
    // Reset form state
    newFieldKey = '';
    newFieldType = 'string';
    showAddTabForm = false;
    newSchemaTabId = '';
    newSchemaTabLabel = '';
    newSchemaTabIcon = '📋';
    
    showSchemaBuilderModal = true;
  }

  function addSchemaField() {
    if (!newFieldKey || editingSchema[newFieldKey]) {
      showToast('Please enter a unique field key', 'error');
      return;
    }

    const field = {
      type: newFieldType,
      label: newFieldKey.charAt(0).toUpperCase() + newFieldKey.slice(1).replace(/([A-Z])/g, ' $1'),
      default: getDefaultValueForType(newFieldType)
    };

    // Add type-specific properties
    if (newFieldType === 'slider') {
      field.min = 0;
      field.max = 100;
      field.step = 1;
    }
    if (newFieldType === 'select') {
      field.options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' }
      ];
    }
    if (schemaBuilderType === 'style') {
      field.group = 'Background';
    }

    editingSchema[newFieldKey] = field;
    editingSchema = editingSchema; // Trigger reactivity
    newFieldKey = '';
    newFieldType = 'string';
  }

  function getDefaultValueForType(type) {
    switch (type) {
      case 'string': return '';
      case 'number': return 0;
      case 'boolean': return false;
      case 'color': return '#ffffff';
      case 'slider': return 50;
      case 'select': return 'option1';
      case 'font': return 'Inter';
      case 'entity': return '';
      case 'image': return '';
      default: return '';
    }
  }

  function removeSchemaField(key) {
    delete editingSchema[key];
    editingSchema = editingSchema; // Trigger reactivity
  }

  function updateSchemaFieldOption(key, optionIndex, field, value) {
    if (!editingSchema[key].options) return;
    editingSchema[key].options[optionIndex][field] = value;
    editingSchema = editingSchema;
  }

  function addSchemaFieldOption(key) {
    if (!editingSchema[key].options) {
      editingSchema[key].options = [];
    }
    const idx = editingSchema[key].options.length + 1;
    editingSchema[key].options.push({ value: `option${idx}`, label: `Option ${idx}` });
    editingSchema = editingSchema;
  }

  function removeSchemaFieldOption(key, optionIndex) {
    editingSchema[key].options.splice(optionIndex, 1);
    editingSchema = editingSchema;
  }

  function saveSchema() {
    if (schemaBuilderType === 'config') {
      widget.configSchema = editingSchema;
      // Save tabs to configSchema._tabs
      widget.configSchema._tabs = editingSchemaTabs;
    } else {
      widget.styleSchema = editingSchema;
      // Also update tabs in configSchema (tabs are shared)
      if (!widget.configSchema) widget.configSchema = {};
      widget.configSchema._tabs = editingSchemaTabs;
    }
    isDirty = true;
    showSchemaBuilderModal = false;
    showToast(`${schemaBuilderType === 'config' ? 'Config' : 'Style'} schema updated`, 'success');
    
    // Re-initialize preview defaults
    initPreviewDefaults();
  }
  
  // ============================================
  // Schema Builder - Inline Tab Management
  // ============================================
  
  // Get fields for a specific tab in schema builder
  // Note: schema param is required for Svelte reactivity tracking
  function getFieldsForTab(tabId, schema) {
    if (!schema) return [];
    return Object.entries(schema).filter(([key, field]) => {
      if (key === '_tabs') return false; // Skip reserved key
      const fieldTab = field.tab || 'default';
      return fieldTab === tabId;
    });
  }
  
  // Add a new tab inline in schema builder
  function addSchemaTab() {
    if (!newSchemaTabId || editingSchemaTabs.find(t => t.id === newSchemaTabId)) {
      showToast('Please enter a unique tab ID', 'error');
      return;
    }
    editingSchemaTabs = [...editingSchemaTabs, {
      id: newSchemaTabId,
      label: newSchemaTabLabel || newSchemaTabId.charAt(0).toUpperCase() + newSchemaTabId.slice(1),
      icon: newSchemaTabIcon
    }];
    // Switch to the new tab
    schemaBuilderActiveTab = newSchemaTabId;
    // Reset form
    newSchemaTabId = '';
    newSchemaTabLabel = '';
    newSchemaTabIcon = '📋';
    showAddTabForm = false;
  }
  
  // Remove a tab from schema builder
  function removeSchemaTab(tabId) {
    // Move all fields in this tab to default (empty string = default tab)
    Object.keys(editingSchema).forEach(key => {
      if (key !== '_tabs' && editingSchema[key].tab === tabId) {
        editingSchema[key].tab = '';
      }
    });
    editingSchemaTabs = editingSchemaTabs.filter(t => t.id !== tabId);
    // Switch to first tab or default
    if (schemaBuilderActiveTab === tabId) {
      schemaBuilderActiveTab = editingSchemaTabs.length > 0 ? editingSchemaTabs[0].id : 'default';
    }
    editingSchema = editingSchema; // Trigger reactivity
  }
  
  // Move a tab up or down
  function moveSchemaTab(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= editingSchemaTabs.length) return;
    const tabs = [...editingSchemaTabs];
    [tabs[index], tabs[newIndex]] = [tabs[newIndex], tabs[index]];
    editingSchemaTabs = tabs;
  }
  
  // Move a field to a different tab
  function moveFieldToTab(fieldKey, newTabId) {
    if (editingSchema[fieldKey]) {
      // Create a new object reference to properly trigger Svelte reactivity
      editingSchema = {
        ...editingSchema,
        [fieldKey]: {
          ...editingSchema[fieldKey],
          tab: newTabId === 'default' ? '' : newTabId
        }
      };
    }
  }
  
  // Add field to the currently active tab
  function addSchemaFieldToActiveTab() {
    if (!newFieldKey || editingSchema[newFieldKey]) {
      showToast('Please enter a unique field key', 'error');
      return;
    }
    
    const defaults = {
      string: { type: 'string', label: newFieldKey, default: '' },
      number: { type: 'number', label: newFieldKey, default: 0 },
      boolean: { type: 'boolean', label: newFieldKey, default: false },
      select: { type: 'select', label: newFieldKey, options: [], default: '' },
      color: { type: 'color', label: newFieldKey, default: '#667eea' },
      slider: { type: 'slider', label: newFieldKey, min: 0, max: 100, step: 1, default: 50 },
      font: { type: 'font', label: newFieldKey, default: 'system-ui' },
      entity: { type: 'entity', label: newFieldKey, default: '' },
      image: { type: 'image', label: newFieldKey, default: '' }
    };
    
    const fieldDef = defaults[newFieldType] || defaults.string;
    // Assign to active tab (empty string for default tab)
    fieldDef.tab = schemaBuilderActiveTab === 'default' ? '' : schemaBuilderActiveTab;
    // Add default group for style schema fields
    if (schemaBuilderType === 'style') {
      fieldDef.group = 'Background';
    }
    
    editingSchema = { ...editingSchema, [newFieldKey]: fieldDef };
    newFieldKey = '';
    showToast('Field added', 'success');
  }

  async function loadMonaco() {
    // Load Monaco from CDN
    if (!window.monaco) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

      await new Promise((resolve) => {
        window.require.config({
          paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
        });
        window.require(['vs/editor/editor.main'], resolve);
      });
    }

    monaco = window.monaco;
  }

  function initEditor(code) {
    if (!editorContainer || !monaco) return;

    // Determine language based on active file
    const language = activeFile === 'template' ? 'html' : 'javascript';

    // Define custom theme
    monaco.editor.defineTheme('widget-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' }
      ],
      colors: {
        'editor.background': '#0d0d14',
        'editor.foreground': '#d4d4d4',
        'editorCursor.foreground': '#667eea',
        'editor.lineHighlightBackground': '#1a1a2e',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41'
      }
    });

    editor = monaco.editor.create(editorContainer, {
      value: code,
      language,
      theme: 'widget-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      padding: { top: 16 }
    });

    // Track changes
    editor.onDidChangeModelContent(() => {
      isDirty = true;
    });

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveWidget);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runPreview);
  }

  async function loadWidget() {
    loading = true;
    debugLog('factory', 'widget.load.start', { widgetId });
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      
      if (data.success) {
        widget = data.widget;
        previewSize = widget.defaultSize || { width: 300, height: 150 };
        
        // Sync previewMode with widget's configured render mode
        // For 'hybrid' mode, default to native but allow toggle
        // For 'image' or 'native', use that mode directly
        if (widget.renderMode === 'hybrid') {
          previewMode = 'native'; // Default to native for hybrid, user can toggle
        } else {
          previewMode = widget.renderMode || 'native';
        }
        
        debugLog('factory', 'widget.load.success', { 
          name: widget.name, 
          version: widget.version,
          renderMode: widget.renderMode,
          hasServerCode: !!widget.serverCode,
          hasClientCode: !!widget.clientCode,
          hasHtmlTemplate: !!widget.htmlTemplate
        });
        
        // Initialize preview config/styles from schemas
        initPreviewDefaults();
        
        // Determine which file to show first based on available code
        if (widget.serverCode) {
          activeFile = 'server';
        } else if (widget.clientCode) {
          activeFile = 'client';
        } else if (widget.code) {
          activeFile = 'client';
        } else if (widget.htmlTemplate) {
          activeFile = 'template';
        }
        
        // Initialize editor after widget loads
        setTimeout(() => initEditor(getActiveCode()), 100);
        
        // Load versions and assets
        await Promise.all([loadVersions(), loadAssets()]);
        
        // Auto-render preview on load
        debugLog('factory', 'preview.autoRender', { widgetName: widget.name });
        setTimeout(() => runPreview(), 200);
      } else {
        error = data.error || 'Failed to load widget';
        debugLog('factory', 'widget.load.error', { error });
      }
    } catch (err) {
      error = err.message;
      debugLog('factory', 'widget.load.error', { error: err.message });
    } finally {
      loading = false;
    }
  }
  
  async function loadAssets() {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/assets`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        widgetAssets = data.assets || [];
      }
    } catch (err) {
      console.error('Failed to load assets:', err);
    }
  }
  
  // Database functions
  async function loadTableData(tableName) {
    if (!widget?.uuid) return;
    dbTableName = tableName;
    try {
      const response = await fetch(
        `/api/extensions/slidecast/widgets/${widget.uuid}/tables/${tableName}`,
        { credentials: 'same-origin' }
      );
      const data = await response.json();
      if (data.success) {
        dbTableData = data.rows || [];
      } else {
        showToast(`Failed to load table: ${data.error}`, 'error');
        dbTableData = [];
      }
    } catch (err) {
      showToast(`Failed to load table: ${err.message}`, 'error');
      dbTableData = [];
    }
  }
  
  async function clearTableData() {
    if (!widget?.uuid || !dbTableName) return;
    if (!confirm(`Clear all data from "${dbTableName}"? This cannot be undone.`)) return;
    
    try {
      const response = await fetch(
        `/api/extensions/slidecast/widgets/${widget.uuid}/tables/${dbTableName}`,
        { 
          method: 'DELETE',
          credentials: 'same-origin' 
        }
      );
      const data = await response.json();
      if (data.success) {
        dbTableData = [];
        showToast(`Cleared table: ${dbTableName}`, 'success');
      } else {
        showToast(`Failed to clear table: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Failed to clear table: ${err.message}`, 'error');
    }
  }
  
  function getActiveCode() {
    if (!widget) return '';
    switch (activeFile) {
      case 'server': return widget.serverCode || '';
      case 'template': return widget.htmlTemplate || '';
      case 'client': return widget.clientCode || widget.code || '';
      default: return '';
    }
  }
  
  function setActiveCode(code) {
    if (!widget) return;
    switch (activeFile) {
      case 'server': widget.serverCode = code; break;
      case 'template': widget.htmlTemplate = code; break;
      case 'client': 
        // If using new structure, use clientCode, otherwise legacy code
        if (widget.clientCode !== undefined || widget.serverCode || widget.htmlTemplate) {
          widget.clientCode = code;
        } else {
          widget.code = code;
        }
        break;
    }
    isDirty = true;
  }
  
  function switchFile(file) {
    if (!monaco || !editor) return;
    
    // Save current code before switching
    const currentCode = editor.getValue();
    setActiveCode(currentCode);
    
    activeFile = file;
    
    // Set new content and language
    const code = getActiveCode();
    const language = file === 'template' ? 'html' : 'javascript';
    
    editor.setValue(code);
    monaco.editor.setModelLanguage(editor.getModel(), language);
  }

  async function loadFonts() {
    try {
      const response = await fetch('/api/extensions/slidecast/widgets/meta/fonts', {
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        fonts = data.fonts || [];
        fontCategories = data.categories || [];
      }
    } catch (err) {
      console.error('Failed to load fonts:', err);
    }
  }

  async function loadVersions() {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/versions`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        versions = data.versions || [];
      }
    } catch (err) {
      console.error('Failed to load versions:', err);
    }
  }

  async function loadSecrets() {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/secrets`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        secrets = data.secrets || [];
      }
    } catch (err) {
      console.error('Failed to load secrets:', err);
    }
  }

  function initPreviewDefaults() {
    // Initialize config defaults
    if (widget.configSchema) {
      for (const [key, field] of Object.entries(widget.configSchema)) {
        if (previewConfig[key] === undefined && field.default !== undefined) {
          previewConfig[key] = field.default;
        }
      }
    }
    // Initialize style defaults
    if (widget.styleSchema) {
      for (const [key, field] of Object.entries(widget.styleSchema)) {
        if (previewStyles[key] === undefined && field.default !== undefined) {
          previewStyles[key] = field.default;
        }
      }
    }
  }

  async function saveWidget() {
    if (!editor) return;
    
    saving = true;
    try {
      // Save current editor content to the active file
      const currentCode = editor.getValue();
      setActiveCode(currentCode);
      
      // Build the update payload with all code fields
      const payload = {
        name: widget.name,
        description: widget.description,
        category: widget.category,
        renderMode: widget.renderMode,
        configSchema: widget.configSchema,
        styleSchema: widget.styleSchema,
        defaultSize: widget.defaultSize,
        refreshInterval: widget.refreshInterval
      };
      
      // Include all code fields
      if (widget.serverCode !== undefined) payload.serverCode = widget.serverCode;
      if (widget.clientCode !== undefined) payload.clientCode = widget.clientCode;
      if (widget.htmlTemplate !== undefined) payload.htmlTemplate = widget.htmlTemplate;
      if (widget.code !== undefined) payload.code = widget.code;
      
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.success) {
        widget = data.widget;
        isDirty = false;
        showToast('Widget saved', 'success');
        await loadVersions();
      } else {
        showToast(data.error || 'Failed to save', 'error');
      }
    } catch (err) {
      showToast('Failed to save widget', 'error');
    } finally {
      saving = false;
    }
  }

  async function runPreview() {
    if (!editor) return;
    
    debugLog('factory', 'preview.run.start', { widgetName: widget?.name, widgetId });
    previewLoading = true;
    previewError = null;
    
    const startTime = performance.now();
    
    try {
      const code = editor.getValue();
      
      // First validate with proper code type based on active file
      const validateBody = {};
      if (activeFile === 'server') {
        validateBody.serverCode = code;
      } else if (activeFile === 'template') {
        validateBody.htmlTemplate = code;
      } else {
        // client or legacy
        validateBody.clientCode = code;
      }
      
      const validateRes = await fetch('/api/extensions/slidecast/widgets/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(validateBody)
      });
      const validateData = await validateRes.json();
      
      if (!validateData.valid) {
        previewError = validateData.errors.join('\n');
        previewResult = null;
        previewLoading = false;
        debugLog('factory', 'preview.run.validationError', { errors: validateData.errors });
        return;
      }
      
      // Execute preview with unsaved code from editor
      // Build code overrides based on which file is being edited
      const codeOverrides = {};
      if (activeFile === 'server') {
        codeOverrides.serverCode = code;
      } else if (activeFile === 'template') {
        codeOverrides.htmlTemplate = code;
      } else if (activeFile === 'client') {
        // For new multi-file widgets use clientCode, for legacy use code
        if (widget?.clientCode !== undefined || !widget?.code) {
          codeOverrides.clientCode = code;
        } else {
          codeOverrides.code = code;
        }
      }
      
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          config: previewConfig,
          styles: previewStyles,
          forceImage: previewMode === 'image',
          size: previewMode === 'image' ? previewSize : undefined,
          ...codeOverrides  // Include unsaved code for live preview
        })
      });

      const data = await response.json();
      const duration = Math.round(performance.now() - startTime);
      
      if (data.success) {
        previewResult = data;
        debugLog('factory', 'preview.run.success', { 
          widgetName: widget?.name, 
          renderMode: data.renderMode,
          primitivesCount: data.primitives?.length || 0,
          hasImage: !!data.imageUrl,
          hasHtml: !!data.html,
          forceImagePreview: data.forceImagePreview || false,
          forceImageError: data.forceImageError || null,
          imageUrl: data.imageUrl || null,
          duration: `${duration}ms`
        });
      } else {
        previewError = data.error;
        previewResult = data;
        debugLog('factory', 'preview.run.error', { error: data.error, duration: `${duration}ms` });
      }
    } catch (err) {
      previewError = err.message;
      debugLog('factory', 'preview.run.networkError', { error: err.message });
    } finally {
      previewLoading = false;
    }
  }

  // Animation preview functions
  async function loadSpriteSheet() {
    if (!widget?.supportsAnimation || !widgetId) return;
    
    spriteLoading = true;
    spriteMetadata = null;
    
    try {
      const params = new URLSearchParams({
        config: JSON.stringify(previewConfig),
        styles: JSON.stringify(previewStyles),
        width: previewSize.width.toString(),
        height: previewSize.height.toString(),
        fps: animationFps.toString(),
        frames: animationFrameCount.toString()
      });
      
      const response = await fetch(
        `/api/extensions/slidecast/protocol/widget/${widgetId}/sprite?${params}`
      );
      const data = await response.json();
      
      if (data.success && data.status === 'ready') {
        spriteMetadata = data;
        debugLog('factory', 'animation.loaded', { 
          frameCount: data.frameCount, 
          fps: data.fps,
          sheetSize: `${data.sheetWidth}x${data.sheetHeight}`
        });
      } else if (data.status === 'busy') {
        showToast('Server busy generating sprite sheet. Try again later.', 'info');
      } else {
        showToast(data.error || 'Failed to generate sprite sheet', 'error');
      }
    } catch (err) {
      console.error('Failed to load sprite sheet:', err);
      showToast('Failed to load sprite sheet: ' + err.message, 'error');
    } finally {
      spriteLoading = false;
    }
  }

  function startAnimation() {
    if (!spriteMetadata) return;
    animationPlaying = true;
    animationFrame = 0;
    
    animationTimer = setInterval(() => {
      animationFrame = (animationFrame + 1) % spriteMetadata.frameCount;
    }, 1000 / spriteMetadata.fps);
  }

  function stopAnimation() {
    animationPlaying = false;
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  function toggleAnimationMode() {
    animationMode = !animationMode;
    if (animationMode) {
      loadSpriteSheet();
    } else {
      stopAnimation();
      spriteMetadata = null;
    }
  }

  function stepAnimationFrame(delta) {
    if (!spriteMetadata) return;
    animationFrame = (animationFrame + delta + spriteMetadata.frameCount) % spriteMetadata.frameCount;
  }

  function confirmPublish() {
    showPublishModal = true;
  }

  async function publishWidget() {
    try {
      await saveWidget();
      
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/publish`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        widget = data.widget;
        showPublishModal = false;
        showToast('Widget published!', 'success');
      } else {
        showToast(data.error || 'Failed to publish', 'error');
      }
    } catch (err) {
      showToast('Failed to publish widget', 'error');
    }
  }

  function confirmDelete() {
    showDeleteModal = true;
  }

  async function deleteWidget() {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast('Widget deleted', 'success');
        setTimeout(() => {
          window.location.href = '/ext/slidecast/widgets';
        }, 500);
      } else {
        showToast(data.error || 'Cannot delete widget', 'error');
      }
    } catch (err) {
      showToast('Failed to delete widget', 'error');
    }
  }

  function confirmRestore(version) {
    selectedVersion = version;
    showRestoreModal = true;
  }

  async function restoreVersion() {
    if (!selectedVersion) return;
    
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/versions/${selectedVersion.version}/restore`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        widget = data.widget;
        if (editor) {
          editor.setValue(widget.code);
        }
        isDirty = false;
        showRestoreModal = false;
        selectedVersion = null;
        showToast(`Restored to v${selectedVersion.version}`, 'success');
        await loadVersions();
      } else {
        showToast(data.error || 'Failed to restore', 'error');
      }
    } catch (err) {
      showToast('Failed to restore version', 'error');
    }
  }

  async function addSecret() {
    if (!newSecretKey || !newSecretValue) return;
    
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          keyName: newSecretKey,
          value: newSecretValue
        })
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Secret "${newSecretKey}" added`, 'success');
        newSecretKey = '';
        newSecretValue = '';
        await loadSecrets();
      } else {
        showToast(data.error || 'Failed to add secret', 'error');
      }
    } catch (err) {
      showToast('Failed to add secret', 'error');
    }
  }

  async function deleteSecret(keyName) {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/secrets/${keyName}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast('Secret deleted', 'success');
        await loadSecrets();
      } else {
        showToast('Failed to delete secret', 'error');
      }
    } catch (err) {
      showToast('Failed to delete secret', 'error');
    }
  }

  function openSecretsModal() {
    loadSecrets();
    showSecretsModal = true;
  }

  function goto(path) {
    window.location.href = path;
  }

  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleString();
  }

</script>

<svelte:head>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <link rel="stylesheet" href="/api/extensions/slidecast/static/studio.css" />
</svelte:head>

<div class="factory-page">
  {#if loading}
    <div class="loading-overlay">
      <div class="spinner"></div>
      <p>Loading widget...</p>
    </div>
  {:else if error}
    <div class="error-overlay">
      <p>{error}</p>
      <button class="btn btn-primary" on:click={() => goto('/ext/slidecast/widgets')}>Back to Library</button>
    </div>
  {:else}
    <!-- Header -->
    <div class="factory-header">
      <div class="header-left">
        <button class="back-btn" on:click={() => goto('/ext/slidecast/widgets')}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div class="widget-title">
          <input 
            type="text" 
            class="title-input"
            bind:value={widget.name}
            on:input={() => isDirty = true}
          />
          {#if isDirty}
            <span class="dirty-badge">Unsaved</span>
          {/if}
        </div>
      </div>
      
      <div class="header-actions">
        <button class="btn btn-ghost help-btn" on:click={() => showHelpModal = true} title="Help & Documentation">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button class="btn btn-ghost" on:click={openSecretsModal}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Secrets
        </button>
        <button class="btn btn-ghost" on:click={() => showSettings = !showSettings}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
        <button class="btn btn-secondary" on:click={runPreview} disabled={previewLoading}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Run
        </button>
        <button class="btn btn-secondary" on:click={saveWidget} disabled={saving || !isDirty}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {#if !widget.isSystem}
          <button class="btn btn-primary" on:click={confirmPublish}>
            Publish
          </button>
        {/if}
      </div>
    </div>

    <!-- Main Content -->
    <div class="factory-content">
      <!-- Left Sidebar -->
      <div class="left-panel" class:collapsed={leftPanelCollapsed}>
        {#if leftPanelCollapsed}
          <!-- Collapsed View -->
          <button 
            class="panel-expand-btn"
            on:click={() => togglePanelCollapse('left')}
            title="Expand Files Panel"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            <span class="expand-label">Files</span>
          </button>
        {:else}
        <div class="panel-header">
          <span class="panel-title">Files</span>
          <button 
            class="panel-collapse-btn"
            on:click={() => togglePanelCollapse('left')}
            title="Collapse Panel"
            disabled={!canCollapse('left')}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div class="left-panel-tabs">
          <button 
            class="left-tab" 
            class:active={leftPanelTab === 'files'}
            on:click={() => leftPanelTab = 'files'}
            title="Files"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
          <button 
            class="left-tab" 
            class:active={leftPanelTab === 'primitives'}
            on:click={() => leftPanelTab = 'primitives'}
            title="Primitives"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </button>
          <button 
            class="left-tab" 
            class:active={leftPanelTab === 'snippets'}
            on:click={() => leftPanelTab = 'snippets'}
            title="Snippets"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <button 
            class="left-tab" 
            class:active={leftPanelTab === 'database'}
            on:click={() => leftPanelTab = 'database'}
            title="Database"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </button>
        </div>
        
        <div class="left-panel-content">
          {#if leftPanelTab === 'files'}
            <FileTree 
              {widget}
              {activeFile}
              assets={widgetAssets}
              on:select={(e) => switchFile(e.detail.file)}
              on:openAssets={() => showAssetManager = true}
            />
          {:else if leftPanelTab === 'primitives'}
            <div class="panel-section">
              <h4>Primitives</h4>
              <div class="primitive-list">
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'box',
  padding: 20,
  background: '#1a1a2e',
  borderRadius: 12,
  children: []
}`})}>
                  <span class="prim-icon">▢</span>
                  <span class="prim-info">
                    <strong>box</strong>
                    <small>Container with flex</small>
                  </span>
                </button>
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'stack',
  direction: 'vertical',
  gap: 12,
  children: []
}`})}>
                  <span class="prim-icon">☰</span>
                  <span class="prim-info">
                    <strong>stack</strong>
                    <small>Flex row/column</small>
                  </span>
                </button>
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'text',
  content: 'Hello',
  style: {
    fontSize: 24,
    color: '#ffffff'
  }
}`})}>
                  <span class="prim-icon">T</span>
                  <span class="prim-info">
                    <strong>text</strong>
                    <small>Text content</small>
                  </span>
                </button>
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'image',
  src: 'https://...',
  width: 100,
  height: 100
}`})}>
                  <span class="prim-icon">🖼</span>
                  <span class="prim-info">
                    <strong>image</strong>
                    <small>Image element</small>
                  </span>
                </button>
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'spacer',
  flex: 1
}`})}>
                  <span class="prim-icon">↔</span>
                  <span class="prim-info">
                    <strong>spacer</strong>
                    <small>Flexible space</small>
                  </span>
                </button>
                <button class="primitive-item" on:click={() => editor?.trigger('keyboard', 'type', {text: `{
  type: 'divider',
  color: 'rgba(255,255,255,0.2)'
}`})}>
                  <span class="prim-icon">—</span>
                  <span class="prim-info">
                    <strong>divider</strong>
                    <small>Line separator</small>
                  </span>
                </button>
              </div>
            </div>
          {:else if leftPanelTab === 'snippets'}
            <div class="panel-section">
              <h4>Code Snippets</h4>
              <div class="snippet-list">
                {#each CODE_SNIPPETS as snippet}
                  <button class="snippet-item" on:click={() => insertSnippet(snippet)}>
                    <strong>{snippet.name}</strong>
                    <small>{snippet.description}</small>
                  </button>
                {/each}
              </div>
              <div class="api-shortcuts">
                <h4>API Quick Access</h4>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "context.debug('value')"})}>
                  <code>debug()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "context.api.system.time()"})}>
                  <code>system.time()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "context.api.system.date()"})}>
                  <code>system.date()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "await context.api.http.get('url')"})}>
                  <code>http.get()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "context.api.assets.get('file.png')"})}>
                  <code>assets.get()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "await context.api.db.get('table', { key: 'value' })"})}>
                  <code>db.get()</code>
                </button>
                <button class="api-item" on:click={() => editor?.trigger('keyboard', 'type', {text: "await context.api.secrets.get('KEY')"})}>
                  <code>secrets.get()</code>
                </button>
              </div>
            </div>
          {:else if leftPanelTab === 'database'}
            <div class="panel-section">
              <h4>Widget Database</h4>
              {#if widget?.tableSchema && Object.keys(widget.tableSchema).length > 0}
                <div class="db-info">
                  <p class="db-hint">This widget defines custom tables for data storage.</p>
                  
                  <h5>Tables</h5>
                  <div class="db-tables">
                    {#each Object.entries(widget.tableSchema) as [tableName, schema]}
                      <div class="db-table">
                        <div class="db-table-header">
                          <span class="db-table-name">{tableName}</span>
                          <button 
                            class="db-table-action"
                            on:click={() => loadTableData(tableName)}
                            title="Load data"
                          >
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        </div>
                        <div class="db-table-fields">
                          {#each Object.entries(schema) as [field, type]}
                            <span class="db-field">
                              <code>{field}</code>
                              <small>{type}</small>
                            </span>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  </div>
                  
                  {#if dbTableData}
                    <div class="db-data-preview">
                      <h5>Data Preview: {dbTableName}</h5>
                      <div class="db-data-stats">
                        <span>{dbTableData.length} row(s)</span>
                        <button class="db-clear-btn" on:click={clearTableData}>Clear</button>
                      </div>
                      {#if dbTableData.length > 0}
                        <div class="db-data-list">
                          {#each dbTableData.slice(0, 5) as row}
                            <pre class="db-row">{JSON.stringify(row, null, 2)}</pre>
                          {/each}
                          {#if dbTableData.length > 5}
                            <p class="db-more">...and {dbTableData.length - 5} more rows</p>
                          {/if}
                        </div>
                      {:else}
                        <p class="db-empty">No data in this table</p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="db-empty-state">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="48" height="48">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  <h5>No Database Tables</h5>
                  <p>This widget doesn't define any database tables.</p>
                  <p class="db-hint">Add a <code>tables</code> section to your widget manifest to enable widget-scoped data storage.</p>
                  <button class="db-example-btn" on:click={() => showDbSchemaExample = true}>
                    Show Example
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
        {/if}
      </div>

      <!-- Editor + Preview Container (fluid with divider) -->
      <div class="fluid-panels-container" bind:this={dividerContainerRef}>
        <!-- Editor Panel -->
        <div 
          class="editor-panel" 
          class:collapsed={editorCollapsed}
          style={!editorCollapsed && !rightPanelCollapsed ? `flex: 0 0 ${editorWidthPercent}%; width: ${editorWidthPercent}%` : ''}
        >
          {#if editorCollapsed}
            <button 
              class="panel-expand-btn vertical"
              on:click={() => togglePanelCollapse('editor')}
              title="Expand Editor"
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span class="expand-label">Editor</span>
            </button>
          {:else}
            <div class="panel-header">
              <span class="panel-title">Code Editor</span>
              <span class="editor-hint">Ctrl+S to save, Ctrl+Enter to run</span>
              <button 
                class="panel-collapse-btn"
                on:click={() => togglePanelCollapse('editor')}
                title="Collapse Panel"
                disabled={!canCollapse('editor')}
              >
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            </div>
          {/if}
          <!-- Keep WidgetEditor mounted always, hide when collapsed -->
          <div class="editor-wrapper" class:hidden={editorCollapsed}>
            <WidgetEditor bind:editorContainer />
          </div>
        </div>

        <!-- Resizable Divider -->
        {#if !editorCollapsed && !rightPanelCollapsed}
          <div 
            class="panel-divider"
            class:dragging={isDraggingDivider}
            on:mousedown={startDividerDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            tabindex="0"
            on:keydown={(e) => {
              if (e.key === 'ArrowLeft') { editorWidthPercent = Math.max(15, editorWidthPercent - 5); saveDividerPosition(); }
              if (e.key === 'ArrowRight') { editorWidthPercent = Math.min(85, editorWidthPercent + 5); saveDividerPosition(); }
            }}
          >
            <div class="divider-handle"></div>
          </div>
        {/if}

        <!-- Right Panel -->
        <div 
          class="right-panel" 
          class:collapsed={rightPanelCollapsed}
          style={!editorCollapsed && !rightPanelCollapsed ? `flex: 0 0 ${100 - editorWidthPercent}%; width: ${100 - editorWidthPercent}%` : ''}
        >
        {#if rightPanelCollapsed}
          <button 
            class="panel-expand-btn"
            on:click={() => togglePanelCollapse('right')}
            title="Expand Preview Panel"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span class="expand-label">Preview</span>
          </button>
        {:else}
        <!-- Panel Header with Collapse Button -->
        <div class="panel-header">
          <span class="panel-title">Preview</span>
          <button 
            class="panel-collapse-btn"
            on:click={() => togglePanelCollapse('right')}
            title="Collapse Panel"
            disabled={!canCollapse('right')}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <!-- Panel Tabs -->
        <div class="panel-tabs">
          <button 
            class="tab" 
            class:active={activePanel === 'preview'}
            on:click={() => activePanel = 'preview'}
          >Preview</button>
          <button 
            class="tab" 
            class:active={activePanel === 'debug'}
            on:click={() => activePanel = 'debug'}
          >Debug</button>
          <button 
            class="tab" 
            class:active={activePanel === 'output'}
            on:click={() => activePanel = 'output'}
          >Output</button>
          <button 
            class="tab" 
            class:active={activePanel === 'versions'}
            on:click={() => activePanel = 'versions'}
          >Versions</button>
        </div>

        <!-- Preview Panel - Canvas-based (like Studio) -->
        {#if activePanel === 'preview'}
          <div class="preview-panel">
            <!-- Preview Toolbar -->
            <div class="preview-toolbar">
              <div class="size-controls">
                <input 
                  type="number" 
                  bind:value={previewSize.width}
                  on:input={() => { isDirty = true; runPreview(); }}
                  min="50"
                  max="1920"
                /> × 
                <input 
                  type="number" 
                  bind:value={previewSize.height}
                  on:input={() => { isDirty = true; runPreview(); }}
                  min="50"
                  max="1080"
                />
              </div>
              <button 
                class="preview-mode-btn"
                class:image-mode={previewMode === 'image'}
                class:locked={widget?.renderMode && widget.renderMode !== 'hybrid'}
                on:click={() => { 
                  // Only allow toggle for hybrid mode - otherwise mode is locked
                  if (widget?.renderMode === 'hybrid' || !widget?.renderMode) {
                    previewMode = previewMode === 'native' ? 'image' : 'native'; 
                    runPreview(); 
                  }
                }}
                title={widget?.renderMode === 'hybrid' 
                  ? (previewMode === 'native' ? 'Switch to Image preview' : 'Switch to Native preview')
                  : `Render mode locked to ${widget?.renderMode || 'native'} (change in Settings)`}
              >
                {#if previewMode === 'native'}
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Native
                {:else}
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Image
                {/if}
                {#if widget?.renderMode && widget.renderMode !== 'hybrid'}
                  <span class="lock-icon">🔒</span>
                {/if}
              </button>
              <button 
                class="auto-refresh-btn" 
                class:active={autoRefresh}
                on:click={toggleAutoRefresh}
                title="Auto-refresh preview at widget's refresh interval"
              >
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {autoRefresh ? 'Auto' : 'Auto'}
              </button>
              {#if widget?.supportsAnimation}
                <button 
                  class="animate-btn"
                  class:active={animationMode}
                  on:click={toggleAnimationMode}
                  title="Toggle Animation Preview (sprite sheet)"
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" fill={animationMode ? 'currentColor' : 'none'}></polygon>
                  </svg>
                  {animationMode ? 'Animating' : 'Animate'}
                </button>
              {/if}
            </div>
            
            <!-- Canvas Container (like Studio) -->
            <div class="preview-canvas-container">
              <div class="preview-canvas-wrapper">
                <!-- Animation Preview (when animationMode is active) -->
                {#if animationMode}
                  {#if spriteLoading}
                    <div class="animation-loading">
                      <div class="animation-spinner"></div>
                      <span>Generating sprite sheet...</span>
                    </div>
                  {:else if spriteMetadata}
                    <div class="animation-preview">
                      <div 
                        class="animation-canvas" 
                        style="width: {spriteMetadata.frameWidth}px; height: {spriteMetadata.frameHeight}px;"
                      >
                        <div 
                          class="sprite-viewport"
                          style="
                            width: {spriteMetadata.frameWidth}px;
                            height: {spriteMetadata.frameHeight}px;
                            background-image: url({spriteMetadata.sheetUrl});
                            background-position: -{spriteMetadata.frameOffsets[animationFrame][0]}px -{spriteMetadata.frameOffsets[animationFrame][1]}px;
                            background-size: {spriteMetadata.sheetWidth}px {spriteMetadata.sheetHeight}px;
                          "
                        ></div>
                      </div>
                      
                      <div class="animation-controls">
                        <button 
                          class="anim-control-btn"
                          on:click={() => stepAnimationFrame(-1)}
                          title="Previous frame"
                          disabled={animationPlaying}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                          </svg>
                        </button>
                        <button 
                          class="anim-control-btn play"
                          on:click={() => animationPlaying ? stopAnimation() : startAnimation()}
                          title={animationPlaying ? 'Pause' : 'Play'}
                        >
                          {#if animationPlaying}
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          {:else}
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          {/if}
                        </button>
                        <button 
                          class="anim-control-btn"
                          on:click={() => stepAnimationFrame(1)}
                          title="Next frame"
                          disabled={animationPlaying}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                          </svg>
                        </button>
                      </div>
                      
                      <div class="animation-info">
                        <span class="frame-counter">Frame {animationFrame + 1} / {spriteMetadata.frameCount}</span>
                        <span class="fps-info">{spriteMetadata.fps} FPS</span>
                        <span class="sheet-info">{spriteMetadata.sheetWidth}×{spriteMetadata.sheetHeight}px</span>
                      </div>
                    </div>
                  {:else}
                    <div class="animation-placeholder">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="48" height="48">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Failed to load sprite sheet</span>
                      <button class="retry-btn" on:click={loadSpriteSheet}>Retry</button>
                    </div>
                  {/if}
                {:else}
                  <!-- Floating Widget Toolbar (like Studio) -->
                  {#if previewSlide && widget}
                    <div class="widget-floating-toolbar">
                      <button class="widget-toolbar-btn primary" on:click={openWidgetConfigWindow} title="Configure Widget">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                        Configure
                      </button>
                      <span class="widget-toolbar-name">{widget.name || 'Widget'}</span>
                    </div>
                  {/if}
                  
                  <div 
                    class="preview-canvas-frame"
                    class:selected={previewSlide}
                    style="width: {previewSize.width}px; height: {previewSize.height}px;"
                    on:click={openWidgetConfigWindow}
                    on:keydown={(e) => e.key === 'Enter' && openWidgetConfigWindow()}
                    role="button"
                    tabindex="0"
                  >
                    {#if previewSlide}
                      <SlideRenderer
                        slide={previewSlide}
                        variables={{}}
                        scale={1}
                        width={previewSize.width}
                        height={previewSize.height}
                        editMode={false}
                        selectedElementId={null}
                      />
                    {:else}
                      <div class="preview-placeholder">
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Press Ctrl+Enter or click "Run" to preview</span>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
            
            <!-- Preview Info -->
            <div class="preview-info">
              {#if previewResult}
                <span class="info-badge mode">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  {previewResult.renderMode}
                </span>
                <span class="info-badge refresh">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {previewResult.refreshInterval >= 60000 
                    ? `${previewResult.refreshInterval / 60000}m` 
                    : previewResult.refreshInterval >= 1000 
                      ? `${previewResult.refreshInterval / 1000}s`
                      : `${previewResult.refreshInterval}ms`}
                </span>
                <span class="info-badge duration {previewResult.duration > 1000 ? 'slow' : previewResult.duration > 200 ? 'ok' : 'fast'}">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {previewResult.duration}ms
                </span>
                {#if previewResult.success === false}
                  <span class="info-badge error">Error</span>
                {/if}
              {/if}
            </div>
          </div>
        {/if}

        <!-- Debug Panel -->
        {#if activePanel === 'debug'}
          <div class="debug-panel">
            <!-- Render Info Section -->
            {#if previewResult}
              <h4>Render Info</h4>
              <div class="render-info">
                <div class="info-row">
                  <span class="info-label">Mode:</span>
                  <span class="info-value {previewResult.renderMode}">{previewResult.renderMode}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Duration:</span>
                  <span class="info-value">{previewResult.duration}ms</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Primitives:</span>
                  <span class="info-value">{previewResult.primitives?.length || 0} elements</span>
                </div>
                {#if previewResult.forceImageError}
                  <div class="info-row error">
                    <span class="info-label">❌ Image Error:</span>
                    <span class="info-value error-text">{previewResult.forceImageError}</span>
                  </div>
                  {#if previewResult.imageUrl}
                    <div class="info-row image-url-row">
                      <span class="info-label">🖼️ Image URL:</span>
                      <a href={previewResult.imageUrl} target="_blank" class="info-value url" title="Click to open image in new tab (will show error)">
                        {previewResult.imageUrl}
                      </a>
                    </div>
                  {/if}
                {:else if previewResult.imageUrl}
                  <div class="info-row image-url-row">
                    <span class="info-label">🖼️ Image URL:</span>
                    <a href={previewResult.imageUrl} target="_blank" class="info-value url" title="Click to open image in new tab">
                      {previewResult.imageUrl}
                    </a>
                  </div>
                  <div class="image-preview-hint">
                    ✅ Image generated successfully. Roku/devices will fetch this URL.
                  </div>
                {:else if previewResult.renderMode === 'image'}
                  <div class="info-row error">
                    <span class="info-label">⚠️ Image URL:</span>
                    <span class="info-value">NOT GENERATED - Check server logs</span>
                  </div>
                {/if}
              </div>
            {/if}
            
            <h4>Logs</h4>
            <div class="log-list">
              {#if previewResult?.logs?.length > 0}
                {#each previewResult.logs as log}
                  <div class="log-entry {log.level || log.type}">
                    <span class="log-level">[{log.level || log.type}]</span>
                    <span class="log-message">{log.message || log.url || JSON.stringify(log)}</span>
                  </div>
                {/each}
              {:else}
                <p class="no-logs">No logs yet. Run the widget to see logs.</p>
              {/if}
            </div>
            
            {#if previewResult?.validation?.errors?.length > 0}
              <h4>Validation Errors</h4>
              <div class="error-list">
                {#each previewResult.validation.errors as error}
                  <div class="error-entry">{error}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Output Panel -->
        {#if activePanel === 'output'}
          <div class="output-panel">
            <h4>Render Output</h4>
            {#if previewResult?.primitives}
              <pre class="output-json">{JSON.stringify(previewResult.primitives, null, 2)}</pre>
            {:else}
              <p class="no-output">Run the widget to see output.</p>
            {/if}
          </div>
        {/if}

        <!-- Versions Panel -->
        {#if activePanel === 'versions'}
          <div class="versions-panel">
            <h4>Version History</h4>
            {#if versions.length > 0}
              <div class="version-list">
                {#each versions as version}
                  <div class="version-entry">
                    <div class="version-info">
                      <span class="version-number">v{version.version}</span>
                      <span class="version-date">{formatDate(version.createdAt)}</span>
                    </div>
                    <button class="btn btn-sm" on:click={() => confirmRestore(version)}>
                      Restore
                    </button>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="no-versions">No versions saved yet. Publish to create a version.</p>
            {/if}
          </div>
        {/if}
        {/if}
      </div>
      </div> <!-- End fluid-panels-container -->
    </div>

    <!-- Settings Drawer -->
    {#if showSettings}
      <div class="settings-drawer">
        <div class="drawer-header">
          <h3>Widget Settings</h3>
          <button class="close-btn" on:click={() => showSettings = false}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div class="settings-content">
          <div class="form-group">
            <label>Description</label>
            <textarea 
              bind:value={widget.description}
              on:input={() => isDirty = true}
              placeholder="Describe what this widget does..."
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Category</label>
            <select bind:value={widget.category} on:change={() => isDirty = true}>
              <option value="time">⏰ Time & Date</option>
              <option value="info">📰 Information</option>
              <option value="content">📝 Content</option>
              <option value="smart-home">🏠 Smart Home</option>
              <option value="data">📊 Data</option>
              <option value="utility">🔧 Utility</option>
              <option value="custom">✨ Custom</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Render Mode</label>
            <select bind:value={widget.renderMode} on:change={() => { 
              isDirty = true; 
              // Sync preview mode when render mode changes
              if (widget.renderMode === 'hybrid') {
                // For hybrid, keep current preview mode
              } else {
                previewMode = widget.renderMode;
              }
              runPreview();
            }}>
              <option value="image">Image (Server-rendered PNG)</option>
              <option value="native">Native (Client-rendered)</option>
              <option value="hybrid">Hybrid (Instance chooses)</option>
            </select>
            <p class="hint">
              Image: Complex designs, custom fonts. Native: Crisp text, fast updates. Hybrid: Instance decides.
            </p>
          </div>
          
          <div class="form-group">
            <label>Refresh Interval (ms)</label>
            <input 
              type="number" 
              bind:value={widget.refreshInterval}
              on:input={() => isDirty = true}
              min="0"
              step="1000"
            />
            <p class="hint">0 = static (no refresh), 1000 = every second</p>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Default Width</label>
              <input 
                type="number" 
                bind:value={widget.defaultSize.width}
                on:input={() => isDirty = true}
                min="50"
              />
            </div>
            <div class="form-group">
              <label>Default Height</label>
              <input 
                type="number" 
                bind:value={widget.defaultSize.height}
                on:input={() => isDirty = true}
                min="50"
              />
            </div>
          </div>

          <!-- Schema Builders -->
          <div class="schema-builders">
            <h4>Schemas & Tabs</h4>
            <p class="hint">Define configuration, style options, and custom tabs</p>
            
            <div class="schema-builder-buttons">
              <button class="schema-btn" on:click={() => openSchemaBuilder('config')}>
                <span class="schema-icon">⚙️</span>
                <span class="schema-info">
                  <strong>Config Schema</strong>
                  <small>{Object.keys(widget?.configSchema || {}).length} fields</small>
                </span>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              
              <button class="schema-btn" on:click={() => openSchemaBuilder('style')}>
                <span class="schema-icon">🎨</span>
                <span class="schema-info">
                  <strong>Style Schema</strong>
                  <small>{Object.keys(widget?.styleSchema || {}).length} fields</small>
                </span>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {#if !widget.isSystem}
            <div class="danger-zone">
              <h4>Danger Zone</h4>
              <button class="btn btn-danger" on:click={confirmDelete}>
                Delete Widget
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- Publish Modal -->
{#if showPublishModal}
  <div class="modal-overlay" on:click={() => showPublishModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Publish Widget</h2>
        <button class="close-btn" on:click={() => showPublishModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Publishing will make this widget available for use in casts and create a version snapshot.</p>
        <p>Are you sure you want to publish <strong>{widget.name}</strong>?</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showPublishModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={publishWidget}>Publish</button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Modal -->
{#if showDeleteModal}
  <div class="modal-overlay" on:click={() => showDeleteModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Delete Widget</h2>
        <button class="close-btn" on:click={() => showDeleteModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete <strong>{widget.name}</strong>?</p>
        <p class="warning-text">This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showDeleteModal = false}>Cancel</button>
        <button class="btn btn-danger" on:click={deleteWidget}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Restore Version Modal -->
{#if showRestoreModal}
  <div class="modal-overlay" on:click={() => showRestoreModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Restore Version</h2>
        <button class="close-btn" on:click={() => showRestoreModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Restore to version <strong>v{selectedVersion?.version}</strong>?</p>
        <p>Current changes will be saved as a new version first.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showRestoreModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={restoreVersion}>Restore</button>
      </div>
    </div>
  </div>
{/if}

<!-- Secrets Modal -->
{#if showSecretsModal}
  <div class="modal-overlay" on:click={() => showSecretsModal = false}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Widget Secrets</h2>
        <button class="close-btn" on:click={() => showSecretsModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Store API keys and sensitive data securely. Access with <code>api.secrets.get('key')</code></p>
        
        <div class="secrets-list">
          {#each secrets as secret}
            <div class="secret-entry">
              <span class="secret-key">{secret.keyName}</span>
              <span class="secret-value">••••••••</span>
              <button class="btn btn-sm btn-danger" on:click={() => deleteSecret(secret.keyName)}>
                Delete
              </button>
            </div>
          {:else}
            <p class="no-secrets">No secrets stored yet.</p>
          {/each}
        </div>
        
        <div class="add-secret-form">
          <input 
            type="text" 
            placeholder="Key name (e.g., API_KEY)"
            bind:value={newSecretKey}
          />
          <input 
            type="password" 
            placeholder="Secret value"
            bind:value={newSecretValue}
          />
          <button class="btn btn-primary" on:click={addSecret} disabled={!newSecretKey || !newSecretValue}>
            Add Secret
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showSecretsModal = false}>Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- Asset Manager Modal -->
<AssetManager 
  show={showAssetManager}
  {widgetId}
  assets={widgetAssets}
  on:close={() => showAssetManager = false}
  on:refresh={loadAssets}
  on:toast={(e) => showToast(e.detail.message, e.detail.type)}
/>

<!-- Schema Builder Modal - Tabbed Interface -->
<SchemaBuilder
  show={showSchemaBuilderModal}
  type={schemaBuilderType}
  bind:editingSchema
  bind:editingSchemaTabs
  bind:activeTab={schemaBuilderActiveTab}
  bind:newFieldKey
  bind:newFieldType
  bind:showAddTabForm
  bind:newSchemaTabId
  bind:newSchemaTabLabel
  bind:newSchemaTabIcon
  {FIELD_TYPES}
  {TAB_ICONS}
  {STYLE_GROUPS}
  on:close={() => showSchemaBuilderModal = false}
  on:save={saveSchema}
  on:tabSelect={(e) => schemaBuilderActiveTab = e.detail.tabId}
  on:addTab={(e) => {
    const { id, label, icon } = e.detail;
    if (!id || editingSchemaTabs.find(t => t.id === id)) {
      showToast('Please enter a unique tab ID', 'error');
      return;
    }
    editingSchemaTabs = [...editingSchemaTabs, { id, label: label || id.charAt(0).toUpperCase() + id.slice(1), icon }];
    schemaBuilderActiveTab = id;
    newSchemaTabId = '';
    newSchemaTabLabel = '';
    newSchemaTabIcon = '📋';
    showAddTabForm = false;
  }}
  on:removeTab={(e) => {
    const { tabId, action, moveToTab } = e.detail;
    
    if (action === 'delete') {
      // Delete all fields in this tab
      Object.keys(editingSchema).forEach(key => {
        if (key !== '_tabs' && editingSchema[key].tab === tabId) {
          delete editingSchema[key];
        }
      });
    } else {
      // Move fields to another tab (default behavior)
      const targetTab = moveToTab === 'default' ? '' : (moveToTab || '');
      Object.keys(editingSchema).forEach(key => {
        if (key !== '_tabs' && editingSchema[key].tab === tabId) {
          editingSchema[key].tab = targetTab;
        }
      });
    }
    
    editingSchemaTabs = editingSchemaTabs.filter(t => t.id !== tabId);
    if (schemaBuilderActiveTab === tabId) {
      schemaBuilderActiveTab = editingSchemaTabs.length > 0 ? editingSchemaTabs[0].id : 'default';
    }
    editingSchema = { ...editingSchema };
  }}
  on:moveTab={(e) => {
    const { index, direction } = e.detail;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= editingSchemaTabs.length) return;
    let tabs = [...editingSchemaTabs];
    [tabs[index], tabs[newIndex]] = [tabs[newIndex], tabs[index]];
    editingSchemaTabs = tabs;
  }}
  on:addField={(e) => {
    const { key, type } = e.detail;
    if (!key || editingSchema[key]) {
      showToast('Please enter a unique field key', 'error');
      return;
    }
    const defaults = {
      string: { type: 'string', label: key, default: '' },
      number: { type: 'number', label: key, default: 0 },
      boolean: { type: 'boolean', label: key, default: false },
      select: { type: 'select', label: key, options: [], default: '' },
      color: { type: 'color', label: key, default: '#667eea' },
      slider: { type: 'slider', label: key, min: 0, max: 100, step: 1, default: 50 },
      font: { type: 'font', label: key, default: 'system-ui' },
      entity: { type: 'entity', label: key, default: '' },
      image: { type: 'image', label: key, default: '' }
    };
    const fieldDef = defaults[type] || defaults.string;
    fieldDef.tab = schemaBuilderActiveTab === 'default' ? '' : schemaBuilderActiveTab;
    // Add default group for style schema fields
    if (schemaBuilderType === 'style') {
      fieldDef.group = 'Background';
    }
    editingSchema = { ...editingSchema, [key]: fieldDef };
    newFieldKey = '';
    showToast('Field added', 'success');
  }}
  on:removeField={(e) => {
    delete editingSchema[e.detail.key];
    editingSchema = editingSchema;
  }}
  on:moveField={(e) => {
    const { key, tabId } = e.detail;
    if (editingSchema[key]) {
      editingSchema = {
        ...editingSchema,
        [key]: {
          ...editingSchema[key],
          tab: tabId === 'default' ? '' : tabId
        }
      };
    }
  }}
  on:addFieldOption={(e) => {
    const key = e.detail.key;
    if (!editingSchema[key].options) {
      editingSchema[key].options = [];
    }
    const idx = editingSchema[key].options.length + 1;
    editingSchema[key].options.push({ value: `option${idx}`, label: `Option ${idx}` });
    editingSchema = editingSchema;
  }}
  on:removeFieldOption={(e) => {
    const { key, index } = e.detail;
    editingSchema[key].options.splice(index, 1);
    editingSchema = editingSchema;
  }}
  on:fieldUpdate={(e) => {
    editingSchema = editingSchema;
  }}
/>


<!-- Help Modal -->
{#if showHelpModal}
  <div class="modal-overlay" on:click={() => showHelpModal = false}>
    <div class="modal modal-xl help-modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>📚 Widget Development Guide</h2>
        <button class="close-btn" on:click={() => showHelpModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <div class="help-tabs">
        <button class="help-tab" class:active={helpTab === 'quickstart'} on:click={() => helpTab = 'quickstart'}>Quick Start</button>
        <button class="help-tab" class:active={helpTab === 'primitives'} on:click={() => helpTab = 'primitives'}>Primitives</button>
        <button class="help-tab" class:active={helpTab === 'api'} on:click={() => helpTab = 'api'}>API Reference</button>
        <button class="help-tab" class:active={helpTab === 'examples'} on:click={() => helpTab = 'examples'}>Templates</button>
      </div>
      
      <div class="modal-body help-body">
        {#if helpTab === 'quickstart'}
          <div class="help-section">
            <h3>🚀 Getting Started</h3>
            <p>Widgets are mini-applications that display dynamic content on your casts. They're written in JavaScript and return render primitives.</p>
            
            <h4>Basic Structure</h4>
            <pre class="code-block">{`{
  // Optional: 'native' for crisp text, 'image' for complex designs
  renderMode: 'native',
  
  // How often to refresh (in ms). 0 = static
  refreshInterval: 60000,
  
  // The render function - must return primitives
  render(ctx) {
    return {
      type: 'box',
      padding: 20,
      background: '#1a1a2e',
      children: [...]
    };
  }
}`}</pre>

            <h4>The Context Object</h4>
            <ul>
              <li><code>context.config</code> - Configuration values from Config Schema</li>
              <li><code>context.styles</code> - Style values from Style Schema</li>
              <li><code>context.data</code> - Data from server.js (in client.js only)</li>
              <li><code>context.api</code> - API methods (http, db, assets, etc.)</li>
              <li><code>context.debug()</code> - Quick debug logging</li>
              <li><code>context.log</code> - Full logging API</li>
            </ul>

            <h4>Keyboard Shortcuts</h4>
            <ul>
              <li><kbd>Ctrl+S</kbd> - Save widget</li>
              <li><kbd>Ctrl+Enter</kbd> - Run preview</li>
              <li><kbd>Ctrl+P</kbd> - Publish widget</li>
            </ul>
          </div>
        {:else if helpTab === 'primitives'}
          <div class="help-section">
            <h3>🧱 Render Primitives</h3>
            <p>Primitives are atomic building blocks that all platforms must implement.</p>
            
            <h4>box</h4>
            <pre class="code-block">{`{
  type: 'box',
  background: '#1a1a2e',
  padding: 20,
  borderRadius: 12,
  shadow: '0 4px 12px rgba(0,0,0,0.3)',
  justify: 'center',  // flex justify-content
  align: 'center',    // flex align-items
  children: [...]
}`}</pre>

            <h4>stack</h4>
            <pre class="code-block">{`{
  type: 'stack',
  direction: 'vertical', // or 'horizontal'
  gap: 12,
  padding: 16,
  children: [...]
}`}</pre>

            <h4>text</h4>
            <pre class="code-block">{`{
  type: 'text',
  content: 'Hello World',
  style: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'Inter',
    color: '#ffffff',
    textAlign: 'center'
  }
}`}</pre>

            <h4>image</h4>
            <pre class="code-block">{`{
  type: 'image',
  src: 'https://example.com/image.png',
  width: 100,
  height: 100,
  style: {
    objectFit: 'cover',
    borderRadius: 8
  }
}`}</pre>

            <h4>spacer</h4>
            <pre class="code-block">{`{
  type: 'spacer',
  flex: 1,      // Grow to fill space
  minSize: 10   // Minimum size in px
}`}</pre>

            <h4>divider</h4>
            <pre class="code-block">{`{
  type: 'divider',
  orientation: 'horizontal', // or 'vertical'
  color: 'rgba(255,255,255,0.2)',
  thickness: 1
}`}</pre>
          </div>
        {:else if helpTab === 'api'}
          <div class="help-section">
            <h3>🔌 API Reference</h3>
            <p>All APIs are accessed via <code>context.api.*</code> in your widget code.</p>
            
            <h4>context.debug() - Quick Debugging</h4>
            <pre class="code-block">{`// Easiest way to inspect values - shows in Debug panel
context.debug('Hello!');
context.debug({ myVar, config });
context.debug(serverData);`}</pre>

            <h4>context.log - Logging</h4>
            <pre class="code-block">{`// Log messages appear in the Debug panel with color coding
context.log.info('Information');   // Blue
context.log.warn('Warning');       // Yellow  
context.log.error('Error');        // Red
context.log.debug('Debug only');   // Purple`}</pre>

            <h4>context.api.http - HTTP Requests</h4>
            <pre class="code-block">{`// GET request with caching
const data = await context.api.http.get(url, {
  params: { key: 'value' },
  headers: { 'Authorization': 'Bearer ...' },
  cacheTtl: 60000,  // Cache for 1 minute
  timeout: 10000    // 10 second timeout
});

// POST request (not cached)
const response = await context.api.http.post(url, body);`}</pre>

            <h4>context.api.db - Widget Database</h4>
            <pre class="code-block">{`// Widgets can have their own tables (define in manifest.json)
// Get a single row
const row = await context.api.db.get('my_table', { id: 123 });

// Get all rows (with optional filters)
const rows = await context.api.db.getAll('my_table', { status: 'active' });

// Insert a row
await context.api.db.insert('my_table', { name: 'Test', value: 42 });

// Update rows
await context.api.db.update('my_table', { id: 123 }, { value: 99 });

// Delete rows  
await context.api.db.delete('my_table', { id: 123 });`}</pre>

            <h4>context.api.assets - Widget Assets</h4>
            <pre class="code-block">{`// Get asset as data URI (for use in primitives)
const imageDataUri = context.api.assets.get('icon.png');

// Use in image primitive
{ type: 'image', src: context.api.assets.get('logo.png'), width: 64, height: 64 }`}</pre>

            <h4>context.api.secrets - API Keys & Secrets</h4>
            <pre class="code-block">{`// Get a secret value (only in server.js, not client.js)
const apiKey = await context.api.secrets.get('MY_API_KEY');`}</pre>

            <h4>context.api.system - System Info</h4>
            <pre class="code-block">{`// Get current time
const time = context.api.system.time();
// { hours, hours12, minutes, seconds, period, formatted, timestamp }

// Get current date
const date = context.api.system.date();
// { year, month, day, weekday, monthName, formatted, iso }

// Get timezone
const tz = context.api.system.timezone();
// 'America/New_York'`}</pre>

            <h4>context.api.storage - Persistent Storage</h4>
            <pre class="code-block">{`// Store data that persists between executions
await context.api.storage.set('lastRun', Date.now());
const lastRun = await context.api.storage.get('lastRun');
await context.api.storage.delete('lastRun');`}</pre>
          </div>
        {:else if helpTab === 'examples'}
          <div class="help-section">
            <h3>📋 Widget Templates</h3>
            <p>Click a template to insert it into your widget code.</p>
            
            <div class="template-cards">
              {#each CODE_SNIPPETS as snippet}
                <div class="template-card" on:click={() => { insertSnippet(snippet); showHelpModal = false; }} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && (insertSnippet(snippet), showHelpModal = false)}>
                  <h4>{snippet.name}</h4>
                  <p>{snippet.description}</p>
                  <span class="insert-hint">Click to insert</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showHelpModal = false}>Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- Toast Container -->
<div class="toast-container">
  {#each toasts as toast (toast.id)}
    <div class="toast toast-{toast.type}">
      {#if toast.type === 'success'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      {:else if toast.type === 'error'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      {:else}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      {/if}
      <span>{toast.message}</span>
    </div>
  {/each}
</div>

<!-- Widget Configuration Window (like Studio) -->
{#if showWidgetConfig && widgetElement && widget}
  <WidgetConfigWindow 
    element={widgetElement}
    widget={widget}
    position={widgetConfigPos}
    isRunning={previewLoading}
    on:close={closeWidgetConfigWindow}
    on:configChange={handleWidgetConfigUpdate}
    on:refresh={() => runPreview()}
    on:autoRun={() => runPreview()}
    on:positionChange={(e) => widgetConfigPos = e.detail}
  />
{/if}

<style>
  .factory-page {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #0d0d14;
    color: #fff;
  }

  .loading-overlay,
  .error-overlay {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .spinner-sm {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Header */
  .factory-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .back-btn {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .back-btn svg {
    width: 18px;
    height: 18px;
  }

  .widget-title {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .title-input {
    background: none;
    border: none;
    color: #fff;
    font-size: 18px;
    font-weight: 600;
    padding: 4px 0;
    outline: none;
    border-bottom: 2px solid transparent;
  }

  .title-input:focus {
    border-bottom-color: #667eea;
  }

  .dirty-badge {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn svg {
    width: 16px;
    height: 16px;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .btn-ghost {
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
  }

  .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .btn-danger {
    background: #ef4444;
    color: #fff;
  }

  .btn-sm {
    padding: 6px 10px;
    font-size: 12px;
  }

  /* Main Content */
  .factory-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* Panel Header with Collapse Button */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .panel-title {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .editor-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    margin-left: auto;
    margin-right: 12px;
  }

  .panel-collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.2s;
  }

  .panel-collapse-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  .panel-collapse-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .panel-collapse-btn svg {
    width: 16px;
    height: 16px;
  }

  .panel-expand-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    background: rgba(102, 126, 234, 0.1);
    border: none;
    color: #667eea;
    cursor: pointer;
    transition: all 0.2s;
    padding: 12px;
  }

  .panel-expand-btn:hover {
    background: rgba(102, 126, 234, 0.2);
  }

  .panel-expand-btn svg {
    width: 20px;
    height: 20px;
  }

  .panel-expand-btn .expand-label {
    font-size: 11px;
    font-weight: 600;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: rotate(180deg);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .panel-expand-btn.vertical {
    writing-mode: horizontal-tb;
  }

  .panel-expand-btn.vertical .expand-label {
    writing-mode: horizontal-tb;
    transform: none;
  }

  /* Left Panel */
  .left-panel {
    width: 240px;
    display: flex;
    flex-direction: column;
    background: rgba(0, 0, 0, 0.3);
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    transition: width 0.3s ease;
  }

  .left-panel.collapsed {
    width: 48px;
  }

  .left-panel-tabs {
    display: flex;
    gap: 2px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .left-tab {
    flex: 1;
    padding: 8px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .left-tab svg {
    width: 18px;
    height: 18px;
  }

  .left-tab:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .left-tab.active {
    background: rgba(102, 126, 234, 0.2);
    color: #667eea;
  }

  .left-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .panel-section h4 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .widget-search input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 12px;
    margin-bottom: 8px;
  }

  .widget-search input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .widget-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: calc(100vh - 280px);
    overflow-y: auto;
  }

  .widget-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    font-size: 12px;
  }

  .widget-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .widget-item.active {
    background: rgba(102, 126, 234, 0.2);
    color: #667eea;
  }

  .widget-item .widget-icon {
    font-size: 14px;
    width: 20px;
    text-align: center;
  }

  .widget-item .widget-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .widget-item .current-badge {
    color: #667eea;
    font-size: 16px;
  }

  .new-widget-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 10px;
    margin-top: 8px;
    background: transparent;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 12px;
  }

  .new-widget-btn:hover {
    border-color: rgba(102, 126, 234, 0.5);
    color: #667eea;
  }

  .new-widget-btn svg {
    width: 14px;
    height: 14px;
  }

  /* Primitives */
  .primitive-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .primitive-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .primitive-item:hover {
    background: rgba(102, 126, 234, 0.15);
    border-color: rgba(102, 126, 234, 0.3);
  }

  .prim-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  .prim-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .prim-info strong {
    font-size: 12px;
    font-weight: 500;
  }

  .prim-info small {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Snippets */
  .snippet-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }

  .snippet-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .snippet-item:hover {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.3);
  }

  .snippet-item strong {
    font-size: 12px;
    font-weight: 500;
  }

  .snippet-item small {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }

  .api-shortcuts {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .api-shortcuts h4 {
    margin-bottom: 8px;
  }

  .api-item {
    display: block;
    width: 100%;
    padding: 6px 8px;
    margin-bottom: 4px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .api-item:hover {
    background: rgba(167, 139, 250, 0.15);
    border-color: rgba(167, 139, 250, 0.3);
  }

  .api-item code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #a78bfa;
  }

  /* Database Panel Styles */
  .db-info {
    padding: 4px 0;
  }

  .db-hint {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 16px;
  }

  .db-tables {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .db-table {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    overflow: hidden;
  }

  .db-table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .db-table-name {
    font-weight: 500;
    font-size: 13px;
    color: #a78bfa;
  }

  .db-table-action {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }

  .db-table-action:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .db-table-fields {
    padding: 8px 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .db-field {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .db-field code {
    color: #e2e8f0;
    font-family: 'JetBrains Mono', monospace;
  }

  .db-field small {
    color: rgba(255, 255, 255, 0.4);
    font-size: 10px;
  }

  .db-data-preview {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 12px;
    margin-top: 8px;
  }

  .db-data-preview h5 {
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 8px;
    color: #a78bfa;
  }

  .db-data-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .db-clear-btn {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .db-clear-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  .db-data-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .db-row {
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 8px;
    border-radius: 4px;
    margin-bottom: 4px;
    color: #e2e8f0;
    overflow-x: auto;
  }

  .db-more, .db-empty {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    padding: 8px;
  }

  .db-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    text-align: center;
    color: rgba(255, 255, 255, 0.4);
  }

  .db-empty-state svg {
    opacity: 0.3;
    margin-bottom: 12px;
  }

  .db-empty-state h5 {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 8px;
  }

  .db-empty-state p {
    font-size: 12px;
    margin: 0 0 8px;
  }

  .db-empty-state code {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    color: #a78bfa;
  }

  .db-example-btn {
    margin-top: 12px;
    padding: 8px 16px;
    background: rgba(167, 139, 250, 0.1);
    border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 6px;
    color: #a78bfa;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .db-example-btn:hover {
    background: rgba(167, 139, 250, 0.2);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .panel-title {
    font-size: 13px;
    font-weight: 500;
  }

  .panel-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }

  .editor-container {
    flex: 1;
    overflow: hidden;
  }

  /* Editor Panel */
  .editor-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    flex: 1; /* Default to flex: 1 when no inline width set */
  }

  .editor-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .editor-wrapper.hidden {
    display: none;
  }

  .editor-panel.collapsed {
    flex: 0 0 48px !important;
    width: 48px !important;
    min-width: 48px;
    max-width: 48px;
    background: rgba(0, 0, 0, 0.3);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    border-right: 1px solid rgba(255, 255, 255, 0.1);
  }

  .editor-panel .panel-header {
    background: rgba(0, 0, 0, 0.4);
  }

  /* Fluid Panels Container */
  .fluid-panels-container {
    flex: 1;
    display: flex;
    min-width: 0;
    overflow: hidden;
  }

  /* Panel Divider */
  .panel-divider {
    width: 12px;
    background: rgba(255, 255, 255, 0.08);
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    flex-shrink: 0;
    position: relative;
  }

  .panel-divider:hover,
  .panel-divider.dragging {
    background: rgba(102, 126, 234, 0.4);
  }

  .panel-divider:focus {
    outline: none;
    background: rgba(102, 126, 234, 0.5);
  }

  .divider-handle {
    width: 4px;
    height: 50px;
    background: rgba(255, 255, 255, 0.4);
    border-radius: 2px;
    transition: background 0.2s, height 0.2s;
  }

  .panel-divider:hover .divider-handle,
  .panel-divider.dragging .divider-handle {
    background: #667eea;
    height: 80px;
  }

  /* Right Panel */
  .right-panel {
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, 0.02);
    min-width: 0;
    flex: 1;
  }

  .right-panel.collapsed {
    flex: 0 0 48px !important;
    width: 48px !important;
    min-width: 48px;
    max-width: 48px;
  }

  .panel-tabs {
    display: flex;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .tab {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
  }

  .tab:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .tab.active {
    color: #fff;
    border-bottom-color: #667eea;
  }

  /* Preview Panel - Canvas-based */
  .preview-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    overflow: auto;
  }

  .preview-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .size-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .size-controls input {
    width: 60px;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
    text-align: center;
  }


  .preview-mode-btn,
  .auto-refresh-btn,
  .config-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
  }

  .preview-mode-btn:hover,
  .auto-refresh-btn:hover,
  .config-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .preview-mode-btn.image-mode {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
  }

  .preview-mode-btn.locked {
    cursor: not-allowed;
    opacity: 0.9;
  }

  .preview-mode-btn.locked:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .preview-mode-btn .lock-icon {
    font-size: 10px;
    margin-left: 2px;
  }

  .auto-refresh-btn.active {
    background: rgba(16, 185, 129, 0.15);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }

  /* Animate Button */
  .animate-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .animate-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .animate-btn.active {
    background: rgba(251, 146, 60, 0.15);
    border-color: rgba(251, 146, 60, 0.4);
    color: #fb923c;
  }

  .animate-btn svg {
    width: 14px;
    height: 14px;
  }

  /* Animation Preview */
  .animation-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 60px;
    color: rgba(255, 255, 255, 0.6);
  }

  .animation-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #fb923c;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .animation-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .animation-canvas {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .sprite-viewport {
    background-repeat: no-repeat;
  }

  .animation-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .anim-control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.2s;
  }

  .anim-control-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .anim-control-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .anim-control-btn.play {
    width: 44px;
    height: 44px;
    background: rgba(251, 146, 60, 0.2);
    border-color: rgba(251, 146, 60, 0.4);
    color: #fb923c;
  }

  .anim-control-btn.play:hover {
    background: rgba(251, 146, 60, 0.3);
  }

  .animation-info {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .animation-info .frame-counter {
    font-family: 'JetBrains Mono', monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .animation-info .fps-info,
  .animation-info .sheet-info {
    background: rgba(251, 146, 60, 0.1);
    padding: 4px 8px;
    border-radius: 4px;
    color: #fb923c;
  }

  .animation-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 60px;
    color: rgba(255, 255, 255, 0.5);
  }

  .animation-placeholder svg {
    opacity: 0.3;
  }

  .retry-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid rgba(251, 146, 60, 0.4);
    background: rgba(251, 146, 60, 0.1);
    color: #fb923c;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: rgba(251, 146, 60, 0.2);
  }

  .config-btn {
    background: rgba(96, 165, 250, 0.15);
    border-color: rgba(96, 165, 250, 0.4);
    color: #60a5fa;
  }

  .preview-mode-btn svg,
  .auto-refresh-btn svg,
  .config-btn svg {
    width: 14px;
    height: 14px;
  }

  /* Canvas Container */
  .preview-canvas-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(15, 23, 42);
    border-radius: 8px;
    overflow: visible;
    min-height: 200px;
    position: relative;
    padding: 60px 40px 40px;
  }

  .preview-canvas-wrapper {
    position: relative;
  }

  .preview-canvas-frame {
    background: rgba(0, 0, 0, 1);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.2s;
    position: relative;
  }

  .preview-canvas-frame.selected {
    border-color: rgb(59, 130, 246);
    box-shadow: 0 0 0 1px rgb(59, 130, 246);
  }

  .preview-canvas-frame:hover {
    border-color: rgba(96, 165, 250, 0.7);
  }

  .preview-canvas-frame:focus {
    outline: none;
    border-color: rgba(96, 165, 250, 0.9);
    box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
  }

  /* Widget Floating Toolbar (like Studio) */
  .widget-floating-toolbar {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.9);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
    z-index: 100;
  }

  .widget-toolbar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .widget-toolbar-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .widget-toolbar-btn.primary {
    background: rgb(59, 130, 246);
    color: #fff;
  }

  .widget-toolbar-btn.primary:hover {
    background: rgb(37, 99, 235);
  }

  .widget-toolbar-name {
    padding: 0 8px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
    border-left: 1px solid rgba(255, 255, 255, 0.2);
    margin-left: 4px;
  }

  .preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .preview-placeholder svg {
    width: 32px;
    height: 32px;
    opacity: 0.5;
    margin-bottom: 4px;
  }

  /* Preview Info */
  .preview-info {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    font-size: 11px;
    flex-wrap: wrap;
  }

  .info-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .info-badge svg {
    width: 12px;
    height: 12px;
  }

  .info-badge.mode {
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.15);
  }

  .info-badge.refresh {
    color: #a78bfa;
    background: rgba(167, 139, 250, 0.15);
  }

  .info-badge.duration.fast {
    color: #34d399;
    background: rgba(52, 211, 153, 0.15);
  }

  .info-badge.duration.ok {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
  }

  .info-badge.duration.slow {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .info-badge.error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  /* Debug Panel */
  .debug-panel,
  .output-panel,
  .versions-panel {
    flex: 1;
    padding: 16px;
    overflow: auto;
  }

  .debug-panel h4,
  .output-panel h4,
  .versions-panel h4 {
    font-size: 13px;
    margin: 0 0 12px;
    color: rgba(255, 255, 255, 0.8);
  }

  .log-list,
  .error-list {
    font-family: monospace;
    font-size: 12px;
    max-height: 200px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 16px;
  }

  .log-entry {
    margin-bottom: 4px;
    word-break: break-word;
  }

  .log-entry.info { color: #60a5fa; }
  .log-entry.warn { color: #fbbf24; }
  .log-entry.error { color: #ef4444; }
  .log-entry.debug { color: #a78bfa; }
  .log-entry.http { color: #34d399; }
  .log-entry.db { color: #2dd4bf; }
  .log-entry.assets { color: #f472b6; }

  .log-level {
    opacity: 0.7;
    margin-right: 8px;
  }

  .error-entry {
    color: #ef4444;
    margin-bottom: 4px;
  }

  .no-logs,
  .no-output,
  .no-versions {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    padding: 24px;
  }

  .output-json {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 12px;
    font-size: 11px;
    overflow: auto;
    max-height: 400px;
    margin: 0;
    white-space: pre-wrap;
  }

  .version-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .version-entry {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
  }

  .version-number {
    font-weight: 600;
    color: #667eea;
  }

  .version-date {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Settings Drawer */
  .settings-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 360px;
    background: #1a1a2e;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .drawer-header h3 {
    font-size: 16px;
    margin: 0;
  }

  .settings-content {
    flex: 1;
    padding: 20px;
    overflow: auto;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 6px;
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 14px;
  }

  .form-group textarea {
    min-height: 80px;
    resize: vertical;
  }

  .form-group select option {
    background: #1a1a2e;
  }

  .form-group .hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 4px;
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .form-row .form-group {
    flex: 1;
  }

  .danger-zone {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid rgba(239, 68, 68, 0.3);
  }

  .danger-zone h4 {
    font-size: 13px;
    color: #ef4444;
    margin: 0 0 12px;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 16px;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal.modal-lg {
    max-width: 600px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .close-btn svg {
    width: 18px;
    height: 18px;
  }

  .modal-body {
    padding: 24px;
  }

  .modal-body p {
    margin: 0 0 12px;
    color: rgba(255, 255, 255, 0.8);
  }

  .modal-body code {
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .warning-text {
    color: #ef4444 !important;
    font-size: 13px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0 0 16px 16px;
  }

  /* Secrets */
  .secrets-list {
    margin-bottom: 20px;
  }

  .secret-entry {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    margin-bottom: 8px;
  }

  .secret-key {
    font-family: monospace;
    font-weight: 600;
    flex: 1;
  }

  .secret-value {
    color: rgba(255, 255, 255, 0.4);
    font-family: monospace;
  }

  .no-secrets {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    padding: 20px;
  }

  .add-secret-form {
    display: flex;
    gap: 8px;
  }

  .add-secret-form input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
  }

  .add-secret-form input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  /* Auto-refresh button */
  .auto-refresh-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
    margin-left: auto;
  }

  .auto-refresh-btn svg {
    width: 14px;
    height: 14px;
  }

  .auto-refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .auto-refresh-btn.active {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.5);
    color: #10b981;
  }

  .auto-refresh-btn.active svg {
    animation: spin 2s linear infinite;
  }

  /* Schema Builders in Settings */
  .schema-builders {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .schema-builders h4 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 4px;
  }

  .schema-builder-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }

  .schema-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    color: #fff;
  }

  .schema-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(102, 126, 234, 0.5);
  }

  .schema-btn .schema-icon {
    font-size: 20px;
  }

  .schema-btn .schema-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .schema-btn .schema-info strong {
    font-size: 13px;
    font-weight: 500;
  }

  .schema-btn .schema-info small {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .schema-btn svg {
    width: 16px;
    height: 16px;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Schema Builder Modal */
  .modal.modal-xl {
    max-width: 800px;
  }

  .schema-builder-body {
    max-height: 60vh;
    overflow-y: auto;
  }

  .schema-intro {
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    margin: 0 0 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .add-field-form {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .add-field-form input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
  }

  .add-field-form select {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
  }

  .add-field-form select option {
    background: #1a1a2e;
  }

  /* Schema Builder Tab Bar */
  .schema-tab-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    flex-wrap: wrap;
  }

  .schema-tab-item {
    display: flex;
    align-items: center;
    position: relative;
  }

  .schema-tab-item:hover .tab-actions {
    opacity: 1;
  }

  .schema-tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .schema-tab-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .schema-tab-btn.active,
  .schema-tab-item.active .schema-tab-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: transparent;
    color: #fff;
  }

  .schema-tab-btn .tab-icon {
    font-size: 14px;
  }

  .schema-tab-btn .tab-count {
    font-size: 11px;
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    opacity: 0.8;
  }

  .schema-tab-btn.default-tab {
    border-style: dashed;
  }

  .tab-actions {
    display: flex;
    gap: 2px;
    margin-left: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .tab-action-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .tab-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .tab-action-btn.tab-delete:hover {
    background: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .add-tab-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-tab-btn:hover {
    border-color: rgba(102, 126, 234, 0.5);
    color: #667eea;
    background: rgba(102, 126, 234, 0.1);
  }

  .add-tab-form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .add-tab-form .icon-picker {
    display: flex;
    gap: 2px;
  }

  .add-tab-form .icon-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-tab-form .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .add-tab-form .icon-btn.selected {
    background: rgba(102, 126, 234, 0.3);
    border-color: #667eea;
  }

  .add-tab-form .tab-id-input,
  .add-tab-form .tab-label-input {
    width: 80px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
  }

  .add-tab-form .btn-sm {
    padding: 6px 10px;
    font-size: 12px;
  }

  /* Active Tab Header */
  .active-tab-header {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .active-tab-header h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: #fff;
  }

  .active-tab-header .tab-description {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
  }

  /* Move to Tab Dropdown */
  .move-to-tab-select {
    padding: 4px 8px;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
  }

  .move-to-tab-select:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .move-to-tab-select option {
    background: #1a1a2e;
  }

  /* Footer Info */
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-info {
    display: flex;
    gap: 16px;
  }

  .footer-info span {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .schema-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .no-fields {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    text-align: center;
  }

  .no-fields-icon {
    font-size: 32px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  .no-fields p {
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    font-size: 13px;
  }

  .schema-field {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    overflow: hidden;
  }

  .field-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .field-key {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    color: #60a5fa;
    font-size: 13px;
  }

  .field-type-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .remove-field-btn {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .remove-field-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .remove-field-btn svg {
    width: 14px;
    height: 14px;
  }

  .field-properties {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px;
  }

  .prop-row-compact {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prop-row-compact label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.5);
  }

  .prop-row-compact input[type="text"],
  .prop-row-compact input[type="number"],
  .prop-row-compact select {
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 12px;
    min-width: 100px;
  }

  .prop-row-compact input[type="color"] {
    width: 60px;
    height: 30px;
    padding: 2px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    cursor: pointer;
  }

  .prop-row-compact input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .options-editor {
    width: 100%;
    margin-top: 8px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .options-editor > label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.5);
    display: block;
    margin-bottom: 8px;
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .option-row input {
    flex: 1;
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 12px;
  }

  .remove-option-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-option-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .add-option-btn {
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
    align-self: flex-start;
  }

  .add-option-btn:hover {
    border-color: rgba(102, 126, 234, 0.5);
    color: #667eea;
  }

  /* Tabs Editor Styles */
  .icon-picker-mini {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
  }

  .icon-btn-mini {
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .icon-btn-mini:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .icon-btn-mini.active {
    background: rgba(102, 126, 234, 0.3);
    border-color: #667eea;
  }

  .tabs-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }

  .tab-icon {
    font-size: 20px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
  }

  .tab-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tab-label-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    padding: 2px 0;
  }

  .tab-label-input:focus {
    outline: none;
    border-bottom-color: #667eea;
  }

  .tab-id {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    font-family: 'JetBrains Mono', monospace;
  }

  .tab-actions {
    display: flex;
    gap: 4px;
  }

  .move-btn, .remove-btn {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .move-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .move-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .remove-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  /* Toast Styles */
  .toast-container {
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-radius: 10px;
    background: rgba(30, 30, 46, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: slideIn 0.3s ease;
    backdrop-filter: blur(10px);
    font-size: 14px;
    color: #fff;
  }

  .toast svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .toast-success {
    border-color: rgba(16, 185, 129, 0.5);
  }

  .toast-success svg {
    color: #10b981;
  }

  .toast-error {
    border-color: rgba(239, 68, 68, 0.5);
  }

  .toast-error svg {
    color: #ef4444;
  }

  .toast-info svg {
    color: #60a5fa;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Help Modal Styles */
  .help-modal {
    max-width: 900px;
  }

  .help-btn {
    padding: 8px !important;
  }

  .help-tabs {
    display: flex;
    gap: 4px;
    padding: 0 24px;
    background: rgba(0, 0, 0, 0.2);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .help-tab {
    padding: 12px 20px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all 0.2s;
  }

  .help-tab:hover {
    color: rgba(255, 255, 255, 0.9);
  }

  .help-tab.active {
    color: #667eea;
    border-bottom-color: #667eea;
  }

  .help-body {
    max-height: 60vh;
    overflow-y: auto;
  }

  .help-section h3 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 12px;
    color: #fff;
  }

  .help-section h4 {
    font-size: 15px;
    font-weight: 600;
    margin: 20px 0 8px;
    color: rgba(255, 255, 255, 0.9);
  }

  .help-section p {
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.6;
    margin: 0 0 16px;
  }

  .help-section ul {
    margin: 0 0 16px;
    padding-left: 24px;
    color: rgba(255, 255, 255, 0.7);
  }

  .help-section li {
    margin-bottom: 8px;
    line-height: 1.5;
  }

  .help-section code {
    background: rgba(102, 126, 234, 0.2);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: #a78bfa;
  }

  .help-section kbd {
    background: rgba(255, 255, 255, 0.1);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .code-block {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    color: #e2e8f0;
    white-space: pre;
    margin: 8px 0 16px;
  }

  .template-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 16px;
    margin-top: 16px;
  }

  .template-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .template-card:hover {
    background: rgba(102, 126, 234, 0.1);
    border-color: rgba(102, 126, 234, 0.5);
    transform: translateY(-2px);
  }

  .template-card h4 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px;
    color: #fff;
  }

  .template-card p {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 12px;
  }

  .insert-hint {
    font-size: 12px;
    color: #667eea;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .template-card:hover .insert-hint {
    opacity: 1;
  }
</style>
