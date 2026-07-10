<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  export let widgets = []; // Available widgets list
  
  const dispatch = createEventDispatcher();
  
  $: widget = widgets.find(w => w.uuid === element?.widgetUuid);
  
  function openWidgetConfig() {
    dispatch('openConfig', { type: 'widget', element });
  }
  
  function refreshWidget() {
    dispatch('refreshWidget', { element });
  }
</script>

{#if element?.type === 'widget'}
<div class="prop-group">
  <h4>Widget</h4>
  
  <div class="widget-info">
    <span class="widget-icon">{widget?.icon || '📦'}</span>
    <span class="widget-name">{widget?.name || element.widgetName || 'Widget'}</span>
  </div>
  
  <button class="btn btn-primary btn-sm btn-full" on:click={openWidgetConfig}>
    <i class="fa-solid fa-gear"></i>
    Configure Widget
  </button>
  
  <button class="btn btn-secondary btn-sm btn-full" on:click={refreshWidget}>
    <i class="fa-solid fa-rotate-right"></i>
    Refresh Now
  </button>
  
  {#if element._widgetError}
  <div class="widget-error">
    <i class="fa-solid fa-triangle-exclamation"></i>
    {element._widgetError}
  </div>
  {/if}
  
  <div class="prop-row">
    <label>Auto-Refresh</label>
    <div class="number-input-with-unit">
      <input 
        type="number" 
        min="0" 
        step="1000"
        bind:value={element.refreshInterval} 
        on:input={() => dispatch('change', { property: 'refresh interval' })}
      />
      <span class="unit">ms</span>
    </div>
  </div>
  
  <p class="refresh-hint">
    {#if element.refreshInterval === 0}
      Static (no auto-refresh)
    {:else if element.refreshInterval < 1000}
      Every {element.refreshInterval}ms
    {:else if element.refreshInterval < 60000}
      Every {(element.refreshInterval / 1000).toFixed(0)}s
    {:else}
      Every {(element.refreshInterval / 60000).toFixed(1)}m
    {/if}
  </p>
</div>

<style>
  .widget-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: rgba(var(--color-surface-alt), 0.5);
    border-radius: 6px;
    margin-bottom: 12px;
  }
  
  .widget-icon {
    font-size: 20px;
  }
  
  .widget-name {
    font-weight: 500;
  }
  
  .btn-full {
    width: 100%;
    margin-bottom: 8px;
  }
  
  .widget-error {
    padding: 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    color: rgb(239, 68, 68);
    font-size: 12px;
    margin-bottom: 12px;
  }
  
  .widget-error i {
    margin-right: 4px;
  }
  
  .refresh-hint {
    font-size: 11px;
    color: rgb(var(--color-text-muted));
    margin: 4px 0 0 0;
  }
  
  .number-input-with-unit {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .number-input-with-unit input {
    flex: 1;
  }
  
  .unit {
    font-size: 11px;
    color: rgb(var(--color-text-muted));
  }
</style>
{/if}
