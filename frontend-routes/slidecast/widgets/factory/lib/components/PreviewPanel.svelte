<script>
  import { createEventDispatcher } from 'svelte';
  import DOMPurify from 'dompurify';
  import { renderPrimitivesToHtml } from '../../../lib/widget-primitives.js';

  export let previewSize = { width: 300, height: 150 };
  export let previewLoading = false;
  export let previewError = null;
  export let previewResult = null;
  export let autoRefresh = false;
  export let previewMode = 'native'; // 'native' or 'image'

  const dispatch = createEventDispatcher();

  function toggleAutoRefresh() {
    dispatch('toggleAutoRefresh');
  }

  function updateSize(size) {
    dispatch('sizeChange', size);
  }

  function togglePreviewMode() {
    previewMode = previewMode === 'native' ? 'image' : 'native';
    dispatch('previewModeChange', previewMode);
  }

</script>

<div class="preview-panel">
  <div class="preview-toolbar">
    <div class="size-controls">
      <input 
        type="number" 
        bind:value={previewSize.width}
        on:input={() => updateSize(previewSize)}
        min="50"
        max="1920"
      /> × 
      <input 
        type="number" 
        bind:value={previewSize.height}
        on:input={() => updateSize(previewSize)}
        min="50"
        max="1080"
      />
    </div>
    <div class="preset-sizes">
      <button on:click={() => updateSize({ width: 200, height: 100 })}>Small</button>
      <button on:click={() => updateSize({ width: 300, height: 150 })}>Medium</button>
      <button on:click={() => updateSize({ width: 400, height: 200 })}>Large</button>
      <button on:click={() => updateSize({ width: 640, height: 360 })}>HD</button>
    </div>
    <button 
      class="preview-mode-btn"
      class:image-mode={previewMode === 'image'}
      on:click={togglePreviewMode}
      title={previewMode === 'native' ? 'Switch to Image preview (what Roku sees)' : 'Switch to Native preview (browser rendering)'}
    >
      {#if previewMode === 'native'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Native
      {:else}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Image
      {/if}
    </button>
    <button 
      class="auto-refresh-btn" 
      class:active={autoRefresh}
      on:click={toggleAutoRefresh}
      title="Auto-refresh preview at widget's refresh interval"
    >
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {autoRefresh ? 'Auto' : 'Auto'}
    </button>
  </div>
  
  <div class="preview-container">
    <div 
      class="preview-frame"
      style="width: {previewSize.width}px; height: {previewSize.height}px;"
    >
      {#if previewLoading}
        <div class="preview-loading">
          <div class="spinner-sm"></div>
          <span>Rendering...</span>
        </div>
      {:else if previewError}
        <div class="preview-error">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" class="error-icon">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{previewError}</span>
        </div>
      {:else if previewResult?.imageUrl}
        <div class="preview-render image-mode">
          <img src={previewResult.imageUrl} alt="Widget Preview" />
        </div>
      {:else if previewResult?.html}
        <div class="preview-render html-mode">
          {@html DOMPurify.sanitize(previewResult.html)}
        </div>
      {:else if previewResult?.primitives}
        <div class="preview-render">
          {@html renderPrimitivesToHtml(previewResult.primitives)}
        </div>
      {:else}
        <div class="preview-placeholder">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Press Ctrl+Enter or click "Run" to preview</span>
        </div>
      {/if}
    </div>
  </div>
  
  <div class="preview-info">
    {#if previewResult}
      <span class="info-badge mode">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
        {previewResult.renderMode}
      </span>
      <span class="info-badge refresh">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {previewResult.refreshInterval >= 60000 
          ? `${previewResult.refreshInterval / 60000}m` 
          : previewResult.refreshInterval >= 1000 
            ? `${previewResult.refreshInterval / 1000}s`
            : `${previewResult.refreshInterval}ms`}
      </span>
      <span class="info-badge duration {previewResult.duration > 1000 ? 'slow' : previewResult.duration > 200 ? 'ok' : 'fast'}">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {previewResult.duration}ms
      </span>
      {#if previewResult.success === false}
        <span class="info-badge error">Error</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Preview Panel */
  .preview-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    overflow: auto;
  }

  .preview-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .size-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .size-controls input {
    width: 60px;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
    text-align: center;
  }

  .preset-sizes {
    display: flex;
    gap: 4px;
  }

  .preset-sizes button {
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    cursor: pointer;
  }

  .preset-sizes button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .preview-mode-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
  }

  .preview-mode-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .preview-mode-btn.image-mode {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
  }

  .preview-mode-btn svg {
    width: 14px;
    height: 14px;
  }

  .auto-refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
    margin-left: auto;
  }

  .auto-refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .auto-refresh-btn.active {
    background: rgba(16, 185, 129, 0.15);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }

  .auto-refresh-btn svg {
    width: 14px;
    height: 14px;
  }

  .preview-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    min-height: 200px;
  }

  .preview-frame {
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.2);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-loading,
  .preview-error,
  .preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .preview-loading span {
    font-size: 11px;
    margin-top: 4px;
  }

  .spinner-sm {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .preview-error {
    color: #ef4444;
    padding: 12px;
    text-align: center;
  }

  .preview-error .error-icon {
    width: 24px;
    height: 24px;
    margin-bottom: 4px;
  }

  .preview-placeholder svg {
    width: 32px;
    height: 32px;
    opacity: 0.5;
    margin-bottom: 4px;
  }

  .preview-render {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', system-ui, sans-serif;
  }

  .preview-render > :global(div) {
    width: 100%;
    height: 100%;
  }

  .preview-render.image-mode img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .preview-render.html-mode {
    padding: 0;
    background: transparent;
  }

  .preview-info {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    font-size: 11px;
    flex-wrap: wrap;
  }

  .info-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .info-badge svg {
    width: 12px;
    height: 12px;
  }

  .info-badge.mode {
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.15);
  }

  .info-badge.refresh {
    color: #a78bfa;
    background: rgba(167, 139, 250, 0.15);
  }

  .info-badge.duration.fast {
    color: #34d399;
    background: rgba(52, 211, 153, 0.15);
  }

  .info-badge.duration.ok {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
  }

  .info-badge.duration.slow {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .info-badge.error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
