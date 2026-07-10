<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: borderEnabled = element?.style?.borderEnabled ?? false;
  $: borderWidth = element?.style?.borderWidth ?? 2;
  $: borderStyle = element?.style?.borderStyle || 'solid';
  $: borderRadius = element?.style?.borderRadius ?? 0;
  $: borderColor = element?.style?.borderColor || '#000000';
  
  function toggleBorder() {
    if (!element) return;
    if (!element.style) element.style = {};
    element.style.borderEnabled = !element.style.borderEnabled;
    dispatch('update');
    dispatch('history', { action: `Toggle border on "${element?.name || element?.type}"` });
  }
</script>

{#if element}
<div class="prop-group collapsible" class:collapsed={!borderEnabled}>
  <h4 class="collapsible-header" on:click={toggleBorder}>
    <span class="collapse-icon">{borderEnabled ? '▼' : '▶'}</span>
    Border
    <label class="toggle-switch small" on:click|stopPropagation>
      <input 
        type="checkbox" 
        checked={borderEnabled}
        on:change={(e) => {
          if (!element.style) element.style = {};
          element.style.borderEnabled = e.target.checked;
          dispatch('update');
        }}
      />
      <span class="toggle-slider"></span>
    </label>
  </h4>
  
  {#if borderEnabled}
    <div class="prop-row">
      <label>Color</label>
      <input 
        type="color" 
        value={borderColor} 
        on:input={(e) => { 
          if (!element.style) element.style = {};
          element.style.borderColor = e.target.value; 
          dispatch('update'); 
        }} 
      />
    </div>
    <div class="prop-row">
      <label>Width</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="1" 
          max="20" 
          step="1"
          value={borderWidth}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.borderWidth = Number(e.target.value) || 2;
            dispatch('update');
          }}
        />
        <span class="slider-value">{borderWidth}px</span>
      </div>
    </div>
    <div class="prop-row">
      <label>Style</label>
      <select 
        value={borderStyle}
        on:change={(e) => {
          if (!element.style) element.style = {};
          element.style.borderStyle = e.target.value;
          dispatch('update');
        }}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
        <option value="double">Double</option>
      </select>
    </div>
    <div class="prop-row">
      <label>Radius</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={borderRadius}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.borderRadius = Number(e.target.value) || 0;
            dispatch('update');
          }}
        />
        <span class="slider-value">{borderRadius}px</span>
      </div>
    </div>
  {/if}
</div>
{/if}
