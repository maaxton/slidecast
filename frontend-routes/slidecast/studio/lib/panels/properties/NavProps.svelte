<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  function openNavConfig() {
    dispatch('openConfig', { type: 'nav', element });
  }
</script>

{#if element?.type === 'nav'}
<div class="prop-group">
  <h4>Navigation</h4>
  
  <div class="nav-info">
    {#if element._isInheritedCopy}
      <span class="nav-badge inherited">🔗 Inherited</span>
    {:else if element.scope === 'cast'}
      <span class="nav-badge cast">🌐 Cast-wide</span>
    {:else if element.scope === 'group'}
      <span class="nav-badge group">📁 Group-wide</span>
    {:else}
      <span class="nav-badge slide">📄 Slide only</span>
    {/if}
  </div>
  
  <button class="btn btn-primary btn-sm btn-full" on:click={openNavConfig}>
    <i class="fa-solid fa-bars"></i>
    Configure Navigation
  </button>
  
  <div class="nav-summary">
    <span class="item-count">{element.items?.length || 0} items</span>
    <span class="layout-type">{element.style?.layout || 'horizontal'}</span>
  </div>
</div>

<style>
  .nav-info {
    margin-bottom: 12px;
  }
  
  .nav-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
  }
  
  .nav-badge.inherited {
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59, 130, 246);
  }
  
  .nav-badge.cast {
    background: rgba(168, 85, 247, 0.1);
    color: rgb(168, 85, 247);
  }
  
  .nav-badge.group {
    background: rgba(34, 197, 94, 0.1);
    color: rgb(34, 197, 94);
  }
  
  .nav-badge.slide {
    background: rgba(var(--color-text-muted), 0.1);
    color: rgb(var(--color-text-muted));
  }
  
  .btn-full {
    width: 100%;
    margin-bottom: 8px;
  }
  
  .nav-summary {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
    padding: 8px;
    background: rgba(var(--color-surface-alt), 0.5);
    border-radius: 4px;
  }
</style>
{/if}
