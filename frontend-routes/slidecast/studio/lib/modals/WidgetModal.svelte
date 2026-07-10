<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let availableWidgets = [];
  export let widgetCategories = [];

  const dispatch = createEventDispatcher();

  let searchQuery = '';
  let selectedCategory = 'all';

  $: filteredWidgets = availableWidgets.filter(w => {
    if (searchQuery && !w.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedCategory !== 'all' && w.category !== selectedCategory) return false;
    return true;
  });

  function close() {
    show = false;
    dispatch('close');
  }

  function selectWidget(widget) {
    dispatch('select', { widget });
    close();
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-widget" on:click={close}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Add Widget</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <!-- Widget Filters -->
        <div class="widget-filters">
          <div class="widget-search">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search widgets..." bind:value={searchQuery} data-testid="widget-search" />
          </div>
          <select bind:value={selectedCategory} data-testid="widget-category">
            <option value="all">All Categories</option>
            {#each widgetCategories as cat}
              <option value={cat.id}>{cat.icon} {cat.name}</option>
            {/each}
          </select>
        </div>
        
        <!-- Widget Grid -->
        <div class="widgets-picker-grid">
          {#each filteredWidgets as widget}
            <button class="widget-picker-item" on:click={() => selectWidget(widget)} data-testid="widget-picker-item" data-widget-uuid={widget.uuid}>
              {#if widget.thumbnail}
                <div class="widget-picker-thumbnail">
                  <img src={widget.thumbnail} alt="{widget.name} preview" />
                </div>
              {:else}
                <span class="widget-picker-icon">{widgetCategories.find(c => c.id === widget.category)?.icon || '📦'}</span>
              {/if}
              <span class="widget-picker-name">{widget.name}</span>
              {#if widget.source === 'provider'}
                <span class="widget-picker-badge" title="Provided by the {widget.provider} extension">{widget.provider}</span>
              {/if}
              <span class="widget-picker-meta">
                {widget.renderMode === 'native' ? '⚡' : '🖼️'} 
                {widget.refreshInterval === 0 ? 'Static' : widget.refreshInterval < 60000 ? `${widget.refreshInterval/1000}s` : `${widget.refreshInterval/60000}m`}
              </span>
            </button>
          {:else}
            <p class="no-widgets-msg">No widgets available. Create one in the Widget Factory.</p>
          {/each}
        </div>
        
        <div class="widget-modal-footer">
          <a href="/ext/slidecast/widgets" class="btn btn-ghost" data-testid="widget-library-link">Open Widget Library</a>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
    isolation: isolate; /* Create new stacking context */
  }

  .modal {
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 90vw;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-lg {
    width: 700px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 20px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .widget-filters {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }

  .widget-search {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .widget-search svg {
    position: absolute;
    left: 12px;
    width: 16px;
    height: 16px;
    color: rgb(var(--color-text-muted));
  }

  .widget-search input {
    width: 100%;
    padding: 10px 12px 10px 40px;
    font-size: 13px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    color: rgb(var(--color-text));
  }

  .widget-filters select {
    padding: 10px 12px;
    font-size: 13px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    color: rgb(var(--color-text));
    min-width: 160px;
  }

  .widgets-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .widget-picker-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 16px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .widget-picker-item:hover {
    border-color: rgb(var(--color-primary));
    background: rgba(var(--color-primary), 0.05);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .widget-picker-icon {
    font-size: 32px;
  }

  .widget-picker-thumbnail {
    width: 100%;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.2);
    margin-bottom: 4px;
  }

  .widget-picker-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .widget-picker-name {
    font-size: 13px;
    font-weight: 500;
    color: rgb(var(--color-text));
  }

  .widget-picker-meta {
    font-size: 11px;
    color: rgb(var(--color-text-muted));
  }

  .widget-picker-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(var(--color-primary), 0.12);
    color: rgb(var(--color-primary));
    text-transform: lowercase;
  }

  .no-widgets-msg {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px;
    color: rgb(var(--color-text-muted));
  }

  .widget-modal-footer {
    display: flex;
    justify-content: center;
    padding-top: 12px;
    border-top: 1px solid rgb(var(--color-border));
  }

  .btn {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .btn-ghost {
    background: transparent;
    color: rgb(var(--color-text-muted));
  }

  .btn-ghost:hover {
    background: rgba(var(--color-text), 0.05);
    color: rgb(var(--color-text));
  }
</style>
