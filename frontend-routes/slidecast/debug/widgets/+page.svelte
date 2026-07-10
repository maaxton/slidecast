<script>
  // Active-Widgets Debug Page (#1117)
  //
  // Lists every widget instance currently in active use — i.e. on a slide in
  // a cast that is playing on ≥1 online screen. For each instance, shows:
  //   • identity (widget uuid, cast, slide, screen)
  //   • configured refresh interval
  //   • last-refresh timestamp
  //   • refresh-health badge (green/yellow/red)
  //   • link to the underlying scheduler job (per-widget micro-job, #1134)
  import { onMount, onDestroy } from 'svelte';

  const API_BASE = '/api/extensions/slidecast';
  const POLL_INTERVAL_MS = 5000;

  let widgets = [];
  let intervalMs = 60000;
  let nowTs = Date.now();
  let loading = true;
  let error = null;
  let note = null;
  let pollTimer = null;

  onMount(() => {
    load();
    pollTimer = setInterval(load, POLL_INTERVAL_MS);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/debug/widgets`);
      const data = await res.json();
      if (!data.success) {
        error = data.error || 'Failed to load active widgets';
        return;
      }
      widgets = data.widgets || [];
      intervalMs = data.interval_ms || 60000;
      nowTs = data.now_ts || Date.now();
      note = data.note || null;
      error = null;
    } catch (err) {
      error = 'Failed to load active widgets: ' + err.message;
    } finally {
      loading = false;
    }
  }

  function formatAge(ms) {
    if (ms === null || ms === undefined) return 'never';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }

  function formatTs(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString();
  }

  // ISO timestamp → "2m ago" / "just now" / absolute fallback (#1142).
  // Accepts ISO string (image_created_at) OR a numeric ms timestamp.
  function formatCreatedAt(value) {
    if (!value) return '—';
    const ms = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isNaN(ms)) return '—';
    const diff = nowTs - ms;
    let rel;
    if (diff < 0) rel = 'in the future';
    else if (diff < 1000) rel = 'just now';
    else if (diff < 60_000) rel = `${Math.round(diff / 1000)}s ago`;
    else if (diff < 3_600_000) rel = `${Math.round(diff / 60_000)}m ago`;
    else if (diff < 86_400_000) rel = `${Math.round(diff / 3_600_000)}h ago`;
    else rel = `${Math.round(diff / 86_400_000)}d ago`;
    return `${new Date(ms).toLocaleTimeString()} (${rel})`;
  }

  function healthColor(h) {
    if (h === 'green') return '#2ea043';
    if (h === 'yellow') return '#d29922';
    return '#da3633';
  }

  function jobLink(jobId) {
    if (jobId === null || jobId === undefined) return null;
    return `/system/jobs?job=${jobId}`;
  }
</script>

<svelte:head>
  <title>Slidecast · Active Widgets</title>
</svelte:head>

<main>
  <header>
    <h1>Active Widgets</h1>
    <p class="subtitle">
      Every widget currently in use on a slideshow playing on ≥1 online screen.
      Auto-refreshes every {POLL_INTERVAL_MS / 1000}s.
    </p>
    <nav>
      <a href="/ext/slidecast/debug">← Slide Layer Debug</a>
    </nav>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if widgets.length === 0}
    <p class="empty">{note || 'No widgets currently active.'}</p>
  {:else}
    <div class="summary">
      <span>{widgets.length} widget instance{widgets.length === 1 ? '' : 's'}</span>
      <span>·</span>
      <span>{widgets.filter(w => w.health === 'red').length} red</span>
      <span>·</span>
      <span>{widgets.filter(w => w.health === 'yellow').length} yellow</span>
      <span>·</span>
      <span>{widgets.filter(w => w.health === 'green').length} green</span>
      <span>·</span>
      <span>interval {intervalMs / 1000}s</span>
    </div>

    <table>
      <thead>
        <tr>
          <th>Health</th>
          <th>Widget</th>
          <th>Screen</th>
          <th>Cast / Slide</th>
          <th>Interval</th>
          <th>Last refresh</th>
          <th>Image created</th>
          <th>Age</th>
          <th>Preview</th>
          <th>Job</th>
        </tr>
      </thead>
      <tbody>
        {#each widgets as w (w.screen_serial + ':' + w.cast_id + ':' + w.slide_idx + ':' + w.widget_uuid)}
          <tr>
            <td>
              <span class="dot" style="background:{healthColor(w.health)}"></span>
              {w.health}
            </td>
            <td>
              <div class="widget-name">{w.widget_name || '(unnamed)'}</div>
              <div class="mono small">{w.widget_uuid}</div>
            </td>
            <td>
              <div>{w.screen_name || '(unnamed)'}</div>
              <div class="mono small">{w.screen_serial}</div>
            </td>
            <td>
              <div>{w.cast_name || '(unnamed)'}</div>
              <div class="mono small">slide {w.slide_idx ?? '?'}</div>
            </td>
            <td>{w.interval_ms / 1000}s</td>
            <td>{formatTs(w.last_refresh_ts)}</td>
            <td class="small">{formatCreatedAt(w.image_created_at)}</td>
            <td>{formatAge(w.age_ms)}</td>
            <td>
              {#if w.image_url}
                <a href={w.image_url} target="_blank" rel="noopener">PNG ↗</a>
              {:else}
                <span class="muted">no file</span>
              {/if}
            </td>
            <td>
              {#if w.job_id !== null && w.job_id !== undefined}
                <a href={jobLink(w.job_id)}>#{w.job_id}</a>
              {:else}
                —
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</main>

<style>
  main {
    padding: 1.5rem 2rem;
    font-family: system-ui, sans-serif;
    max-width: 1400px;
  }
  header { margin-bottom: 1.25rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
  .subtitle { color: #888; margin: 0 0 0.5rem; font-size: 0.9rem; }
  nav { font-size: 0.85rem; }
  nav a { color: #58a6ff; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  .summary {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    color: #999;
    align-items: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th, td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #2a2a2a;
    vertical-align: top;
  }
  th {
    font-weight: 600;
    color: #ccc;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .dot {
    display: inline-block;
    width: 10px; height: 10px;
    border-radius: 50%;
    margin-right: 0.4rem;
    vertical-align: middle;
  }
  .widget-name { font-weight: 500; }
  .mono { font-family: ui-monospace, Menlo, monospace; }
  .small { font-size: 0.75rem; color: #777; }
  .error { color: #da3633; }
  .empty { color: #888; font-style: italic; }
  .muted { color: #777; font-size: 0.8rem; font-style: italic; }
  a { color: #58a6ff; }
</style>
