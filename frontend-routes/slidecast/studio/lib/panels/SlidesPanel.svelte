<script>
  import { createEventDispatcher } from 'svelte';
  import SlideRenderer from '../../../lib/SlideRenderer.svelte';
  
  export let cast = null;
  export let currentGroupId = 'home';
  export let currentSlideIndex = 0;
  export let currentGroup = null;
  export let currentSlides = [];
  export let slideClipboard = null;
  export let clipboardOperation = null;
  export let draggedSlideIndex = null;
  export let dragOverSlideIndex = null;
  export let collapsed = false;
  export let show = true;
  
  const dispatch = createEventDispatcher();
  
  // Helper to get current group for duration calculation
  function getCurrentGroup() {
    return currentGroup;
  }
  
  // Event handlers that dispatch to parent
  function selectGroup(groupId) {
    dispatch('selectGroup', groupId);
  }
  
  function deleteGroup(groupId) {
    dispatch('deleteGroup', groupId);
  }
  
  function addSlide() {
    dispatch('addSlide');
  }
  
  function selectSlide(index) {
    dispatch('selectSlide', index);
  }
  
  function deleteSlide(index) {
    dispatch('deleteSlide', index);
  }
  
  function duplicateSlide(index) {
    dispatch('duplicateSlide', index);
  }
  
  function copySlide(index) {
    dispatch('copySlide', index);
  }
  
  function cutSlide(index) {
    dispatch('cutSlide', index);
  }
  
  function openSlideSettings(index) {
    dispatch('openSlideSettings', index);
  }
  
  function openGroupSettings() {
    dispatch('openGroupSettings');
  }
  
  function openAddGroupModal() {
    dispatch('openAddGroupModal');
  }
  
  function showPasteOptions() {
    dispatch('showPasteOptions');
  }
  
  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('toggleCollapse', collapsed);
  }
  
  // Drag handlers
  function handleSlideDragStart(e, index) {
    dispatch('slideDragStart', { event: e, index });
  }
  
  function handleSlideDragOver(e, index) {
    dispatch('slideDragOver', { event: e, index });
  }
  
  function handleSlideDragLeave(e) {
    dispatch('slideDragLeave', { event: e });
  }
  
  function handleSlideDrop(e, index) {
    dispatch('slideDrop', { event: e, index });
  }
  
  function handleSlideDragEnd(e) {
    dispatch('slideDragEnd', { event: e });
  }
</script>

{#if show}
<aside class="slides-panel" class:collapsed data-testid="slides-panel">
  {#if collapsed}
    <button class="panel-toggle" on:click={toggleCollapse} data-testid="slides-panel-expand">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </button>
  {:else}
    <!-- Group Tabs -->
    <div class="group-tabs" data-testid="group-tabs">
      {#each cast?.definition?.groups || [] as group}
        <button 
          class="group-tab"
          data-testid="group-tab"
          data-group-id={group.id}
          class:active={currentGroupId === group.id}
          on:click={() => selectGroup(group.id)}
          title={group.name}
        >
          {#if group.id === 'home'}<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px;"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>{/if}
          <span class="group-tab-name">{group.name}</span>
          {#if group.id !== 'home'}
            <button class="group-delete-btn" on:click|stopPropagation={() => deleteGroup(group.id)} title="Delete group" data-testid="group-delete">×</button>
          {/if}
        </button>
      {/each}
      <button class="group-tab add-group-btn" on:click={openAddGroupModal} title="Add Group" data-testid="group-add">
        +
      </button>
    </div>
    
    <div class="panel-header" data-testid="slides-panel-header">
      <h3>{currentGroup?.name || 'Slides'}</h3>
      <div class="panel-actions">
        <button class="icon-btn" on:click={openGroupSettings} title="Group Settings" data-testid="group-settings"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>
        <button class="icon-btn" on:click={addSlide} title="Add Slide" data-testid="slide-add">+</button>
        <button class="icon-btn" on:click={toggleCollapse} title="Collapse" data-testid="slides-collapse">‹</button>
      </div>
    </div>
    <div class="slides-list" data-testid="slides-list">
      {#each currentSlides as slide, i}
        <div 
          class="slide-thumb" data-testid="slide-thumb" data-slide-index={i} 
          class:active={currentSlideIndex === i}
          class:drag-over={dragOverSlideIndex === i && draggedSlideIndex !== i}
          class:dragging={draggedSlideIndex === i}
          draggable="true"
          on:click={() => selectSlide(i)}
          on:dragstart={(e) => handleSlideDragStart(e, i)}
          on:dragover={(e) => handleSlideDragOver(e, i)}
          on:dragleave={handleSlideDragLeave}
          on:drop={(e) => handleSlideDrop(e, i)}
          on:dragend={handleSlideDragEnd}
        >
          <!-- Top bar: Duration (left) & Delete (right) -->
          <div class="slide-top-bar">
            <button 
              class="slide-duration-badge" data-testid="slide-duration" 
              class:manual={slide.autoAdvance === false || (slide.autoAdvance === undefined && getCurrentGroup()?.autoAdvance === false)}
              on:click|stopPropagation={() => openSlideSettings(i)}
              title="Click to edit slide settings"
            >
              {#if slide.autoAdvance === false || (slide.autoAdvance === undefined && getCurrentGroup()?.autoAdvance === false)}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                Manual
              {:else}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                {(slide.duration || getCurrentGroup()?.defaultDuration || 10000) / 1000}s
              {/if}
            </button>
            {#if currentSlides.length > 1}
              <button class="slide-delete-btn" data-testid="slide-delete" on:click|stopPropagation={() => deleteSlide(i)} title="Delete Slide">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            {/if}
          </div>
          
          <!-- Drag handle & Preview -->
          <div class="slide-content">
            <div class="slide-drag-handle" title="Drag to reorder"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="8" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/></svg></div>
            <div class="slide-preview-container">
              <div class="slide-mini-preview">
                <SlideRenderer
                  slide={slide}
                  variables={cast?.definition?.variables || {}}
                  scale={0.083}
                  width={1920}
                  height={1080}
                  interactive={false}
                  {currentGroupId}
                  currentSlideIndex={i}
                />
              </div>
            </div>
          </div>
          
          <!-- Slide name -->
          <div class="slide-info">
            <input type="text" class="slide-name-input" bind:value={slide.name} on:click|stopPropagation />
          </div>
          
          <!-- Hover actions bar -->
          <div class="slide-hover-actions">
            <button class="slide-action-btn" on:click|stopPropagation={() => duplicateSlide(i)} title="Duplicate" data-testid="slide-duplicate">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <button class="slide-action-btn" on:click|stopPropagation={() => copySlide(i)} title="Copy" data-testid="slide-copy">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            </button>
            <button class="slide-action-btn" on:click|stopPropagation={() => cutSlide(i)} title="Cut" data-testid="slide-cut">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z"/></svg>
            </button>
            <button class="slide-action-btn" on:click|stopPropagation={() => openSlideSettings(i)} title="Settings" data-testid="slide-settings">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            </button>
          </div>
        </div>
      {/each}
      
      <!-- Add Slide Placeholder -->
      <div class="slide-thumb add-slide-ghost" data-testid="slide-add-ghost" on:click={addSlide} on:keydown={(e) => e.key === 'Enter' && addSlide()} tabindex="0" role="button" title="Add new slide">
        <div class="ghost-preview-area">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          <span class="ghost-label">New Slide</span>
        </div>
      </div>
      
      <!-- Paste indicator if clipboard has copied content -->
      {#if slideClipboard && clipboardOperation === 'copy'}
        <button class="paste-slide-btn" data-testid="slide-paste" on:click={showPasteOptions}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z"/></svg>
          Paste Slide
        </button>
      {/if}
    </div>
  {/if}
</aside>
{/if}

<style>
  /* Styles are inherited from the main page CSS */
  /* This component uses the same class names to match the existing styles */
</style>
