<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { HostSlot } from '@waiveo/ui';
  import CustomSelect from '../components/CustomSelect.svelte';

  export let element = null;
  export let widget = null;
  export let position = { x: 100, y: 100 };
  export let isRunning = false;
  // studioElements contribution (spec §6 / D9, Wave 5 Slice 5.4) matching
  // this element's widgetUuid (`${extension}:${widgetType}`), or null for a
  // plain DB/provider widget with no studio-element contribution. When set,
  // the Default tab mounts the contributing extension's OWN config panel
  // (via HostSlot, the same generic contribution-slot primitive every other
  // host slot uses) instead of the generic schema-driven config/style
  // fields — the render path is unchanged either way (WidgetResolver /
  // WidgetProviderRegistry), only the STUDIO CONFIG UI differs.
  export let contribution = null;

  const dispatch = createEventDispatcher();
  
  // Debug logging helper
  function debugLog(category, action, data = {}) {
    if (typeof window !== 'undefined' && window.WaiveoDebug?.isEnabled?.()) {
      window.WaiveoDebug.log('slidecast', category, action, data);
    }
  }
  
  // ---- Secret-typed config fields (Task 6) ----
  // Names of SHARED system secrets, for the "use shared key" picker. Names ONLY —
  // the list route never returns a value.
  let sharedSecretNames = [];
  // Per-field UI mode: 'enter' (type a value) | 'shared' (pick a shared key).
  let secretMode = {};

  async function loadSharedSecretNames() {
    try {
      const res = await fetch('/api/extensions/system/secrets', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      sharedSecretNames = (data.secrets || []).filter((s) => s.shared).map((s) => s.key);
    } catch {
      sharedSecretNames = [];
    }
  }

  function isSecretRef(v) {
    return !!v && typeof v === 'object' && typeof v.$secret === 'string';
  }
  function isSharedRef(v) {
    return isSecretRef(v) && v.$secret.startsWith('shared:');
  }
  function isSharedPick(v) {
    return !!v && typeof v === 'object' && typeof v.$secretSharedPick === 'string';
  }
  function sharedNameOf(v) {
    if (isSharedRef(v)) return v.$secret.slice('shared:'.length);
    if (isSharedPick(v)) return v.$secretSharedPick;
    return '';
  }
  // A value/reference is currently stored (widget-scoped or shared).
  function secretIsSet(v) {
    return isSecretRef(v);
  }
  // Initialise a field's mode from its current value (shared ref/pick => 'shared').
  function secretModeFor(key) {
    if (secretMode[key]) return secretMode[key];
    const v = element.widgetConfig[key];
    secretMode[key] = (isSharedRef(v) || isSharedPick(v)) ? 'shared' : 'enter';
    return secretMode[key];
  }
  function setSecretMode(key, mode) {
    secretMode[key] = mode;
    secretMode = { ...secretMode };
  }
  function onSecretInput(key, raw) {
    // Emit the raw string only on real input — stripped to a {$secret} ref at
    // save. Empty input is a no-op so it never wipes an existing reference.
    if (raw === '') return;
    element.widgetConfig[key] = raw;
    onConfigChange();
  }
  function onSecretClear(key) {
    element.widgetConfig[key] = '';
    onConfigChange();
    scheduleAutoRun();
  }
  function onSharedPick(key, name) {
    element.widgetConfig[key] = name ? { $secretSharedPick: name } : '';
    onConfigChange();
    scheduleAutoRun();
  }

  onMount(() => {
    loadSharedSecretNames();
    debugLog('widget.config', 'open', {
      widgetName: widget?.name,
      elementId: element?.id,
      hasStyleSchema: !!widget?.styleSchema,
      styleSchemaKeys: widget?.styleSchema ? Object.keys(widget.styleSchema) : [],
      styleFieldCount: widget?.styleSchema ? Object.keys(widget.styleSchema).filter(k => k !== '_tabs').length : 0
    });
  });
  
  onDestroy(() => {
    debugLog('widget.config', 'close', { widgetName: widget?.name, elementId: element?.id });
  });

  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let localPosition = { ...position };
  let activeTab = 'default'; // Start with Default tab
  
  // Ensure element.widgetConfig and element.widgetStyles exist
  $: if (element) {
    if (!element.widgetConfig) element.widgetConfig = {};
    if (!element.widgetStyles) element.widgetStyles = {};
  }
  
  // Sync with external position changes
  $: if (position && !isDragging) {
    localPosition = { ...position };
  }
  
  // Debug: trace widget prop changes
  $: if (widget) {
    debugLog('widget.config', 'widget.prop.changed', {
      name: widget.name,
      uuid: widget.uuid,
      hasConfigSchema: !!widget.configSchema,
      hasStyleSchema: !!widget.styleSchema,
      configSchemaKeys: widget.configSchema ? Object.keys(widget.configSchema) : [],
      styleSchemaKeys: widget.styleSchema ? Object.keys(widget.styleSchema) : [],
      styleSchemaRaw: widget.styleSchema
    });
  }
  
  // Compute tabs: use configSchema._tabs if defined, otherwise fallback to basic tabs
  $: customTabs = widget?.configSchema?._tabs || [];
  
  // Build the tab list
  // Always start with Default tab, then add any custom tabs, then Status
  $: widgetTabs = [{ id: 'default', label: 'Default', icon: '⚙️' }, ...customTabs];
  
  // Always add status tab at the end
  $: allTabs = [...widgetTabs, { id: 'status', label: 'Status', icon: '📊' }];
  
  // Get fields for a specific tab (filter out _tabs reserved key)
  function getConfigFieldsForTab(tabId) {
    if (!widget?.configSchema) return [];
    return Object.entries(widget.configSchema).filter(([key, field]) => {
      // Skip the reserved _tabs key
      if (key === '_tabs') return false;
      // 'default' tab shows fields with no tab assignment (empty or undefined)
      if (tabId === 'default') {
        return !field.tab || field.tab === '';
      }
      // Other tabs show fields with matching tab assignment
      return field.tab === tabId;
    });
  }
  
  function getStyleFieldsForTab(tabId) {
    debugLog('widget.config', 'getStyleFieldsForTab.called', { 
      tabId, 
      hasStyleSchema: !!widget?.styleSchema,
      styleSchemaType: typeof widget?.styleSchema
    });
    
    if (!widget?.styleSchema) {
      debugLog('widget.config', 'getStyleFieldsForTab.noSchema', { tabId });
      return [];
    }
    // Style fields ALWAYS go in the 'default' tab (they use groups, not tabs)
    // The 'tab' property should only be used for config fields
    if (tabId !== 'default') {
      debugLog('widget.config', 'getStyleFieldsForTab.notDefault', { tabId });
      return [];
    }
    
    const result = Object.entries(widget.styleSchema).filter(([key, field]) => {
      // Skip the reserved _tabs key
      if (key === '_tabs') return false;
      // Include all style fields in default tab
      return true;
    });
    
    debugLog('widget.config', 'getStyleFieldsForTab.result', { 
      tabId, 
      fieldCount: result.length,
      fieldKeys: result.map(([k]) => k)
    });
    
    return result;
  }
  
  // Typography size presets
  const sizePresets = [
    { label: '8', value: 8 },
    { label: '10', value: 10 },
    { label: '12', value: 12 },
    { label: '14', value: 14 },
    { label: '18', value: 18 },
    { label: '24', value: 24 },
    { label: '36', value: 36 },
    { label: '48', value: 48 },
    { label: '72', value: 72 }
  ];

  let advancedMode = {};

  function setSizeFromPreset(key, preset) {
    element.widgetStyles[key] = preset.value;
    onConfigChange();
    scheduleAutoRun();
  }

  function startDrag(e) {
    if (e.target.closest('input, select, button, textarea, .toggle-switch')) return;
    isDragging = true;
    dragOffset = {
      x: e.clientX - localPosition.x,
      y: e.clientY - localPosition.y
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e) {
    if (!isDragging) return;
    localPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
    dispatch('positionChange', localPosition);
  }

  function stopDrag() {
    isDragging = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  function close() {
    dispatch('close');
  }

  function onConfigChange() {
    dispatch('configChange', { element });
    debugLog('widget.config', 'change', { widgetName: widget?.name, elementId: element?.id });
  }

  function onRefresh() {
    dispatch('refresh', { element });
    debugLog('widget.config', 'refresh', { widgetName: widget?.name, elementId: element?.id });
  }

  function scheduleAutoRun() {
    dispatch('autoRun', { element });
  }
</script>

<div 
  class="widget-config-window"
  class:dragging={isDragging}
  style="left: {localPosition.x}px; top: {localPosition.y}px;"
>
  <div class="widget-window-header" on:mousedown={startDrag}>
    <div class="widget-window-title">
      <span class="widget-icon">{widget?.icon || '📦'}</span>
      <span class="widget-name">{widget?.name || element?.widgetName || 'Widget'}</span>
      <span class="widget-category-badge">{widget?.category || 'custom'}</span>
    </div>
    <button class="widget-window-close" on:click={close}>×</button>
  </div>
  
  <!-- Tabs - Dynamic based on widget.tabs -->
  <div class="widget-config-tabs">
    {#each allTabs as tab}
      <button class="widget-tab" class:active={activeTab === tab.id} on:click={() => activeTab = tab.id}>
        <span class="tab-icon">{tab.icon}</span>
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="widget-window-body">
    <!-- STATUS TAB -->
    {#if activeTab === 'status'}
      <div class="widget-preview-section">
        <h3>Status & Refresh</h3>
        <div class="widget-status-container">
          {#if isRunning}
            <div class="widget-status-item rendering">
              <div class="loading-spinner-small"></div>
              <span>Rendering widget...</span>
            </div>
          {:else if element._widgetError}
            <div class="widget-status-item error">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              <span>{element._widgetError}</span>
            </div>
          {:else}
            <div class="widget-status-item success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              <span>Widget rendered • See canvas for preview</span>
            </div>
          {/if}
          <p class="widget-status-hint">Changes auto-refresh immediately</p>
        </div>
        
        <!-- Render Mode Toggle for Hybrid Widgets -->
        {#if widget?.renderMode === 'hybrid'}
          <div class="widget-render-mode-section">
            <h3>Render Mode</h3>
            <div class="render-mode-toggle">
              <button 
                class="render-mode-btn" 
                class:active={element._widgetRenderMode === 'native'}
                on:click={() => { element._widgetRenderMode = 'native'; onConfigChange(); dispatch('renderModeChange', { element }); }}
              >
                <span class="mode-icon">⚡</span>
                <span class="mode-label">Native</span>
                <span class="mode-desc">HTML rendering, crisp text</span>
              </button>
              <button 
                class="render-mode-btn" 
                class:active={element._widgetRenderMode === 'image'}
                on:click={() => { element._widgetRenderMode = 'image'; onConfigChange(); dispatch('renderModeChange', { element }); }}
              >
                <span class="mode-icon">🖼️</span>
                <span class="mode-label">Image</span>
                <span class="mode-desc">Server-rendered PNG</span>
              </button>
            </div>
            <p class="render-mode-hint">
              {#if element._widgetRenderMode === 'image'}
                Image mode: Widget is rendered as a PNG on the server. Best for complex designs, custom fonts, and consistent appearance across devices.
              {:else}
                Native mode: Widget renders as HTML in the browser. Best for crisp text, fast updates, and interactive elements.
              {/if}
            </p>
          </div>
        {:else if widget?.renderMode}
          <div class="widget-render-mode-section">
            <h3>Render Mode</h3>
            <p class="render-mode-locked">
              <span class="mode-badge">{widget.renderMode === 'image' ? '🖼️ Image' : '⚡ Native'}</span>
              This widget only supports {widget.renderMode} rendering.
            </p>
          </div>
        {/if}
        <div class="widget-refresh-settings">
          <div class="widget-config-row">
            <label>Auto-Refresh Interval</label>
            <div class="widget-number-input">
              <input 
                type="number" 
                min="0" 
                step="1000" 
                bind:value={element.refreshInterval} 
                on:input={() => { onConfigChange(); dispatch('refreshIntervalChange', { element }); }}
              />
              <span class="unit">ms</span>
            </div>
          </div>
          <p class="widget-refresh-hint">
            {#if element.refreshInterval === 0}
              Widget will not auto-refresh (static)
            {:else if element.refreshInterval < 1000}
              Refreshes every {element.refreshInterval}ms
            {:else if element.refreshInterval < 60000}
              Refreshes every {(element.refreshInterval / 1000).toFixed(0)}s
            {:else}
              Refreshes every {(element.refreshInterval / 60000).toFixed(1)}m
            {/if}
          </p>
        </div>
      </div>
    
    <!-- DYNAMIC TABS - Config/Style fields -->
    {:else}
      {@const configFields = getConfigFieldsForTab(activeTab)}
      {@const styleFields = getStyleFieldsForTab(activeTab)}
      
      <div class="widget-config-layout">
        <!-- Size controls - only show on default tab -->
        {#if activeTab === 'default' && element}
          <div class="widget-config-section widget-size-section">
            <h3>Size</h3>
            <div class="widget-size-row">
              <div class="widget-size-input">
                <label>W</label>
                <input 
                  type="number" 
                  min="50"
                  max="1920"
                  bind:value={element.size.width} 
                  on:input={() => { onConfigChange(); dispatch('sizeChange', { element }); }}
                />
              </div>
              <span class="size-separator">×</span>
              <div class="widget-size-input">
                <label>H</label>
                <input 
                  type="number" 
                  min="50"
                  max="1080"
                  bind:value={element.size.height} 
                  on:input={() => { onConfigChange(); dispatch('sizeChange', { element }); }}
                />
              </div>
            </div>
          </div>
        {/if}
        
        <!-- studioElements contribution: the contributing extension's OWN
             config panel replaces the generic schema-driven fields below
             (spec §6 / D9, Wave 5 Slice 5.4). Mounted via HostSlot, filtered
             to this exact contribution — the same generic contribution-slot
             primitive every other host slot uses; nothing here is
             studioElements-specific beyond the slot name + filter. -->
        {#if activeTab === 'default' && contribution}
          <div class="widget-config-section">
            <h3>Configuration</h3>
            <HostSlot
              slot="studioElements"
              filter={(c) => c.extension === contribution.extension && c.componentPath === contribution.componentPath}
              componentProps={{ element, onChange: () => { onConfigChange(); scheduleAutoRun(); } }}
            />
          </div>
        {:else if configFields.length > 0}
          <div class="widget-config-section">
            <h3>Configuration</h3>
            <div class="widget-config-grid">
              {#each configFields as [key, schema]}
                <div class="widget-config-row">
                  <label>{schema.label || key}</label>
                  {#if schema.type === 'select'}
                    <CustomSelect 
                      value={element.widgetConfig[key]} 
                      options={schema.options}
                      on:change={(e) => { element.widgetConfig[key] = e.detail.value; onConfigChange(); scheduleAutoRun(); }}
                    />
                  {:else if schema.type === 'boolean'}
                    <label class="toggle-switch">
                      <input type="checkbox" bind:checked={element.widgetConfig[key]} on:change={() => { onConfigChange(); scheduleAutoRun(); }} />
                      <span class="toggle-slider"></span>
                    </label>
                  {:else if schema.type === 'number'}
                    {@const step = schema.step || 1}
                    <div class="widget-number-input">
                      <input 
                        type="number" 
                        min={schema.min}
                        max={schema.max}
                        step={step}
                        bind:value={element.widgetConfig[key]} 
                        on:input={() => {
                          if (key === 'width') element.size.width = element.widgetConfig[key];
                          if (key === 'height') element.size.height = element.widgetConfig[key];
                          onConfigChange();
                          scheduleAutoRun();
                        }}
                      />
                      {#if schema.unit}<span class="unit">{schema.unit}</span>{/if}
                    </div>
                  {:else if schema.type === 'entity'}
                    <input type="text" placeholder="entity_id" bind:value={element.widgetConfig[key]} on:input={() => { onConfigChange(); scheduleAutoRun(); }} />
                  {:else if schema.type === 'secret'}
                    {@const secMode = secretModeFor(key)}
                    {@const curVal = element.widgetConfig[key]}
                    <div class="secret-field">
                      <div class="secret-mode-toggle">
                        <button type="button" class="secret-mode-btn" class:active={secMode === 'enter'} on:click={() => setSecretMode(key, 'enter')}>Enter value</button>
                        <button type="button" class="secret-mode-btn" class:active={secMode === 'shared'} on:click={() => setSecretMode(key, 'shared')}>Use shared key</button>
                      </div>
                      {#if secMode === 'enter'}
                        {#if secretIsSet(curVal)}
                          <div class="secret-set-row">
                            <span class="secret-set-badge">•••• set</span>
                            <button type="button" class="secret-clear-btn" on:click={() => onSecretClear(key)}>Clear</button>
                          </div>
                          <input type="password" autocomplete="new-password" placeholder="Enter a new value to replace" on:input={(e) => onSecretInput(key, e.target.value)} />
                        {:else}
                          <input type="password" autocomplete="new-password" placeholder="Enter secret value" on:input={(e) => onSecretInput(key, e.target.value)} />
                        {/if}
                      {:else}
                        <select value={sharedNameOf(curVal)} on:change={(e) => onSharedPick(key, e.target.value)}>
                          <option value="">— Select a shared key —</option>
                          {#each sharedSecretNames as name}
                            <option value={name}>{name}</option>
                          {/each}
                        </select>
                        {#if sharedSecretNames.length === 0}
                          <span class="field-hint">No shared keys available. Add one in Settings → Secrets.</span>
                        {/if}
                      {/if}
                    </div>
                  {:else}
                    <input type="text" bind:value={element.widgetConfig[key]} on:input={() => { onConfigChange(); scheduleAutoRun(); }} />
                  {/if}
                  {#if schema.description}
                    <span class="field-hint">{schema.description}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
        
        <!-- Style fields for this tab - GROUPED BY group property -->
        {#if styleFields.length > 0}
          <div class="widget-config-section">
            <h3>Styles</h3>
            
            {#each ['Theme', 'Background', 'Typography', 'Layout', 'Effects', 'Border', 'Other'] as groupName}
              {@const groupFields = styleFields.filter(([key, field]) => (field.group || 'Other') === groupName)}
              {#if groupFields.length > 0}
                <div class="style-group">
                  <h4 class="style-group-header">{groupName}</h4>
                  <div class="widget-config-grid">
                    {#each groupFields as [key, schema]}
                      <div class="widget-config-row">
                        <label>{schema.label || key}</label>
                        {#if schema.type === 'color'}
                          <input 
                            type="color" 
                            value={element.widgetStyles[key] || schema.default || '#000000'} 
                            on:input={(e) => { element.widgetStyles[key] = e.target.value; onConfigChange(); scheduleAutoRun(); }} 
                          />
                        {:else if schema.type === 'slider' || schema.type === 'number'}
                          {@const styleStep = schema.step || 1}
                          <div class="widget-number-input">
                            <input 
                              type="number"
                              min={schema.min} 
                              max={schema.max} 
                              step={styleStep}
                              bind:value={element.widgetStyles[key]} 
                              on:input={() => { onConfigChange(); scheduleAutoRun(); }}
                            />
                            {#if schema.unit}<span class="unit">{schema.unit}</span>{/if}
                          </div>
                        {:else if schema.type === 'select'}
                          <CustomSelect 
                            value={element.widgetStyles[key]} 
                            options={schema.options}
                            on:change={(e) => { element.widgetStyles[key] = e.detail.value; onConfigChange(); scheduleAutoRun(); }}
                          />
                        {:else if schema.type === 'font'}
                          <CustomSelect 
                            value={element.widgetStyles[key]} 
                            options={[
                              { value: 'Inter', label: 'Inter' },
                              { value: 'Roboto', label: 'Roboto' },
                              { value: 'Open Sans', label: 'Open Sans' },
                              { value: 'Lato', label: 'Lato' },
                              { value: 'Roboto Slab', label: 'Roboto Slab' },
                              { value: 'Merriweather', label: 'Merriweather' },
                              { value: 'Bebas Neue', label: 'Bebas Neue' },
                              { value: 'Oswald', label: 'Oswald' },
                              { value: 'JetBrains Mono', label: 'JetBrains Mono' },
                              { value: 'Roboto Mono', label: 'Roboto Mono' }
                            ]}
                            on:change={(e) => { element.widgetStyles[key] = e.detail.value; onConfigChange(); scheduleAutoRun(); }}
                          />
                        {:else if schema.type === 'typography'}
                          <div class="typography-control">
                            <div class="typography-row">
                              <div class="size-presets">
                                {#each sizePresets as preset}
                                  <button 
                                    class="size-preset-btn" 
                                    class:active={element.widgetStyles[key] === preset.value}
                                    on:click={() => setSizeFromPreset(key, preset)}
                                    title="{preset.value}px"
                                  >
                                    {preset.label}
                                  </button>
                                {/each}
                                <button 
                                  class="size-preset-btn advanced-toggle" 
                                  class:active={advancedMode[key]}
                                  on:click={() => advancedMode[key] = !advancedMode[key]}
                                  title="Custom size"
                                >
                                  ⚙
                                </button>
                              </div>
                            </div>
                            {#if advancedMode[key]}
                              <div class="typography-advanced">
                                <div class="advanced-row">
                                  <label class="mini-label">Size</label>
                                  <input 
                                    type="number" 
                                    min="8" 
                                    max="200"
                                    bind:value={element.widgetStyles[key]} 
                                    on:input={() => { onConfigChange(); scheduleAutoRun(); }}
                                  />
                                  <span class="unit">px</span>
                                </div>
                              </div>
                            {/if}
                          </div>
                        {:else if schema.type === 'fontWeight'}
                          <div class="font-weight-buttons">
                            {#each [
                              { value: '300', label: 'Light', icon: 'Aa' },
                              { value: '400', label: 'Regular', icon: 'Aa' },
                              { value: '500', label: 'Medium', icon: 'Aa' },
                              { value: '600', label: 'Semi', icon: 'Aa' },
                              { value: '700', label: 'Bold', icon: 'Aa' }
                            ] as weight}
                              <button 
                                class="weight-btn"
                                class:active={element.widgetStyles[key] === weight.value}
                                style="font-weight: {weight.value}"
                                on:click={() => { element.widgetStyles[key] = weight.value; onConfigChange(); scheduleAutoRun(); }}
                                title={weight.label}
                              >
                                {weight.icon}
                              </button>
                            {/each}
                          </div>
                        {:else if schema.type === 'boolean'}
                          <label class="toggle-switch">
                            <input type="checkbox" bind:checked={element.widgetStyles[key]} on:change={() => { onConfigChange(); scheduleAutoRun(); }} />
                            <span class="toggle-slider"></span>
                          </label>
                        {:else}
                          <input type="text" bind:value={element.widgetStyles[key]} on:input={() => { onConfigChange(); scheduleAutoRun(); }} />
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
        
        <!-- Show message if no fields for this tab (a studioElements contribution
             always has its own panel, so it never counts as "no options") -->
        {#if !(activeTab === 'default' && contribution) && configFields.length === 0 && styleFields.length === 0}
          <p class="no-config">No options for this tab.</p>
        {/if}
      </div>
    {/if}
  </div>

  <div class="widget-window-footer">
    <button class="btn btn-sm btn-ghost" on:click={onRefresh} disabled={isRunning}>
      {#if isRunning}
        <div class="mini-spinner"></div>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      {/if}
      Refresh Now
    </button>
    <button class="btn btn-sm btn-primary" on:click={close}>Done</button>
  </div>
</div>

<style>
  /* Secret-typed config field (Task 6) */
  .secret-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .secret-mode-toggle {
    display: flex;
    gap: 4px;
  }

  .secret-mode-btn {
    flex: 1;
    padding: 5px 8px;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
  }

  .secret-mode-btn:hover {
    background: rgba(0, 0, 0, 0.4);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .secret-mode-btn.active {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgb(99, 102, 241);
    color: white;
  }

  .secret-set-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .secret-set-badge {
    font-size: 11px;
    letter-spacing: 1px;
    color: rgb(34, 197, 94);
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.35);
    border-radius: 4px;
    padding: 2px 8px;
  }

  .secret-clear-btn {
    font-size: 11px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .secret-clear-btn:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .style-group {
    margin-bottom: 16px;
  }
  
  .style-group-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--color-text-muted));
    margin: 0 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid rgb(var(--color-border));
  }
  
  .style-group:first-child .style-group-header {
    margin-top: 0;
  }
  
  /* Size section */
  .widget-size-section {
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 16px;
    margin-bottom: 16px;
  }
  
  .widget-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .widget-size-input {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  
  .widget-size-input label {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    width: 20px;
  }
  
  .widget-size-input input {
    flex: 1;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    padding: 8px 12px;
    color: white;
    font-size: 14px;
  }
  
  .widget-size-input input:focus {
    outline: none;
    border-color: rgba(99, 102, 241, 0.5);
  }
  
  .size-separator {
    color: rgba(255,255,255,0.4);
    font-size: 14px;
  }
  
  /* Render Mode Section */
  .widget-render-mode-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255,255,255,0.1);
  }
  
  .widget-render-mode-section h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255,255,255,0.7);
    margin: 0 0 12px 0;
  }
  
  .render-mode-toggle {
    display: flex;
    gap: 8px;
  }
  
  .render-mode-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: rgba(0,0,0,0.3);
    border: 2px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .render-mode-btn:hover {
    background: rgba(0,0,0,0.4);
    border-color: rgba(255,255,255,0.2);
  }
  
  .render-mode-btn.active {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgb(99, 102, 241);
  }
  
  .render-mode-btn .mode-icon {
    font-size: 20px;
  }
  
  .render-mode-btn .mode-label {
    font-size: 13px;
    font-weight: 600;
    color: white;
  }
  
  .render-mode-btn .mode-desc {
    font-size: 10px;
    color: rgba(255,255,255,0.5);
    text-align: center;
  }
  
  .render-mode-hint {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    margin: 8px 0 0 0;
    line-height: 1.4;
  }
  
  .render-mode-locked {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }
  
  .mode-badge {
    background: rgba(255,255,255,0.1);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
</style>
