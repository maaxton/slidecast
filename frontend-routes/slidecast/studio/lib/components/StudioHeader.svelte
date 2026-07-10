<script>
  import { createEventDispatcher } from 'svelte';
  import { getMenuDefinitions } from '../data/menuDefinitions.js';

  export let castName = '';
  export let saving = false;
  export let hasUnsavedChanges = false;
  export let openMenu = null;
  export let canvasSize = '1920 × 1080';
  
  // Panel state for reactive menu checkboxes
  export let showSlidesPanel = true;
  export let showLayersPanel = true;
  export let showPropertiesPanel = true;
  export let showHistoryPanel = false;

  // Allow two-way binding for castName
  $: {
    // Update cast name when it changes externally
  }

  function handleCastNameChange(e) {
    castName = e.target.value;
    dispatch('castNameChange', { name: castName });
  }

  const dispatch = createEventDispatcher();
  
  // Make menuDefinitions reactive so checkboxes update when panel states change
  $: menuDefinitions = getMenuDefinitions({
    showSlidesPanel,
    showLayersPanel,
    showPropertiesPanel,
    showHistoryPanel
  });

  function toggleMenu(key) {
    dispatch('menuToggle', { key, open: openMenu === key ? null : key });
  }

  function handleMenuAction(action) {
    dispatch('menuAction', { action });
  }

  function handleSave() {
    dispatch('save');
  }

  function handlePreview() {
    dispatch('preview');
  }

  function handleClose() {
    dispatch('close');
  }

  function handleCanvasSizeClick() {
    dispatch('openCanvasSize');
  }

  function menuItemTestId(item) {
    if (item?.action) return item.action;
    if (item?.label) return item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return 'item';
  }
</script>

<!-- Header with Menu Bar -->
<header class="studio-header" data-testid="studio-header">
  <!-- Top Row: Menu Bar -->
  <div class="menu-bar-row">
    <div class="menu-bar-left">
      <button class="back-btn" on:click={handleClose} title="Back to Dashboard" data-testid="studio-back">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      
      <nav class="menu-bar">
        {#each Object.entries(menuDefinitions) as [key, menu]}
          <div class="menu-item" class:open={openMenu === key}>
            <button 
              class="menu-trigger" 
              data-testid={`menu-${key}`}
              on:click|stopPropagation={() => toggleMenu(key)}
              on:mouseenter={() => openMenu && (openMenu = key)}
            >
              {menu.label}
            </button>
            
            {#if openMenu === key}
              <div class="menu-dropdown">
                {#each menu.items as item}
                  {#if item.type === 'separator'}
                    <div class="menu-separator"></div>
                  {:else if item.submenu}
                    <div class="menu-item-with-submenu">
                      <button
                        class="menu-dropdown-item has-submenu"
                        data-testid={`menu-item-${menuItemTestId(item)}`}
                        disabled={typeof item.disabled === 'function' ? item.disabled() : item.disabled}
                      >
                        {#if item.icon}<i class={item.icon}></i>{/if}
                        <span>{item.label}</span>
                        <i class="fa-solid fa-chevron-right submenu-arrow"></i>
                      </button>
                      <div class="submenu">
                        {#each item.submenu as subitem}
                          {#if subitem.type === 'separator'}
                            <div class="menu-separator"></div>
                          {:else}
                            <button 
                              class="menu-dropdown-item"
                              data-testid={`menu-item-${menuItemTestId(subitem)}`}
                              on:click={() => handleMenuAction(subitem.action)}
                              disabled={typeof subitem.disabled === 'function' ? subitem.disabled() : subitem.disabled}
                            >
                              <span>{subitem.label}</span>
                              {#if subitem.shortcut}<span class="menu-shortcut">{subitem.shortcut}</span>{/if}
                            </button>
                          {/if}
                        {/each}
                      </div>
                    </div>
                  {:else}
                    <button 
                      class="menu-dropdown-item"
                      data-testid={`menu-item-${menuItemTestId(item)}`}
                      class:has-check={item.checked !== undefined}
                      on:click={() => handleMenuAction(item.action)}
                      disabled={typeof item.disabled === 'function' ? item.disabled() : item.disabled}
                    >
                      {#if item.checked !== undefined}
                        <i class="fa-solid fa-check menu-check" class:visible={item.checked}></i>
                      {/if}
                      {#if item.icon}<i class={item.icon}></i>{/if}
                      <span>{item.label}</span>
                      {#if item.shortcut}<span class="menu-shortcut">{item.shortcut}</span>{/if}
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
    </div>
    
    <div class="menu-bar-right">
      <button class="btn btn-ghost btn-sm" on:click={handlePreview} title="Preview Cast" data-testid="studio-preview">
        <i class="fa-solid fa-play"></i>
        Preview
      </button>
      <button class="btn btn-primary btn-sm" class:has-changes={hasUnsavedChanges} on:click={handleSave} disabled={saving} data-testid="studio-save">
        {#if saving}
          <span class="spinner-sm"></span>
        {:else}
          <i class="fa-solid fa-floppy-disk"></i>
        {/if}
        Save
        {#if hasUnsavedChanges}<span class="unsaved-dot">•</span>{/if}
      </button>
    </div>
  </div>
  
  <!-- Second Row: Document Title & Status -->
  <div class="title-bar-row">
    <div class="title-bar-left">
      <input type="text" class="cast-name-input" value={castName} on:input={handleCastNameChange} placeholder="Untitled Cast" data-testid="studio-cast-name" />
      {#if hasUnsavedChanges}
        <span class="unsaved-indicator">Unsaved changes</span>
      {/if}
    </div>
    
    <div class="title-bar-right">
      <span class="canvas-size" on:click={handleCanvasSizeClick} title="Canvas Size" data-testid="studio-canvas-size">
        <i class="fa-solid fa-expand"></i>
        {canvasSize}
      </span>
    </div>
  </div>
</header>
