<script>
  import { createEventDispatcher } from 'svelte';
  import JsonTree from './JsonTree.svelte';

  export let layer;
  export let castId;
  export let slideIndex;

  const dispatch = createEventDispatcher();
  const API_BASE = '/api/extensions/slidecast';

  let showJson = false;
  let rerenderLoading = false;
  let toast = null;

  // Status badge logic
  function getStatus(layer) {
    if (layer.native === true) return 'native';
    if (layer.error) return 'failed';
    if (!layer.file) return 'skipped';
    return 'rendered';
  }

  $: status = getStatus(layer);

  function getImageUrl() {
    if (!layer.file) return null;
    return `${API_BASE}/protocol/slide-layer/${castId}/${slideIndex}/${layer.file}`;
  }

  function showToast(message, type = 'success') {
    toast = { message, type };
    setTimeout(() => { toast = null; }, 3000);
  }

  function handleOpenRender() {
    // Direct param mode — render-element page fetches data from slide-elements
    // by cast/slide and looks up the element by ID.  No tokens involved.
    const elementId = layer.id || layer.element?.id;
    if (!elementId) {
      showToast('Layer has no element id to render', 'error');
      return;
    }
    const url = `${API_BASE}/protocol/render-element` +
      `?cast=${encodeURIComponent(castId)}` +
      `&slide=${encodeURIComponent(slideIndex)}` +
      `&element=${encodeURIComponent(elementId)}` +
      `&debug=true`;
    window.open(url, '_blank', 'noopener');
  }

  async function handleRerender() {
    rerenderLoading = true;
    try {
      const res = await fetch(`${API_BASE}/protocol/rerender-element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          castId,
          slideIndex,
          elementId: layer.id
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Re-render queued');
        dispatch('refresh');
      } else {
        showToast(data.error || 'Re-render failed', 'error');
      }
    } catch (err) {
      showToast('Re-render failed: ' + err.message, 'error');
    } finally {
      rerenderLoading = false;
    }
  }

  function handleCompare() {
    dispatch('compare', { layer });
  }

  function toggleJson() {
    showJson = !showJson;
  }

  function truncateHash(hash) {
    if (!hash) return null;
    return hash.substring(0, 8);
  }
</script>

<div class="layer-card" class:failed={status === 'failed'} class:native-card={status === 'native'}>
  <!-- Toast -->
  {#if toast}
    <div class="card-toast" class:toast-error={toast.type === 'error'}>
      {toast.message}
    </div>
  {/if}

  <!-- Header -->
  <div class="card-header">
    <span class="card-title">z{layer.zIndex} · {layer.type}</span>
    <span class="status-badge status-{status}">{status}</span>
  </div>

  <!-- Preview Area -->
  <div class="card-preview">
    {#if status === 'native'}
      <div class="native-placeholder">
        <div class="native-icon">⬜</div>
        <div class="native-text">Screen-rendered</div>
        <div class="native-sub">{layer.type}</div>
      </div>
    {:else if layer.file}
      <div class="image-preview">
        <img
          src={getImageUrl()}
          alt="Layer {layer.zIndex}"
          loading="lazy"
        />
      </div>
    {:else}
      <div class="no-preview">
        {status === 'skipped' ? 'Skipped — no file' : 'No preview'}
      </div>
    {/if}
  </div>

  <!-- Error message if failed -->
  {#if status === 'failed' && layer.error}
    <div class="error-message">
      {layer.error}
    </div>
  {/if}

  <!-- Metadata -->
  <div class="card-meta">
    <div class="meta-row">
      <span class="meta-label">Position</span>
      <span class="meta-value">({layer.x}, {layer.y})</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Size</span>
      <span class="meta-value">{layer.width}×{layer.height}</span>
    </div>
    {#if layer.file}
      <div class="meta-row">
        <span class="meta-label">File</span>
        <span class="meta-value mono">{layer.file}</span>
      </div>
    {/if}
    {#if layer.contentHash}
      <div class="meta-row">
        <span class="meta-label">Hash</span>
        <span class="meta-value mono">{truncateHash(layer.contentHash)}</span>
      </div>
    {/if}
  </div>

  <!-- Action Buttons -->
  <div class="card-actions">
    <button class="action-btn" on:click={handleCompare} title="Compare">
      Compare
    </button>
    {#if layer.element}
      <button class="action-btn" on:click={handleOpenRender} title="Open render in new tab">
        Open Render
      </button>
    {/if}
    <button
      class="action-btn"
      on:click={handleRerender}
      disabled={rerenderLoading}
      title="Re-render this element"
    >
      {rerenderLoading ? 'Re-rendering...' : 'Re-render'}
    </button>
    <button class="action-btn" class:active={showJson} on:click={toggleJson} title="Toggle JSON">
      JSON
    </button>
  </div>

  <!-- JSON panel -->
  {#if showJson}
    <div class="json-panel">
      <JsonTree data={layer.element || layer} expanded={false} label="element" />
    </div>
  {/if}
</div>

<style>
  .layer-card {
    position: relative;
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    background: var(--color-surface-raised, #252542);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .layer-card.failed {
    border-color: #ef4444;
  }

  .layer-card.native-card {
    border-color: #4a90d9;
  }

  /* Toast */
  .card-toast {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    padding: 6px 14px;
    background: #10b981;
    color: white;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }

  .card-toast.toast-error {
    background: #ef4444;
  }

  /* Header */
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--color-surface, #1a1a2e);
    border-bottom: 1px solid var(--color-border, #3d3d5c);
  }

  .card-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text, #e0e0e0);
  }

  /* Status Badge */
  .status-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-rendered { background: #14532d; color: #4ade80; }
  .status-native   { background: #1e3a5f; color: #60a5fa; }
  .status-skipped  { background: #451a03; color: #fbbf24; }
  .status-failed   { background: #450a0a; color: #f87171; }

  /* Preview */
  .card-preview {
    min-height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: repeating-conic-gradient(#3d3d5c 0% 25%, #252542 0% 50%) 50% / 10px 10px;
  }

  .image-preview {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
  }

  .image-preview img {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
    display: block;
  }

  .native-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    border: 2px dashed var(--color-border, #3d3d5c);
    border-radius: 6px;
    margin: 12px;
    color: var(--color-text-muted, #888);
    background: var(--color-surface, #1a1a2e);
  }

  .native-icon {
    font-size: 24px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  .native-text {
    font-size: 13px;
    font-weight: 500;
    color: #60a5fa;
  }

  .native-sub {
    font-size: 11px;
    color: var(--color-text-muted, #888);
    margin-top: 2px;
  }

  .no-preview {
    color: var(--color-text-muted, #666);
    font-size: 13px;
    padding: 20px;
  }

  /* Error */
  .error-message {
    padding: 8px 14px;
    background: #450a0a;
    border-top: 1px solid #7f1d1d;
    color: #f87171;
    font-size: 12px;
    font-family: monospace;
  }

  /* Metadata */
  .card-meta {
    padding: 10px 14px;
    background: var(--color-surface, #1a1a2e);
    border-top: 1px solid var(--color-border, #3d3d5c);
    font-size: 12px;
  }

  .meta-row {
    display: flex;
    gap: 8px;
    padding: 2px 0;
  }

  .meta-label {
    color: var(--color-text-muted, #888);
    min-width: 60px;
    flex-shrink: 0;
  }

  .meta-value {
    color: var(--color-text, #e0e0e0);
    word-break: break-all;
  }

  .mono {
    font-family: monospace;
    color: #10b981;
    font-size: 11px;
  }

  /* Actions */
  .card-actions {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    background: var(--color-surface, #1a1a2e);
    border-top: 1px solid var(--color-border, #3d3d5c);
    flex-wrap: wrap;
  }

  .action-btn {
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 500;
    background: var(--color-surface-raised, #252542);
    color: var(--color-text, #e0e0e0);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .action-btn:hover {
    background: var(--color-primary, #6366f1);
    color: white;
    border-color: var(--color-primary, #6366f1);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.active {
    background: var(--color-primary, #6366f1);
    color: white;
    border-color: var(--color-primary, #6366f1);
  }

  /* JSON Panel */
  .json-panel {
    border-top: 1px solid var(--color-border, #3d3d5c);
  }
</style>
