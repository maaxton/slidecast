<script>
  import { createEventDispatcher } from 'svelte';
  import * as canvas from '../utils/canvasControls.js';
  import { activeTool, selectedElementId } from '../stores/studioStore.js';

  export let modKey = '⌘';
  export let canvasZoom = 0.5;
  export let canvasContainer = null;
  // studioElements contributions (spec §6 / D9, Wave 5 Slice 5.4) — fetched
  // once by +page.svelte from GET /api/extensions/contributions/studioElements
  // and passed down here. Each entry with a `widgetType` becomes an extra
  // toolbar button placed after the built-in "Widget" button. Placing one
  // dispatches the SAME `addElement` event the built-in buttons use, with
  // type:'widget' and widgetUuid `${extension}:${widgetType}` — the exact
  // provider-qualified id the studio's generic Widget picker already places
  // and WidgetResolver/WidgetProviderRegistry already renders. No second
  // placement or render path: studioElements only adds a dedicated toolbar
  // entry (+ a nicer config panel, wired in WidgetConfigWindow) on top of the
  // existing widget mechanism.
  export let contributions = [];

  const dispatch = createEventDispatcher();

  $: placeableContributions = (contributions || []).filter(
    (c) => c && typeof c.widgetType === 'string' && c.widgetType.trim() !== '',
  );

  function handleAddElement(type, options = {}) {
    dispatch('addElement', { type, options });
  }

  function handleAddStudioElement(contribution) {
    handleAddElement('widget', { widgetUuid: `${contribution.extension}:${contribution.widgetType}` });
  }

  function handleDeselect() {
    selectedElementId.set(null);
  }
</script>

<!-- Toolbar -->
<footer class="studio-toolbar" data-testid="studio-toolbar">
  <button class="tool-btn" on:click={() => dispatch('openMedia')} title="Image" data-testid="studio-tool-image">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
    <span>Image</span>
  </button>
  <button class="tool-btn" on:click={() => handleAddElement('text')} title="Text" data-testid="studio-tool-text">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>
    <span>Text</span>
  </button>
  <button class="tool-btn" on:click={() => handleAddElement('shape', { shape: 'rectangle' })} title="Shape" data-testid="studio-tool-shape">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v18H3V3z"/></svg>
    <span>Shape</span>
  </button>
  <button class="tool-btn" on:click={() => handleAddElement('nav')} title="Navigation" data-testid="studio-tool-nav">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
    <span>Nav</span>
  </button>
  <button class="tool-btn" on:click={() => handleAddElement('qr')} title="QR Code" data-testid="studio-tool-qr">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13 0h1v1h-1zm-3-1h2v2h-2zm-1 2h1v4h-4v-2h1v-1h2zm4-1h2v4h-1v-3h-1zm-3 4h1v1h-1zm2 0h1v1h-1z"/></svg>
    <span>QR</span>
  </button>
  <button class="tool-btn" on:click={() => handleAddElement('ping')} title="Ping Button" data-testid="studio-tool-ping">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
    <span>Ping</span>
  </button>
  <button class="tool-btn" on:click={() => dispatch('openWidget')} title="Widget" data-testid="studio-tool-widget">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z"/></svg>
    <span>Widget</span>
  </button>
  {#each placeableContributions as c (`${c.extension}:${c.componentPath}`)}
    <button
      class="tool-btn"
      on:click={() => handleAddStudioElement(c)}
      title={c.label}
      data-testid="studio-tool-contrib-{c.extension}-{c.widgetType}"
    >
      {#if c.icon}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d={c.icon} />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z"/></svg>
      {/if}
      <span>{c.label}</span>
    </button>
  {/each}
  <div class="toolbar-divider"></div>
  <span class="toolbar-hint">{modKey}+Z undo • {modKey}+Y redo • {modKey}+S save • Del delete</span>
  
  <!-- Zoom Controls with Tool Selection -->
  <div class="toolbar-zoom">
    <button 
      class="zoom-btn tool-btn"
      data-testid="studio-tool-pointer"
      class:active={$activeTool === 'pointer'} 
      on:click={() => activeTool.set('pointer')} 
      title="Selection Tool (V)"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4 4l16 8-7 2-2 7z"/></svg>
    </button>
    <button 
      class="zoom-btn tool-btn"
      data-testid="studio-tool-hand"
      class:active={$activeTool === 'hand'} 
      on:click={() => activeTool.set('hand')} 
      title="Hand Tool (H) - Pan canvas"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18 12V8a2 2 0 00-2-2 2 2 0 00-2 2V4a2 2 0 00-2-2 2 2 0 00-2 2v6.5L8.5 9A2.12 2.12 0 006 9.25a2 2 0 00-.12 2.91L10.5 18H18a2 2 0 002-2v-4a2 2 0 00-2-2z"/></svg>
    </button>
    <button 
      class="zoom-btn tool-btn"
      data-testid="studio-tool-deselect"
      disabled={!$selectedElementId}
      on:click={handleDeselect} 
      title="Deselect (D)"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
    <span class="toolbar-separator"></span>
    <button class="zoom-btn" on:click={canvas.zoomOut} title="Zoom Out" data-testid="studio-zoom-out">−</button>
    <span class="zoom-level">{Math.round(canvasZoom * 100)}%</span>
    <button class="zoom-btn" on:click={canvas.zoomIn} title="Zoom In" data-testid="studio-zoom-in">+</button>
    <button class="zoom-btn" on:click={() => canvas.zoomFit(canvasContainer)} title="Fit to Screen" data-testid="studio-zoom-fit">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 0h2v6h-6v-2h4v-4z"/></svg>
    </button>
  </div>
</footer>
