<script>
  import { onMount, onDestroy } from 'svelte';
  import SlideRenderer from '../lib/SlideRenderer.svelte';
  import RokuPreviewRenderer from '../lib/RokuPreviewRenderer.svelte';

  let cast = null;
  let loading = true;
  let error = null;
  
  let slideTimer = null;
  let scale = 1;
  let ws = null;
  
  // Preview mode: 'web' or 'roku'
  let previewMode = 'web';
  let rokuSlideImageUrl = null;
  
  // Groups-based navigation state
  let currentGroupId = 'home';
  let currentSlideIndex = 0;
  
  // For crossfade: track previous slide state
  let previousGroupId = null;
  let previousSlideIndex = null;
  let isTransitioning = false;
  
  // Widget refresh management
  let widgetRefreshTimers = {};
  let widgetRenderCache = {}; // Cache widget renders by element id

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  let isFullscreen = false;
  
  // URL parameter controls
  let isPaused = false;
  let initialSlide = null;
  let initialGroup = null;
  
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.() ||
      document.documentElement.webkitRequestFullscreen?.() ||
      document.documentElement.mozRequestFullScreen?.() ||
      document.documentElement.msRequestFullscreen?.();
      isFullscreen = true;
    } else {
      document.exitFullscreen?.() ||
      document.webkitExitFullscreen?.() ||
      document.mozCancelFullScreen?.() ||
      document.msExitFullscreen?.();
      isFullscreen = false;
    }
  }
  
  // Get current group object
  function getCurrentGroup() {
    return cast?.groups?.find(g => g.id === currentGroupId) || cast?.groups?.[0];
  }
  
  // Get slides for current group
  function getCurrentSlides() {
    return getCurrentGroup()?.slides || [];
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (document.fullscreenElement) {
        isFullscreen = false;
      } else {
        window.close();
      }
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    } else if (e.key === 'p' || e.key === 'P') {
      // Toggle pause
      togglePause();
    } else if (e.key === 'ArrowLeft') {
      const slides = getCurrentSlides();
      goToSlide(currentGroupId, Math.max(0, currentSlideIndex - 1));
    } else if (e.key === 'ArrowRight') {
      const slides = getCurrentSlides();
      goToSlide(currentGroupId, Math.min(slides.length - 1, currentSlideIndex + 1));
    } else if (e.key === ' ') {
      // Space now toggles pause instead of advancing
      e.preventDefault();
      togglePause();
    } else if (e.key === 'Home' || e.key === 'h' || e.key === 'H') {
      // Quick return to home group
      goToGroup('home');
    }
  }
  
  function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
      // Stop the slideshow
      if (slideTimer) {
        clearTimeout(slideTimer);
        slideTimer = null;
      }
    } else {
      // Resume the slideshow
      scheduleNextSlide();
    }
  }

  onMount(async () => {
    // Hide sidebar and make fullscreen
    const sidebar = document.querySelector('.sidebar, [class*="Sidebar"], nav');
    const appMain = document.querySelector('.app-main');
    const mobileBtn = document.querySelector('.mobile-menu-btn');
    
    if (sidebar) sidebar.style.display = 'none';
    if (appMain) appMain.style.marginLeft = '0';
    if (mobileBtn) mobileBtn.style.display = 'none';
    
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    
    window.addEventListener('keydown', handleKeydown);
    
    document.addEventListener('fullscreenchange', () => {
      isFullscreen = !!document.fullscreenElement;
    });
    
    const castId = getQueryParam('id');
    const isLivePreview = getQueryParam('live') === 'true';
    
    // Parse URL control parameters
    initialSlide = getQueryParam('slide');
    initialGroup = getQueryParam('group');
    const pauseParam = getQueryParam('paused') || getQueryParam('pause');
    isPaused = pauseParam === 'true' || pauseParam === '1';
    
    // Also support mode parameter for preview mode
    const modeParam = getQueryParam('mode');
    if (modeParam === 'roku' || modeParam === 'web') {
      previewMode = modeParam;
    }
    
    if (!castId && !isLivePreview) {
      error = 'No cast ID provided';
      loading = false;
      return;
    }

    if (isLivePreview) {
      const previewData = sessionStorage.getItem('slidecast_preview_data');
      if (previewData) {
        try {
          const parsedCast = JSON.parse(previewData);
          cast = normalizeCast(parsedCast);
          loading = false;
          console.log('Loaded live preview cast:', cast);
        } catch (e) {
          console.error('Failed to parse preview data:', e);
          await loadCast(castId);
        }
      } else {
        await loadCast(castId);
      }
    } else {
      await loadCast(castId);
    }
    
    if (cast) {
      // Start at the specified group or default group
      if (initialGroup && cast.groups?.find(g => g.id === initialGroup)) {
        currentGroupId = initialGroup;
      } else {
        const defaultGroup = cast.groups?.find(g => g.isDefault) || cast.groups?.[0];
        currentGroupId = defaultGroup?.id || 'home';
      }
      
      // Start at the specified slide or slide 0
      if (initialSlide !== null) {
        const slideNum = parseInt(initialSlide, 10);
        const slides = getCurrentSlides();
        if (!isNaN(slideNum) && slideNum >= 0 && slideNum < slides.length) {
          currentSlideIndex = slideNum;
        } else {
          currentSlideIndex = 0;
        }
      } else {
        currentSlideIndex = 0;
      }
      
      // Process widgets in the first slide
      await ensureWidgetsProcessed();
      
      // Only start slideshow if not paused
      if (!isPaused) {
        startSlideshow();
      }
    }
    
    updateScale();
    window.addEventListener('resize', updateScale);
  });

  onDestroy(() => {
    if (slideTimer) clearTimeout(slideTimer);
    if (ws) ws.close();
    window.removeEventListener('resize', updateScale);
    
    // Clear all widget refresh timers
    Object.values(widgetRefreshTimers).forEach(timer => clearInterval(timer));
    widgetRefreshTimers = {};
    
    const sidebar = document.querySelector('.sidebar, [class*="Sidebar"], nav');
    const appMain = document.querySelector('.app-main');
    const mobileBtn = document.querySelector('.mobile-menu-btn');
    
    if (sidebar) sidebar.style.display = '';
    if (appMain) appMain.style.marginLeft = '';
    if (mobileBtn) mobileBtn.style.display = '';
    
    document.body.style.overflow = '';
  });

  // Execute a widget and get its render data
  async function executeWidget(element) {
    if (element.type !== 'widget' || !element.widgetUuid) return element;
    
    const cacheKey = `${element.widgetUuid}-${JSON.stringify(element.widgetConfig)}-${JSON.stringify(element.widgetStyles)}-${element._widgetRenderMode || ''}`;
    
    // Check cache first
    if (widgetRenderCache[cacheKey]) {
      return { ...element, ...widgetRenderCache[cacheKey] };
    }
    
    try {
      // Determine if we should force image mode
      const userWantsImage = element._widgetRenderMode === 'image';
      
      // Call backend to render widget (POST for full render with primitives)
      const response = await fetch(`/api/extensions/slidecast/protocol/widget/${element.widgetUuid}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          config: element.widgetConfig || {},
          styles: element.widgetStyles || {},
          size: element.size || { width: 300, height: 80 },
          forceImage: userWantsImage
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Only preserve user's render mode if it's a valid choice ('native' or 'image')
        // 'hybrid' is NOT a valid render mode - it must be converted to native/image
        const hasValidUserChoice = element._widgetRenderMode === 'native' || element._widgetRenderMode === 'image';
        const effectiveRenderMode = hasValidUserChoice ? element._widgetRenderMode : data.renderMode;
        
        const renderData = {
          _widgetRenderMode: effectiveRenderMode,
          _widgetPrimitives: data.primitives,
          _widgetImageUrl: data.imageUrl,
          _widgetError: null,
          _widgetLoading: false
        };
        
        // Cache the result (with short TTL based on refresh interval)
        widgetRenderCache[cacheKey] = renderData;
        
        // Set up refresh timer for this widget if not already set
        const refreshInterval = data.refreshInterval || element.refreshInterval || 60000;
        const timerId = `${element.id}-${element.widgetUuid}`;
        
        if (!widgetRefreshTimers[timerId] && refreshInterval > 0) {
          widgetRefreshTimers[timerId] = setInterval(async () => {
            // Clear cache and re-render
            delete widgetRenderCache[cacheKey];
            // Trigger re-render by updating the current slide
            if (cast) {
              await processWidgetsInSlide(currentSlide);
              cast = cast; // Trigger reactivity
            }
          }, refreshInterval);
        }
        
        return { ...element, ...renderData };
      } else {
        return { 
          ...element, 
          _widgetError: data.error || 'Failed to render widget',
          _widgetLoading: false
        };
      }
    } catch (err) {
      console.error('Widget execution failed:', err);
      return { 
        ...element, 
        _widgetError: err.message,
        _widgetLoading: false
      };
    }
  }
  
  // Process all widgets in a slide
  async function processWidgetsInSlide(slide) {
    if (!slide || !slide.elements) return slide;
    
    const processedElements = await Promise.all(
      slide.elements.map(async (element) => {
        if (element.type === 'widget') {
          return await executeWidget(element);
        }
        return element;
      })
    );
    
    slide.elements = processedElements;
    return slide;
  }
  
  // Process widgets when slide changes - triggered manually, not reactively
  let lastProcessedSlideId = null;
  
  async function ensureWidgetsProcessed() {
    const slideId = `${currentGroupId}-${currentSlideIndex}`;
    
    // Get the current slide directly (not from reactive variable)
    const group = cast?.groups?.find(g => g.id === currentGroupId);
    const slide = group?.slides?.[currentSlideIndex];
    
    if (lastProcessedSlideId !== slideId && slide?.elements) {
      lastProcessedSlideId = slideId;
      await processWidgetsInSlide(slide);
      // Trigger Svelte reactivity after processing widgets
      cast = cast;
    }
  }

  // Normalize cast to groups structure
  function normalizeCast(rawCast) {
    const definition = rawCast.definition || rawCast;
    
    // Already has groups
    if (definition.groups) {
      return {
        ...rawCast,
        groups: definition.groups,
        settings: definition.settings || {},
        variables: definition.variables || {}
      };
    }
    
    // Legacy slides array - wrap in Home group
    if (definition.slides) {
      return {
        ...rawCast,
        groups: [{
          id: 'home',
          name: 'Home',
          isDefault: true,
          loop: definition.settings?.loop !== false,
          defaultDuration: definition.settings?.defaultDuration || 10000,
          slides: definition.slides
        }],
        settings: definition.settings || {},
        variables: definition.variables || {}
      };
    }
    
    // Empty - return minimal structure
    return {
      ...rawCast,
      groups: [{
        id: 'home',
        name: 'Home',
        isDefault: true,
        loop: true,
        defaultDuration: 10000,
        slides: []
      }],
      settings: {},
      variables: {}
    };
  }

  async function loadCast(castId) {
    try {
      const response = await fetch(`/api/extensions/slidecast/protocol/cast/${castId}`, {
        credentials: 'same-origin'
      });
      const data = await response.json();
      
      if (data.cast) {
        cast = normalizeCast(data.cast);
        console.log('Loaded cast:', cast);
      } else {
        error = data.error || 'Cast not found';
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function startSlideshow() {
    const slides = getCurrentSlides();
    if (slides.length <= 1) return;
    scheduleNextSlide();
  }

  function scheduleNextSlide() {
    const group = getCurrentGroup();
    const slides = getCurrentSlides();
    const slide = slides[currentSlideIndex];
    
    if (!slide || slides.length === 0) {
      if (slideTimer) clearTimeout(slideTimer);
      return;
    }
    
    const duration = slide.duration || group?.defaultDuration || 10000;

    if (slideTimer) clearTimeout(slideTimer);
    slideTimer = setTimeout(() => {
      nextSlide();
    }, duration);
  }

  async function nextSlide() {
    const group = getCurrentGroup();
    const slides = getCurrentSlides();
    
    if (!slides || slides.length === 0) return;
    
    let nextIndex = currentSlideIndex + 1;
    
    // End of slides in this group
    if (nextIndex >= slides.length) {
      // Should we loop?
      if (group?.loop && slides.length > 1) {
        nextIndex = 0;
      } else {
        // Stay on last slide
        return;
      }
    }
    
    await transitionToSlide(currentGroupId, nextIndex);
    scheduleNextSlide();
  }

  // Go to a specific slide within a group
  async function goToSlide(groupId, slideIndex) {
    if (groupId === currentGroupId && slideIndex === currentSlideIndex) return;
    if (slideTimer) clearTimeout(slideTimer);
    
    await transitionToSlide(groupId, slideIndex);
    scheduleNextSlide();
  }
  
  // Go to a group (starts at slide 0)
  async function goToGroup(groupId) {
    if (slideTimer) clearTimeout(slideTimer);
    
    await transitionToSlide(groupId, 0);
    scheduleNextSlide();
  }
  
  let transitionClass = '';
  
  async function transitionToSlide(targetGroupId, targetSlideIndex) {
    // Get the TARGET slide to check its transition override
    const targetGroup = cast?.groups?.find(g => g.id === targetGroupId);
    const targetSlide = targetGroup?.slides?.[targetSlideIndex];
    
    const transitionDuration = getTransitionDuration(targetSlide);
    const transitionType = getTransitionType(targetSlide);
    
    if (transitionType === 'cut' || isTransitioning) {
      // Instant cut - no transition
      currentGroupId = targetGroupId;
      currentSlideIndex = targetSlideIndex;
      // Process widgets for new slide
      await ensureWidgetsProcessed();
      return;
    }
    
    // Store previous for transition
    previousGroupId = currentGroupId;
    previousSlideIndex = currentSlideIndex;
    currentGroupId = targetGroupId;
    currentSlideIndex = targetSlideIndex;
    isTransitioning = true;
    transitionClass = transitionType;
    
    // Process widgets for new slide (don't wait for transition)
    ensureWidgetsProcessed();
    
    await new Promise(r => setTimeout(r, transitionDuration));
    
    previousGroupId = null;
    previousSlideIndex = null;
    isTransitioning = false;
    transitionClass = '';
  }

  function updateScale() {
    const frameOverhead = isFullscreen ? 0 : 150;
    const availableWidth = window.innerWidth - 80;
    const availableHeight = window.innerHeight - frameOverhead;
    
    const scaleX = availableWidth / 1920;
    const scaleY = availableHeight / 1080;
    scale = Math.min(1, Math.min(scaleX, scaleY));
  }

  function handleNavAction(event) {
    const { action } = event.detail;
    
    if (action?.type === 'group') {
      // Navigate to a group
      const targetGroupId = action.group_id;
      if (targetGroupId && cast?.groups?.find(g => g.id === targetGroupId)) {
        goToGroup(targetGroupId);
      }
    } else if (action?.type === 'slide') {
      // Navigate to a specific slide
      // Can specify group_id to jump to slide in different group
      const targetGroupId = action.group_id || currentGroupId;
      let slideIndex = action.slide_index;
      
      // Support legacy slide_id
      if (slideIndex === undefined && action.slide_id) {
        const group = cast?.groups?.find(g => g.id === targetGroupId);
        slideIndex = group?.slides?.findIndex(s => s.id === action.slide_id);
      }
      
      if (slideIndex !== undefined && slideIndex >= 0) {
        goToSlide(targetGroupId, slideIndex);
      }
    } else if (action?.type === 'webhook') {
      const url = action.webhook_url;
      const method = action.webhook_method || 'POST';
      if (url) {
        fetch(url, { method, mode: 'no-cors' }).catch(e => console.error('Webhook failed:', e));
      }
    } else if (action?.type === 'url') {
      if (action.url) {
        window.open(action.url, '_blank');
      }
    } else if (action?.type === 'ping') {
      sendPing(action.ping_name);
    }
  }

  function handlePing(event) {
    const { pingName } = event.detail;
    sendPing(pingName);
  }

  async function sendPing(pingName) {
    try {
      const slides = getCurrentSlides();
      await fetch('/api/extensions/slidecast/protocol/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          serial: 'browser-preview',
          ping_name: pingName,
          cast_id: cast?.id,
          group_id: currentGroupId,
          slide_id: slides[currentSlideIndex]?.id
        })
      });
    } catch (e) {
      console.error('Failed to send ping:', e);
    }
  }

  function getTransitionDuration(slide = null) {
    // Check slide override first
    if (slide?.transition?.duration) return slide.transition.duration;
    // Check group-level transition settings
    const group = getCurrentGroup();
    if (group?.transition?.duration) return group.transition.duration;
    // Fall back to cast default
    return cast?.settings?.transition?.duration || 500;
  }
  
  function getTransitionType(slide = null) {
    // Check slide override first
    if (slide?.transition?.type) return slide.transition.type;
    // Check group-level transition settings
    const group = getCurrentGroup();
    if (group?.transition?.type) return group.transition.type;
    // Fall back to cast default
    return cast?.settings?.transition?.type || 'fade';
  }

  // Reactive: current and previous slides
  $: currentGroup = cast?.groups?.find(g => g.id === currentGroupId);
  $: currentSlides = currentGroup?.slides || [];
  $: currentSlide = currentSlides[currentSlideIndex];
  
  $: previousGroup = previousGroupId ? cast?.groups?.find(g => g.id === previousGroupId) : null;
  $: previousSlide = previousGroup?.slides?.[previousSlideIndex] || null;
  
  // Compute flattened slide index for Roku PNG URL
  $: flattenedSlideIndex = (() => {
    if (!cast?.groups) return 0;
    let index = 0;
    for (const group of cast.groups) {
      if (group.id === currentGroupId) {
        return index + currentSlideIndex;
      }
      index += (group.slides?.length || 0);
    }
    return 0;
  })();
  
  // Roku slide image URL
  $: rokuSlideImageUrl = cast?.id 
    ? `/api/extensions/slidecast/protocol/slide-image/${cast.id}/${flattenedSlideIndex}`
    : null;
  
  // Toggle preview mode
  function togglePreviewMode() {
    previewMode = previewMode === 'web' ? 'roku' : 'web';
  }
</script>

<svelte:head>
  <title>{cast?.name || 'Slidecast Preview'}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <!-- Roku-Compatible Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <!-- Roku-compatible fonts only -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Roboto+Slab:wght@400;500;700&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&family=Bebas+Neue&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #000; }
  </style>
</svelte:head>

<div class="preview-container">
  {#if loading}
    <div class="loading-screen">
      <div class="spinner"></div>
      <span>Loading cast...</span>
    </div>
  {:else if error}
    <div class="error-screen">
      <div class="error-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <h2>Unable to Load Cast</h2>
      <p>{error}</p>
      <button class="retry-btn" on:click={() => window.location.reload()}>Retry</button>
    </div>
  {:else if cast}
    <!-- Waiveo TV Frame -->
    <div class="tv-frame" class:fullscreen-mode={isFullscreen}>
      <!-- TV Bezel -->
      <div class="tv-bezel">
        <!-- Brand Logo -->
        <div class="tv-brand">
          <span class="brand-logo">W</span>
          <span class="brand-name">waiveo</span>
        </div>
        
        <!-- Screen Area -->
        <div class="tv-screen" style="--tv-scale: {scale}">
          <!-- Crossfade: render both slides stacked, animate opacity -->
          <div class="slide-stack">
            <!-- Previous slide (fading out) - rendered behind current -->
            {#if previousSlide && isTransitioning}
              {@const previousFlattenedIndex = (() => {
                if (!cast?.groups || !previousGroupId) return 0;
                let index = 0;
                for (const group of cast.groups) {
                  if (group.id === previousGroupId) {
                    return index + (previousSlideIndex || 0);
                  }
                  index += (group.slides?.length || 0);
                }
                return 0;
              })()}
              <div 
                class="slide-wrapper slide-layer transition-out {transitionClass}" 
                style="--transition-duration: {getTransitionDuration(currentSlide)}ms;"
              >
                <div class="slide-scaler" style="transform: scale({scale}); transform-origin: center center;">
                  {#if previewMode === 'roku'}
                    <RokuPreviewRenderer
                      slide={previousSlide}
                      castId={cast.id}
                      slideIndex={previousFlattenedIndex}
                      width={1920}
                      height={1080}
                      scale={1}
                      currentGroupId={previousGroupId}
                    />
                  {:else}
                    <SlideRenderer
                      slide={previousSlide}
                      variables={cast.variables || {}}
                      scale={1}
                      width={1920}
                      height={1080}
                      interactive={false}
                    />
                  {/if}
                </div>
              </div>
            {/if}
            
            <!-- Current slide (transitioning in, or fully visible) -->
            <div 
              class="slide-wrapper slide-layer" 
              class:transition-in={isTransitioning}
              class:fade={transitionClass === 'fade'}
              class:slide-left={transitionClass === 'slide-left'}
              class:slide-right={transitionClass === 'slide-right'}
              class:slide-up={transitionClass === 'slide-up'}
              class:slide-down={transitionClass === 'slide-down'}
              style="--transition-duration: {getTransitionDuration(currentSlide)}ms;"
            >
              <div class="slide-scaler" style="transform: scale({scale}); transform-origin: center center;">
                {#if previewMode === 'roku'}
                  <RokuPreviewRenderer
                    slide={currentSlide}
                    slideImageUrl={rokuSlideImageUrl}
                    castId={cast.id}
                    slideIndex={flattenedSlideIndex}
                    width={1920}
                    height={1080}
                    scale={1}
                    {currentGroupId}
                    on:navClick={(e) => handleNavAction({ detail: { action: e.detail.item.action } })}
                  />
                {:else}
                  <SlideRenderer
                    slide={currentSlide}
                    variables={cast.variables || {}}
                    scale={1}
                    width={1920}
                    height={1080}
                    interactive={true}
                    {currentGroupId}
                    {currentSlideIndex}
                    on:navAction={handleNavAction}
                    on:ping={handlePing}
                  />
                {/if}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Power LED -->
        <div class="tv-led"></div>
      </div>
      
      <!-- TV Stand -->
      <div class="tv-stand">
        <div class="stand-neck"></div>
        <div class="stand-base"></div>
      </div>
    </div>

    {#if currentSlides && currentSlides.length > 1}
      <div class="slide-indicators">
        {#each currentSlides as slide, i}
          <button 
            class="indicator" 
            class:active={i === currentSlideIndex}
            on:click={() => goToSlide(currentGroupId, i)}
            title="Slide {i + 1}"
          ></button>
        {/each}
      </div>
    {/if}
    
    <!-- Group indicator (show current group name if not Home) -->
    {#if cast.groups && cast.groups.length > 1}
      <div class="group-indicator">
        <span class="group-name">{currentGroup?.name || 'Home'}</span>
        {#if currentGroupId !== 'home'}
          <button class="home-btn" on:click={() => goToGroup('home')} title="Return to Home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
        {/if}
      </div>
    {/if}

    <!-- Preview Mode Toggle -->
    <div class="preview-mode-toggle">
      <button 
        class="mode-btn"
        class:active={previewMode === 'web'}
        on:click={() => previewMode = 'web'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Web
      </button>
      <button 
        class="mode-btn roku"
        class:active={previewMode === 'roku'}
        on:click={() => previewMode = 'roku'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        Roku
      </button>
    </div>
    
    <!-- Control buttons -->
    <div class="preview-controls">
      <button class="control-btn" class:paused={isPaused} on:click={togglePause} title={isPaused ? "Resume (Space/P)" : "Pause (Space/P)"}>
        {#if isPaused}
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z" />
          </svg>
        {:else}
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {/if}
      </button>
      <button class="control-btn" on:click={toggleFullscreen} title="Toggle Fullscreen (F)">
        {#if isFullscreen}
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
          </svg>
        {:else}
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        {/if}
      </button>
      <button class="control-btn close-btn" on:click={() => window.close()} title="Close Preview (Esc)">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    
    <!-- Pause indicator overlay -->
    {#if isPaused}
      <div class="pause-indicator">
        <svg fill="currentColor" viewBox="0 0 24 24" width="20" height="20">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
        </svg>
        PAUSED
      </div>
    {/if}
    
    <!-- Keyboard hint (fades out) -->
    <div class="keyboard-hint">Space/P to pause • F for fullscreen • ← → to navigate • Esc to close</div>
  {/if}
</div>

<style>
  .preview-container {
    width: 100vw;
    height: 100vh;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    position: fixed;
    inset: 0;
    z-index: 9999;
    padding: 20px;
    box-sizing: border-box;
  }
  
  /* Waiveo TV Frame */
  .tv-frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 95vw;
    max-height: 95vh;
    transition: all 0.3s ease;
  }
  
  .tv-frame.fullscreen-mode {
    max-width: 100vw;
    max-height: 100vh;
  }
  
  .tv-frame.fullscreen-mode .tv-bezel {
    padding: 0;
    border-radius: 0;
    background: #000;
  }
  
  .tv-frame.fullscreen-mode .tv-stand,
  .tv-frame.fullscreen-mode .tv-brand,
  .tv-frame.fullscreen-mode .tv-led {
    display: none;
  }
  
  .tv-bezel {
    background: linear-gradient(145deg, #2d2d2d, #1a1a1a);
    padding: 20px 20px 35px 20px;
    border-radius: 20px;
    box-shadow: 
      0 25px 60px rgba(0,0,0,0.5),
      0 0 0 1px rgba(255,255,255,0.05),
      inset 0 1px 0 rgba(255,255,255,0.1);
    position: relative;
  }
  
  .tv-screen {
    width: calc(1920px * var(--tv-scale, 0.5));
    height: calc(1080px * var(--tv-scale, 0.5));
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    box-shadow: 
      inset 0 0 30px rgba(0,0,0,0.8),
      0 0 1px rgba(255,255,255,0.1);
  }
  
  .tv-brand {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    color: #888;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 300;
    letter-spacing: 3px;
    text-transform: lowercase;
  }
  
  .brand-logo {
    width: 20px;
    height: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 12px;
    color: white;
    letter-spacing: 0;
  }
  
  .brand-name {
    opacity: 0.7;
  }
  
  .tv-led {
    position: absolute;
    bottom: 12px;
    right: 25px;
    width: 6px;
    height: 6px;
    background: #4ade80;
    border-radius: 50%;
    box-shadow: 0 0 8px #4ade80, 0 0 16px rgba(74, 222, 128, 0.5);
    animation: pulse-led 2s ease-in-out infinite;
  }
  
  @keyframes pulse-led {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  /* TV Stand */
  .tv-stand {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  
  .stand-neck {
    width: 60px;
    height: 30px;
    background: linear-gradient(to right, #1a1a1a, #333, #1a1a1a);
    border-radius: 0 0 4px 4px;
  }
  
  .stand-base {
    width: 180px;
    height: 12px;
    background: linear-gradient(145deg, #333, #1a1a1a);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  
  .slide-stack {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .slide-layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  /* Transition out (previous slide) */
  .slide-layer.transition-out {
    z-index: 1;
  }
  .slide-layer.transition-out.fade {
    animation: fadeOut var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-out.slide-left {
    animation: slideOutLeft var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-out.slide-right {
    animation: slideOutRight var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-out.slide-up {
    animation: slideOutUp var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-out.slide-down {
    animation: slideOutDown var(--transition-duration, 500ms) ease-out forwards;
  }
  
  /* Transition in (current slide) */
  .slide-layer.transition-in {
    z-index: 2;
  }
  .slide-layer.transition-in.fade {
    animation: fadeIn var(--transition-duration, 500ms) ease-in forwards;
  }
  .slide-layer.transition-in.slide-left {
    animation: slideInLeft var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-in.slide-right {
    animation: slideInRight var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-in.slide-up {
    animation: slideInUp var(--transition-duration, 500ms) ease-out forwards;
  }
  .slide-layer.transition-in.slide-down {
    animation: slideInDown var(--transition-duration, 500ms) ease-out forwards;
  }
  
  .slide-layer:not(.transition-out):not(.transition-in) {
    opacity: 1;
    z-index: 2;
  }
  
  /* Fade animations */
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  /* Slide animations */
  @keyframes slideOutLeft {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(-100%); opacity: 0; }
  }
  @keyframes slideInLeft {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
  @keyframes slideInRight {
    from { transform: translateX(-100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutUp {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(-100%); opacity: 0; }
  }
  @keyframes slideInUp {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes slideOutDown {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(100%); opacity: 0; }
  }
  @keyframes slideInDown {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .preview-controls {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10001;
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .preview-container:hover .preview-controls {
    opacity: 1;
  }
  
  .control-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    border: 2px solid rgba(255, 255, 255, 0.3);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .control-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
    transform: scale(1.1);
  }
  
  .control-btn.close-btn:hover {
    background: rgba(239, 68, 68, 0.8);
    border-color: rgba(239, 68, 68, 1);
  }
  
  .control-btn.paused {
    background: rgba(234, 179, 8, 0.8);
    border-color: rgba(234, 179, 8, 1);
  }
  
  .pause-indicator {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgba(234, 179, 8, 0.9);
    color: #000;
    font-weight: 600;
    font-size: 13px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  
  .keyboard-hint {
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10001;
    padding: 10px 20px;
    background: rgba(0, 0, 0, 0.7);
    color: rgba(255, 255, 255, 0.9);
    border-radius: 8px;
    font-size: 0.85rem;
    opacity: 1;
    animation: fadeOutHint 5s forwards;
    pointer-events: none;
  }
  
  @keyframes fadeOutHint {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }

  .loading-screen, .error-screen {
    color: white;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 3px solid rgba(255,255,255,0.2);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .error-icon { margin-bottom: 1rem; opacity: 0.8; }
  .error-screen h2 { font-size: 1.5rem; margin: 0; }
  .error-screen p { color: rgba(255,255,255,0.7); margin: 0.5rem 0 1rem; }

  .retry-btn {
    padding: 0.75rem 2rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .retry-btn:hover { transform: scale(1.05); }

  .slide-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 100%;
    min-height: 100%;
    padding: 20px;
    box-sizing: border-box;
  }

  .slide-scaler {
    width: 1920px;
    height: 1080px;
    flex-shrink: 0;
    /* Maintain exact 16:9 aspect ratio */
    aspect-ratio: 16 / 9;
    position: relative;
    background: #000;
  }

  .slide-indicators {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 100;
    padding: 8px 12px;
    background: rgba(0,0,0,0.5);
    border-radius: 16px;
  }

  .indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .indicator:hover { background: rgba(255,255,255,0.5); transform: scale(1.2); }
  .indicator.active { background: white; transform: scale(1.2); }
  
  /* Group indicator */
  .group-indicator {
    position: fixed;
    top: 20px;
    left: 20px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 8px;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .preview-container:hover .group-indicator {
    opacity: 1;
  }
  
  .group-name {
    color: white;
    font-size: 0.85rem;
    font-weight: 500;
  }
  
  .home-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.2s ease;
  }
  
  .home-btn:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
  }
  
  /* Preview Mode Toggle */
  .preview-mode-toggle {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10001;
    display: flex;
    gap: 4px;
    padding: 4px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 12px;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .preview-container:hover .preview-mode-toggle {
    opacity: 1;
  }
  
  .mode-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .mode-btn:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.1);
  }
  
  .mode-btn.active {
    color: white;
    background: rgba(102, 126, 234, 0.8);
  }
  
  .mode-btn.roku.active {
    background: rgba(108, 53, 222, 0.9);
  }
</style>
