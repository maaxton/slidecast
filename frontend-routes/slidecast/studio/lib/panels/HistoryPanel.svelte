<script>
  import { createEventDispatcher } from 'svelte';
  
  export let historyStack = [];
  export let historyIndex = -1;
  export let collapsed = false;
  export let show = false;
  
  const dispatch = createEventDispatcher();
  
  function jumpToHistory(index) {
    dispatch('jumpToHistory', index);
  }
  
  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('toggleCollapse', collapsed);
  }
  
  function formatHistoryTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
</script>

{#if show}
  <div class="right-panel history-panel" class:collapsed>
    <div class="panel-header" on:click={toggleCollapse}>
      <h3>History</h3>
      <span class="history-count">{historyStack.length} actions</span>
      <button class="icon-btn">{collapsed ? '‹' : '›'}</button>
    </div>
    {#if !collapsed}
      <div class="panel-content history-content">
        <div class="history-list">
          {#each historyStack as item, i}
            <div 
              class="history-item" 
              class:current={i === historyIndex}
              class:future={i > historyIndex}
              on:click={() => jumpToHistory(i)}
              title={`${item.action} at ${formatHistoryTime(item.timestamp)}`}
            >
              <span class="history-dot" class:current={i === historyIndex}></span>
              <span class="history-action">{item.action}</span>
              <span class="history-time">{formatHistoryTime(item.timestamp)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Styles are inherited from the main page CSS */
</style>
