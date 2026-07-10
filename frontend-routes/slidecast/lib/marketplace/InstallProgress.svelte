<script>
  /**
   * InstallProgress — per-extension status list for the wizard's install step.
   *
   * Mirrors the backend batch phases (spec §4b):
   *   pending → downloading → verifying → installing_deps → activating →
   *   health_check → installed | failed
   *
   * Props:
   *   entries — [{ name, displayName?, phase, error? }]
   * Events:
   *   retry   — { name } when a failed row's Retry is clicked
   */
  import { createEventDispatcher } from 'svelte';
  import { Spinner } from '$lib/extension-components.js';

  export let entries = [];

  const dispatch = createEventDispatcher();

  const PHASE_LABELS = {
    pending: 'Waiting…',
    queued: 'Queued…',
    downloading: 'Downloading…',
    verifying: 'Verifying integrity…',
    installing: 'Installing…',
    installing_deps: 'Installing dependencies…',
    activating: 'Activating…',
    health_check: 'Running health check…',
    installed: 'Installed',
    failed: 'Failed',
    skipped: 'Skipped',
  };

  const PHASE_PERCENT = {
    pending: 6,
    queued: 6,
    downloading: 25,
    verifying: 45,
    installing: 55,
    installing_deps: 65,
    activating: 80,
    health_check: 92,
    installed: 100,
    failed: 100,
    skipped: 100,
  };

  function label(phase) {
    return PHASE_LABELS[phase] || 'Waiting…';
  }

  function percent(phase) {
    return PHASE_PERCENT[phase] ?? 0;
  }

  function isFailed(phase) {
    return phase === 'failed';
  }

  function isDone(phase) {
    return phase === 'installed';
  }

  function isSkipped(phase) {
    return phase === 'skipped';
  }

  function isBusy(phase) {
    return !isFailed(phase) && !isDone(phase) && !isSkipped(phase);
  }

  function retry(name) {
    dispatch('retry', { name });
  }
</script>

<ul class="install-progress">
  {#each entries as entry (entry.name)}
    <li class="ip-row" class:failed={isFailed(entry.phase)} class:done={isDone(entry.phase)} class:skipped={isSkipped(entry.phase)}>
      <div class="ip-icon">
        {#if isDone(entry.phase)}
          <span class="ip-glyph done">✓</span>
        {:else if isFailed(entry.phase)}
          <span class="ip-glyph failed">!</span>
        {:else if isSkipped(entry.phase)}
          <span class="ip-glyph skipped">–</span>
        {:else}
          <Spinner size="sm" />
        {/if}
      </div>

      <div class="ip-main">
        <div class="ip-head">
          <span class="ip-name">{entry.displayName || entry.name}</span>
          <span class="ip-phase" class:failed={isFailed(entry.phase)}>{label(entry.phase)}</span>
        </div>
        <div class="ip-track">
          <div
            class="ip-fill"
            class:failed={isFailed(entry.phase)}
            class:done={isDone(entry.phase)}
            class:skipped={isSkipped(entry.phase)}
            class:busy={isBusy(entry.phase)}
            style="width: {percent(entry.phase)}%"
          ></div>
        </div>
        {#if isFailed(entry.phase) && entry.error}
          <p class="ip-error">{entry.error}</p>
        {/if}
      </div>

      {#if isFailed(entry.phase)}
        <button type="button" class="ip-retry" on:click={() => retry(entry.name)}>
          Retry
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .install-progress {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jewel-space-md, 1rem);
  }

  .ip-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--jewel-space-md, 1rem);
    padding: var(--jewel-space-md, 1rem);
    border: 1px solid rgb(var(--color-border));
    border-radius: var(--radius-lg, 0.5rem);
    background: rgb(var(--color-surface));
  }

  .ip-row.failed {
    border-color: rgb(var(--color-error));
  }

  .ip-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
  }

  .ip-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    color: white;
    font-weight: 700;
    font-size: 0.9rem;
    line-height: 1;
  }

  .ip-glyph.done {
    background: rgb(var(--color-success));
  }

  .ip-glyph.failed {
    background: rgb(var(--color-error));
  }

  .ip-glyph.skipped {
    background: rgb(var(--color-text-tertiary));
  }

  .ip-row.skipped {
    opacity: 0.75;
  }

  .ip-main {
    min-width: 0;
  }

  .ip-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--jewel-space-sm, 0.5rem);
    margin-bottom: 0.4rem;
  }

  .ip-name {
    font-weight: 600;
    color: rgb(var(--color-text));
  }

  .ip-phase {
    font-size: var(--jewel-font-size-xs, 0.75rem);
    color: rgb(var(--color-text-secondary));
    white-space: nowrap;
  }

  .ip-phase.failed {
    color: rgb(var(--color-error));
  }

  .ip-track {
    width: 100%;
    height: 6px;
    border-radius: var(--radius-full, 9999px);
    background: rgb(var(--color-surface-hover));
    overflow: hidden;
  }

  .ip-fill {
    height: 100%;
    border-radius: var(--radius-full, 9999px);
    transition: width var(--transition-slow, 300ms ease);
    background: rgb(var(--color-primary));
  }

  .ip-fill.done {
    background: rgb(var(--color-success));
  }

  .ip-fill.failed {
    background: rgb(var(--color-error));
  }

  .ip-fill.skipped {
    background: rgb(var(--color-text-tertiary));
  }

  .ip-fill.busy {
    background: rgb(var(--color-primary));
  }

  .ip-error {
    margin: 0.5rem 0 0;
    font-size: var(--jewel-font-size-xs, 0.75rem);
    color: rgb(var(--color-error));
    word-break: break-word;
  }

  .ip-retry {
    padding: 0.4rem 0.9rem;
    border: 1px solid rgb(var(--color-error));
    border-radius: var(--radius-lg, 0.5rem);
    background: transparent;
    color: rgb(var(--color-error));
    font-size: var(--jewel-font-size-sm, 0.875rem);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-base, 200ms ease);
    white-space: nowrap;
  }

  .ip-retry:hover {
    background: rgb(var(--color-error));
    color: white;
  }
</style>
