<script>
  import { onMount } from 'svelte';
  import LayerInspector from './lib/LayerInspector.svelte';
  import RenderPipeline from './lib/RenderPipeline.svelte';
  import ScreenPreview from './lib/ScreenPreview.svelte';

  const API_BASE = '/api/extensions/slidecast';

  let castId = null;
  let slideIndex = 0;
  let cast = null;
  let slides = [];
  let loading = false;
  let error = null;
  let activeTab = 'layers';

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    castId = params.get('cast');
    slideIndex = parseInt(params.get('slide') || '0');

    if (castId) {
      await loadCast();
    } else {
      error = 'No cast ID provided. Use ?cast=<castId> in the URL.';
    }
  });

  async function loadCast() {
    loading = true;
    error = null;

    try {
      const res = await fetch(`${API_BASE}/casts/${castId}`);
      const data = await res.json();

      if (!data.cast) {
        error = 'Cast not found.';
        return;
      }

      cast = data.cast;

      // Flatten slides from groups
      slides = [];
      const groups = cast.definition?.groups || [];
      for (const group of groups) {
        for (const slide of (group.slides || [])) {
          slides.push({
            ...slide,
            groupName: group.name,
            groupId: group.id
          });
        }
      }

      // Clamp slideIndex to valid range
      if (slideIndex >= slides.length) {
        slideIndex = 0;
      }
    } catch (err) {
      error = 'Failed to load cast: ' + err.message;
    } finally {
      loading = false;
    }
  }

  async function onSlideChange() {
    // Update URL without page reload
    const url = new URL(window.location.href);
    url.searchParams.set('slide', slideIndex);
    window.history.replaceState({}, '', url.toString());
  }

  function setTab(tab) {
    activeTab = tab;
  }
</script>

<div class="studio-container">
  <!-- Header -->
  <div class="studio-header">
    <div class="header-left">
      <h1 class="studio-title">Debug Studio</h1>
      {#if cast}
        <span class="cast-name">Cast: {cast.name}</span>
      {:else if loading}
        <span class="cast-name loading">Loading...</span>
      {/if}
    </div>

    {#if slides.length > 0}
      <div class="slide-selector">
        <select bind:value={slideIndex} on:change={onSlideChange}>
          {#each slides as slide, i}
            <option value={i}>
              Slide {i}: {slide.name || 'Untitled'} ({slide.groupName})
            </option>
          {/each}
        </select>
      </div>
    {/if}
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <!-- Tab Bar -->
  <div class="tab-bar">
    <button
      class="tab-btn"
      class:active={activeTab === 'layers'}
      on:click={() => setTab('layers')}
    >
      Layer Inspector
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'pipeline'}
      on:click={() => setTab('pipeline')}
    >
      Render Pipeline
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'preview'}
      on:click={() => setTab('preview')}
    >
      Screen Preview
    </button>
  </div>

  <!-- Tab Content -->
  <div class="tab-content">
    {#if activeTab === 'layers'}
      {#if castId}
        <LayerInspector {castId} {slideIndex} {slides} />
      {:else}
        <div class="placeholder">
          <p>No cast loaded. Use <code>?cast=&lt;castId&gt;</code> in the URL.</p>
        </div>
      {/if}
    {:else if activeTab === 'pipeline'}
      {#if castId}
        <RenderPipeline {castId} {slides} />
      {:else}
        <div class="placeholder">
          <p>No cast loaded. Use <code>?cast=&lt;castId&gt;</code> in the URL.</p>
        </div>
      {/if}
    {:else if activeTab === 'preview'}
      {#if castId}
        <ScreenPreview
          {castId}
          {slideIndex}
          slide={slides[slideIndex] || null}
          castDefinition={cast?.definition || null}
        />
      {:else}
        <div class="placeholder">
          <p>No cast loaded. Use <code>?cast=&lt;castId&gt;</code> in the URL.</p>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .studio-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text, #e0e0e0);
    font-family: system-ui, -apple-system, sans-serif;
  }

  /* Header */
  .studio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px 24px;
    background: var(--color-surface-raised, #252542);
    border-bottom: 1px solid var(--color-border, #3d3d5c);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .studio-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text, #fff);
  }

  .cast-name {
    font-size: 14px;
    color: var(--color-text-muted, #aaa);
    padding: 4px 10px;
    background: var(--color-surface, #1a1a2e);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 4px;
  }

  .cast-name.loading {
    opacity: 0.6;
  }

  .slide-selector select {
    padding: 6px 12px;
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text, #fff);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 4px;
    font-size: 14px;
    min-width: 240px;
    cursor: pointer;
  }

  .slide-selector select:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  /* Error Banner */
  .error-banner {
    padding: 12px 24px;
    background: #3d1a1a;
    border-bottom: 1px solid #6b2c2c;
    color: #ff6b6b;
    font-size: 14px;
  }

  /* Tab Bar */
  .tab-bar {
    display: flex;
    gap: 4px;
    padding: 12px 24px 0;
    background: var(--color-surface-raised, #252542);
    border-bottom: 1px solid var(--color-border, #3d3d5c);
  }

  .tab-btn {
    padding: 8px 20px;
    border: 1px solid var(--color-border, #3d3d5c);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: var(--color-surface, #1a1a2e);
    color: var(--color-text-muted, #aaa);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    position: relative;
    bottom: -1px;
  }

  .tab-btn:hover {
    background: var(--color-surface-raised, #252542);
    color: var(--color-text, #e0e0e0);
  }

  .tab-btn.active {
    background: var(--color-primary, #6366f1);
    color: #fff;
    border-color: var(--color-primary, #6366f1);
  }

  /* Tab Content */
  .tab-content {
    flex: 1;
    padding: 32px 24px;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    border: 1px dashed var(--color-border, #3d3d5c);
    border-radius: 8px;
    color: var(--color-text-muted, #888);
    font-size: 16px;
  }

  .placeholder p {
    margin: 0;
  }
</style>
