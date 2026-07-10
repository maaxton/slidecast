<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  
  const dispatch = createEventDispatcher();
  
  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }
  
  // Computed safe values
  $: foregroundColor = element?.style?.foregroundColor || '#000000';
  $: backgroundColor = element?.style?.backgroundColor || '#ffffff';
  
  function onChange(property) {
    dispatch('change', { property });
  }
  
  function openQRConfig() {
    dispatch('openConfig', { type: element.type, element });
  }
</script>

{#if element?.type === 'qr' || element?.type === 'qrcode'}
<div class="prop-group">
  <h4>QR Code</h4>
  
  <button class="btn btn-primary btn-sm btn-full" on:click={openQRConfig}>
    <i class="fa-solid fa-qrcode"></i>
    Configure QR Code
  </button>
  
  <div class="prop-row">
    <label>Content</label>
    <input 
      type="text" 
      value={element.content || ''}
      placeholder="URL or text"
      on:input={(e) => {
        element.content = e.target.value;
        onChange('QR content');
      }}
    />
  </div>
  
  <div class="prop-row">
    <label>Foreground</label>
    <input 
      type="color" 
      value={foregroundColor}
      on:input={(e) => {
        if (!element.style) element.style = {};
        element.style.foregroundColor = e.target.value;
        onChange('QR foreground');
      }} 
    />
  </div>
  
  <div class="prop-row">
    <label>Background</label>
    <input 
      type="color" 
      value={backgroundColor}
      on:input={(e) => {
        if (!element.style) element.style = {};
        element.style.backgroundColor = e.target.value;
        onChange('QR background');
      }} 
    />
  </div>
  
  <div class="prop-row">
    <label>Error Correction</label>
    <select 
      value={element.errorCorrection || 'M'}
      on:change={(e) => {
        element.errorCorrection = e.target.value;
        onChange('error correction');
      }}
    >
      <option value="L">Low (7%)</option>
      <option value="M">Medium (15%)</option>
      <option value="Q">Quartile (25%)</option>
      <option value="H">High (30%)</option>
    </select>
  </div>
</div>

<style>
  .btn-full {
    width: 100%;
    margin-bottom: 12px;
  }
</style>
{/if}
