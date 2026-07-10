<script>
  import { createEventDispatcher } from 'svelte';
  
  export let currentSlide = null;
  export let selectedElementId = null;
  export let draggedLayerId = null;
  export let dragOverLayerId = null;
  export let activeTool = 'pointer';
  export let collapsed = false;
  export let show = true;
  
  const dispatch = createEventDispatcher();
  
  function selectElement(elementId) {
    // Hand tool disables layer selection
    if (activeTool === 'hand') return;
    dispatch('selectElement', elementId);
  }
  
  function duplicateElement(element) {
    // Don't allow duplicating locked elements
    if (element.locked) return;
    dispatch('duplicateElement', element);
  }
  
  function deleteElement(elementId, element) {
    // Don't allow deleting locked elements
    if (element?.locked) return;
    dispatch('deleteElement', elementId);
  }
  
  function updateElementName(element) {
    // Don't allow renaming locked elements
    if (element.locked) return;
    dispatch('updateElementName', element);
  }
  
  function toggleLock(element) {
    // Don't allow toggling lock on background elements (always locked)
    if (element.type === 'background') return;
    dispatch('toggleLock', element);
  }
  
  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('toggleCollapse', collapsed);
  }
  
  // Drag handlers
  function handleLayerDragStart(e, element) {
    dispatch('layerDragStart', { event: e, element });
  }
  
  function handleLayerDragOver(e, element) {
    dispatch('layerDragOver', { event: e, element });
  }
  
  function handleLayerDragLeave(e) {
    dispatch('layerDragLeave', { event: e });
  }
  
  function handleLayerDrop(e, element) {
    dispatch('layerDrop', { event: e, element });
  }
  
  function handleLayerDragEnd(e) {
    dispatch('layerDragEnd', { event: e });
  }
  
  // Sort elements by z-index (background at bottom)
  function sortElements(elements) {
    return [...elements].sort((a, b) => {
      if (a.type === 'background') return 1;
      if (b.type === 'background') return -1;
      return (b.zIndex || 0) - (a.zIndex || 0);
    });
  }
</script>

{#if show}
<div class="right-panel layers-panel" class:collapsed data-testid="layers-panel">
  <div class="panel-header" on:click={toggleCollapse} data-testid="layers-panel-header">
    <h3>Layers</h3>
    <button class="icon-btn">{collapsed ? '‹' : '›'}</button>
  </div>
  {#if !collapsed}
    <div class="panel-content">
      {#if currentSlide?.elements?.length > 0}
        <div class="layers-list-inline" data-testid="layers-list">
          {#each sortElements(currentSlide?.elements || []) as element, i (element.id)}
            <div 
              class="layer-row"
              data-testid="layer-row"
              data-layer-type={element.type}
              class:selected={selectedElementId === element.id}
              class:locked={element.locked || element.type === 'background'}
              class:hand-tool-active={activeTool === 'hand'}
              class:drag-over={dragOverLayerId === element.id && draggedLayerId !== element.id}
              class:dragging={draggedLayerId === element.id}
              on:click={() => selectElement(element.id)}
              draggable={!(element.locked || element.type === 'background')}
              on:dragstart={(e) => handleLayerDragStart(e, element)}
              on:dragover={(e) => handleLayerDragOver(e, element)}
              on:dragleave={handleLayerDragLeave}
              on:drop={(e) => handleLayerDrop(e, element)}
              on:dragend={handleLayerDragEnd}
            >
              <span class="layer-icon">
                {#if element.type === 'background'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/></svg>
                {:else if element.type === 'text'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>
                {:else if element.type === 'image'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                {:else if element.type === 'video'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
                {:else if element.type === 'shape'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v18H3z"/></svg>
                {:else if element.type === 'nav'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                {:else if element.type === 'qr' || element.type === 'qrcode'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13 0h1v1h-1zm-3-1h2v2h-2zm-1 2h1v4h-4v-2h1v-1h2zm4-1h2v4h-1v-3h-1zm-3 4h1v1h-1zm2 0h1v1h-1z"/></svg>
                {:else if element.type === 'ping'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
                {:else if element.type === 'widget'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 3.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5zM19 19H5V5h14v14z"/></svg>
                {:else}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>{/if}
              </span>
              <input 
                type="text" 
                class="layer-name-input"
                data-testid="layer-name"
                bind:value={element.name} 
                on:click|stopPropagation 
                on:input={() => updateElementName(element)}
                placeholder={element.type}
              />
              {#if element.type === 'nav'}
                {#if element._isInheritedCopy}
                  <span class="layer-scope-badge inherited" title="Inherited from {element.scope === 'cast' ? 'cast' : 'group'}">🔗</span>
                {:else if element.scope === 'cast'}
                  <span class="layer-scope-badge cast" title="Applied to entire cast">🌐</span>
                {:else if element.scope === 'group'}
                  <span class="layer-scope-badge group" title="Applied to this group">📁</span>
                {/if}
              {/if}
              {#if element.type !== 'background'}
                <div class="layer-actions">
                  <!-- Lock/Unlock toggle button -->
                  <button 
                    class="layer-action-btn lock-btn" 
                    class:locked={element.locked}
                    on:click|stopPropagation={() => toggleLock(element)} 
                    title={element.locked ? "Unlock layer" : "Lock layer"} 
                    data-testid="layer-lock-toggle"
                  >
                    {#if element.locked}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                    {:else}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
                    {/if}
                  </button>
                  {#if !element.locked}
                    <button class="layer-action-btn" on:click|stopPropagation={() => duplicateElement(element)} title="Duplicate" data-testid="layer-duplicate"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>
                    <button class="layer-action-btn danger" on:click|stopPropagation={() => deleteElement(element.id, element)} title="Delete" data-testid="layer-delete"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
                    <span class="layer-drag-handle" title="Drag to reorder" data-testid="layer-drag-handle"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></span>
                  {/if}
                </div>
              {:else}
                <span class="layer-locked-icon" title="Background (always locked)" data-testid="layer-locked"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></span>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-layers-hint">No elements</p>
      {/if}
    </div>
  {/if}
</div>
{/if}

<style>
  /* Styles are inherited from the main page CSS */
  
  /* Lock button specific styles */
  :global(.layer-action-btn.lock-btn) {
    color: rgb(var(--color-text-muted));
  }
  
  :global(.layer-action-btn.lock-btn.locked) {
    color: rgb(var(--color-warning, 234, 179, 8));
    background: rgba(234, 179, 8, 0.15);
  }
  
  :global(.layer-action-btn.lock-btn:hover) {
    background: rgba(var(--color-text), 0.1);
  }
  
  :global(.layer-action-btn.lock-btn.locked:hover) {
    background: rgba(234, 179, 8, 0.25);
  }
</style>
