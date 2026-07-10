<script>
  import { createEventDispatcher } from 'svelte';
  import { iconCategories, allIcons } from '../data/iconCategories.js';
  import * as store from '../stores/studioStore.js';
  import { get } from 'svelte/store';

  export let show = false;
  export let selectedElement = null;
  export let itemIndex = null;

  const dispatch = createEventDispatcher();

  let iconSearchQuery = '';
  let activeIconCategory = 'all';

  $: filteredIcons = iconSearchQuery 
    ? allIcons.filter(icon => 
        icon.name.toLowerCase().includes(iconSearchQuery.toLowerCase()) ||
        icon.category.toLowerCase().includes(iconSearchQuery.toLowerCase())
      )
    : activeIconCategory === 'all' 
      ? allIcons 
      : iconCategories.find(c => c.name === activeIconCategory)?.icons || [];

  function close() {
    iconSearchQuery = '';
    activeIconCategory = 'all';
    show = false;
    dispatch('close');
  }

  function selectIcon(iconClass) {
    if (selectedElement?.items && selectedElement.items[itemIndex]) {
      selectedElement.items[itemIndex].iconClass = iconClass;
      selectedElement.items[itemIndex].iconSvg = null;
      selectedElement.items[itemIndex].icon = null;
      dispatch('update', { element: selectedElement });
    }
    close();
  }

  function selectCustomIcon(iconValue) {
    if (selectedElement?.items && selectedElement.items[itemIndex]) {
      selectedElement.items[itemIndex].icon = iconValue;
      selectedElement.items[itemIndex].iconClass = null;
      selectedElement.items[itemIndex].iconSvg = null;
      dispatch('update', { element: selectedElement });
    }
    close();
  }

  let customIconInput = null;
</script>

{#if show && selectedElement?.type === 'nav'}
  <div class="modal-overlay" data-testid="modal-icon-picker" on:click={close}>
    <div class="modal modal-icon-picker modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <span class="modal-icon"><i class="fa-solid fa-icons"></i></span>
        <h2>Choose Icon</h2>
        <span class="icon-count">{allIcons.length} icons</span>
        <button class="modal-close" on:click={close}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      
      <div class="icon-picker-search">
        <i class="fa-solid fa-magnifying-glass search-icon"></i>
        <input 
          type="text" 
          bind:value={iconSearchQuery}
          placeholder="Search {allIcons.length} icons..."
          class="search-input"
        />
      </div>
      
      <div class="icon-picker-categories">
        <button 
          class="category-btn" 
          class:active={activeIconCategory === 'all'}
          on:click={() => activeIconCategory = 'all'}
        >
          All
        </button>
        {#each iconCategories as category}
          <button 
            class="category-btn"
            class:active={activeIconCategory === category.name}
            on:click={() => activeIconCategory = category.name}
          >
            {category.name}
          </button>
        {/each}
      </div>
      
      <div class="modal-body icon-picker-body">
        <div class="icon-grid fa-icon-grid">
          {#each filteredIcons as icon}
            <button 
              class="icon-option fa-icon-option" 
              class:selected={selectedElement.items[itemIndex]?.iconClass === icon.class}
              on:click={() => selectIcon(icon.class)}
              title={icon.name}
            >
              <i class={icon.class}></i>
              <span class="icon-name">{icon.name}</span>
            </button>
          {/each}
          
          {#if filteredIcons.length === 0}
            <div class="no-results">
              <i class="fa-solid fa-magnifying-glass"></i>
              <p>No icons found for "{iconSearchQuery}"</p>
            </div>
          {/if}
        </div>
        
        <div class="custom-icon-section">
          <h4>Or use custom emoji/text:</h4>
          <div class="custom-icon-input-row">
            <input 
              type="text" 
              placeholder="Enter emoji or text..." 
              class="custom-icon-input"
              bind:this={customIconInput}
              on:keydown={(e) => {
                if (e.key === 'Enter' && e.target.value) {
                  selectCustomIcon(e.target.value);
                }
              }}
            />
            <button 
              class="btn btn-primary btn-sm"
              on:click={() => {
                if (customIconInput?.value) {
                  selectCustomIcon(customIconInput.value);
                }
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
