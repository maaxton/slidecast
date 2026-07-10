<script>
  import { createEventDispatcher } from 'svelte';

  export let element = null;
  export let position = { x: 150, y: 120 };

  const dispatch = createEventDispatcher();

  // Ensure element.style exists
  $: if (element && !element.style) {
    element.style = {};
  }

  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let localPosition = { ...position };
  
  // Sync with external position changes
  $: if (position && !isDragging) {
    localPosition = { ...position };
  }

  function startDrag(e) {
    if (e.target.closest('input, select, button, textarea, .toggle-switch')) return;
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
    localPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
    dispatch('positionChange', localPosition);
  }

  function stopDrag() {
    isDragging = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  function close() {
    dispatch('close');
  }

  function onChange(property) {
    // Trigger cast update to refresh canvas display
    dispatch('update');
    // Track in history (debounced)
    dispatch('change', { property });
  }

  function toggleBold() {
    element.style.fontWeight = element.style.fontWeight === 'bold' ? 'normal' : 'bold';
    dispatch('update');
    dispatch('history', { action: 'Toggle bold' });
  }

  function toggleItalic() {
    element.style.fontStyle = element.style.fontStyle === 'italic' ? 'normal' : 'italic';
    dispatch('update');
    dispatch('history', { action: 'Toggle italic' });
  }

  function toggleUnderline() {
    element.style.textDecoration = element.style.textDecoration === 'underline' ? 'none' : 'underline';
    dispatch('update');
    dispatch('history', { action: 'Toggle underline' });
  }

  function setAlign(align) {
    element.style.textAlign = align;
    dispatch('update');
    dispatch('history', { action: `Set align ${align}` });
  }
</script>

{#if element}
<div 
  class="text-config-window"
  class:dragging={isDragging}
  style="left: {localPosition.x}px; top: {localPosition.y}px;"
>
  <div class="text-window-header" on:mousedown={startDrag}>
    <div class="text-window-title">
      <span class="text-icon">📝</span>
      <span class="text-name">Edit Text</span>
    </div>
    <button class="text-window-close" on:click={close}>×</button>
  </div>

  <div class="text-window-body">
    <!-- Text Content -->
    <div class="text-config-section">
      <h3>Content</h3>
      <textarea 
        bind:value={element.content} 
        on:input={() => onChange('text content')}
        placeholder="Enter your text..."
        rows="4"
        class="text-content-textarea"
      ></textarea>
    </div>
    
    <div class="text-config-layout">
      <!-- Left: Typography -->
      <div class="text-config-section">
        <h3>Typography</h3>
        <div class="text-config-grid">
          <div class="text-config-row">
            <label>Font</label>
            <select 
              value={element.style?.fontFamily || 'Inter'}
              on:change={(e) => {
                element.style.fontFamily = e.target.value;
                onChange('font family');
              }}
            >
              <optgroup label="Sans Serif">
                <option value="Inter">Inter</option>
                <option value="Roboto">Roboto</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Lato">Lato</option>
              </optgroup>
              <optgroup label="Serif">
                <option value="Roboto Slab">Roboto Slab</option>
                <option value="Merriweather">Merriweather</option>
              </optgroup>
              <optgroup label="Display">
                <option value="Bebas Neue">Bebas Neue</option>
                <option value="Oswald">Oswald</option>
              </optgroup>
              <optgroup label="Monospace">
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Roboto Mono">Roboto Mono</option>
              </optgroup>
            </select>
          </div>
          
          <div class="text-config-row">
            <label>Size</label>
            <div class="text-number-input">
              <input 
                type="number" 
                value={element.style?.fontSize || 16}
                on:input={(e) => {
                  element.style.fontSize = Number(e.target.value) || 16;
                  onChange('font size');
                }}
                min="8" 
                max="500"
              />
              <span class="unit">px</span>
            </div>
          </div>
          
          <div class="text-config-row">
            <label>Color</label>
            <input 
              type="color" 
              value={element.style.color || '#ffffff'} 
              on:input={(e) => { element.style.color = e.target.value; onChange('text color'); }} 
            />
          </div>
          
          <div class="text-config-row">
            <label>Style</label>
            <div class="text-style-buttons">
              <button 
                class="style-btn" 
                class:active={element.style.fontWeight === 'bold'} 
                on:click={toggleBold}
                title="Bold"
              ><strong>B</strong></button>
              <button 
                class="style-btn" 
                class:active={element.style.fontStyle === 'italic'} 
                on:click={toggleItalic}
                title="Italic"
              ><em>I</em></button>
              <button 
                class="style-btn" 
                class:active={element.style.textDecoration === 'underline'} 
                on:click={toggleUnderline}
                title="Underline"
              ><u>U</u></button>
            </div>
          </div>
          
          <div class="text-config-row">
            <label>Align</label>
            <div class="text-style-buttons">
              <button 
                class="style-btn" 
                class:active={element.style.textAlign === 'left'} 
                on:click={() => setAlign('left')}
                title="Align Left"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 4h18v2H3V4zm0 4h12v2H3V8zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z"/></svg>
              </button>
              <button 
                class="style-btn" 
                class:active={element.style.textAlign === 'center'} 
                on:click={() => setAlign('center')}
                title="Align Center"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 4h18v2H3V4zm3 4h12v2H6V8zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z"/></svg>
              </button>
              <button 
                class="style-btn" 
                class:active={element.style.textAlign === 'right'} 
                on:click={() => setAlign('right')}
                title="Align Right"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 4h18v2H3V4zm6 4h12v2H9V8zm-6 4h18v2H3v-2zm6 4h12v2H9v-2zm-6 4h18v2H3v-2z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Advanced -->
      <div class="text-config-section">
        <h3>Advanced</h3>
        <div class="text-config-grid">
          <div class="text-config-row">
            <label>Line Height</label>
            <div class="text-number-input">
              <input 
                type="number" 
                min="0.5" 
                max="3" 
                step="0.1" 
                value={element.style?.lineHeight || 1.5}
                on:input={(e) => {
                  element.style.lineHeight = Number(e.target.value) || 1.5;
                  onChange('line height');
                }}
              />
            </div>
          </div>
          <div class="text-config-row">
            <label>Letter Spacing</label>
            <div class="text-number-input">
              <input 
                type="number" 
                min="-5" 
                max="20" 
                step="0.5" 
                value={element.style?.letterSpacing || 0}
                on:input={(e) => {
                  element.style.letterSpacing = Number(e.target.value) || 0;
                  onChange('letter spacing');
                }}
              />
              <span class="unit">px</span>
            </div>
          </div>
          <div class="text-config-row">
            <label>Outline Color</label>
            <input 
              type="color" 
              value={element.style.strokeColor || '#000000'} 
              on:input={(e) => { element.style.strokeColor = e.target.value; onChange('outline color'); }}
            />
          </div>
          <div class="text-config-row">
            <label>Outline Width</label>
            <div class="text-number-input">
              <input 
                type="number" 
                min="0" 
                max="20" 
                step="1"
                value={element.style?.strokeWidth || 0}
                on:input={(e) => {
                  element.style.strokeWidth = Number(e.target.value) || 0;
                  onChange('outline width');
                }}
              />
              <span class="unit">px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <div class="text-window-footer">
    <button class="btn btn-sm btn-primary" on:click={close}>Done</button>
  </div>
</div>
{/if}

<style>
  .text-config-window {
    position: fixed;
    width: 520px;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    z-index: 10001;
    overflow: hidden;
  }

  .text-config-window.dragging {
    user-select: none;
  }

  .text-window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    cursor: move;
  }

  .text-window-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .text-icon {
    font-size: 16px;
  }

  .text-window-close {
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

  .text-window-close:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .text-window-body {
    padding: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .text-config-section {
    margin-bottom: 16px;
  }

  .text-config-section h3 {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--color-text-muted));
  }

  .text-content-textarea {
    width: 100%;
    padding: 12px;
    font-size: 14px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    color: rgb(var(--color-text));
    resize: vertical;
    min-height: 80px;
  }

  .text-config-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .text-config-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .text-config-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .text-config-row label {
    flex: 0 0 80px;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
  }

  .text-config-row select,
  .text-config-row input[type="number"] {
    flex: 1;
    padding: 6px 8px;
    font-size: 12px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    color: rgb(var(--color-text));
  }

  .text-config-row input[type="color"] {
    width: 32px;
    height: 28px;
    padding: 2px;
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
  }

  .text-number-input {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .text-number-input input {
    flex: 1;
  }

  .unit {
    font-size: 11px;
    color: rgb(var(--color-text-muted));
  }

  .text-style-buttons {
    display: flex;
    gap: 4px;
  }

  .style-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }

  .style-btn:hover {
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
  }

  .style-btn.active {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
    color: white;
  }

  .text-window-footer {
    display: flex;
    justify-content: flex-end;
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
</style>
