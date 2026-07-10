<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: gradientMaskEnabled = element?.style?.gradientMaskEnabled ?? false;
  $: gradientDirection = element?.style?.gradientDirection || 'to-right';
  $: gradientStart = element?.style?.gradientStart ?? 0;
  $: gradientEnd = element?.style?.gradientEnd ?? 100;
  
  function onChange(property) {
    dispatch('change', { property });
  }
  
  function toggleGradientMask() {
    if (!element) return;
    if (!element.style) element.style = {};
    element.style.gradientMaskEnabled = !element.style.gradientMaskEnabled;
    dispatch('update'); // Trigger full cast update
    dispatch('history', { action: `Toggle opacity gradient on "${element?.name || element?.type}"` });
  }
</script>

{#if element}
<div class="prop-group collapsible" class:collapsed={!gradientMaskEnabled}>
  <h4 class="collapsible-header" on:click={toggleGradientMask}>
    <span class="collapse-icon">{gradientMaskEnabled ? '▼' : '▶'}</span>
    Opacity Gradient
    <label class="toggle-switch small" on:click|stopPropagation>
      <input 
        type="checkbox" 
        checked={gradientMaskEnabled}
        on:change={(e) => {
          if (!element.style) element.style = {};
          element.style.gradientMaskEnabled = e.target.checked;
          dispatch('update');
        }}
      />
      <span class="toggle-slider"></span>
    </label>
  </h4>
  
  {#if gradientMaskEnabled}
    <div class="prop-row">
      <label>Direction</label>
      <select 
        value={gradientDirection}
        on:change={(e) => {
          if (!element.style) element.style = {};
          element.style.gradientDirection = e.target.value;
          dispatch('update');
        }}
      >
        <option value="to-right">Left → Right</option>
        <option value="to-left">Right → Left</option>
        <option value="to-bottom">Top → Bottom</option>
        <option value="to-top">Bottom → Top</option>
        <option value="to-bottom-right">Top-Left → Bottom-Right</option>
        <option value="to-bottom-left">Top-Right → Bottom-Left</option>
        <option value="radial-out">Center → Edges</option>
        <option value="radial-in">Edges → Center</option>
      </select>
    </div>
    <div class="prop-row">
      <label>Start</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={gradientStart}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.gradientStart = Number(e.target.value) || 0;
            dispatch('update');
          }}
        />
        <span class="slider-value">{gradientStart}%</span>
      </div>
    </div>
    <div class="prop-row">
      <label>End</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={gradientEnd}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.gradientEnd = Number(e.target.value) || 100;
            dispatch('update');
          }}
        />
        <span class="slider-value">{gradientEnd}%</span>
      </div>
    </div>
  {/if}
</div>
{/if}
