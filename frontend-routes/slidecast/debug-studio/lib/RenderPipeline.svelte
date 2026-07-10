<script>
  import { onMount, onDestroy } from 'svelte';

  export let castId;
  export let slides = [];

  const API_BASE = '/api/extensions/slidecast';

  // KPI state
  let queueDepth = 0;
  let activeRenders = 0;
  let recentErrors = [];
  let lastFullRender = null;

  // Slide layer status map: index -> { layers, status, loading }
  let slideStatuses = {};

  let pollingInterval = null;
  let fetchingSlides = false;

  // --- Helpers ---

  function relativeTime(ts) {
    if (!ts) return 'unknown';
    const diff = Date.now() - new Date(ts).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  function truncateId(id) {
    if (!id) return '';
    return id.length > 12 ? id.slice(0, 12) + '…' : id;
  }

  // --- Fetch functions ---

  async function fetchRenderStatus() {
    try {
      const res = await fetch(`${API_BASE}/protocol/render-status`);
      if (!res.ok) throw new Error('no render-status endpoint');
      const data = await res.json();
      queueDepth = data.queueSize ?? data.queue_size ?? data.queue?.length ?? 0;
      activeRenders = data.activeCount ?? data.active_count ?? data.active ?? 0;
    } catch {
      // Endpoint may not exist — fall back gracefully
      queueDepth = 0;
      activeRenders = 0;
    }
  }

  async function fetchErrors() {
    try {
      const res = await fetch(`${API_BASE}/render-errors`);
      if (!res.ok) throw new Error('no errors endpoint');
      const data = await res.json();
      recentErrors = Array.isArray(data) ? data : (data.errors ?? []);
    } catch {
      recentErrors = [];
    }
  }

  async function fetchSlideStatus(index) {
    try {
      slideStatuses[index] = { ...(slideStatuses[index] || {}), loading: true };
      slideStatuses = { ...slideStatuses };

      const res = await fetch(`${API_BASE}/protocol/slide-layers/${castId}/${index}`);
      if (!res.ok) throw new Error('failed');
      const data = await res.json();

      const layers = Array.isArray(data.layers) ? data.layers : (data.layers != null ? [] : null);
      const status = data.status ?? (layers != null ? 'cached' : 'unknown');
      const generatedAt = data.generatedAt ?? data.generated_at ?? null;

      // Track most-recent generatedAt across all slides
      if (generatedAt) {
        const t = new Date(generatedAt).getTime();
        if (!lastFullRender || t > new Date(lastFullRender).getTime()) {
          lastFullRender = generatedAt;
        }
      }

      slideStatuses[index] = { layers, status, generatedAt, loading: false };
    } catch {
      slideStatuses[index] = { layers: null, status: 'failed', generatedAt: null, loading: false };
    }
    slideStatuses = { ...slideStatuses };
  }

  async function fetchAllSlides() {
    if (fetchingSlides || !castId || slides.length === 0) return;
    fetchingSlides = true;
    lastFullRender = null;
    await Promise.all(slides.map((_, i) => fetchSlideStatus(i)));
    fetchingSlides = false;
  }

  async function refresh() {
    await Promise.all([fetchRenderStatus(), fetchErrors(), fetchAllSlides()]);
  }

  // --- Actions ---

  async function forceRender(index) {
    slideStatuses[index] = { ...(slideStatuses[index] || {}), loading: true };
    slideStatuses = { ...slideStatuses };
    try {
      await fetch(`${API_BASE}/protocol/slide-layers/${castId}/${index}?force=true`);
    } catch {}
    await fetchSlideStatus(index);
  }

  async function reRenderAll() {
    await Promise.all(slides.map((_, i) => forceRender(i)));
  }

  function clearCache() {
    // Placeholder — no backend endpoint yet
    alert('Clear Cache: no backend endpoint implemented yet.');
  }

  function clearErrors() {
    // Placeholder — no backend endpoint yet
    recentErrors = [];
  }

  // --- Status helpers ---

  function statusColor(status) {
    switch (status) {
      case 'cached': return 'var(--color-success, #22c55e)';
      case 'rendering':
      case 'queued': return 'var(--color-warning, #eab308)';
      case 'failed': return 'var(--color-error, #ef4444)';
      default: return 'var(--color-text-muted, #aaa)';
    }
  }

  function layerCount(s) {
    if (!s || s.loading) return '…';
    if (!s.layers) return '—';
    return s.layers.length;
  }

  // --- Lifecycle ---

  onMount(() => {
    refresh();
    pollingInterval = setInterval(async () => {
      await fetchRenderStatus();
      await fetchErrors();
      // Only re-fetch slide statuses if not already fetching
      if (!fetchingSlides) {
        await fetchAllSlides();
      }
    }, 5000);
  });

  onDestroy(() => {
    if (pollingInterval) clearInterval(pollingInterval);
  });
</script>

<div class="pipeline-root">
  <!-- KPI Cards -->
  <div class="kpi-row">
    <div class="kpi-card" class:kpi-green={queueDepth === 0} class:kpi-yellow={queueDepth > 0}>
      <span class="kpi-number">{queueDepth}</span>
      <span class="kpi-label">Queue Depth</span>
    </div>
    <div class="kpi-card kpi-blue">
      <span class="kpi-number">{activeRenders}</span>
      <span class="kpi-label">Active Renders</span>
    </div>
    <div class="kpi-card" class:kpi-green={recentErrors.length === 0} class:kpi-red={recentErrors.length > 0}>
      <span class="kpi-number">{recentErrors.length}</span>
      <span class="kpi-label">Recent Errors</span>
    </div>
    <div class="kpi-card kpi-neutral">
      <span class="kpi-number kpi-number--sm">{lastFullRender ? relativeTime(lastFullRender) : '—'}</span>
      <span class="kpi-label">Last Full Render</span>
    </div>
  </div>

  <!-- Main content: 2 columns -->
  <div class="content-columns">
    <!-- Left: Slide Render Status table -->
    <div class="col-left">
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Slide Render Status</h2>
          <div class="panel-actions">
            <button class="btn btn-primary" on:click={reRenderAll}>Re-render All Slides</button>
            <button class="btn btn-secondary" on:click={clearCache}>Clear Cache</button>
          </div>
        </div>

        {#if slides.length === 0}
          <div class="empty-state">No slides loaded.</div>
        {:else}
          <div class="table-wrap">
            <table class="slide-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Layers</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {#each slides as slide, i}
                  {@const s = slideStatuses[i]}
                  <tr>
                    <td class="col-num">{i}</td>
                    <td class="col-name">{slide.name || 'Untitled'}</td>
                    <td class="col-layers">{layerCount(s)}</td>
                    <td class="col-status">
                      {#if s?.loading}
                        <span class="status-text" style="color: var(--color-text-muted, #aaa)">loading…</span>
                      {:else}
                        <span class="status-text" style="color: {statusColor(s?.status)}">
                          {s?.status ?? 'unknown'}
                        </span>
                      {/if}
                    </td>
                    <td class="col-action">
                      {#if s?.status === 'failed'}
                        <button class="btn btn-danger btn-sm" on:click={() => forceRender(i)} disabled={s?.loading}>
                          Retry
                        </button>
                      {:else}
                        <button class="btn btn-secondary btn-sm" on:click={() => forceRender(i)} disabled={s?.loading}>
                          Force
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>

    <!-- Right: Recent Errors -->
    <div class="col-right">
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Recent Errors</h2>
          <button class="btn btn-secondary" on:click={clearErrors}>Clear Errors</button>
        </div>

        {#if recentErrors.length === 0}
          <div class="empty-state empty-state--good">No errors. All clear.</div>
        {:else}
          <div class="error-list">
            {#each recentErrors as err}
              <div class="error-item">
                <div class="error-meta">
                  <span class="error-source">
                    {err.elementType ?? err.type ?? 'unknown'} · {truncateId(err.id ?? err.elementId ?? '')}
                  </span>
                  <span class="error-time">{relativeTime(err.timestamp ?? err.ts ?? err.createdAt)}</span>
                </div>
                <pre class="error-message">{err.message ?? err.error ?? JSON.stringify(err)}</pre>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .pipeline-root {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* KPI Cards */
  .kpi-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .kpi-card {
    flex: 1;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border, #3d3d5c);
    background: var(--color-surface-raised, #252542);
    gap: 6px;
  }

  .kpi-number {
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
  }

  .kpi-number--sm {
    font-size: 22px;
  }

  .kpi-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted, #aaa);
    text-align: center;
  }

  /* KPI color variants */
  .kpi-green .kpi-number { color: #22c55e; }
  .kpi-green { border-color: #166534; }

  .kpi-yellow .kpi-number { color: #eab308; }
  .kpi-yellow { border-color: #713f12; }

  .kpi-red .kpi-number { color: #ef4444; }
  .kpi-red { border-color: #7f1d1d; }

  .kpi-blue .kpi-number { color: #60a5fa; }
  .kpi-blue { border-color: #1e3a5f; }

  .kpi-neutral .kpi-number { color: var(--color-text, #e0e0e0); }

  /* Two-column layout */
  .content-columns {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  .col-left {
    flex: 2;
    min-width: 0;
  }

  .col-right {
    flex: 1;
    min-width: 260px;
  }

  /* Panel */
  .panel {
    background: var(--color-surface-raised, #252542);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border, #3d3d5c);
    background: var(--color-surface, #1a1a2e);
  }

  .panel-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text, #e0e0e0);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .panel-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
  }

  .slide-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .slide-table th {
    padding: 10px 12px;
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted, #aaa);
    border-bottom: 1px solid var(--color-border, #3d3d5c);
    white-space: nowrap;
  }

  .slide-table td {
    padding: 9px 12px;
    border-bottom: 1px solid rgba(61, 61, 92, 0.4);
    vertical-align: middle;
  }

  .slide-table tr:last-child td {
    border-bottom: none;
  }

  .slide-table tr:hover td {
    background: rgba(255, 255, 255, 0.03);
  }

  .col-num {
    width: 36px;
    color: var(--color-text-muted, #aaa);
    font-variant-numeric: tabular-nums;
  }

  .col-name {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text, #e0e0e0);
  }

  .col-layers {
    width: 60px;
    text-align: center;
    color: var(--color-text-muted, #ccc);
    font-variant-numeric: tabular-nums;
  }

  .col-status {
    width: 100px;
  }

  .col-action {
    width: 80px;
    text-align: right;
  }

  .status-text {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Empty state */
  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--color-text-muted, #aaa);
    font-size: 14px;
  }

  .empty-state--good {
    color: #22c55e;
  }

  /* Buttons */
  .btn {
    padding: 7px 14px;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;
  }

  .btn-primary {
    background: var(--color-primary, #6366f1);
    color: #fff;
    border-color: var(--color-primary, #6366f1);
  }

  .btn-primary:hover:not(:disabled) {
    background: #4f52d8;
  }

  .btn-secondary {
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text-muted, #ccc);
    border-color: var(--color-border, #3d3d5c);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-surface-raised, #252542);
    color: var(--color-text, #e0e0e0);
  }

  .btn-danger {
    background: #7f1d1d;
    color: #fca5a5;
    border-color: #991b1b;
  }

  .btn-danger:hover:not(:disabled) {
    background: #991b1b;
    color: #fff;
  }

  /* Error list */
  .error-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .error-item {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(61, 61, 92, 0.4);
  }

  .error-item:last-child {
    border-bottom: none;
  }

  .error-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    gap: 8px;
  }

  .error-source {
    font-size: 12px;
    font-weight: 600;
    color: #f87171;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-time {
    font-size: 11px;
    color: var(--color-text-muted, #aaa);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .error-message {
    margin: 0;
    font-size: 11px;
    font-family: 'Fira Mono', 'Cascadia Code', 'Consolas', monospace;
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.25);
    border: 1px solid rgba(153, 27, 27, 0.4);
    border-radius: 4px;
    padding: 6px 8px;
    white-space: pre-wrap;
    word-break: break-all;
    overflow: hidden;
    max-height: 80px;
    overflow-y: auto;
  }
</style>
