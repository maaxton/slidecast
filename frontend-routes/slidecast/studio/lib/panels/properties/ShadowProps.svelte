<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: shadowEnabled = element?.style?.shadowEnabled ?? false;
  $: shadowOffsetX = element?.style?.shadowOffsetX ?? 0;
  $: shadowOffsetY = element?.style?.shadowOffsetY ?? 4;
  $: shadowBlur = element?.style?.shadowBlur ?? 10;
  $: shadowSpread = element?.style?.shadowSpread ?? 0;
  $: shadowColor = element?.style?.shadowColor || '#000000';
  
  function toggleShadow() {
    if (!element) return;
    if (!element.style) element.style = {};
    element.style.shadowEnabled = !element.style.shadowEnabled;
    dispatch('update');
    dispatch('history', { action: `Toggle shadow on "${element?.name || element?.type}"` });
  }
</script>

{#if element}
<div class="prop-group collapsible" class:collapsed={!shadowEnabled}>
  <h4 class="collapsible-header" on:click={toggleShadow}>
    <span class="collapse-icon">{shadowEnabled ? '▼' : '▶'}</span>
    Shadow
    <label class="toggle-switch small" on:click|stopPropagation>
      <input 
        type="checkbox" 
        checked={shadowEnabled}
        on:change={(e) => {
          if (!element.style) element.style = {};
          element.style.shadowEnabled = e.target.checked;
          dispatch('update');
        }}
      />
      <span class="toggle-slider"></span>
    </label>
  </h4>
  
  {#if shadowEnabled}
    <div class="prop-row">
      <label>Color</label>
      <input 
        type="color" 
        value={shadowColor} 
        on:input={(e) => { 
          if (!element.style) element.style = {};
          element.style.shadowColor = e.target.value; 
          dispatch('update'); 
        }} 
      />
    </div>
    <div class="prop-row">
      <label>Offset X</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="-50" 
          max="50" 
          step="1"
          value={shadowOffsetX}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.shadowOffsetX = Number(e.target.value) || 0;
            dispatch('update');
          }}
        />
        <span class="slider-value">{shadowOffsetX}px</span>
      </div>
    </div>
    <div class="prop-row">
      <label>Offset Y</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="-50" 
          max="50" 
          step="1"
          value={shadowOffsetY}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.shadowOffsetY = Number(e.target.value) || 4;
            dispatch('update');
          }}
        />
        <span class="slider-value">{shadowOffsetY}px</span>
      </div>
    </div>
    <div class="prop-row">
      <label>Blur</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={shadowBlur}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.shadowBlur = Number(e.target.value) || 10;
            dispatch('update');
          }}
        />
        <span class="slider-value">{shadowBlur}px</span>
      </div>
    </div>
    <div class="prop-row">
      <label>Spread</label>
      <div class="slider-with-value">
        <input 
          type="range" 
          min="-20" 
          max="50" 
          step="1"
          value={shadowSpread}
          on:input={(e) => {
            if (!element.style) element.style = {};
            element.style.shadowSpread = Number(e.target.value) || 0;
            dispatch('update');
          }}
        />
        <span class="slider-value">{shadowSpread}px</span>
      </div>
    </div>
  {/if}
</div>
{/if}
