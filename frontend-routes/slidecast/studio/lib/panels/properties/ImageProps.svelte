<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: objectFit = element?.style?.objectFit || 'cover';
  $: objectPosition = element?.style?.objectPosition || 'center';
  
  function openMediaPicker() {
    dispatch('openMedia');
  }
</script>

{#if element?.type === 'image'}
<div class="prop-group">
  <h4>Image</h4>
  <button class="btn btn-secondary btn-sm" on:click={openMediaPicker}>Change Image</button>
  
  <div class="prop-row">
    <label>Fit</label>
    <select 
      value={objectFit}
      on:change={(e) => {
        if (!element.style) element.style = {};
        element.style.objectFit = e.target.value;
        dispatch('update');
      }}
    >
      <option value="cover">Cover</option>
      <option value="contain">Contain</option>
      <option value="fill">Fill</option>
      <option value="none">None</option>
    </select>
  </div>
  
  <div class="prop-row">
    <label>Position</label>
    <select 
      value={objectPosition}
      on:change={(e) => {
        if (!element.style) element.style = {};
        element.style.objectPosition = e.target.value;
        dispatch('update');
      }}
    >
      <option value="center">Center</option>
      <option value="top">Top</option>
      <option value="bottom">Bottom</option>
      <option value="left">Left</option>
      <option value="right">Right</option>
      <option value="top left">Top Left</option>
      <option value="top right">Top Right</option>
      <option value="bottom left">Bottom Left</option>
      <option value="bottom right">Bottom Right</option>
    </select>
  </div>
</div>
{/if}
