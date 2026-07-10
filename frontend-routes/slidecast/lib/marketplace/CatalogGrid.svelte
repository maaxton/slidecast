<script>
  /**
   * CatalogGrid — lays out selectable catalog cards grouped by category.
   *
   * Props:
   *   extensions — annotated catalog entries (GET /api/catalog)
   *   selected   — Set<string> of picked extension names
   * Events:
   *   toggle     — re-dispatched { name } from a card
   */
  import { createEventDispatcher } from 'svelte';
  import CatalogCard from './CatalogCard.svelte';

  export let extensions = [];
  export let selected = new Set();

  const dispatch = createEventDispatcher();

  $: groups = groupByCategory(extensions);

  function groupByCategory(list) {
    const map = new Map();
    for (const ext of Array.isArray(list) ? list : []) {
      const category = ext.category || 'Other';
      if (!map.has(category)) map.set(category, []);
      map.get(category).push(ext);
    }
    // Recommended-heavy / general categories first, then alphabetical.
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function handleToggle(event) {
    dispatch('toggle', event.detail);
  }
</script>

<div class="catalog-grid-root">
  {#each groups as [category, items] (category)}
    <section class="catalog-group">
      <h2 class="catalog-group-title">{category}</h2>
      <div class="catalog-grid">
        {#each items as ext (ext.name)}
          <CatalogCard
            extension={ext}
            selected={selected.has(ext.name)}
            on:toggle={handleToggle}
          />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .catalog-grid-root {
    display: flex;
    flex-direction: column;
    gap: var(--jewel-space-xl, 2rem);
  }

  .catalog-group-title {
    font-size: var(--jewel-font-size-sm, 0.875rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(var(--color-text-secondary));
    margin: 0 0 var(--jewel-space-md, 1rem);
  }

  .catalog-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--jewel-space-md, 1rem);
  }

  @media (min-width: 720px) {
    .catalog-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
