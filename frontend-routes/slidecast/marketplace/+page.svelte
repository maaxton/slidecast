<script>
  /**
   * Slidecast Marketplace — browse + batch-install content packs (casts &
   * templates) from the slidecast content catalog. A hub sub-route, reached from
   * the "Marketplace" button on the slidecast dashboard.
   *
   * Reuses the copied CatalogGrid/CatalogCard/InstallProgress (in ../lib/marketplace).
   * Install-drive: POST /marketplace/jobs → poll GET /marketplace/jobs/:jobId
   * (the slidecast frontend has no WS channel; the server still emits
   * content:job_* WS events for any future subscriber). InstallProgress renders
   * the live per-item phases in a modal.
   */
  import { onMount, onDestroy } from 'svelte';
  import CatalogGrid from '../lib/marketplace/CatalogGrid.svelte';
  import InstallProgress from '../lib/marketplace/InstallProgress.svelte';

  const API = '/api/extensions/slidecast/marketplace';

  const KINDS = [
    { key: 'cast', label: 'Content' },
    { key: 'template', label: 'Templates' },
    { key: 'widget', label: 'Widgets' },
  ];

  const EMPTY_NOUN = { cast: 'content packs', template: 'templates', widget: 'widgets' };

  let activeKind = 'cast';
  let entries = [];
  let loading = true;
  let error = null;
  let selected = new Set();

  // Install job state
  let showProgress = false;
  let installing = false;
  let jobId = null;
  let progressEntries = [];
  let pollTimer = null;

  // Toasts (self-contained, mirrors the hub)
  let toasts = [];
  let toastId = 0;
  function showToast(message, type = 'info', duration = 3000) {
    const id = ++toastId;
    toasts = [...toasts, { id, message, type }];
    setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, duration);
  }

  function goto(path) { window.location.href = path; }

  onMount(loadCatalog);
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

  async function loadCatalog() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`${API}/catalog?kind=${activeKind}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        entries = data.items || [];
      } else {
        error = data.error || 'Failed to load catalog';
        entries = [];
      }
    } catch (err) {
      error = err.message;
      entries = [];
    } finally {
      loading = false;
    }
  }

  function selectKind(kind) {
    if (kind === activeKind) return;
    activeKind = kind;
    selected = new Set();
    loadCatalog();
  }

  function handleToggle(event) {
    const { name } = event.detail;
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    selected = next;
  }

  function displayNameFor(id) {
    const e = entries.find((x) => x.name === id);
    return (e && (e.displayName || e.name)) || id;
  }

  async function install() {
    if (selected.size === 0) return;
    const items = [...selected].map((id) => {
      const entry = entries.find((e) => e.name === id);
      return { kind: (entry && entry.kind) || activeKind, id };
    });

    installing = true;
    showProgress = true;
    progressEntries = items.map((it) => ({ name: it.id, displayName: displayNameFor(it.id), phase: 'queued' }));

    try {
      const res = await fetch(`${API}/jobs`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!data.success || !data.jobId) {
        throw new Error(data.error || 'Failed to start install');
      }
      jobId = data.jobId;
      startPolling();
    } catch (err) {
      installing = false;
      showToast(err.message || 'Install failed', 'error');
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollJob, 800);
    pollJob();
  }

  async function pollJob() {
    if (!jobId) return;
    try {
      const res = await fetch(`${API}/jobs/${jobId}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) return;
      progressEntries = (data.items || []).map((it) => ({
        name: it.name,
        displayName: displayNameFor(it.id || it.name),
        phase: it.phase,
        error: it.error,
      }));
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        installing = false;
        const s = data.summary || {};
        if (s.failed > 0) {
          showToast(`${s.installed} installed, ${s.failed} failed`, 'error', 4000);
        } else {
          showToast(`${s.installed} installed`, 'success');
        }
        // Refresh the catalog so installed items annotate correctly.
        selected = new Set();
        loadCatalog();
      }
    } catch {
      // transient — keep polling
    }
  }

  function retry(event) {
    const { name } = event.detail;
    const entry = entries.find((e) => e.name === name);
    // Re-run a single-item job (server install is idempotent).
    const items = [{ kind: (entry && entry.kind) || activeKind, id: name }];
    fetch(`${API}/jobs`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.jobId) {
          jobId = data.jobId;
          installing = true;
          startPolling();
        }
      })
      .catch(() => showToast('Retry failed', 'error'));
  }

  function closeProgress() {
    if (installing) return;
    showProgress = false;
    progressEntries = [];
    jobId = null;
  }
</script>

<div class="marketplace">
  <div class="page-header">
    <div class="header-left">
      <button class="btn btn-ghost" on:click={() => goto('/ext/slidecast')} aria-label="Back to dashboard">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div>
        <h1>Marketplace</h1>
        <p>Install ready-made casts, templates, and widgets</p>
      </div>
    </div>
    <div class="header-actions">
      <button
        class="btn btn-primary"
        disabled={selected.size === 0 || installing}
        on:click={install}
      >
        Install{selected.size > 0 ? ` (${selected.size})` : ''}
      </button>
    </div>
  </div>

  <div class="kind-tabs" role="tablist">
    {#each KINDS as kind}
      <button
        class="kind-tab"
        class:active={activeKind === kind.key}
        role="tab"
        aria-selected={activeKind === kind.key}
        on:click={() => selectKind(kind.key)}
      >
        {kind.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="loading"><div class="spinner"></div><span>Loading marketplace…</span></div>
  {:else if error}
    <div class="empty-state">
      <h3>Could not load the marketplace</h3>
      <p>{error}</p>
      <button class="btn btn-secondary" on:click={loadCatalog}>Retry</button>
    </div>
  {:else if entries.length === 0}
    <div class="empty-state">
      <h3>Nothing here yet</h3>
      <p>No {EMPTY_NOUN[activeKind] || 'items'} are published in the catalog.</p>
    </div>
  {:else}
    <CatalogGrid extensions={entries} {selected} on:toggle={handleToggle} />
  {/if}
</div>

{#if showProgress}
  <div class="modal-overlay" on:click={closeProgress}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Installing</h2>
        {#if !installing}
          <button class="close-btn" on:click={closeProgress}>×</button>
        {/if}
      </div>
      <div class="modal-body">
        <InstallProgress entries={progressEntries} on:retry={retry} />
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" disabled={installing} on:click={closeProgress}>
          {installing ? 'Installing…' : 'Done'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if toasts.length > 0}
  <div class="toast-container">
    {#each toasts as toast (toast.id)}
      <div class="toast toast-{toast.type}">{toast.message}</div>
    {/each}
  </div>
{/if}

<style>
  .marketplace {
    padding: var(--jewel-space-xl, 2rem);
    max-width: 1100px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-left h1 {
    margin: 0;
    font-size: 1.5rem;
    color: rgb(var(--color-text));
  }

  .header-left p {
    margin: 0.15rem 0 0;
    color: rgb(var(--color-text-secondary));
    font-size: 0.9rem;
  }

  .kind-tabs {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: rgb(var(--color-surface-hover));
    border-radius: var(--radius-lg, 0.5rem);
    margin-bottom: 1.5rem;
  }

  .kind-tab {
    padding: 0.45rem 1.1rem;
    border: none;
    background: transparent;
    color: rgb(var(--color-text-secondary));
    font-weight: 600;
    font-size: 0.9rem;
    border-radius: var(--radius-md, 0.375rem);
    cursor: pointer;
    transition: all 150ms ease;
  }

  .kind-tab.active {
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    box-shadow: var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.08));
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-lg, 0.5rem);
    border: 1px solid rgb(var(--color-border));
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .btn-primary {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
    color: white;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-ghost {
    border-color: transparent;
    background: transparent;
    padding: 0.4rem;
  }

  .loading,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: rgb(var(--color-text-secondary));
    text-align: center;
  }

  .empty-state h3 {
    margin: 0;
    color: rgb(var(--color-text));
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    background: rgb(var(--color-surface));
    border-radius: var(--radius-2xl, 1rem);
    width: 100%;
    max-width: 560px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg, 0 10px 30px rgb(0 0 0 / 0.25));
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .modal-header h2 { margin: 0; font-size: 1.15rem; color: rgb(var(--color-text)); }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 1.5rem;
    line-height: 1;
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
  }

  .modal-body { padding: 1.5rem; overflow-y: auto; }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgb(var(--color-border));
  }

  .toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 1100;
  }

  .toast {
    padding: 0.75rem 1.1rem;
    border-radius: var(--radius-lg, 0.5rem);
    color: white;
    font-size: 0.9rem;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
    background: rgb(var(--color-primary));
  }

  .toast-success { background: rgb(var(--color-success)); }
  .toast-error { background: rgb(var(--color-error)); }
</style>
