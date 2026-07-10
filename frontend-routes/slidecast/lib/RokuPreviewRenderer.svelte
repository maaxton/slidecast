<script>
  /**
   * RokuPreviewRenderer - Simulates how Roku will render the slide
   * 
   * Uses per-layer PNG compositing for pixel-perfect rendering:
   * - Fetches layer metadata (z-index, position, opacity)
   * - Renders each layer PNG with proper positioning
   * - Applies opacity at composite time (not baked into PNG)
   * - Native elements (video, clock, nav) are simulated
   */
  
  export let slide = null;
  export let slideImageUrl = null; // Legacy - ignored in favor of layers
  export let castId = null;
  export let slideIndex = 0;
  export let width = 1920;
  export let height = 1080;
  export let scale = 1;
  export let currentGroupId = null;
  
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();
  
  // Handle nav item click - dispatch event for parent to handle navigation
  function handleNavClick(item, itemIndex) {
    debug('roku.nav', 'click', { itemIndex, groupId: item.groupId, label: item.label, action: item.action });
    dispatch('navClick', { item, itemIndex });
  }
  
  // Layer metadata from server
  let layers = [];
  let layersLoading = true;
  let layersError = null;
  let layersGeneratedAt = '';

  // Mount-time timestamp used as an extra cache-buster so the browser never serves
  // a stale HTTP-cached PNG when the component first renders (Bug 3).
  let mountTimestamp = Date.now();
  
  // Simulated Roku system time for clock/date widgets
  let currentTime = new Date();
  let timeInterval;
  
  // Debug helper
  function debug(category, action, data) {
    window.WaiveoDebug?.log('slidecast', category, action, data);
  }

  // Fetch layer metadata when slide changes
  async function fetchLayers() {
    if (!castId || slideIndex === undefined) {
      layersLoading = false;
      debug('roku.layers', 'skip', { reason: 'missing castId or slideIndex', castId, slideIndex });
      return;
    }
    
    layersLoading = true;
    layersError = null;
    
    debug('roku.layers', 'fetch.start', { castId, slideIndex });
    
    try {
      const response = await fetch(`/api/extensions/slidecast/protocol/slide-layers/${castId}/${slideIndex}`);
      const data = await response.json();
      
      if (data.success !== false && data.layers) {
        layers = data.layers;
        layersGeneratedAt = data.generatedAt || '';

        // Debug each layer
        const nativeLayers = layers.filter(l => l.native);
        const pngLayers = layers.filter(l => !l.native);
        
        debug('roku.layers', 'fetch.success', { 
          slideIndex,
          totalLayers: layers.length,
          nativeCount: nativeLayers.length,
          pngCount: pngLayers.length,
          nativeTypes: nativeLayers.map(l => l.type),
          pngFiles: pngLayers.map(l => l.file),
          layerSummary: layers.map(l => ({
            zIndex: l.zIndex,
            type: l.type,
            native: l.native,
            x: l.x,
            y: l.y,
            width: l.width,
            height: l.height,
            file: l.file || 'N/A'
          }))
        });
      } else {
        // Fallback to legacy single image
        layers = [{
          id: 'legacy',
          type: 'legacy',
          native: false,
          zIndex: 0,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          file: null, // Will use legacy URL
          useLegacyUrl: true
        }];
        layersError = data.error || 'Layers not available';
        debug('roku.layers', 'fetch.fallback', { error: layersError });
      }
    } catch (err) {
      console.error('Failed to fetch layers:', err);
      // Fallback to legacy
      layers = [{
        id: 'legacy',
        type: 'legacy',
        native: false,
        zIndex: 0,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        useLegacyUrl: true
      }];
      layersError = err.message;
      debug('roku.layers', 'fetch.error', { error: err.message });
    } finally {
      layersLoading = false;
    }
  }
  
  // Build layer image URL
  function getLayerUrl(layer) {
    if (layer.useLegacyUrl) {
      const url = `/api/extensions/slidecast/protocol/slide-image/${castId}/${slideIndex}`;
      debug('roku.layer', 'url.legacy', { layerId: layer.id, url });
      return url;
    }
    if (layer.file) {
      let url = `/api/extensions/slidecast/protocol/slide-layer/${castId}/${slideIndex}/${layer.file}`;
      // Cache-busting: contentHash changes when content changes, generatedAt changes on re-render,
      // mountTimestamp prevents the browser from serving a stale HTTP-cached PNG on initial mount
      // (Bug 3: stale widget cache values shown when browser has cached an older PNG).
      const hash = layer.contentHash || '';
      url += `?h=${hash}&g=${encodeURIComponent(layersGeneratedAt)}&m=${mountTimestamp}`;
      debug('roku.layer', 'url.png', { layerId: layer.id, file: layer.file, url });
      return url;
    }
    debug('roku.layer', 'url.null', { layerId: layer.id, type: layer.type });
    return null;
  }
  
  // Debug widget type detection
  function detectWidgetType(layer) {
    const widgetUuid = layer.element?.widgetUuid || layer.element?.widget_uuid || '';
    const explicitType = layer.element?.widgetType || layer.element?.widget?.type;
    
    let detectedType = explicitType;
    if (!detectedType) {
      if (widgetUuid.includes('clock')) detectedType = 'clock';
      else if (widgetUuid.includes('date')) detectedType = 'date';
      else if (widgetUuid.includes('countdown')) detectedType = 'countdown';
    }
    
    debug('roku.widget', 'detect', { 
      layerId: layer.id,
      widgetUuid,
      explicitType,
      detectedType,
      renderMode: layer.element?._widgetRenderMode
    });
    
    return detectedType;
  }
  
  onMount(() => {
    // Update time every second for clock simulation
    timeInterval = setInterval(() => {
      currentTime = new Date();
    }, 1000);
    
    // Initial fetch
    fetchLayers();
  });
  
  onDestroy(() => {
    if (timeInterval) clearInterval(timeInterval);
  });
  
  // Refetch when castId or slideIndex changes
  $: if (castId && slideIndex !== undefined) {
    fetchLayers();
  }
  
  // Extract background video from slide — stored as an element with type === 'video' in slide.elements
  $: backgroundVideoData = slide?.elements?.find(el => el.type === 'video') || null;

  // Bug 1 fix: when background is video, filter out any stale 'background' type PNG layer from the
  // layers list. Such a layer (background.png, zIndex -1 → CSS z=9) would sit ABOVE the video
  // element (z=1) and make the video completely invisible. On Roku, the video is a native node that
  // always renders behind all SceneGraph overlays — the background-color PNG must not be present.
  $: visibleLayers = backgroundVideoData
    ? layers.filter(l => l.type !== 'background')
    : layers;

  // Get background color — mirror exactly what SlideRenderer uses:
  //   slide.backgroundColor (flat property, set by the editor)
  //   fallback to slide.background.color for the nested schema variant
  //   final fallback to #000000 (SlideRenderer default)
  $: backgroundColor = slide?.backgroundColor
    || (slide?.background?.type === 'color' ? slide.background.color : null)
    || '#000000';
  
  // Format time for clock widget simulation
  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  }
  
  // Format date for date widget simulation  
  function formatDate(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }
</script>

<div 
  class="roku-preview"
  style="
    width: {width * scale}px;
    height: {height * scale}px;
    background-color: {backgroundColor};
    transform-origin: top left;
  "
>
  <!-- Layer 0: Background Video (if a video element exists in slide.elements) -->
  {#if backgroundVideoData}
    {@const bgVideoSrc = backgroundVideoData.asset_id
      ? `/api/extensions/slidecast/protocol/asset/${backgroundVideoData.asset_id}`
      : (backgroundVideoData.url || backgroundVideoData.src || '')}
    <video
      src={bgVideoSrc}
      class="background-video"
      autoplay
      loop
      muted
      playsinline
    ></video>
  {/if}
  
  <!-- Render each layer in z-order -->
  {#if layersLoading}
    <div class="loading-message">
      <span>Loading layers...</span>
    </div>
  {:else}
    {#each visibleLayers.slice().sort((a, b) => a.zIndex - b.zIndex) as layer}
      {#if !layer.native}
        <!-- Check if this is a multi-state nav layer -->
        {#if layer.type === 'nav' && layer.files && layer.files.length > 0}
          <!-- Multi-state nav layer - show PNG for current group + click targets -->
          <!-- Find matching highlight, or fall back to "no highlight" state (index=-1), or first file -->
          {@const activeFile = layer.files.find(f => f.groupId === currentGroupId) 
            || layer.files.find(f => f.index === -1) 
            || layer.files[0]}
          {@const navHash = layer.contentHash || ''}
          {@const navUrl = `/api/extensions/slidecast/protocol/slide-layer/${castId}/${slideIndex}/${activeFile.file}?h=${navHash}&g=${encodeURIComponent(layersGeneratedAt)}`}
          <div 
            class="nav-layer"
            style="
              position: absolute;
              left: {layer.x * scale}px;
              top: {layer.y * scale}px;
              width: {layer.width * scale}px;
              height: {layer.height * scale}px;
              z-index: {layer.zIndex + 10};
            "
          >
            <!-- Nav PNG image -->
            <img 
              class="nav-image"
              src={navUrl}
              alt="Navigation"
              style="
                width: 100%;
                height: 100%;
                opacity: {layer.opacity};
                transform: rotate({layer.rotation || 0}deg);
              "
              on:load={() => {
                debug('roku.nav', 'load.success', { activeFile: activeFile.file, currentGroupId });
              }}
              on:error={(e) => {
                debug('roku.nav', 'load.error', { file: activeFile.file });
                e.target.style.display = 'none';
              }}
            />
            <!-- Invisible click targets overlaid on nav -->
            <div class="nav-click-targets" style="position: absolute; inset: 0; display: flex;">
              {#each layer.items as item, i}
                <button
                  class="nav-click-target"
                  class:active={item.groupId === currentGroupId}
                  style="flex: 1; background: transparent; border: none; cursor: pointer;"
                  on:click={() => handleNavClick(item, i)}
                >
                  <span class="sr-only">{item.label}</span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <!-- Regular static layer - render PNG with position and opacity -->
          {@const layerUrl = getLayerUrl(layer)}
          {#if layerUrl}
            <img 
              class="layer-image"
              src={layerUrl}
              alt="Layer {layer.zIndex}"
              style="
                position: absolute;
                left: {layer.x * scale}px;
                top: {layer.y * scale}px;
                width: {layer.width * scale}px;
                height: {layer.height * scale}px;
                opacity: {layer.opacity};
                transform: rotate({layer.rotation || 0}deg);
                transform-origin: center center;
                z-index: {layer.zIndex + 10};
              "
              on:load={() => {
                debug('roku.layer', 'load.success', { 
                  layerId: layer.id, 
                  file: layer.file,
                  zIndex: layer.zIndex,
                  position: { x: layer.x, y: layer.y },
                  size: { width: layer.width, height: layer.height }
                });
              }}
              on:error={(e) => {
                debug('roku.layer', 'load.error', { layerId: layer.id, file: layer.file, url: layerUrl });
                console.warn('Layer image failed to load:', layerUrl);
                e.target.style.display = 'none';
              }}
            />
          {/if}
        {/if}
      {:else}
        <!-- Native element - render like web preview -->
        {#if layer.type === 'video'}
          {@const _ = debug('roku.native', 'video', { 
            zIndex: layer.zIndex, 
            position: { x: layer.x, y: layer.y },
            size: { width: layer.width, height: layer.height },
            opacity: layer.opacity,
            assetId: layer.element?.asset_id,
            cssZIndex: layer.zIndex + 10
          })}
          {@const videoSrc = layer.element?.asset_id 
            ? `/api/extensions/slidecast/protocol/asset/${layer.element.asset_id}` 
            : (layer.element?.src || '')}
          {@const videoAutoplay = layer.element?.config?.autoplay !== false}
          {@const videoLoop = layer.element?.config?.loop !== false}
          {@const videoMuted = layer.element?.config?.muted !== false}
          <video
            src={videoSrc}
            class="native-video"
            style="
              position: absolute;
              left: {layer.x * scale}px;
              top: {layer.y * scale}px;
              width: {layer.width * scale}px;
              height: {layer.height * scale}px;
              opacity: {layer.opacity};
              z-index: {layer.zIndex + 10};
              object-fit: {layer.element?.style?.objectFit || 'cover'};
            "
            autoplay={videoAutoplay}
            loop={videoLoop}
            muted={videoMuted}
            playsinline
          ></video>
        {:else if layer.type === 'nav'}
          <div 
            class="native-nav"
            style="
              position: absolute;
              left: {layer.x * scale}px;
              top: {layer.y * scale}px;
              width: {layer.width * scale}px;
              height: {layer.height * scale}px;
              opacity: {layer.opacity};
              z-index: {layer.zIndex + 10};
            "
          >
            <div class="nav-bar">
              {#each (layer.element?.items || []) as item, i}
                {@const isActive = item.action?.type === 'group'
                  ? item.action.group_id === currentGroupId
                  : item.action?.type === 'slide'
                    ? item.action.group_id === currentGroupId
                    : (i === 0 && !currentGroupId)}
                <div
                  class="nav-item"
                  class:active={isActive}
                >
                  {item.label || `Group ${i + 1}`}
                </div>
              {/each}
            </div>
          </div>
        {:else if layer.type === 'widget'}
          {@const widgetType = detectWidgetType(layer)}
          {@const widgetStyles = layer.element?.widgetStyles || layer.element?.styles || {}}
          <div 
            class="native-widget"
            style="
              position: absolute;
              left: {layer.x * scale}px;
              top: {layer.y * scale}px;
              width: {layer.width * scale}px;
              height: {layer.height * scale}px;
              opacity: {layer.opacity};
              z-index: {layer.zIndex + 10};
            "
          >
            {#if widgetType === 'clock'}
              <div 
                class="roku-clock"
                style="
                  font-size: {(widgetStyles.fontSize || 48) * scale}px;
                  color: {widgetStyles.textColor || '#ffffff'};
                  font-family: {widgetStyles.fontFamily || 'Helvetica Neue'}, Arial, sans-serif;
                  font-weight: {widgetStyles.fontWeight || 700};
                "
              >
                {formatTime(currentTime)}
              </div>
            {:else if widgetType === 'date'}
              <div 
                class="roku-date"
                style="
                  font-size: {(widgetStyles.fontSize || 24) * scale}px;
                  color: {widgetStyles.textColor || '#ffffff'};
                  font-family: {widgetStyles.fontFamily || 'Helvetica Neue'}, Arial, sans-serif;
                "
              >
                {formatDate(currentTime)}
              </div>
            {:else if widgetType === 'countdown'}
              <div class="roku-countdown">
                <span class="countdown-time">00:00:00</span>
                <span class="countdown-label">Countdown</span>
              </div>
            {:else}
              <div class="roku-widget-placeholder">
                {layer.element?.name || layer.element?.widget_name || 'Widget'}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    {/each}
  {/if}
  
  <!-- Roku Badge -->
  <div class="roku-badge">
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
    Roku Preview
  </div>
</div>

<style>
  .roku-preview {
    position: relative;
    overflow: hidden;
    font-family: 'Gotham', 'Helvetica Neue', Arial, sans-serif;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  
  /* Background video */
  .background-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 1;
    pointer-events: none;
  }
  
  /* Layer images */
  .layer-image {
    pointer-events: none;
  }
  
  /* Multi-state nav layer */
  .nav-layer {
    position: relative;
  }
  
  .nav-image {
    display: block;
    pointer-events: none;
  }
  
  .nav-click-targets {
    pointer-events: auto;
  }
  
  .nav-click-target {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  
  .nav-click-target:hover {
    opacity: 0.1;
    background: rgba(255, 255, 255, 0.2) !important;
  }
  
  .nav-click-target:active {
    opacity: 0.2;
    background: rgba(255, 255, 255, 0.3) !important;
  }
  
  /* Screen reader only */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  
  /* Loading message */
  .loading-message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    z-index: 5;
  }
  
  /* Native video element */
  video.native-video {
    display: block;
    pointer-events: none;
  }
  
  /* Native widgets - Roku system font simulation */
  .native-widget {
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  
  .roku-clock {
    font-size: 48px;
    font-weight: 700;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    letter-spacing: 2px;
  }
  
  .roku-date {
    font-size: 24px;
    font-weight: 500;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    font-family: 'Helvetica Neue', Arial, sans-serif;
  }
  
  .roku-countdown {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  
  .countdown-time {
    font-size: 36px;
    font-weight: 700;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  
  .countdown-label {
    font-size: 12px;
    opacity: 0.7;
  }
  
  .roku-widget-placeholder {
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    color: white;
    font-size: 14px;
  }
  
  /* Native navigation - Roku system font simulation */
  .native-nav {
    pointer-events: none;
  }
  
  .nav-bar {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
  }
  
  .nav-item {
    padding: 8px 24px;
    font-size: 18px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    transition: all 0.2s ease;
  }
  
  .nav-item.active {
    background: rgba(128, 90, 213, 0.9);
    color: white;
    font-weight: 600;
  }
  
  /* Roku badge */
  .roku-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(108, 53, 222, 0.9);
    border-radius: 16px;
    color: white;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    z-index: 100;
  }
</style>
