<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  function onChange(property) {
    dispatch('change', { property });
  }
  
  function openTextConfig() {
    dispatch('openConfig', { type: 'text', element });
  }
</script>

{#if element?.type === 'text'}
<div class="prop-group">
  <h4>Text</h4>
  <button class="btn btn-secondary btn-sm btn-full" on:click={openTextConfig}>
    <i class="fa-solid fa-font"></i>
    Edit Text & Formatting
  </button>
  
  <!-- Quick preview of current text -->
  <div class="text-preview" title={element.content}>
    {element.content?.substring(0, 50) || 'Empty text'}{element.content?.length > 50 ? '...' : ''}
  </div>
  
  <!-- Quick access controls -->
  <div class="prop-row">
    <label>Font Size</label>
    <div class="number-input-with-unit">
      <input 
        type="number" 
        min="8" 
        max="500"
        value={element?.style?.fontSize || 16}
        on:input={(e) => {
          if (!element.style) element.style = {};
          element.style.fontSize = Number(e.target.value) || 16;
          onChange('font size');
        }}
      />
      <span class="unit">px</span>
    </div>
  </div>
  
  <div class="prop-row">
    <label>Color</label>
    <input 
      type="color" 
      value={element?.style?.color || '#ffffff'} 
      on:input={(e) => {
        if (!element.style) element.style = {};
        element.style.color = e.target.value;
        onChange('text color');
      }} 
    />
  </div>
</div>

<style>
  .text-preview {
    padding: 8px;
    background: rgba(var(--color-surface-alt), 0.5);
    border-radius: 4px;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
    margin-bottom: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .btn-full {
    width: 100%;
    margin-bottom: 8px;
  }
  
  .number-input-with-unit {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .number-input-with-unit input {
    flex: 1;
  }
  
  .unit {
    font-size: 11px;
    color: rgb(var(--color-text-muted));
  }
</style>
{/if}
