<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  function onChange(property) {
    dispatch('change', { property });
  }
</script>

{#if element?.type === 'ping'}
<div class="prop-group">
  <h4>Ping Button</h4>
  
  <div class="prop-row">
    <label>Label</label>
    <input 
      type="text" 
      bind:value={element.label} 
      placeholder="Button text"
      on:input={() => onChange('ping label')}
    />
  </div>
  
  <div class="prop-row">
    <label>Message</label>
    <input 
      type="text" 
      bind:value={element.message} 
      placeholder="Notification message"
      on:input={() => onChange('ping message')}
    />
  </div>
  
  <div class="prop-row">
    <label>Background</label>
    <input 
      type="color" 
      value={element.style.backgroundColor || element.style.background || '#ef4444'} 
      on:input={(e) => { element.style.backgroundColor = e.target.value; onChange('ping background'); }} 
    />
  </div>
  
  <div class="prop-row">
    <label>Text Color</label>
    <input 
      type="color" 
      value={element.style.color || '#ffffff'} 
      on:input={(e) => { element.style.color = e.target.value; onChange('ping text color'); }} 
    />
  </div>
  
  <div class="prop-row">
    <label>Border Radius</label>
    <div class="slider-with-value">
      <input 
        type="range" 
        min="0" 
        max="50" 
        step="1"
        value={element?.style?.borderRadius ?? 8}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.borderRadius = Number(e.target.value) || 8;
          onChange('ping border radius');
        }}
      />
      <span class="slider-value">{element?.style?.borderRadius ?? 8}px</span>
    </div>
  </div>
</div>
{/if}
