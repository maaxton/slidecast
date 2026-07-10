<script>
  import { createEventDispatcher } from 'svelte';
  import SlideRenderer from '../../lib/SlideRenderer.svelte';

  export let open = false;
  export let element = null;
  export let layerPngUrl = null;
  export let castId = null;
  export let slideIndex = 0;

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleEscape(e) {
    if (e.key === 'Escape' && open) {
      close();
    }
  }

  // Build a fake single-element slide for the SlideRenderer
  $: fakeSlide = element
    ? { elements: [element], background: null }
    : null;

  $: shortId = element?.id ? element.id.substring(0, 8) : '';
  $: modalTitle = element
    ? `Compare: ${element.type} — ${shortId}`
    : 'Compare';
</script>

<svelte:window on:keydown={handleEscape} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={handleBackdropClick} role="presentation">
    <div class="modal-content" on:click|stopPropagation>
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">{modalTitle}</h2>
        <button class="close-btn" on:click={close} aria-label="Close">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Panels -->
      <div class="panels">
        <!-- Left: Editor (SlideRenderer) -->
        <div class="panel">
          <div class="panel-label">Editor</div>
          <div class="panel-body panel-editor">
            {#if fakeSlide}
              <div class="renderer-wrap">
                <SlideRenderer
                  slide={fakeSlide}
                  scale={0.3}
                  width={1920}
                  height={1080}
                  interactive={false}
                  editMode={false}
                />
              </div>
            {:else}
              <div class="empty-panel">No element</div>
            {/if}
          </div>
        </div>

        <!-- Right: Rendered PNG -->
        <div class="panel">
          <div class="panel-label">Rendered</div>
          <div class="panel-body panel-rendered">
            {#if layerPngUrl}
              <img
                src={layerPngUrl}
                alt="Rendered layer"
                class="rendered-img"
              />
            {:else}
              <div class="empty-panel">No rendered image</div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-content {
    background: var(--color-surface-raised, #252542);
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 12px;
    width: min(90vw, 1100px);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--color-border, #3d3d5c);
    background: var(--color-surface, #1a1a2e);
    flex-shrink: 0;
  }

  .modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text, #e0e0e0);
    font-family: monospace;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: none;
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 6px;
    color: var(--color-text-muted, #888);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: #ef4444;
    color: white;
    border-color: #ef4444;
  }

  .panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--color-border, #3d3d5c);
    flex: 1;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    background: var(--color-surface, #1a1a2e);
    overflow: hidden;
  }

  .panel-label {
    padding: 8px 14px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted, #888);
    background: var(--color-surface-raised, #252542);
    border-bottom: 1px solid var(--color-border, #3d3d5c);
    flex-shrink: 0;
  }

  .panel-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    min-height: 300px;
    max-height: calc(85vh - 140px);
    padding: 12px;
  }

  /* Checkerboard background for both panels */
  .panel-editor,
  .panel-rendered {
    background:
      repeating-conic-gradient(#2a2a3e 0% 25%, #1a1a2e 0% 50%)
      50% / 16px 16px;
  }

  .renderer-wrap {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Constrain the SlideRenderer output */
  .renderer-wrap :global(.slide-container) {
    max-width: 100%;
    height: auto;
  }

  .rendered-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
    border-radius: 2px;
  }

  .empty-panel {
    color: var(--color-text-muted, #666);
    font-size: 13px;
    font-style: italic;
  }
</style>
