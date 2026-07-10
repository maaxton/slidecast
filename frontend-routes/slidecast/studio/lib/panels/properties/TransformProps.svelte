<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists immediately
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values to prevent errors during template evaluation
  $: rotation = element?.style?.rotation ?? 0;
  $: scale = element?.style?.scale ?? 1;
  $: opacity = element?.style?.opacity ?? 1;
  $: blur = element?.style?.blur ?? 0;
  $: flipX = element?.style?.flipX ?? false;
  $: flipY = element?.style?.flipY ?? false;
  
  function onChange(property) {
    dispatch('change', { property });
  }
  
  function toggleFlipX() {
    if (!element) return;
    if (!element.style) element.style = {};
    element.style.flipX = !element.style.flipX;
    onChange('flip horizontal');
  }
  
  function toggleFlipY() {
    if (!element) return;
    if (!element.style) element.style = {};
    element.style.flipY = !element.style.flipY;
    onChange('flip vertical');
  }
</script>

{#if element}
<div class="prop-group">
  <h4>Transforms</h4>
  
  <!-- Rotation -->
  <div class="prop-row">
    <label>Rotation</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="-180" 
        max="180" 
        step="1"
        value={rotation}
        on:input={(e) => { 
          if (!element.style) element.style = {};
          element.style.rotation = Number(e.target.value) || 0; 
          onChange('rotation'); 
        }}
      />
      <span class="slider-value">{rotation}°</span>
    </div>
  </div>
  
  <!-- Scale -->
  <div class="prop-row">
    <label>Scale</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="0.1" 
        max="3" 
        step="0.1"
        value={scale}
        on:input={(e) => { 
          if (!element.style) element.style = {};
          element.style.scale = Number(e.target.value) || 1; 
          onChange('scale'); 
        }}
      />
      <span class="slider-value">{scale.toFixed(1)}×</span>
    </div>
  </div>
  
  <!-- Flip -->
  <div class="prop-row">
    <label>Flip</label>
    <div class="btn-group">
      <button 
        class="flip-btn" 
        class:active={flipX}
        on:click={toggleFlipX}
        title="Flip Horizontal"
      >
        <i class="fa-solid fa-left-right"></i>
      </button>
      <button 
        class="flip-btn" 
        class:active={flipY}
        on:click={toggleFlipY}
        title="Flip Vertical"
      >
        <i class="fa-solid fa-up-down"></i>
      </button>
    </div>
  </div>
  
  <!-- Opacity -->
  <div class="prop-row">
    <label>Opacity</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="0" 
        max="1" 
        step="0.05"
        value={opacity}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.opacity = Number(e.target.value) || 1;
          onChange('opacity');
        }}
      />
      <span class="slider-value">{Math.round(opacity * 100)}%</span>
    </div>
  </div>
  
  <!-- Blur -->
  <div class="prop-row">
    <label>Blur</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="0" 
        max="50" 
        step="1"
        value={blur}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.blur = Number(e.target.value) || 0;
          onChange('blur');
        }}
      />
      <span class="slider-value">{blur}px</span>
    </div>
  </div>
</div>
{/if}
