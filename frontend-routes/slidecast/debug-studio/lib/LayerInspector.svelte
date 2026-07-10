<script>
  import { onMount } from 'svelte';
  import LayerCard from './LayerCard.svelte';
  import CompareModal from './CompareModal.svelte';
  import JsonTree from './JsonTree.svelte';

  export let castId;
  export let slideIndex;
  export let slides;

  const API_BASE = '/api/extensions/slidecast';

  let layers = [];
  let renderStats = null;
  let generatedAt = null;
  let loading = false;
  let error = null;
  let renderStatus = null;

  // Compare modal state
  let compareOpen = false;
  let compareElement = null;
  let comparePngUrl = null;

  // Watch for slideIndex changes
  $: if (castId && slideIndex !== undefined) {
    loadLayers();
  }

  onMount(() => {
    if (castId) {
      loadLayers();
    }
  });

  async function loadLayers(force = false) {
    loading = true;
    error = null;

    try {
      let url = `${API_BASE}/protocol/slide-layers/${castId}/${slideIndex}`;
      if (force) url += '?force=true';

      const res = await fetch(url);
      const data = await res.json();

      if (data.layers && data.layers.length > 0) {
        layers = data.layers;
        renderStats = data.renderStats || null;
        generatedAt = data.generatedAt || null;
        renderStatus = null;
      } else if (data.status === 'rendering' || data.status === 'queued') {
        renderStatus = data.status;
        // Auto-retry in 3 seconds
        setTimeout(() => loadLayers(false), 3000);
      } else if (data.success === false) {
        error = data.error || 'Failed to load layers';
        layers = [];
        renderStats = null;
      } else {
        layers = [];
        renderStats = null;
        renderStatus = 'no layers';
      }
    } catch (err) {
      error = 'Failed to load layers: ' + err.message;
      layers = [];
      renderStats = null;
    } finally {
      loading = false;
    }
  }

  function handleRerender() {
    loadLayers(true);
  }

  function handleRefresh() {
    loadLayers(false);
  }

  function handleCompare(e) {
    const { layer } = e.detail;
    compareElement = layer.element || null;
    comparePngUrl = layer.file
      ? `${API_BASE}/protocol/slide-layer/${castId}/${slideIndex}/${layer.file}`
      : null;
    compareOpen = true;
  }

  function closeCompare() {
    compareOpen = false;
    compareElement = null;
    comparePngUrl = null;
  }

  function timeSinceRender(generatedAt) {
    if (!generatedAt) return 'Unknown';
    const ms = Date.now() - new Date(generatedAt).getTime();
    if (ms < 1000) return 'just now';
    if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
    return new Date(generatedAt).toLocaleTimeString();
  }

  // Count layer statuses
  $: renderedCount = layers.filter(l => !l.native && l.file && !l.error).length;
  $: nativeCount = layers.filter(l => l.native === true).length;
  $: skippedCount = layers.filter(l => !l.native && !l.file && !l.error).length;
  $: failedCount = layers.filter(l => !!l.error).length;
</script>

<div class="layer-inspector">
  <!-- Stats Bar -->
  {#if layers.length > 0 || loading}
    <div class="stats-bar">
      <div class="stat">
        <span class="stat-value">{layers.length}</span>
        <span class="stat-label">total</span>
      </div>
      <div class="stat stat-green">
        <span class="stat-value">{renderedCount}</span>
        <span class="stat-label">rendered</span>
      </div>
      <div class="stat stat-blue">
        <span class="stat-value">{nativeCount}</span>
        <span class="stat-label">native</span>
      </div>
      <div class="stat stat-yellow">
        <span class="stat-value">{skippedCount}</span>
        <span class="stat-label">skipped</span>
      </div>
      <div class="stat stat-red">
        <span class="stat-value">{failedCount}</span>
        <span class="stat-label">failed</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat stat-time">
        <span class="stat-label">rendered</span>
        <span class="stat-value">{timeSinceRender(generatedAt)}</span>
      </div>
      <div class="stats-actions">
        <button class="rerender-btn" on:click={handleRerender} disabled={loading}>
          {loading ? 'Loading...' : 'Re-render All'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Error state -->
  {#if error}
    <div class="error-panel">
      <strong>Error:</strong> {error}
      <button class="retry-btn" on:click={() => loadLayers()}>Retry</button>
    </div>
  {/if}

  <!-- Loading state -->
  {#if loading}
    <div class="loading-panel">
      <div class="loading-spinner"></div>
      Loading layers...
    </div>
  {:else if renderStatus === 'rendering' || renderStatus === 'queued'}
    <div class="loading-panel">
      <div class="loading-spinner"></div>
      Slide is {renderStatus}... auto-retrying
    </div>
  {:else if !error && layers.length === 0 && castId}
    <div class="empty-panel">
      No layers found for this slide. Click "Re-render All" to generate layers.
    </div>
  {/if}

  <!-- Layers Grid -->
  {#if layers.length > 0}
    <div class="layers-grid">
      {#each layers as layer (layer.id || layer.zIndex)}
        <LayerCard
          {layer}
          {castId}
          {slideIndex}
          on:compare={handleCompare}
          on:refresh={handleRefresh}
        />
      {/each}
    </div>
  {/if}
</div>

<!-- Compare Modal -->
<CompareModal
  open={compareOpen}
  element={compareElement}
  layerPngUrl={comparePngUrl}
  {castId}
  {slideIndex}
  on:close={closeCompare}
/>

<style>
  .layer-inspector {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Stats Bar */
  .stats-bar {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    padding: 12px 16px;
    background: var(--color-surface-raised, #252542);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .stat-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-text, #e0e0e0);
    line-height: 1;
  }

  .stat-label {
    font-size: 11px;
    color: var(--color-text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-green .stat-value { color: #4ade80; }
  .stat-blue  .stat-value { color: #60a5fa; }
  .stat-yellow .stat-value { color: #fbbf24; }
  .stat-red   .stat-value { color: #f87171; }

  .stat-time {
    flex-direction: row;
    gap: 6px;
    align-items: baseline;
  }

  .stat-time .stat-label {
    font-size: 12px;
  }

  .stat-time .stat-value {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-muted, #aaa);
  }

  .stat-divider {
    width: 1px;
    height: 32px;
    background: var(--color-border, #3d3d5c);
    margin: 0 4px;
  }

  .stats-actions {
    margin-left: auto;
  }

  .rerender-btn {
    padding: 7px 16px;
    background: var(--color-primary, #6366f1);
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .rerender-btn:hover {
    background: #4f46e5;
  }

  .rerender-btn:disabled {
    background: #444;
    cursor: not-allowed;
  }

  /* Error Panel */
  .error-panel {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: #3d1a1a;
    border: 1px solid #6b2c2c;
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 14px;
  }

  .retry-btn {
    padding: 4px 10px;
    background: transparent;
    color: #ff6b6b;
    border: 1px solid #ff6b6b;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    margin-left: auto;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: rgba(255, 107, 107, 0.1);
  }

  /* Loading Panel */
  .loading-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 200px;
    color: var(--color-text-muted, #888);
    font-size: 14px;
  }

  .loading-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--color-border, #3d3d5c);
    border-top-color: var(--color-primary, #6366f1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Empty Panel */
  .empty-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    border: 1px dashed var(--color-border, #3d3d5c);
    border-radius: 8px;
    color: var(--color-text-muted, #888);
    font-size: 14px;
  }

  /* Layers Grid */
  .layers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
</style>
