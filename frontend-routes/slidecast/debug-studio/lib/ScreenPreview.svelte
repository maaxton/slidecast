<script>
  import { onMount } from 'svelte';
  import SlideRenderer from '../../lib/SlideRenderer.svelte';

  const API_BASE = '/api/extensions/slidecast';

  // Props
  export let castId = null;
  export let slideIndex = 0;
  export let slide = null;
  export let castDefinition = null;

  // View mode
  let viewMode = 'side-by-side'; // 'side-by-side' | 'overlay' | 'layers-stack'

  // Editor preview
  let editorContainerEl = null;
  let editorContainerWidth = 0;
  let editorContainerHeight = 0;
  let editorScale = 1;

  // Rendered output
  let renderedContainerEl = null;
  let renderedContainerWidth = 0;
  let renderedContainerHeight = 0;
  let renderedScale = 1;

  // Layer data
  let layers = [];
  let layersLoading = false;
  let layersError = null;

  // Layer visibility (for layers stack mode)
  let layerVisibility = {};

  // Screens
  let screens = [];
  let screensLoading = false;

  // Overlay opacity
  let overlayOpacity = 0.5;

  // Toast
  let toastMessage = null;
  let toastTimer = null;

  // --- Reactive ---

  $: if (castId !== null && slideIndex !== null) {
    loadLayers();
  }

  $: if (layers.length) {
    // Initialize layer visibility
    const newVis = {};
    for (const layer of layers) {
      if (!(layer.layerId in layerVisibility)) {
        newVis[layer.layerId] = true;
      } else {
        newVis[layer.layerId] = layerVisibility[layer.layerId];
      }
    }
    layerVisibility = newVis;
  }

  // Compute scale for editor preview (fits 1920x1080 into container)
  $: if (editorContainerWidth && editorContainerHeight) {
    const scaleW = editorContainerWidth / 1920;
    const scaleH = editorContainerHeight / 1080;
    editorScale = Math.min(scaleW, scaleH);
  }

  $: if (renderedContainerWidth && renderedContainerHeight) {
    const scaleW = renderedContainerWidth / 1920;
    const scaleH = renderedContainerHeight / 1080;
    renderedScale = Math.min(scaleW, scaleH);
  }

  // Layer color coding
  function layerColor(layer) {
    if (layer._error || layer.status === 'failed') return '#7f1d1d'; // red
    if (layer.isNative) return 'transparent'; // blue outlined
    return '#052e16'; // green-tinted for PNG
  }

  function layerBorderColor(layer) {
    if (layer._error || layer.status === 'failed') return '#ef4444';
    if (layer.isNative) return '#3b82f6';
    return '#22c55e';
  }

  // --- Data fetching ---

  async function loadLayers() {
    if (!castId) return;
    layersLoading = true;
    layersError = null;
    try {
      const res = await fetch(`${API_BASE}/protocol/slide-layers/${castId}/${slideIndex}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      layers = data.layers || [];
    } catch (err) {
      layersError = 'Failed to load layer data: ' + err.message;
      layers = [];
    } finally {
      layersLoading = false;
    }
  }

  async function loadScreens() {
    screensLoading = true;
    try {
      const res = await fetch(`${API_BASE}/screens`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      screens = data.screens || data || [];
    } catch (err) {
      screens = [];
    } finally {
      screensLoading = false;
    }
  }

  // --- Mount ---

  onMount(() => {
    loadScreens();

    // Observe editor container size
    if (editorContainerEl) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          editorContainerWidth = entry.contentRect.width;
          editorContainerHeight = entry.contentRect.height;
        }
      });
      ro.observe(editorContainerEl);
    }

    if (renderedContainerEl) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          renderedContainerWidth = entry.contentRect.width;
          renderedContainerHeight = entry.contentRect.height;
        }
      });
      ro.observe(renderedContainerEl);
    }
  });

  // --- Toast ---

  function showToast(msg) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMessage = null; }, 3000);
  }

  function handleScreenshot(screen) {
    showToast('Coming soon: screenshot for ' + (screen.name || screen.serial));
  }

  // --- Helpers ---

  function shortType(layer) {
    if (!layer.type) return '?';
    return layer.type.length > 8 ? layer.type.slice(0, 7) + '…' : layer.type;
  }

  // Rendered canvas dimensions (scaled)
  $: canvasW = 1920 * renderedScale;
  $: canvasH = 1080 * renderedScale;
</script>

<div class="screen-preview">

  <!-- View Mode Toggle -->
  <div class="toolbar">
    <div class="btn-group" role="group" aria-label="View mode">
      <button
        class="mode-btn"
        class:active={viewMode === 'side-by-side'}
        on:click={() => viewMode = 'side-by-side'}
      >Side by Side</button>
      <button
        class="mode-btn"
        class:active={viewMode === 'overlay'}
        on:click={() => viewMode = 'overlay'}
      >Overlay</button>
      <button
        class="mode-btn"
        class:active={viewMode === 'layers-stack'}
        on:click={() => viewMode = 'layers-stack'}
      >Layers Stack</button>
    </div>

    {#if viewMode === 'overlay'}
      <div class="overlay-controls">
        <label class="opacity-label" for="overlay-opacity">Rendered opacity</label>
        <input
          id="overlay-opacity"
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={overlayOpacity}
          class="opacity-slider"
        />
        <span class="opacity-val">{Math.round(overlayOpacity * 100)}%</span>
      </div>
    {/if}
  </div>

  <!-- Main Content -->
  {#if viewMode === 'side-by-side'}
    <div class="panels-row">
      <!-- Editor Preview -->
      <div class="panel">
        <div class="panel-label">Editor Preview — What you see in studio</div>
        <div class="preview-container" bind:this={editorContainerEl}>
          {#if slide}
            <div
              class="canvas-wrapper"
              style="width:{1920 * editorScale}px; height:{1080 * editorScale}px;"
            >
              <SlideRenderer
                {slide}
                width={1920}
                height={1080}
                scale={editorScale}
              />
            </div>
          {:else}
            <div class="empty-state">No slide selected</div>
          {/if}
        </div>
      </div>

      <!-- Rendered Output -->
      <div class="panel">
        <div class="panel-label">Rendered Output — Composited layer PNGs</div>
        <div class="preview-container" bind:this={renderedContainerEl}>
          {#if layersLoading}
            <div class="empty-state">Loading layers…</div>
          {:else if layersError}
            <div class="empty-state error">{layersError}</div>
          {:else}
            <div
              class="canvas-wrapper rendered-canvas"
              style="width:{canvasW}px; height:{canvasH}px;"
            >
              {#each layers as layer (layer.layerId)}
                {#if !layer.isNative && layer.file}
                  <img
                    src={layer.file}
                    alt="layer {layer.zIndex}"
                    class="layer-img"
                    style="
                      left: {(layer.x || 0) * renderedScale}px;
                      top: {(layer.y || 0) * renderedScale}px;
                      width: {(layer.width || 1920) * renderedScale}px;
                      height: {(layer.height || 1080) * renderedScale}px;
                      z-index: {layer.zIndex || 0};
                      opacity: {layer.opacity !== undefined ? layer.opacity : 1};
                    "
                  />
                {:else if layer.isNative}
                  <div
                    class="native-layer-overlay"
                    style="
                      left: {(layer.x || 0) * renderedScale}px;
                      top: {(layer.y || 0) * renderedScale}px;
                      width: {(layer.width || 1920) * renderedScale}px;
                      height: {(layer.height || 1080) * renderedScale}px;
                      z-index: {layer.zIndex || 0};
                    "
                  >
                    <span class="native-label">{layer.type || 'native'}</span>
                  </div>
                {/if}
              {/each}
              {#if layers.length === 0}
                <div class="empty-state">No layer data</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>

  {:else if viewMode === 'overlay'}
    <div class="panels-overlay">
      <!-- Editor on bottom, rendered on top -->
      <div class="overlay-panel-label">Editor Preview (base)</div>
      <div class="preview-container overlay-preview-container" bind:this={editorContainerEl}>
        {#if slide}
          <div
            class="canvas-wrapper"
            style="width:{1920 * editorScale}px; height:{1080 * editorScale}px;"
          >
            <SlideRenderer
              {slide}
              width={1920}
              height={1080}
              scale={editorScale}
            />
          </div>
        {:else}
          <div class="empty-state">No slide selected</div>
        {/if}

        <!-- Rendered output layered on top -->
        {#if !layersLoading && !layersError && layers.length > 0}
          <div
            class="overlay-rendered"
            style="opacity:{overlayOpacity}; width:{1920 * editorScale}px; height:{1080 * editorScale}px;"
            bind:this={renderedContainerEl}
          >
            {#each layers as layer (layer.layerId)}
              {#if !layer.isNative && layer.file}
                <img
                  src={layer.file}
                  alt="layer {layer.zIndex}"
                  class="layer-img"
                  style="
                    left: {(layer.x || 0) * editorScale}px;
                    top: {(layer.y || 0) * editorScale}px;
                    width: {(layer.width || 1920) * editorScale}px;
                    height: {(layer.height || 1080) * editorScale}px;
                    z-index: {layer.zIndex || 0};
                    opacity: {layer.opacity !== undefined ? layer.opacity : 1};
                  "
                />
              {:else if layer.isNative}
                <div
                  class="native-layer-overlay"
                  style="
                    left: {(layer.x || 0) * editorScale}px;
                    top: {(layer.y || 0) * editorScale}px;
                    width: {(layer.width || 1920) * editorScale}px;
                    height: {(layer.height || 1080) * editorScale}px;
                    z-index: {layer.zIndex || 0};
                  "
                >
                  <span class="native-label">{layer.type || 'native'}</span>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      <div class="overlay-panel-label muted">Rendered Output overlaid at {Math.round(overlayOpacity * 100)}% opacity</div>
    </div>

  {:else if viewMode === 'layers-stack'}
    <div class="layers-stack-view">
      {#if layersLoading}
        <div class="empty-state">Loading layers…</div>
      {:else if layersError}
        <div class="empty-state error">{layersError}</div>
      {:else if layers.length === 0}
        <div class="empty-state">No layers for this slide</div>
      {:else}
        {#each [...layers].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0)) as layer (layer.layerId)}
          <div class="stack-layer-row">
            <label class="stack-visibility">
              <input
                type="checkbox"
                bind:checked={layerVisibility[layer.layerId]}
              />
              <span class="stack-layer-name">
                z{layer.zIndex ?? '?'} — {layer.type || 'unknown'}
                {#if layer.isNative}<span class="badge native-badge">Native</span>{/if}
                {#if layer._error || layer.status === 'failed'}<span class="badge error-badge">Failed</span>{/if}
              </span>
            </label>

            {#if layerVisibility[layer.layerId]}
              <div class="stack-layer-preview">
                {#if !layer.isNative && layer.file}
                  <img
                    src={layer.file}
                    alt="layer {layer.zIndex}"
                    class="stack-layer-img"
                  />
                {:else if layer.isNative}
                  <div class="stack-native-placeholder">
                    <span>{layer.type || 'native'} (rendered on device)</span>
                  </div>
                {:else}
                  <div class="stack-native-placeholder error">
                    <span>No file / failed</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Connected Screens -->
  <div class="section">
    <div class="section-title">Connected Screens</div>
    {#if screensLoading}
      <div class="screens-empty">Loading screens…</div>
    {:else if screens.length === 0}
      <div class="screens-empty">No screens connected</div>
    {:else}
      <div class="screens-list">
        {#each screens as screen}
          <div class="screen-card">
            <div class="screen-info">
              <span class="screen-name">{screen.name || 'Unnamed Screen'}</span>
              <span class="screen-serial">{screen.serial || screen.id || ''}</span>
            </div>
            <div class="screen-actions">
              <span class="online-badge" class:online={screen.online} class:offline={!screen.online}>
                {screen.online ? 'Online' : 'Offline'}
              </span>
              <button class="screenshot-btn" on:click={() => handleScreenshot(screen)}>
                Take Screenshot
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Layer Compositing Order -->
  <div class="section">
    <div class="section-title">Layer Compositing Order</div>
    {#if layersLoading}
      <div class="screens-empty">Loading…</div>
    {:else if layers.length === 0}
      <div class="screens-empty">No layers</div>
    {:else}
      <div class="compositing-track">
        {#each [...layers].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)) as layer (layer.layerId)}
          <div class="compositing-bar-wrap">
            <div
              class="compositing-bar"
              style="
                background: {layerColor(layer)};
                border-color: {layerBorderColor(layer)};
              "
              title="{layer.type} | z:{layer.zIndex} | {layer.isNative ? 'Native' : 'PNG'}"
            ></div>
            <div class="compositing-label">
              <span class="comp-z">z{layer.zIndex ?? '?'}</span>
              <span class="comp-type">{shortType(layer)}</span>
            </div>
          </div>
        {/each}
      </div>
      <div class="compositing-legend">
        <span class="legend-item">
          <span class="legend-dot png-dot"></span> PNG layer
        </span>
        <span class="legend-item">
          <span class="legend-dot native-dot"></span> Native
        </span>
        <span class="legend-item">
          <span class="legend-dot failed-dot"></span> Failed
        </span>
      </div>
    {/if}
  </div>

</div>

<!-- Toast -->
{#if toastMessage}
  <div class="toast">{toastMessage}</div>
{/if}

<style>
  /* ─── Layout ─────────────────────────────────── */
  .screen-preview {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 0;
  }

  /* ─── Toolbar ─────────────────────────────────── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .btn-group {
    display: flex;
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 6px;
    overflow: hidden;
  }

  .mode-btn {
    padding: 7px 18px;
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text-muted, #aaa);
    border: none;
    border-right: 1px solid var(--color-border, #3d3d5c);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .mode-btn:last-child {
    border-right: none;
  }

  .mode-btn:hover {
    background: var(--color-surface-raised, #252542);
    color: var(--color-text, #e0e0e0);
  }

  .mode-btn.active {
    background: var(--color-primary, #6366f1);
    color: #fff;
  }

  .overlay-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .opacity-label {
    font-size: 13px;
    color: var(--color-text-muted, #aaa);
  }

  .opacity-slider {
    width: 120px;
    accent-color: var(--color-primary, #6366f1);
  }

  .opacity-val {
    font-size: 13px;
    color: var(--color-text, #e0e0e0);
    width: 36px;
    text-align: right;
  }

  /* ─── Side-by-Side Panels ─────────────────────── */
  .panels-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .preview-container {
    flex: 1;
    min-height: 220px;
    background: #000;
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }

  .canvas-wrapper {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
  }

  .rendered-canvas {
    position: relative;
    background: #111;
  }

  /* ─── Overlay Mode ─────────────────────────────── */
  .panels-overlay {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .overlay-panel-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .overlay-panel-label.muted {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-top: 4px;
  }

  .overlay-preview-container {
    position: relative;
  }

  .overlay-rendered {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  /* ─── Layer images (shared) ────────────────────── */
  .layer-img {
    position: absolute;
    display: block;
  }

  .native-layer-overlay {
    position: absolute;
    background: rgba(59, 130, 246, 0.12);
    border: 1px dashed #3b82f6;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .native-label {
    font-size: 11px;
    color: #60a5fa;
    background: rgba(0,0,0,0.6);
    padding: 2px 6px;
    border-radius: 3px;
  }

  /* ─── Layers Stack Mode ─────────────────────────── */
  .layers-stack-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .stack-layer-row {
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    overflow: hidden;
    background: var(--color-surface-raised, #252542);
  }

  .stack-visibility {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
  }

  .stack-visibility input[type="checkbox"] {
    accent-color: var(--color-primary, #6366f1);
    width: 15px;
    height: 15px;
  }

  .stack-layer-name {
    font-size: 13px;
    color: var(--color-text, #e0e0e0);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .native-badge {
    background: rgba(59,130,246,0.2);
    color: #60a5fa;
    border: 1px solid #3b82f6;
  }

  .error-badge {
    background: rgba(239,68,68,0.2);
    color: #f87171;
    border: 1px solid #ef4444;
  }

  .stack-layer-preview {
    border-top: 1px solid var(--color-border, #3d3d5c);
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    min-height: 80px;
  }

  .stack-layer-img {
    max-width: 100%;
    max-height: 200px;
    object-fit: contain;
    display: block;
  }

  .stack-native-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 60px;
    color: #60a5fa;
    font-size: 13px;
    background: rgba(59,130,246,0.05);
    border: 1px dashed #3b82f6;
    border-radius: 4px;
  }

  .stack-native-placeholder.error {
    color: #f87171;
    background: rgba(239,68,68,0.05);
    border-color: #ef4444;
  }

  /* ─── Empty / Error States ──────────────────────── */
  .empty-state {
    color: var(--color-text-muted, #888);
    font-size: 14px;
    padding: 16px;
    text-align: center;
  }

  .empty-state.error {
    color: #f87171;
  }

  /* ─── Connected Screens ─────────────────────────── */
  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-muted, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--color-border, #3d3d5c);
  }

  .screens-empty {
    font-size: 14px;
    color: var(--color-text-muted, #888);
  }

  .screens-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .screen-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: var(--color-surface-raised, #252542);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
  }

  .screen-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .screen-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text, #e0e0e0);
  }

  .screen-serial {
    font-size: 12px;
    color: var(--color-text-muted, #aaa);
    font-family: monospace;
  }

  .screen-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .online-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .online-badge.online {
    background: rgba(34,197,94,0.15);
    color: #4ade80;
    border: 1px solid #22c55e;
  }

  .online-badge.offline {
    background: rgba(107,114,128,0.15);
    color: #9ca3af;
    border: 1px solid #6b7280;
  }

  .screenshot-btn {
    padding: 5px 12px;
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text, #e0e0e0);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .screenshot-btn:hover {
    background: var(--color-primary, #6366f1);
    border-color: var(--color-primary, #6366f1);
    color: #fff;
  }

  /* ─── Compositing Order ─────────────────────────── */
  .compositing-track {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-end;
  }

  .compositing-bar-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .compositing-bar {
    width: 48px;
    height: 60px;
    border: 2px solid;
    border-radius: 5px;
  }

  .compositing-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .comp-z {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text, #e0e0e0);
    font-family: monospace;
  }

  .comp-type {
    font-size: 10px;
    color: var(--color-text-muted, #aaa);
    max-width: 52px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  .compositing-legend {
    display: flex;
    gap: 16px;
    margin-top: 4px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-muted, #aaa);
  }

  .legend-dot {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 2px solid;
    display: inline-block;
  }

  .png-dot {
    background: #052e16;
    border-color: #22c55e;
  }

  .native-dot {
    background: transparent;
    border-color: #3b82f6;
  }

  .failed-dot {
    background: #7f1d1d;
    border-color: #ef4444;
  }

  /* ─── Toast ─────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-surface-raised, #252542);
    color: var(--color-text, #e0e0e0);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    padding: 10px 22px;
    font-size: 14px;
    z-index: 9999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    pointer-events: none;
    animation: toast-in 0.18s ease;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
