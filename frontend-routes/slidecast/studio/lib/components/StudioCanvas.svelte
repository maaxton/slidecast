<script>
  import { createEventDispatcher } from 'svelte';
  import SlideRenderer from '../../../lib/SlideRenderer.svelte';
  import * as canvas from '../utils/canvasControls.js';

  export let zoom = 0.5;
  export let pan = { x: 0, y: 0 };
  export let activeTool = 'pointer';
  export let isPanning = false;
  export let currentSlide = null;
  export let variables = {};
  export let selectedElementId = null;
  export let selectedElement = null;
  export let availableWidgets = [];
  export let currentGroupId = 'home';
  export let currentSlideIndex = 0;
  export let slowLoadingWidgets = new Set();
  export let runWidget = null; // Function to run widgets

  const dispatch = createEventDispatcher();
  let canvasContainer = null;

  // Expose canvasContainer to parent if needed
  export { canvasContainer };

  function handleElementSelect(event) {
    dispatch('select', { element: event.detail.element });
  }
  
  function handleElementDoubleClick(event) {
    dispatch('elementDoubleClick', { element: event.detail.element });
  }

  function handleBackgroundClick() {
    dispatch('backgroundClick');
  }

  function handleStartDrag(e, element) {
    dispatch('startDrag', { event: e, element });
  }

  function handleOpenWidgetConfig(element) {
    dispatch('openWidgetConfig', { element, runWidgetFn: runWidget });
  }

  function handleOpenTextConfig(element) {
    dispatch('openTextConfig', { element });
  }

  function handleOpenNavConfig(element) {
    dispatch('openNavConfig', { element });
  }

  function handleOpenQRConfig(element) {
    dispatch('openQRConfig', { element });
  }

  function handleCanvasWheel(e) {
    canvas.handleCanvasWheel(e, canvasContainer);
  }

  function handleCanvasMouseDown(e) {
    canvas.handleCanvasMouseDown(e);
  }

  function handleCanvasPanMove(e) {
    canvas.handleCanvasPanMove(e);
  }

  function handleCanvasPanEnd(e) {
    canvas.handleCanvasPanEnd(e);
  }

  $: widgetInfo = selectedElement?.type === 'widget' 
    ? availableWidgets.find(w => w.uuid === selectedElement.widgetUuid)
    : null;
</script>

<!-- Canvas Area -->
<main 
  class="canvas-area"
  data-testid="studio-canvas"
  class:panning={isPanning}
  class:hand-tool={activeTool === 'hand'}
  bind:this={canvasContainer}
  on:wheel|preventDefault={handleCanvasWheel}
  on:mousedown={handleCanvasMouseDown}
  on:mousemove={handleCanvasPanMove}
  on:mouseup={handleCanvasPanEnd}
  on:mouseleave={handleCanvasPanEnd}
>
  <!-- TV Frame -->
  <div class="tv-frame" style="transform: translate({pan.x}px, {pan.y}px) scale({zoom}); transform-origin: center center;">
    <div class="tv-bezel">
      <div class="tv-brand">
        <span class="brand-logo">W</span>
        <span class="brand-name">waiveo</span>
      </div>
      <div class="canvas-wrapper">
        <!-- Slide Renderer -->
        {#if currentSlide}
          <SlideRenderer
            slide={currentSlide}
            {variables}
            scale={1}
            width={1920}
            height={1080}
            editMode={true}
            {selectedElementId}
            showGrid={true}
            {currentGroupId}
            {currentSlideIndex}
            on:elementSelect={handleElementSelect}
            on:elementDoubleClick={handleElementDoubleClick}
            on:backgroundClick={handleBackgroundClick}
          />
        {/if}
        
        <!-- Drag overlay for selected element -->
        {#if selectedElement}
          <div 
            class="element-drag-overlay"
            class:no-resize={selectedElement.type === 'widget'}
            style="
              left: {selectedElement.position.x}px;
              top: {selectedElement.position.y}px;
              width: {selectedElement.size.width}px;
              height: {selectedElement.size.height}px;
              {selectedElement.style?.rotation ? `transform: rotate(${selectedElement.style.rotation}deg); transform-origin: center center;` : ''}
            "
            on:mousedown={(e) => handleStartDrag(e, selectedElement)}
          >
            <!-- Hide resize handles for widgets - size controlled via widget config -->
            {#if selectedElement.type !== 'widget'}
              <div class="handle handle-nw" data-handle="nw"></div>
              <div class="handle handle-n" data-handle="n"></div>
              <div class="handle handle-ne" data-handle="ne"></div>
              <div class="handle handle-e" data-handle="e"></div>
              <div class="handle handle-se" data-handle="se"></div>
              <div class="handle handle-s" data-handle="s"></div>
              <div class="handle handle-sw" data-handle="sw"></div>
              <div class="handle handle-w" data-handle="w"></div>
            {/if}
            
            <!-- Floating widget toolbar -->
            {#if selectedElement.type === 'widget'}
              <div class="widget-floating-toolbar" on:mousedown|stopPropagation>
                <button class="widget-toolbar-btn primary" on:click={() => handleOpenWidgetConfig(selectedElement)} title="Configure Widget">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                  Configure
                </button>
                <span class="widget-toolbar-name">{widgetInfo?.name || selectedElement.widgetName || 'Widget'}</span>
              </div>
            {/if}
            
            <!-- Floating text toolbar -->
            {#if selectedElement.type === 'text'}
              <div class="widget-floating-toolbar" on:mousedown|stopPropagation>
                <button class="widget-toolbar-btn primary" on:click={() => handleOpenTextConfig(selectedElement)} title="Edit Text">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                  Edit Text
                </button>
                <span class="widget-toolbar-name">{selectedElement.content?.substring(0, 20) || 'Text'}{selectedElement.content?.length > 20 ? '...' : ''}</span>
              </div>
            {/if}

            <!-- Floating navigation toolbar -->
            {#if selectedElement.type === 'nav'}
              <div class="widget-floating-toolbar" on:mousedown|stopPropagation>
                <button class="widget-toolbar-btn primary" on:click={() => handleOpenNavConfig(selectedElement)} title="Configure Navigation">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                  Configure
                </button>
                <span class="widget-toolbar-name">Navigation</span>
              </div>
            {/if}

            <!-- Floating QR toolbar -->
            {#if selectedElement.type === 'qr' || selectedElement.type === 'qrcode'}
              <div class="widget-floating-toolbar" on:mousedown|stopPropagation>
                <button class="widget-toolbar-btn primary" on:click={() => handleOpenQRConfig(selectedElement)} title="Configure QR Code">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13 0h1v1h-1zm-3-1h2v2h-2zm-1 2h1v4h-4v-2h1v-1h2zm4-1h2v4h-1v-3h-1zm-3 4h1v1h-1zm2 0h1v1h-1z"/></svg>
                  Configure
                </button>
                <span class="widget-toolbar-name">QR Code</span>
              </div>
            {/if}
          </div>
        {/if}
        
        <!-- Widget slow loading spinners (shown below widget after 500ms) -->
        {#if currentSlide?.elements}
          {#each currentSlide.elements.filter(el => el.type === 'widget' && slowLoadingWidgets.has(el.id)) as widget}
            <div 
              class="widget-loading-indicator"
              style="
                left: {widget.position.x}px;
                top: {widget.position.y + widget.size.height + 8}px;
                width: {widget.size.width}px;
              "
            >
              <div class="loading-spinner-small"></div>
              <span>Rendering widget...</span>
            </div>
          {/each}
        {/if}
      </div>
      <div class="tv-led"></div>
    </div>
    <div class="tv-stand">
      <div class="stand-neck"></div>
      <div class="stand-base"></div>
    </div>
  </div>
</main>
