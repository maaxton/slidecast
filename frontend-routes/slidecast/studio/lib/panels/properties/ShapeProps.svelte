<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: fillOpacity = element?.style?.fillOpacity ?? 1;
  $: borderRadius = element?.style?.borderRadius ?? 0;
  $: strokeWidth = element?.style?.strokeWidth ?? 2;
  $: fillColor = element?.style?.backgroundColor || element?.style?.fill || '#3b82f6';
  
  function onChange(property) {
    dispatch('change', { property });
  }
</script>

{#if element?.type === 'shape'}
<div class="prop-group">
  <h4>Shape</h4>
  
  <div class="prop-row">
    <label>Type</label>
    <select 
      value={element.shape || 'rectangle'}
      on:change={(e) => {
        element.shape = e.target.value;
        onChange('shape type');
      }}
    >
      <option value="rectangle">Rectangle</option>
      <option value="circle">Circle</option>
      <option value="triangle">Triangle</option>
      <option value="line">Line</option>
    </select>
  </div>
  
  <div class="prop-row">
    <label>Fill</label>
    <input 
      type="color" 
      value={fillColor} 
      on:input={(e) => {
        if (!element.style) element.style = {};
        element.style.backgroundColor = e.target.value;
        onChange('fill color');
      }} 
    />
  </div>
  
  <div class="prop-row">
    <label>Fill Opacity</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="0" 
        max="1" 
        step="0.05"
        value={fillOpacity}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.fillOpacity = Number(e.target.value) || 1;
          onChange('fill opacity');
        }}
      />
      <span class="slider-value">{Math.round(fillOpacity * 100)}%</span>
    </div>
  </div>
  
  {#if element.shape === 'rectangle'}
  <div class="prop-row">
    <label>Corner Radius</label>
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
          onChange('corner radius');
        }}
      />
      <span class="slider-value">{borderRadius}px</span>
    </div>
  </div>
  {/if}
  
  {#if element.shape === 'line'}
  <div class="prop-row">
    <label>Stroke Width</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="1" 
        max="20" 
        step="1"
        value={strokeWidth}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.strokeWidth = Number(e.target.value) || 2;
          onChange('stroke width');
        }}
      />
      <span class="slider-value">{strokeWidth}px</span>
    </div>
  </div>
  {/if}
</div>
{/if}
