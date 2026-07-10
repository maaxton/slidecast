<script>
  /**
   * CatalogCard — one selectable extension in the first-boot wizard.
   *
   * Renders icon / displayName / description / category + version + size, a
   * "Recommended" badge, and a select toggle. Incompatible entries (and ones
   * already installed) are shown disabled with the reason surfaced. The whole
   * card is a checkbox: click / Enter / Space toggles selection.
   *
   * Props:
   *   extension — an annotated catalog entry from GET /api/catalog
   *   selected  — whether this entry is currently picked
   * Events:
   *   toggle    — { name } when the user selects/deselects (compatible only)
   */
  import { createEventDispatcher } from 'svelte';
  import { Badge } from '$lib/extension-components.js';

  export let extension;
  export let selected = false;

  const dispatch = createEventDispatcher();

  $: installed = !!(extension && extension.installedVersion);
  $: compatible = !!extension && extension.compatible !== false;
  // Widget trust state (Phase 2 = first-party only). A widget that ships executing
  // code from a non-first-party source is blocked (community server_code runs
  // in-core; unlocked in Phase 3 once the isolation host adopts widget-hosting).
  $: isWidget = !!extension && extension.kind === 'widget';
  $: firstParty = isWidget && extension.trust === 'first-party';
  $: blocked = isWidget && !!extension.executesCode && extension.trust !== 'first-party';
  $: selectable = compatible && !installed && !blocked;
  $: displayName = (extension && (extension.displayName || extension.name)) || 'Extension';
  $: version = (extension && (extension.latestCompatibleVersion || extension.installedVersion)) || null;
  $: sizeLabel = formatSize(resolveSize(extension));

  function resolveSize(ext) {
    if (!ext) return null;
    const versions = Array.isArray(ext.versions) ? ext.versions : [];
    const match = versions.find((v) => v.version === ext.latestCompatibleVersion) || versions[0];
    return (match && match.size) || ext.size || null;
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function toggle() {
    if (!selectable) return;
    dispatch('toggle', { name: extension.name });
  }

  function onKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  }
</script>

<div
  class="catalog-card"
  class:selected
  class:disabled={!selectable}
  role="checkbox"
  aria-checked={selected}
  aria-disabled={!selectable}
  aria-label={displayName}
  tabindex={selectable ? 0 : -1}
  on:click={toggle}
  on:keydown={onKeydown}
>
  <div class="cc-select" aria-hidden="true">
    {#if installed}
      <span class="cc-box cc-box-installed">✓</span>
    {:else}
      <span class="cc-box" class:checked={selected}>{#if selected}✓{/if}</span>
    {/if}
  </div>

  <div class="cc-icon">
    {#if extension && extension.icon}
      <img src={extension.icon} alt="" />
    {:else}
      <span class="cc-icon-fallback">{displayName.charAt(0).toUpperCase()}</span>
    {/if}
  </div>

  <div class="cc-body">
    <div class="cc-head">
      <span class="cc-name">{displayName}</span>
      {#if extension && extension.recommended}
        <Badge variant="primary" size="sm">Recommended</Badge>
      {/if}
      {#if firstParty}
        <Badge variant="success" size="sm">First-party</Badge>
      {/if}
    </div>

    {#if extension && extension.description}
      <p class="cc-desc">{extension.description}</p>
    {/if}

    <div class="cc-meta">
      {#if extension && extension.category}
        <span class="cc-chip">{extension.category}</span>
      {/if}
      {#if version}<span class="cc-dim">v{version}</span>{/if}
      {#if sizeLabel}<span class="cc-dim">{sizeLabel}</span>{/if}
    </div>

    {#if installed}
      <p class="cc-note installed">Already installed</p>
    {:else if blocked}
      <p class="cc-note incompatible">
        Community widget — ships executing code that runs in-core. Blocked until it is first-party / allowlisted.
      </p>
    {:else if !compatible}
      <p class="cc-note incompatible">
        {(extension && extension.incompatibleReason) || 'Not compatible with this system'}
      </p>
    {/if}
  </div>
</div>

<style>
  .catalog-card {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: var(--jewel-space-md, 1rem);
    align-items: start;
    padding: var(--jewel-space-lg, 1.5rem);
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: var(--radius-2xl, 1rem);
    cursor: pointer;
    transition: border-color var(--transition-base, 200ms ease),
      box-shadow var(--transition-base, 200ms ease),
      transform var(--transition-base, 200ms ease);
    text-align: left;
  }

  .catalog-card:hover:not(.disabled) {
    border-color: rgb(var(--color-primary));
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
    transform: translateY(-2px);
  }

  .catalog-card:focus-visible {
    outline: 2px solid rgb(var(--color-primary));
    outline-offset: 2px;
  }

  .catalog-card.selected {
    border-color: rgb(var(--color-primary));
    background: rgb(var(--color-primary) / 0.06);
    box-shadow: 0 0 0 1px rgb(var(--color-primary));
  }

  .catalog-card.disabled {
    cursor: default;
    opacity: 0.62;
  }

  .cc-select {
    padding-top: 2px;
  }

  .cc-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    border: 2px solid rgb(var(--color-border));
    border-radius: var(--radius-md, 0.375rem);
    color: white;
    font-size: 0.85rem;
    line-height: 1;
    background: rgb(var(--color-surface));
    transition: background var(--transition-base, 200ms ease),
      border-color var(--transition-base, 200ms ease);
  }

  .cc-box.checked {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
  }

  .cc-box-installed {
    background: rgb(var(--color-success));
    border-color: rgb(var(--color-success));
  }

  .cc-icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-lg, 0.5rem);
    overflow: hidden;
    background: rgb(var(--color-surface-hover));
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cc-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .cc-icon-fallback {
    font-size: 1.25rem;
    font-weight: 700;
    color: rgb(var(--color-primary));
  }

  .cc-body {
    min-width: 0;
  }

  .cc-head {
    display: flex;
    align-items: center;
    gap: var(--jewel-space-sm, 0.5rem);
    flex-wrap: wrap;
  }

  .cc-name {
    font-weight: 600;
    font-size: var(--jewel-font-size-base, 1rem);
    color: rgb(var(--color-text));
  }

  .cc-desc {
    margin: 0.35rem 0 0;
    font-size: var(--jewel-font-size-sm, 0.875rem);
    color: rgb(var(--color-text-secondary));
    line-height: 1.45;
  }

  .cc-meta {
    display: flex;
    align-items: center;
    gap: var(--jewel-space-sm, 0.5rem);
    flex-wrap: wrap;
    margin-top: 0.6rem;
    font-size: var(--jewel-font-size-xs, 0.75rem);
  }

  .cc-chip {
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-full, 9999px);
    background: rgb(var(--color-surface-hover));
    color: rgb(var(--color-text-secondary));
    font-weight: 500;
  }

  .cc-dim {
    color: rgb(var(--color-text-secondary));
  }

  .cc-note {
    margin: 0.6rem 0 0;
    font-size: var(--jewel-font-size-xs, 0.75rem);
  }

  .cc-note.installed {
    color: rgb(var(--color-success));
  }

  .cc-note.incompatible {
    color: rgb(var(--color-warning));
  }
</style>
