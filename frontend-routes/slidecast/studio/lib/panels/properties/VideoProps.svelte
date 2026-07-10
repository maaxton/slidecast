<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style and element.playback exist
  $: if (element) {
    if (!element.style) element.style = {};
    if (!element.playback) element.playback = {};
  }
  
  // Computed safe values
  $: objectFit = element?.style?.objectFit || 'cover';
  $: loop = element?.playback?.loop ?? true;
  $: muted = element?.playback?.muted ?? true;
  $: autoplay = element?.playback?.autoplay ?? true;
  
  function openMediaPicker() {
    dispatch('openMedia');
  }
</script>

{#if element?.type === 'video'}
<div class="prop-group">
  <h4>Video</h4>
  
  <button class="btn btn-secondary btn-sm" on:click={openMediaPicker}>Change Video</button>
  
  <div class="prop-row">
    <label>Loop</label>
    <label class="toggle-switch">
      <input 
        type="checkbox" 
        checked={loop}
        on:change={(e) => {
          if (!element.playback) element.playback = {};
          element.playback.loop = e.target.checked;
          dispatch('update');
        }} 
      />
      <span class="toggle-slider"></span>
    </label>
  </div>
  
  <div class="prop-row">
    <label>Muted</label>
    <label class="toggle-switch">
      <input 
        type="checkbox" 
        checked={muted}
        on:change={(e) => {
          if (!element.playback) element.playback = {};
          element.playback.muted = e.target.checked;
          dispatch('update');
        }} 
      />
      <span class="toggle-slider"></span>
    </label>
  </div>
  
  <div class="prop-row">
    <label>Autoplay</label>
    <label class="toggle-switch">
      <input 
        type="checkbox" 
        checked={autoplay}
        on:change={(e) => {
          if (!element.playback) element.playback = {};
          element.playback.autoplay = e.target.checked;
          dispatch('update');
        }} 
      />
      <span class="toggle-slider"></span>
    </label>
  </div>
  
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
    </select>
  </div>
</div>
{/if}
