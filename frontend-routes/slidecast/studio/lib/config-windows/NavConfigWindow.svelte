<script>
  import { createEventDispatcher } from 'svelte';

  export let element = null;
  export let position = { x: 100, y: 80 };
  export let cast = null;
  export let currentGroupId = 'home';
  export let iconCategories = [];
  export let allIcons = [];

  const dispatch = createEventDispatcher();

  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let localPosition = { ...position };
  let hasUserMoved = false; // Track if user has manually moved the window
  let activeTab = 'default';
  let editingNavItemId = null;
  let iconSearchQuery = '';
  let activeIconCategory = 'all';

  // Standard Roku apps and commands
  const ROKU_APPS = [
    { id: 'netflix', label: 'Netflix', channelId: '12', icon: 'fa-solid fa-n' },
    { id: 'youtube', label: 'YouTube', channelId: '837', icon: 'fa-brands fa-youtube' },
    { id: 'hulu', label: 'Hulu', channelId: '2285', icon: 'fa-solid fa-h' },
    { id: 'disney', label: 'Disney+', channelId: '291097', icon: 'fa-solid fa-d' },
    { id: 'prime', label: 'Prime Video', channelId: '13', icon: 'fa-brands fa-amazon' },
    { id: 'appletv', label: 'Apple TV+', channelId: '551012', icon: 'fa-brands fa-apple' },
    { id: 'hbomax', label: 'Max', channelId: '61322', icon: 'fa-solid fa-m' },
    { id: 'peacock', label: 'Peacock', channelId: '593099', icon: 'fa-solid fa-p' },
    { id: 'paramount', label: 'Paramount+', channelId: '31440', icon: 'fa-solid fa-p' },
    { id: 'spotify', label: 'Spotify', channelId: '22297', icon: 'fa-brands fa-spotify' }
  ];

  const ROKU_COMMANDS = [
    { id: 'home', label: 'Home', key: 'Home', icon: 'fa-solid fa-house' },
    { id: 'back', label: 'Back', key: 'Back', icon: 'fa-solid fa-arrow-left' },
    { id: 'play', label: 'Play/Pause', key: 'Play', icon: 'fa-solid fa-play' },
    { id: 'power', label: 'Power Off', key: 'PowerOff', icon: 'fa-solid fa-power-off' }
  ];

  // Ensure element.items is always an array
  $: if (element && !Array.isArray(element.items)) {
    element.items = [];
  }
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Ensure element.size and element.position exist
  $: if (element && !element.size) {
    element.size = { width: 200, height: 60 };
  }
  $: if (element && !element.position) {
    element.position = { x: 0, y: 0 };
  }
  // Ensure navOrder exists (lower = first/active by default)
  $: if (element && element.navOrder === undefined) {
    element.navOrder = 0;
  }

  // Filtered icons for search
  $: filteredIcons = iconSearchQuery 
    ? (allIcons || []).filter(icon => 
        icon.name.toLowerCase().includes(iconSearchQuery.toLowerCase()) ||
        icon.category?.toLowerCase().includes(iconSearchQuery.toLowerCase())
      )
    : activeIconCategory === 'all' 
      ? (allIcons || [])
      : (iconCategories || []).find(c => c.name === activeIconCategory)?.icons || [];

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
    hasUserMoved = true; // Mark that user has moved the window
    localPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
  }

  function stopDrag() {
    isDragging = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  function close() {
    dispatch('close');
  }

  function syncChanges() {
    dispatch('sync', { element });
  }
  
  function onSizeChange() {
    dispatch('sizeChange', { element });
    syncChanges();
  }

  function generateId() {
    return 'nav_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function applyPreset(preset, styleOverrides) {
    element.style = { ...element.style, preset, ...styleOverrides };
    syncChanges();
  }

  function setLayout(layout) {
    element.layout = layout;
    syncChanges();
  }

  function addNavItem() {
    if (!element.items) element.items = [];
    element.items.push({
      id: generateId(),
      label: 'New Item',
      iconClass: 'fa-solid fa-circle-dot',
      action: { type: 'slide', slide_index: 0, group_id: currentGroupId }
    });
    syncChanges();
  }

  function removeNavItem(index) {
    element.items.splice(index, 1);
    element.items = [...element.items];
    editingNavItemId = null;
    syncChanges();
  }

  function duplicateNavItem(index) {
    const item = element.items[index];
    const newItem = {
      ...JSON.parse(JSON.stringify(item)),
      id: generateId(),
      label: item.label + ' Copy'
    };
    element.items.splice(index + 1, 0, newItem);
    element.items = [...element.items];
    syncChanges();
  }

  function moveNavItem(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= element.items.length) return;
    const items = [...element.items];
    [items[index], items[newIndex]] = [items[newIndex], items[index]];
    element.items = items;
    syncChanges();
  }

  function goToSource() {
    dispatch('goToSource', { element });
    close();
  }
</script>

{#if element}
<div 
  class="nav-config-window"
  class:dragging={isDragging}
  style="left: {localPosition.x}px; top: {localPosition.y}px;"
>
  <div class="nav-window-header" on:mousedown={startDrag}>
    <div class="nav-window-title">
      <span class="nav-icon">☰</span>
      <span class="nav-name">Navigation</span>
      <span class="nav-category-badge">MENU</span>
    </div>
    <button class="nav-window-close" on:click={close}>×</button>
  </div>
  
  <!-- Tabs -->
  <div class="nav-config-tabs">
    <button class="nav-tab" class:active={activeTab === 'default'} on:click={() => activeTab = 'default'}>
      <span class="tab-icon">⚙️</span>
      Default
    </button>
    <button class="nav-tab" class:active={activeTab === 'style'} on:click={() => activeTab = 'style'}>
      <span class="tab-icon">🎨</span>
      Style
    </button>
    <button class="nav-tab" class:active={activeTab === 'items'} on:click={() => activeTab = 'items'}>
      <span class="tab-icon">📋</span>
      Items
      <span class="nav-tab-badge">{element.items?.length || 0}</span>
    </button>
  </div>
  
  <div class="nav-window-body">
    <!-- DEFAULT TAB -->
    {#if activeTab === 'default'}
      <!-- Size controls -->
      <div class="nav-config-section nav-size-section">
        <h3>Size & Order</h3>
        <div class="nav-size-row">
          <div class="nav-size-input">
            <label>W</label>
            <input 
              type="number" 
              min="50"
              max="1920"
              bind:value={element.size.width} 
              on:input={onSizeChange}
            />
          </div>
          <span class="size-separator">×</span>
          <div class="nav-size-input">
            <label>H</label>
            <input 
              type="number" 
              min="30"
              max="1080"
              bind:value={element.size.height} 
              on:input={onSizeChange}
            />
          </div>
          <span class="size-separator"></span>
          <div class="nav-size-input nav-order-input">
            <label title="Nav order - lower number = active first">Order</label>
            <input 
              type="number" 
              min="0"
              max="99"
              bind:value={element.navOrder} 
              on:input={() => dispatch('change')}
              title="Navigation order - lower number gets focus first"
            />
          </div>
        </div>
      </div>
      
      <div class="nav-config-section">
        <h3>Quick Presets</h3>
        <div class="nav-presets-grid">
          <button class="nav-preset-btn" class:active={element.style?.preset === 'unified-bar'} 
            on:click={() => applyPreset('unified-bar', { containerBackground: '#000000', containerOpacity: 0.6, containerRadius: 16, containerPadding: 8, itemBackgroundColor: '#ffffff', itemBackgroundOpacity: 0, itemBorderRadius: 8, itemPadding: 12, itemGap: 4 })} title="Unified Bar">
            <span class="preset-icon">▬</span><span>Bar</span>
          </button>
          <button class="nav-preset-btn" class:active={element.style?.preset === 'pill-buttons'}
            on:click={() => applyPreset('pill-buttons', { containerBackground: '#000000', containerOpacity: 0, containerRadius: 0, containerPadding: 0, itemBackgroundColor: '#333333', itemBackgroundOpacity: 0.8, itemBorderRadius: 50, itemPadding: 14, itemGap: 12 })} title="Pill Buttons">
            <span class="preset-icon">◉</span><span>Pills</span>
          </button>
          <button class="nav-preset-btn" class:active={element.style?.preset === 'contained-pills'}
            on:click={() => applyPreset('contained-pills', { containerBackground: '#1a1a2e', containerOpacity: 0.9, containerRadius: 20, containerPadding: 10, itemBackgroundColor: '#ffffff', itemBackgroundOpacity: 0.1, itemBorderRadius: 12, itemPadding: 12, itemGap: 8 })} title="Contained Pills">
            <span class="preset-icon">▭</span><span>Tray</span>
          </button>
          <button class="nav-preset-btn" class:active={element.style?.preset === 'minimal'}
            on:click={() => applyPreset('minimal', { containerBackground: '#000000', containerOpacity: 0, containerRadius: 0, containerPadding: 0, itemBackgroundColor: '#ffffff', itemBackgroundOpacity: 0, itemBorderRadius: 4, itemPadding: 10, itemGap: 20 })} title="Minimal">
            <span class="preset-icon">―</span><span>Minimal</span>
          </button>
          <button class="nav-preset-btn" class:active={element.style?.preset === 'glass'}
            on:click={() => applyPreset('glass', { containerBackground: '#ffffff', containerOpacity: 0.15, containerRadius: 24, containerPadding: 10, containerBlur: 20, itemBackgroundColor: '#ffffff', itemBackgroundOpacity: 0.1, itemBorderRadius: 14, itemPadding: 14, itemGap: 8 })} title="Glass">
            <span class="preset-icon">◇</span><span>Glass</span>
          </button>
          <button class="nav-preset-btn" class:active={element.style?.preset === 'segmented'}
            on:click={() => applyPreset('segmented', { containerBackground: '#333333', containerOpacity: 0.9, containerRadius: 10, containerPadding: 4, itemBackgroundColor: '#ffffff', itemBackgroundOpacity: 0, itemBorderRadius: 6, itemPadding: 10, itemGap: 2 })} title="Segmented">
            <span class="preset-icon">▤</span><span>Segment</span>
          </button>
        </div>
      </div>
      
      <div class="nav-config-section">
        <h3>Layout</h3>
        <div class="nav-layout-toggle">
          <button class="nav-layout-btn" class:active={element.layout !== 'vertical'} on:click={() => setLayout('horizontal')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Horizontal
          </button>
          <button class="nav-layout-btn" class:active={element.layout === 'vertical'} on:click={() => setLayout('vertical')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/></svg>
            Vertical
          </button>
        </div>
      </div>
      
      <!-- Scope Info for Inherited -->
      {#if element._isInheritedCopy}
        <div class="nav-config-section inherited-notice">
          <div class="inherited-icon">🔗</div>
          <div class="inherited-text">
            <strong>Inherited Navigation</strong>
            <p>This is a copy from {element.scope === 'cast' ? 'cast-wide' : 'group'} settings. Changes here only affect this slide.</p>
            <button class="btn btn-sm" on:click={goToSource}>Edit Original</button>
          </div>
        </div>
      {/if}
    {/if}
    
    <!-- STYLE TAB -->
    {#if activeTab === 'style'}
      <div class="nav-config-section">
        <h3>Container</h3>
        <div class="nav-config-row">
          <label>Background</label>
          <input 
            type="color" 
            value={element.style?.containerBackground || '#000000'} 
            on:input={(e) => { element.style.containerBackground = e.target.value; syncChanges(); }} 
          />
        </div>
        <div class="nav-config-row">
          <label>Opacity</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.05" 
              value={element.style?.containerOpacity ?? 0}
              on:input={(e) => { element.style.containerOpacity = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{Math.round((element.style?.containerOpacity || 0) * 100)}%</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Corner Radius</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="50" 
              step="1" 
              value={element.style?.containerRadius || 0}
              on:input={(e) => { element.style.containerRadius = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.containerRadius || 0}px</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Padding</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="30" 
              step="1" 
              value={element.style?.containerPadding || 0}
              on:input={(e) => { element.style.containerPadding = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.containerPadding || 0}px</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Blur</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="30" 
              step="1" 
              value={element.style?.containerBlur || 0}
              on:input={(e) => { element.style.containerBlur = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.containerBlur || 0}px</span>
          </div>
        </div>
      </div>
      
      <div class="nav-config-section">
        <h3>Items</h3>
        <div class="nav-config-row">
          <label>Background</label>
          <input 
            type="color" 
            value={element.style?.itemBackgroundColor || '#ffffff'} 
            on:input={(e) => { element.style.itemBackgroundColor = e.target.value; syncChanges(); }} 
          />
        </div>
        <div class="nav-config-row">
          <label>Bg Opacity</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.05" 
              value={element.style?.itemBackgroundOpacity ?? 0}
              on:input={(e) => { element.style.itemBackgroundOpacity = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{Math.round((element.style?.itemBackgroundOpacity || 0) * 100)}%</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Corner Radius</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="50" 
              step="1" 
              value={element.style?.itemBorderRadius || 0}
              on:input={(e) => { element.style.itemBorderRadius = Number(e.target.value) || 0; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.itemBorderRadius || 0}px</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Padding</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="4" 
              max="30" 
              step="1" 
              value={element.style?.itemPadding || 10}
              on:input={(e) => { element.style.itemPadding = Number(e.target.value) || 10; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.itemPadding || 10}px</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Gap</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="0" 
              max="30" 
              step="1" 
              value={element.style?.itemGap || 8}
              on:input={(e) => { element.style.itemGap = Number(e.target.value) || 8; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.itemGap || 8}px</span>
          </div>
        </div>
      </div>
      
      <div class="nav-config-section">
        <h3>Text & Icons</h3>
        <div class="nav-config-row">
          <label>Text Color</label>
          <input 
            type="color" 
            value={element.style?.textColor || '#ffffff'} 
            on:input={(e) => { element.style.textColor = e.target.value; syncChanges(); }} 
          />
        </div>
        <div class="nav-config-row">
          <label>Font Size</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="10" 
              max="32" 
              step="1" 
              value={element.style?.fontSize || 14}
              on:input={(e) => { element.style.fontSize = Number(e.target.value) || 14; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.fontSize || 14}px</span>
          </div>
        </div>
        <div class="nav-config-row">
          <label>Icon Size</label>
          <div class="slider-with-value">
            <input 
              type="range" 
              min="12" 
              max="48" 
              step="1" 
              value={element.style?.iconSize || 20}
              on:input={(e) => { element.style.iconSize = Number(e.target.value) || 20; syncChanges(); }} 
            />
            <span class="slider-value">{element.style?.iconSize || 20}px</span>
          </div>
        </div>
      </div>
    {/if}
    
    <!-- ITEMS TAB -->
    {#if activeTab === 'items'}
      <div class="nav-items-list">
        {#each element.items || [] as item, i (item.id)}
          <div class="nav-item-card" class:editing={editingNavItemId === item.id}>
            <div class="nav-item-header" on:click={() => editingNavItemId = editingNavItemId === item.id ? null : item.id}>
              <span class="nav-item-icon">
                {#if item.iconClass}
                  <i class={item.iconClass}></i>
                {:else}
                  <span class="nav-item-emoji">{item.emoji || '●'}</span>
                {/if}
              </span>
              <span class="nav-item-label">{item.label || 'Untitled'}</span>
              <div class="nav-item-actions">
                <button class="nav-item-action" on:click|stopPropagation={() => moveNavItem(i, -1)} disabled={i === 0} title="Move Up">↑</button>
                <button class="nav-item-action" on:click|stopPropagation={() => moveNavItem(i, 1)} disabled={i === element.items.length - 1} title="Move Down">↓</button>
                <button class="nav-item-action" on:click|stopPropagation={() => duplicateNavItem(i)} title="Duplicate">⧉</button>
                <button class="nav-item-action danger" on:click|stopPropagation={() => removeNavItem(i)} title="Delete">×</button>
              </div>
            </div>
            
            {#if editingNavItemId === item.id}
              <div class="nav-item-edit">
                <div class="nav-config-row">
                  <label>Label</label>
                  <input type="text" bind:value={item.label} on:input={syncChanges} placeholder="Button label" />
                </div>
                
                <div class="nav-config-row">
                  <label>Icon</label>
                  <div class="icon-picker-inline">
                    <input type="text" bind:value={iconSearchQuery} placeholder="Search icons..." class="icon-search" />
                    <div class="icon-grid">
                      {#each filteredIcons.slice(0, 36) as icon}
                        <button 
                          class="icon-option" 
                          class:active={item.iconClass === icon.class}
                          on:click={() => { item.iconClass = icon.class; syncChanges(); }}
                          title={icon.name}
                        >
                          <i class={icon.class}></i>
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
                
                <div class="nav-config-row">
                  <label>Action</label>
                  <select bind:value={item.action.type} on:change={() => { 
                    // Reset action-specific fields when type changes
                    if (item.action.type === 'launch_app') {
                      item.action.app_id = ROKU_APPS[0].id;
                      item.action.channel_id = ROKU_APPS[0].channelId;
                    } else if (item.action.type === 'remote_command') {
                      item.action.command = ROKU_COMMANDS[0].id;
                      item.action.key = ROKU_COMMANDS[0].key;
                    }
                    syncChanges(); 
                  }}>
                    <optgroup label="Navigation">
                      <option value="slide">Go to Slide</option>
                      <option value="group">Go to Group</option>
                    </optgroup>
                    <optgroup label="Roku Remote">
                      <option value="launch_app">Launch App</option>
                      <option value="remote_command">Remote Command</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="url">Open URL</option>
                      <option value="ping">Send Ping</option>
                    </optgroup>
                  </select>
                </div>
                
                {#if item.action.type === 'slide'}
                  <div class="nav-config-row">
                    <label>Slide</label>
                    <select bind:value={item.action.slide_index} on:change={syncChanges}>
                      {#each cast?.definition?.groups || [] as group, groupIdx}
                        <optgroup label={group.name}>
                          {#each group.slides || [] as slide, slideIdx}
                            <option value={slideIdx}>{slide.name || `Slide ${slideIdx + 1}`}</option>
                          {/each}
                        </optgroup>
                      {/each}
                    </select>
                  </div>
                  <div class="nav-config-row">
                    <label>In Group</label>
                    <select bind:value={item.action.group_id} on:change={syncChanges}>
                      {#each cast?.definition?.groups || [] as group}
                        <option value={group.id}>{group.name}</option>
                      {/each}
                    </select>
                  </div>
                {:else if item.action.type === 'group'}
                  <div class="nav-config-row">
                    <label>Group</label>
                    <select bind:value={item.action.group_id} on:change={syncChanges}>
                      {#each cast?.definition?.groups || [] as group}
                        <option value={group.id}>{group.name}</option>
                      {/each}
                    </select>
                  </div>
                {:else if item.action.type === 'launch_app'}
                  <div class="nav-config-row">
                    <label>App</label>
                    <select 
                      value={item.action.app_id || 'netflix'} 
                      on:change={(e) => { 
                        const app = ROKU_APPS.find(a => a.id === e.target.value);
                        item.action.app_id = app.id;
                        item.action.channel_id = app.channelId;
                        item.action.app_label = app.label;
                        syncChanges(); 
                      }}
                    >
                      {#each ROKU_APPS as app}
                        <option value={app.id}>{app.label}</option>
                      {/each}
                    </select>
                  </div>
                  <p class="action-hint">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Launches the app on Roku when pressed
                  </p>
                {:else if item.action.type === 'remote_command'}
                  <div class="nav-config-row">
                    <label>Command</label>
                    <select 
                      value={item.action.command || 'home'} 
                      on:change={(e) => { 
                        const cmd = ROKU_COMMANDS.find(c => c.id === e.target.value);
                        item.action.command = cmd.id;
                        item.action.key = cmd.key;
                        item.action.command_label = cmd.label;
                        syncChanges(); 
                      }}
                    >
                      {#each ROKU_COMMANDS as cmd}
                        <option value={cmd.id}>{cmd.label}</option>
                      {/each}
                    </select>
                  </div>
                  <p class="action-hint">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Sends remote control command to Roku
                  </p>
                {:else if item.action.type === 'url'}
                  <div class="nav-config-row">
                    <label>URL</label>
                    <input type="url" bind:value={item.action.url} on:input={syncChanges} placeholder="https://..." />
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        
        <button class="nav-add-item-btn" on:click={addNavItem}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Menu Item
        </button>
      </div>
    {/if}
  </div>
  
  <div class="nav-window-footer">
    <button class="btn btn-sm btn-ghost" on:click={syncChanges}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      Refresh Now
    </button>
    <button class="btn btn-sm btn-primary" on:click={close}>Done</button>
  </div>
</div>
{/if}

<style>
  .nav-config-window {
    position: fixed;
    width: 420px;
    height: 550px;
    max-height: 80vh;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    z-index: 10001;
    display: flex;
    flex-direction: column;
  }

  .nav-config-window.dragging {
    user-select: none;
  }

  .nav-window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    cursor: move;
    flex-shrink: 0;
  }

  .nav-window-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .nav-icon {
    font-size: 16px;
  }

  .nav-category-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.2);
    color: rgb(129, 140, 248);
  }
  
  .tab-icon {
    font-size: 14px;
  }

  .nav-window-close {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    color: rgb(var(--color-text-muted));
  }

  .nav-window-close:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .nav-config-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    flex-shrink: 0;
  }

  .nav-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .nav-tab:hover {
    background: rgba(var(--color-text), 0.05);
    color: rgb(var(--color-text));
  }

  .nav-tab.active {
    background: rgb(var(--color-primary));
    color: white;
  }

  .nav-tab-badge {
    background: rgba(255, 255, 255, 0.2);
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
  }

  .nav-window-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .nav-config-section {
    margin-bottom: 20px;
  }

  .nav-config-section h3 {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--color-text-muted));
  }

  .nav-presets-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .nav-preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    cursor: pointer;
    font-size: 11px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .nav-preset-btn:hover {
    border-color: rgb(var(--color-primary) / 0.3);
    color: rgb(var(--color-text));
  }

  .nav-preset-btn.active {
    background: rgb(var(--color-primary) / 0.1);
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-primary));
  }

  .preset-icon {
    font-size: 18px;
  }

  .nav-layout-toggle {
    display: flex;
    gap: 8px;
  }

  .nav-layout-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .nav-layout-btn:hover {
    border-color: rgb(var(--color-primary) / 0.3);
  }

  .nav-layout-btn.active {
    background: rgb(var(--color-primary) / 0.1);
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-primary));
  }

  .nav-config-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .nav-config-row label {
    flex: 0 0 90px;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
  }

  .nav-config-row input[type="text"],
  .nav-config-row input[type="url"],
  .nav-config-row input[type="number"],
  .nav-config-row select {
    flex: 1;
    padding: 6px 10px;
    font-size: 13px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    color: rgb(var(--color-text));
  }

  .nav-config-row input[type="color"] {
    width: 36px;
    height: 28px;
    padding: 2px;
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    cursor: pointer;
  }

  .slider-with-value {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .slider-with-value input[type="range"] {
    flex: 1;
  }

  .slider-value {
    flex: 0 0 45px;
    font-size: 11px;
    color: rgb(var(--color-text-muted));
    text-align: right;
  }

  .inherited-notice {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
  }

  .inherited-icon {
    font-size: 24px;
  }

  .inherited-text strong {
    display: block;
    margin-bottom: 4px;
  }

  .inherited-text p {
    font-size: 12px;
    color: rgb(var(--color-text-muted));
    margin: 0 0 8px 0;
  }

  .nav-items-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nav-item-card {
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    overflow: hidden;
  }

  .nav-item-card.editing {
    border-color: rgb(var(--color-primary));
  }

  .nav-item-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    cursor: pointer;
  }

  .nav-item-header:hover {
    background: rgba(var(--color-text), 0.03);
  }

  .nav-item-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--color-primary), 0.1);
    border-radius: 6px;
    font-size: 14px;
    color: rgb(var(--color-primary));
  }

  .nav-item-label {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
  }

  .nav-item-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .nav-item-header:hover .nav-item-actions {
    opacity: 1;
  }

  .nav-item-action {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
  }

  .nav-item-action:hover:not(:disabled) {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .nav-item-action:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .nav-item-action.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
  }

  .nav-item-edit {
    padding: 12px;
    border-top: 1px solid rgb(var(--color-border));
    background: rgba(var(--color-surface), 0.5);
  }

  .icon-picker-inline {
    flex: 1;
  }

  .icon-search {
    width: 100%;
    margin-bottom: 8px;
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
    max-height: 120px;
    overflow-y: auto;
  }

  .icon-option {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .icon-option:hover {
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-text));
  }

  .icon-option.active {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
    color: white;
  }

  .nav-add-item-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    background: transparent;
    border: 2px dashed rgb(var(--color-border));
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .nav-add-item-btn:hover {
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-primary));
    background: rgba(var(--color-primary), 0.05);
  }

  .nav-window-footer {
    display: flex;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgb(var(--color-surface-alt));
    border-top: 1px solid rgb(var(--color-border));
    flex-shrink: 0;
  }

  .btn {
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-primary {
    background: rgb(var(--color-primary));
    color: white;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-sm {
    padding: 6px 12px;
    font-size: 12px;
  }
  
  .btn-ghost {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: rgb(var(--color-text-muted));
    border: 1px solid rgb(var(--color-border));
  }
  
  .btn-ghost:hover {
    background: rgba(var(--color-text), 0.05);
    color: rgb(var(--color-text));
  }
  
  /* Size section */
  .nav-size-section {
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 16px;
    margin-bottom: 16px;
  }
  
  .nav-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .nav-size-input {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  
  .nav-size-input label {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    width: 20px;
    flex-shrink: 0;
  }
  
  .nav-size-input input {
    flex: 1;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    padding: 8px 12px;
    color: white;
    font-size: 14px;
  }
  
  .nav-size-input input:focus {
    outline: none;
    border-color: rgba(99, 102, 241, 0.5);
  }
  
  .size-separator {
    color: rgba(255,255,255,0.4);
    font-size: 14px;
  }
  
  .action-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px 0 8px 0;
    padding: 8px 12px;
    background: rgba(59, 130, 246, 0.1);
    border-radius: 6px;
    font-size: 11px;
    color: rgb(147, 197, 253);
  }
  
  .action-hint svg {
    flex-shrink: 0;
    opacity: 0.7;
  }
</style>
