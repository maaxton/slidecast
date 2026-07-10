<script>
  import { onMount } from 'svelte';
  
  let casts = [];
  let selectedCastId = '';
  let selectedSlideIndex = 0;
  let slides = [];
  let layerData = null;
  let loading = false;
  let error = null;
  let forceRender = false;
  let clearCache = false;
  
  const API_BASE = '/api/extensions/slidecast';
  
  onMount(async () => {
    await loadCasts();
  });
  
  async function loadCasts() {
    try {
      const res = await fetch(`${API_BASE}/casts`);
      const data = await res.json();
      casts = data.casts || [];
    } catch (err) {
      error = 'Failed to load casts: ' + err.message;
    }
  }
  
  async function onCastSelect() {
    if (!selectedCastId) {
      slides = [];
      layerData = null;
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/casts/${selectedCastId}`);
      const data = await res.json();
      
      // Flatten slides from groups
      slides = [];
      const groups = data.cast?.definition?.groups || [];
      for (const group of groups) {
        for (const slide of (group.slides || [])) {
          slides.push({
            ...slide,
            groupName: group.name,
            groupId: group.id
          });
        }
      }
      
      selectedSlideIndex = 0;
      if (slides.length > 0) {
        await loadLayers();
      }
    } catch (err) {
      error = 'Failed to load cast: ' + err.message;
    }
  }
  
  async function loadLayers() {
    if (!selectedCastId || slides.length === 0) return;
    
    loading = true;
    error = null;
    layerData = null;
    
    try {
      let url = `${API_BASE}/protocol/slide-layers/${selectedCastId}/${selectedSlideIndex}`;
      const params = [];
      if (forceRender) params.push('force=true');
      if (clearCache) params.push('nocache=' + Date.now());
      if (params.length > 0) url += '?' + params.join('&');
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.success) {
        layerData = data;
      } else {
        error = data.error || 'Failed to load layers';
      }
    } catch (err) {
      error = 'Failed to load layers: ' + err.message;
    } finally {
      loading = false;
    }
  }
  
  function getLayerImageUrl(layer, file = null) {
    const fileName = file || layer.file;
    if (!fileName) return null;
    return `${API_BASE}/protocol/slide-layer/${selectedCastId}/${selectedSlideIndex}/${fileName}?t=${Date.now()}`;
  }
  
  function getAssetUrl(assetId) {
    return `${API_BASE}/protocol/asset/${assetId}`;
  }
  
  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return '';
    const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  }

  function formatRefreshInterval(intervalMs) {
    if (intervalMs == null) return 'unknown';
    if (intervalMs >= 60000) {
      const min = Math.round(intervalMs / 60000);
      return `${min} min`;
    }
    const sec = Math.round(intervalMs / 1000);
    return `${sec} sec`;
  }

  function formatLayerInfo(layer) {
    const parts = [];
    parts.push({ label: 'ID', value: layer.id });
    parts.push({ label: 'Type', value: layer.type, highlight: true });
    parts.push({ label: 'Native', value: layer.native ? 'Yes' : 'No', badge: layer.native ? 'native' : null });
    parts.push({ label: 'Position', value: `(${layer.x}, ${layer.y})` });
    parts.push({ label: 'Size', value: `${layer.width}x${layer.height}` });
    parts.push({ label: 'Z-Index', value: layer.zIndex });
    parts.push({ label: 'Opacity', value: layer.opacity });
    if (layer.rotation) parts.push({ label: 'Rotation', value: `${layer.rotation}°` });
    if (layer.file) parts.push({ label: 'File', value: layer.file, mono: true });
    if (layer.contentHash) parts.push({ label: 'Hash', value: layer.contentHash.substring(0, 12), mono: true });
    if (layer.created_at !== undefined) {
      const rel = formatRelativeTime(layer.created_at);
      parts.push({
        label: 'Created',
        value: layer.created_at ? `${layer.created_at}${rel ? ` (${rel})` : ''}` : 'unknown',
        mono: !!layer.created_at,
      });
    }
    return parts;
  }

  function getWidgetElement(layerId) {
    if (!slides.length || selectedSlideIndex >= slides.length) return null;
    const slide = slides[selectedSlideIndex];
    const elements = slide.elements || [];
    return elements.find(el => el.id === layerId && el.type === 'widget');
  }
  
  function formatNavInfo(layer) {
    const parts = [];
    if (layer.files) {
      parts.push({ label: 'PNG States', value: layer.files.length });
    }
    if (layer.items) {
      parts.push({ label: 'Nav Items', value: layer.items.length });
    }
    if (layer.activeIndex !== undefined) {
      parts.push({ label: 'Active Index', value: layer.activeIndex });
    }
    return parts;
  }
  
  function formatVideoInfo(layer) {
    const parts = [];
    if (layer.element?.asset_id) {
      parts.push({ label: 'Asset ID', value: layer.element.asset_id, mono: true });
    }
    if (layer.element?.playback) {
      const pb = layer.element.playback;
      parts.push({ label: 'Autoplay', value: pb.autoplay ? 'Yes' : 'No' });
      parts.push({ label: 'Loop', value: pb.loop ? 'Yes' : 'No' });
      parts.push({ label: 'Muted', value: pb.muted ? 'Yes' : 'No' });
    }
    return parts;
  }
</script>

<div class="debug-container">
  <h1>🔧 Layer Debug Tool</h1>

  <!-- Debug Hub (#1142) — quick links to all slidecast debug/health surfaces. -->
  <div class="debug-hub">
    <div class="debug-hub-title">Slidecast Debug Hub</div>
    <ul>
      <li><a href="/ext/slidecast/debug/widgets">Active Widgets</a> — refresh health, image-created timestamps, PNG previews (#1117 / #1142)</li>
      <li><a href="/api/extensions/slidecast/health/widget-refresh" target="_blank" rel="noopener">/health/widget-refresh</a> — scheduler status JSON (gate mode, last tick, skip reason)</li>
      <li><a href="/api/extensions/slidecast/debug/widgets" target="_blank" rel="noopener">/debug/widgets</a> — raw active-widgets JSON (what the Active Widgets page reads)</li>
    </ul>
  </div>

  <div class="controls">
    <div class="control-group">
      <label for="cast-select">Cast:</label>
      <select id="cast-select" bind:value={selectedCastId} on:change={onCastSelect}>
        <option value="">-- Select Cast --</option>
        {#each casts as cast}
          <option value={cast.uuid}>{cast.name}</option>
        {/each}
      </select>
    </div>
    
    {#if slides.length > 0}
      <div class="control-group">
        <label for="slide-select">Slide:</label>
        <select id="slide-select" bind:value={selectedSlideIndex} on:change={loadLayers}>
          {#each slides as slide, i}
            <option value={i}>
              {i}: {slide.name || 'Untitled'} ({slide.groupName})
            </option>
          {/each}
        </select>
      </div>
      
      <div class="control-group">
        <label>
          <input type="checkbox" bind:checked={forceRender} />
          Force Re-render
        </label>
      </div>
      
      <div class="control-group">
        <label>
          <input type="checkbox" bind:checked={clearCache} />
          Bypass Cache
        </label>
      </div>
      
      <button on:click={loadLayers} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh Layers'}
      </button>
    {/if}
  </div>
  
  {#if error}
    <div class="error">{error}</div>
  {/if}
  
  {#if layerData}
    <div class="layer-info">
      <h2>Slide {selectedSlideIndex}: {layerData.width}x{layerData.height}</h2>
      <p class="meta">Last Rendered: <strong>{layerData.generatedAt ? new Date(layerData.generatedAt).toLocaleString() : 'Unknown'}</strong></p>
      <p class="meta">Total Layers: {layerData.layers?.length || 0} {#if layerData.renderStats}(rendered: {layerData.renderStats.rendered}, skipped: {layerData.renderStats.skipped}){/if}</p>
    </div>
    
    <div class="layers-grid">
      {#each (layerData.layers || []) as layer, i}
        <div class="layer-card" class:native={layer.native} class:video={layer.type === 'video'} class:nav={layer.type === 'nav'}>
          <div class="layer-header">
            <span class="layer-index">#{layer.zIndex}</span>
            <span class="layer-type" class:native={layer.native}>
              {layer.type}
              {#if layer.native}
                <span class="badge native">NATIVE</span>
              {/if}
              {#if layer.type === 'video'}
                <span class="badge video">VIDEO</span>
              {/if}
              {#if layer.type === 'nav'}
                <span class="badge nav">NAV</span>
              {/if}
            </span>
          </div>
          
          <!-- VIDEO LAYER -->
          {#if layer.type === 'video' && layer.element?.asset_id}
            <div class="video-section">
              <div class="section-title">🎬 Video Preview</div>
              <div class="video-preview">
                <video 
                  src={getAssetUrl(layer.element.asset_id)} 
                  controls 
                  muted
                  style="max-width: 100%; max-height: 200px;"
                >
                  <track kind="captions" />
                </video>
              </div>
              <div class="video-info">
                {#each formatVideoInfo(layer) as info}
                  <div class="detail-row">
                    <span class="label">{info.label}:</span>
                    <span class:mono={info.mono}>{info.value}</span>
                  </div>
                {/each}
              </div>
            </div>
          
          <!-- NAV LAYER - Show ALL states -->
          {:else if layer.type === 'nav' && layer.files}
            <div class="nav-section">
              <div class="section-title">☰ Nav States ({layer.files.length} PNGs)</div>
              <div class="nav-states-grid">
                {#each layer.files as file}
                  <div class="nav-state">
                    <div class="nav-state-header">
                      {#if file.index === -1}
                        <span class="state-label none">No Highlight</span>
                      {:else}
                        <span class="state-label">{file.label || `Item ${file.index}`}</span>
                      {/if}
                    </div>
                    <div class="nav-state-preview">
                      <img src={getLayerImageUrl(layer, file.file)} alt={file.label || 'Nav state'} />
                    </div>
                    <div class="nav-state-info">
                      <div class="detail-row"><span class="label">File:</span> <span class="mono">{file.file}</span></div>
                      <div class="detail-row"><span class="label">Index:</span> {file.index}</div>
                      {#if file.slideIndex !== undefined && file.slideIndex !== null}
                        <div class="detail-row"><span class="label">slideIndex:</span> <span class="highlight">{file.slideIndex}</span></div>
                      {/if}
                      {#if file.groupId}
                        <div class="detail-row"><span class="label">groupId:</span> {file.groupId}</div>
                      {/if}
                      {#if file.actionType}
                        <div class="detail-row"><span class="label">actionType:</span> {file.actionType}</div>
                      {/if}
                      <div class="render-source-link">
                        <a
                          href="{API_BASE}/protocol/render-element?cast={selectedCastId}&slide={selectedSlideIndex}&element={layer.id}&focusedNavItem={file.index}{file.groupId ? `&currentGroup=${encodeURIComponent(file.groupId)}` : ''}{file.slideIndex !== undefined && file.slideIndex !== null ? `&currentSlide=${file.slideIndex}` : ''}"
                          target="_blank"
                          rel="noopener"
                          title="Open render for this nav state in a new tab"
                        >
                          Open Render
                        </a>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
              
              {#if layer.items}
                <div class="nav-items-section">
                  <div class="section-title">Nav Items</div>
                  {#each layer.items as item, idx}
                    <div class="nav-item-row">
                      <span class="item-index">{idx}</span>
                      <span class="item-label">{item.label}</span>
                      {#if item.action}
                        <span class="item-action">
                          → {item.action.type}: 
                          {#if item.action.type === 'slide'}
                            slide {item.action.slide_index} in {item.action.group_id}
                          {:else if item.action.type === 'group'}
                            {item.action.group_id}
                          {:else}
                            {JSON.stringify(item.action)}
                          {/if}
                        </span>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          
          <!-- REGULAR LAYER PREVIEW -->
          {:else}
            <div class="layer-preview">
              {#if layer.native}
                {#if layer.type === 'image' && layer.element?.asset_id}
                  <img src={getAssetUrl(layer.element.asset_id)} alt="Native image" />
                  <div class="preview-label">Asset: {layer.element.asset_id}</div>
                {:else}
                  <div class="native-placeholder">
                    Rendered by Roku
                    <br/>
                    <small>{layer.type}</small>
                  </div>
                {/if}
              {:else if layer.file}
                <img src={getLayerImageUrl(layer)} alt="Layer {i}" style={layer.type === 'widget' ? 'background: #1a1a2e; border-radius: 8px;' : ''} />
                <div class="preview-label">{layer.file}</div>
              {:else}
                <div class="no-preview">No preview</div>
              {/if}
            </div>
          {/if}
          
          <div class="layer-details">
            {#each formatLayerInfo(layer) as info}
              <div class="detail-row">
                <span class="label">{info.label}:</span>
                <span class:mono={info.mono} class:highlight={info.highlight}>
                  {info.value}
                  {#if info.badge}
                    <span class="mini-badge {info.badge}">{info.badge}</span>
                  {/if}
                </span>
              </div>
            {/each}
            {#if layer.native || ['video', 'clock', 'date'].includes(layer.type)}
              <div class="render-source-link">
                <span class="text-muted">Rendered by Roku</span>
              </div>
            {:else if layer.type !== 'nav'}
              <div class="render-source-link">
                <a
                  href="{API_BASE}/protocol/render-element?cast={selectedCastId}&slide={selectedSlideIndex}&element={layer.id}"
                  target="_blank"
                  rel="noopener"
                >
                  Open Render
                </a>
              </div>
            {:else if layer.type === 'nav' && layer.files}
              <div class="render-source-link">
                <span class="text-muted">{layer.files.length} nav state link{layer.files.length === 1 ? '' : 's'} above (one per state)</span>
              </div>
            {/if}
          </div>
          
          {#if layer.type === 'widget'}
            {@const widgetEl = getWidgetElement(layer.id)}
            {#if widgetEl}
              <div class="widget-info">
                <div class="section-title">🔧 Widget Config</div>
                <div class="detail-row">
                  <span class="label">UUID:</span>
                  <span class="mono">{widgetEl.widgetUuid || 'unknown'}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Refresh Interval:</span>
                  <span>{formatRefreshInterval(layer.widget_refresh_interval_ms)}</span>
                </div>
                {#if widgetEl.widgetConfig}
                  <details class="widget-config" open>
                    <summary>widgetConfig</summary>
                    <pre>{JSON.stringify(widgetEl.widgetConfig, null, 2)}</pre>
                  </details>
                {/if}
                {#if widgetEl.widgetStyles}
                  <details class="widget-config">
                    <summary>widgetStyles</summary>
                    <pre>{JSON.stringify(widgetEl.widgetStyles, null, 2)}</pre>
                  </details>
                {/if}
                <div class="render-link">
                  <a href="/ext/slidecast/render?cast={selectedCastId}&slide={selectedSlideIndex}&element={layer.id}&debug=true" target="_blank" rel="noopener">Open Render Page</a>
                </div>
              </div>
            {/if}
          {/if}

          {#if layer.element}
            <details class="element-data">
              <summary>Element Data</summary>
              <pre>{JSON.stringify(layer.element, null, 2)}</pre>
            </details>
          {/if}
        </div>
      {/each}
    </div>
    
    <details class="raw-data">
      <summary>Raw Layer Data</summary>
      <pre>{JSON.stringify(layerData, null, 2)}</pre>
    </details>
  {/if}
</div>

<style>
  .debug-container {
    padding: 20px;
    max-width: 1600px;
    margin: 0 auto;
    font-family: system-ui, -apple-system, sans-serif;
    background: #1a1a2e;
    min-height: 100vh;
    color: #e0e0e0;
  }
  
  h1 {
    margin-bottom: 20px;
    color: #fff;
  }

  .debug-hub {
    margin-bottom: 20px;
    padding: 12px 16px;
    background: #252542;
    border: 1px solid #3d3d5c;
    border-radius: 8px;
  }
  .debug-hub-title {
    font-size: 12px;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
  .debug-hub ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: #ccc;
  }
  .debug-hub a {
    color: #6366f1;
    text-decoration: none;
  }
  .debug-hub a:hover { text-decoration: underline; }
  
  h2 {
    margin: 0 0 10px 0;
    color: #fff;
  }
  
  .controls {
    display: flex;
    gap: 20px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding: 15px;
    background: #252542;
    border-radius: 8px;
    border: 1px solid #3d3d5c;
  }
  
  .control-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  label {
    font-weight: 500;
    color: #aaa;
  }
  
  select {
    padding: 8px 12px;
    border: 1px solid #3d3d5c;
    border-radius: 4px;
    font-size: 14px;
    min-width: 200px;
    background: #1a1a2e;
    color: #fff;
  }
  
  input[type="checkbox"] {
    accent-color: #6366f1;
  }
  
  button {
    padding: 8px 16px;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  
  button:hover {
    background: #4f46e5;
  }
  
  button:disabled {
    background: #555;
    cursor: not-allowed;
  }
  
  .error {
    padding: 15px;
    background: #3d1a1a;
    border: 1px solid #6b2c2c;
    border-radius: 4px;
    color: #ff6b6b;
    margin-bottom: 20px;
  }
  
  .layer-info {
    margin-bottom: 20px;
    padding: 15px;
    background: #252542;
    border-radius: 8px;
    border: 1px solid #3d3d5c;
  }
  
  .meta {
    margin: 5px 0;
    color: #888;
    font-size: 14px;
  }
  
  .layers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
  }
  
  .layer-card {
    border: 1px solid #3d3d5c;
    border-radius: 8px;
    overflow: hidden;
    background: #252542;
  }
  
  .layer-card.native {
    border-color: #4a90d9;
  }
  
  .layer-card.video {
    border-color: #10b981;
  }
  
  .layer-card.nav {
    border-color: #f59e0b;
  }
  
  .layer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background: #1a1a2e;
    border-bottom: 1px solid #3d3d5c;
  }
  
  .layer-index {
    font-weight: bold;
    color: #888;
  }
  
  .layer-type {
    font-weight: 500;
    color: #fff;
  }
  
  .badge {
    display: inline-block;
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 3px;
    margin-left: 8px;
  }
  
  .badge.native { background: #4a90d9; color: white; }
  .badge.video { background: #10b981; color: white; }
  .badge.nav { background: #f59e0b; color: #000; }
  
  .section-title {
    padding: 10px 15px;
    font-weight: 600;
    font-size: 14px;
    background: #1a1a2e;
    border-bottom: 1px solid #3d3d5c;
    color: #fff;
  }
  
  /* Video Section */
  .video-section {
    border-bottom: 1px solid #3d3d5c;
  }
  
  .video-preview {
    padding: 15px;
    background: #000;
    display: flex;
    justify-content: center;
  }
  
  .video-info {
    padding: 10px 15px;
    background: #1e3a29;
  }
  
  /* Nav Section */
  .nav-section {
    max-height: 600px;
    overflow-y: auto;
  }
  
  .nav-states-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
    padding: 15px;
    background: #1a1a2e;
  }
  
  .nav-state {
    border: 1px solid #3d3d5c;
    border-radius: 6px;
    overflow: hidden;
    background: #252542;
  }
  
  .nav-state-header {
    padding: 8px 10px;
    background: #1a1a2e;
    border-bottom: 1px solid #3d3d5c;
  }
  
  .state-label {
    font-weight: 500;
    font-size: 12px;
    color: #f59e0b;
  }
  
  .state-label.none {
    color: #888;
  }
  
  .nav-state-preview {
    background: #333;
    min-height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .nav-state-preview img {
    max-width: 100%;
    max-height: 100px;
    object-fit: contain;
  }
  
  .nav-state-info {
    padding: 8px 10px;
    font-size: 11px;
  }
  
  .nav-items-section {
    border-top: 1px solid #3d3d5c;
    padding: 10px 15px;
  }
  
  .nav-item-row {
    display: flex;
    gap: 10px;
    padding: 5px 0;
    font-size: 12px;
    border-bottom: 1px solid #3d3d5c;
  }
  
  .nav-item-row:last-child {
    border-bottom: none;
  }
  
  .item-index {
    background: #6366f1;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
  }
  
  .item-label {
    font-weight: 500;
  }
  
  .item-action {
    color: #888;
  }
  
  /* Regular Layer Preview — checkerboard shows transparency */
  .layer-preview {
    position: relative;
    min-height: 150px;
    max-height: 300px;
    background-color: #1a1a2e;
    background-image:
      linear-gradient(45deg, #252540 25%, transparent 25%),
      linear-gradient(-45deg, #252540 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #252540 75%),
      linear-gradient(-45deg, transparent 75%, #252540 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  
  .layer-preview img {
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
  }
  
  .preview-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 5px 10px;
    background: rgba(0,0,0,0.7);
    color: white;
    font-size: 11px;
    font-family: monospace;
  }
  
  .native-placeholder {
    padding: 30px;
    text-align: center;
    color: #888;
    background: #1a1a2e;
    width: 100%;
  }
  
  .no-preview {
    padding: 30px;
    color: #666;
  }
  
  .layer-details {
    padding: 10px 15px;
    font-size: 12px;
    background: #1a1a2e;
    border-top: 1px solid #3d3d5c;
  }
  
  .detail-row {
    padding: 3px 0;
    display: flex;
    gap: 8px;
  }
  
  .detail-row .label {
    color: #888;
    min-width: 80px;
  }
  
  .mono {
    font-family: monospace;
    color: #10b981;
  }
  
  .highlight {
    color: #f59e0b;
    font-weight: 600;
  }
  
  .mini-badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 2px;
    margin-left: 4px;
  }
  
  .mini-badge.native { background: #4a90d9; }

  .render-source-link {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #3d3d5c;
  }

  .render-source-link a {
    color: #6C63FF;
    font-size: 12px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .render-source-link a:hover {
    color: #8B85FF;
    text-decoration: underline;
  }

  .render-source-link .text-muted {
    color: #888;
    font-size: 12px;
    font-style: italic;
  }
  
  .widget-info {
    border-top: 1px solid #3d3d5c;
    padding: 10px 15px;
    background: #16213e;
  }

  .widget-config {
    margin-top: 6px;
  }

  .widget-config summary {
    cursor: pointer;
    font-size: 11px;
    color: #f59e0b;
    padding: 4px 0;
  }

  .widget-config summary:hover {
    color: #fbbf24;
  }

  .widget-config pre {
    margin: 4px 0 0 0;
    padding: 8px;
    background: #0d0d1a;
    font-size: 10px;
    overflow-x: auto;
    border-radius: 4px;
    color: #a0a0c0;
  }

  .render-link {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #3d3d5c;
  }

  .render-link a {
    color: #f59e0b;
    font-size: 11px;
    text-decoration: none;
  }

  .render-link a:hover {
    color: #fbbf24;
    text-decoration: underline;
  }

  .element-data {
    border-top: 1px solid #3d3d5c;
  }
  
  .element-data summary {
    padding: 10px 15px;
    cursor: pointer;
    font-size: 12px;
    color: #888;
    background: #1a1a2e;
  }
  
  .element-data summary:hover {
    color: #fff;
  }
  
  .element-data pre {
    margin: 0;
    padding: 10px 15px;
    background: #0d0d1a;
    font-size: 11px;
    overflow-x: auto;
    max-height: 200px;
    color: #10b981;
  }
  
  .raw-data {
    margin-top: 30px;
    border: 1px solid #3d3d5c;
    border-radius: 8px;
    background: #252542;
  }
  
  .raw-data summary {
    padding: 15px;
    cursor: pointer;
    font-weight: 500;
    background: #1a1a2e;
    color: #fff;
  }
  
  .raw-data pre {
    margin: 0;
    padding: 15px;
    font-size: 12px;
    overflow-x: auto;
    max-height: 400px;
    background: #0d0d1a;
    color: #10b981;
  }
</style>
