<script>
  import { createEventDispatcher } from 'svelte';

  export let element = null;
  export let position = { x: 200, y: 150 };

  const dispatch = createEventDispatcher();

  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let localPosition = { ...position };
  let hasUserMoved = false; // Track if user has manually moved the window
  let activeTab = 'default';

  // Ensure element.size exists
  $: if (element && !element.size) {
    element.size = { width: 150, height: 150 };
  }

  function startDrag(e) {
    if (e.target.closest('input, select, button, textarea')) return;
    isDragging = true;
    dragOffset = {
      x: e.clientX - localPosition.x,
      y: e.clientY - localPosition.y
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e) {
    if (!isDragging) return;
    hasUserMoved = true; // Mark that user has moved the window
    localPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
  }

  function stopDrag() {
    isDragging = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  function close() {
    dispatch('close');
  }

  function setQRType(type) {
    element.qrType = type;
    updateQRData();
  }

  function updateQRData() {
    // Build the QR data based on type
    if (element.qrType === 'url' || !element.qrType) {
      element.data = element.qrUrl || '';
    } else if (element.qrType === 'wifi') {
      const ssid = element.qrWifiSsid || '';
      const password = element.qrWifiPassword || '';
      const security = element.qrWifiSecurity || 'WPA';
      element.data = `WIFI:T:${security};S:${ssid};P:${password};;`;
    }
    // For 'text' type, element.data is already the content
    
    dispatch('update');
  }
  
  function onSizeChange() {
    dispatch('sizeChange', { element });
    updateQRData();
  }
  
  function onRefresh() {
    updateQRData();
  }
</script>

{#if element}
<div 
  class="qr-config-window"
  class:dragging={isDragging}
  style="left: {localPosition.x}px; top: {localPosition.y}px;"
>
  <div class="qr-window-header" on:mousedown={startDrag}>
    <div class="qr-window-title">
      <span class="qr-icon">📱</span>
      <span class="qr-name">QR Code</span>
      <span class="qr-category-badge">SCAN</span>
    </div>
    <button class="qr-window-close" on:click={close}>×</button>
  </div>
  
  <!-- Tabs -->
  <div class="qr-config-tabs">
    <button class="qr-tab" class:active={activeTab === 'default'} on:click={() => activeTab = 'default'}>
      <span class="tab-icon">⚙️</span>
      Default
    </button>
    <button class="qr-tab" class:active={activeTab === 'content'} on:click={() => activeTab = 'content'}>
      <span class="tab-icon">📝</span>
      Content
    </button>
    <button class="qr-tab" class:active={activeTab === 'style'} on:click={() => activeTab = 'style'}>
      <span class="tab-icon">🎨</span>
      Style
    </button>
  </div>

  <div class="qr-window-body">
    <!-- DEFAULT TAB -->
    {#if activeTab === 'default'}
      <!-- Size controls -->
      <div class="qr-config-section qr-size-section">
        <h3>Size</h3>
        <div class="qr-size-row">
          <div class="qr-size-input">
            <label>W</label>
            <input 
              type="number" 
              min="50"
              max="500"
              bind:value={element.size.width} 
              on:input={onSizeChange}
            />
          </div>
          <span class="size-separator">×</span>
          <div class="qr-size-input">
            <label>H</label>
            <input 
              type="number" 
              min="50"
              max="500"
              bind:value={element.size.height} 
              on:input={onSizeChange}
            />
          </div>
        </div>
      </div>
      
      <div class="qr-config-section">
        <h3>QR Type</h3>
        <div class="qr-type-buttons">
          <button 
            class="qr-type-btn" 
            class:active={!element.qrType || element.qrType === 'url'} 
            on:click={() => setQRType('url')}
          >
            <span class="qr-type-icon">🔗</span>
            <span>URL</span>
          </button>
          <button 
            class="qr-type-btn" 
            class:active={element.qrType === 'text'} 
            on:click={() => setQRType('text')}
          >
            <span class="qr-type-icon">📝</span>
            <span>Text</span>
          </button>
          <button 
            class="qr-type-btn" 
            class:active={element.qrType === 'wifi'} 
            on:click={() => setQRType('wifi')}
          >
            <span class="qr-type-icon">📶</span>
            <span>WiFi</span>
          </button>
        </div>
      </div>
    {/if}
    
    <!-- CONTENT TAB -->
    {#if activeTab === 'content'}
      <div class="qr-config-section">
        <h3>Content</h3>
        {#if element.qrType === 'url' || !element.qrType}
          <div class="qr-config-row">
            <label>URL</label>
            <input 
              type="url" 
              bind:value={element.qrUrl} 
              placeholder="https://example.com" 
              on:input={updateQRData} 
            />
          </div>
        {:else if element.qrType === 'text'}
          <div class="qr-config-row">
            <label>Text</label>
            <textarea 
              bind:value={element.data} 
              placeholder="Enter text..." 
              rows="3" 
              on:input={updateQRData}
            ></textarea>
          </div>
        {:else if element.qrType === 'wifi'}
          <div class="qr-config-row">
            <label>Network Name (SSID)</label>
            <input 
              type="text" 
              bind:value={element.qrWifiSsid} 
              placeholder="WiFi Network" 
              on:input={updateQRData} 
            />
          </div>
          <div class="qr-config-row">
            <label>Password</label>
            <input 
              type="text" 
              bind:value={element.qrWifiPassword} 
              placeholder="Password" 
              on:input={updateQRData} 
            />
          </div>
          <div class="qr-config-row">
            <label>Security</label>
            <select bind:value={element.qrWifiSecurity} on:change={updateQRData}>
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">Open (No Password)</option>
            </select>
          </div>
        {/if}
      </div>
    {/if}
    
    <!-- STYLE TAB -->
    {#if activeTab === 'style'}
      <div class="qr-config-section">
        <h3>Colors</h3>
        <div class="qr-config-row color-row">
          <label>Foreground</label>
          <input 
            type="color" 
            value={element.foreground || '#000000'} 
            on:input={(e) => { element.foreground = e.target.value; updateQRData(); }} 
          />
        </div>
        <div class="qr-config-row color-row">
          <label>Background</label>
          <input 
            type="color" 
            value={element.background || '#ffffff'} 
            on:input={(e) => { element.background = e.target.value; updateQRData(); }} 
          />
        </div>
      </div>
    {/if}
  </div>

  <div class="qr-window-footer">
    <button class="btn btn-sm btn-ghost" on:click={onRefresh}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      Refresh Now
    </button>
    <button class="btn btn-sm btn-primary" on:click={close}>Done</button>
  </div>
</div>
{/if}

<style>
  .qr-config-window {
    position: fixed;
    width: 420px;
    height: 550px;
    max-height: 80vh;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    z-index: 10001;
    display: flex;
    flex-direction: column;
  }

  .qr-config-window.dragging {
    user-select: none;
  }

  .qr-window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    cursor: move;
  }

  .qr-window-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .qr-icon {
    font-size: 16px;
  }

  .qr-category-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.2);
    color: rgb(129, 140, 248);
  }

  .qr-window-close {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    color: rgb(var(--color-text-muted));
  }

  .qr-window-close:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .qr-config-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    flex-shrink: 0;
  }

  .qr-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .qr-tab:hover {
    background: rgba(var(--color-text), 0.05);
    color: rgb(var(--color-text));
  }

  .qr-tab.active {
    background: rgb(var(--color-primary));
    color: white;
  }
  
  .tab-icon {
    font-size: 14px;
  }

  .qr-window-body {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  .qr-config-section {
    margin-bottom: 20px;
  }

  .qr-config-section h3 {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--color-text-muted));
  }

  .qr-type-buttons {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .qr-type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .qr-type-btn:hover {
    background: rgb(var(--color-surface));
    border-color: rgb(var(--color-primary) / 0.3);
    color: rgb(var(--color-text));
  }

  .qr-type-btn.active {
    background: rgb(var(--color-primary) / 0.1);
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-primary));
  }

  .qr-type-icon {
    font-size: 20px;
  }

  .qr-config-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .qr-config-row label {
    font-size: 12px;
    color: rgb(var(--color-text-muted));
  }

  .qr-config-row input,
  .qr-config-row select,
  .qr-config-row textarea {
    padding: 8px 12px;
    font-size: 13px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    color: rgb(var(--color-text));
  }

  .qr-config-row textarea {
    resize: vertical;
    min-height: 60px;
  }

  .qr-config-row.color-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .qr-config-row input[type="color"] {
    width: 40px;
    height: 32px;
    padding: 2px;
    border-radius: 6px;
    cursor: pointer;
  }

  .qr-window-footer {
    display: flex;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgb(var(--color-surface-alt));
    border-top: 1px solid rgb(var(--color-border));
  }

  .btn {
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-primary {
    background: rgb(var(--color-primary));
    color: white;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-sm {
    padding: 6px 12px;
    font-size: 12px;
  }
  
  .btn-ghost {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: rgb(var(--color-text-muted));
    border: 1px solid rgb(var(--color-border));
  }
  
  .btn-ghost:hover {
    background: rgba(var(--color-text), 0.05);
    color: rgb(var(--color-text));
  }
  
  /* Size section */
  .qr-size-section {
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 16px;
    margin-bottom: 16px;
  }
  
  .qr-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .qr-size-input {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  
  .qr-size-input label {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    width: 20px;
    flex-shrink: 0;
  }
  
  .qr-size-input input {
    flex: 1;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    padding: 8px 12px;
    color: white;
    font-size: 14px;
  }
  
  .qr-size-input input:focus {
    outline: none;
    border-color: rgba(99, 102, 241, 0.5);
  }
  
  .size-separator {
    color: rgba(255,255,255,0.4);
    font-size: 14px;
  }
</style>
