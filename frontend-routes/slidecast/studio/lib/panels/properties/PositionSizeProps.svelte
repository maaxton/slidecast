<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  export let hideSize = false; // For widgets where size is controlled elsewhere
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.position and element.size exist
  $: if (element) {
    if (!element.position) element.position = { x: 0, y: 0 };
    if (!element.size) element.size = { width: 100, height: 100 };
  }
  
  function onChange(property) {
    dispatch('change', { property });
  }
</script>

{#if element}
  <!-- Position -->
  <div class="prop-group">
    <h4>Position</h4>
    <div class="prop-row">
      <label>X</label>
      <input 
        type="number" 
        bind:value={element.position.x} 
        on:input={() => onChange('position')}
      />
    </div>
    <div class="prop-row">
      <label>Y</label>
      <input 
        type="number" 
        bind:value={element.position.y} 
        on:input={() => onChange('position')}
      />
    </div>
  </div>
  
  <!-- Size (optional) -->
  {#if !hideSize}
  <div class="prop-group">
    <h4>Size</h4>
    <div class="prop-row">
      <label>W</label>
      <input 
        type="number" 
        bind:value={element.size.width} 
        on:input={() => onChange('size')}
      />
    </div>
    <div class="prop-row">
      <label>H</label>
      <input 
        type="number" 
        bind:value={element.size.height} 
        on:input={() => onChange('size')}
      />
    </div>
  </div>
  {/if}
{/if}
