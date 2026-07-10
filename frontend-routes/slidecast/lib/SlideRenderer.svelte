<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import DOMPurify from 'dompurify';
  import { renderPrimitivesToHtml, escapeHtml } from './widget-primitives.js';
  // Rendering CSS is in <style> below as :global() rules, mirroring shared-renderer/styles.css
  
  // Props
  export let slide = null;
  export let variables = {};
  export let scale = 1;
  export let width = 1920;
  export let height = 1080;
  export let interactive = false; // Enable element clicks/selection
  export let editMode = false; // Show selection handles
  export let selectedElementId = null;
  export let showGrid = false;
  
  // For self-aware navigation
  export let currentGroupId = null;
  export let currentSlideIndex = 0;
  
  const dispatch = createEventDispatcher();
  
  // Sort elements by zIndex, filtering hidden inherited navs
  $: sortedElements = [...(slide?.elements || [])]
    .filter(element => {
      // Filter out hidden inherited navs
      if (element.type === 'nav' && element._isInheritedCopy && element._sourceNavId) {
        const override = slide?.navOverrides?.[element._sourceNavId];
        if (override?.hidden) return false;
      }
      return true;
    })
    .map(element => {
      // Apply position/style overrides for inherited navs
      if (element.type === 'nav' && element._isInheritedCopy && element._sourceNavId) {
        const override = slide?.navOverrides?.[element._sourceNavId];
        if (override) {
          return {
            ...element,
            position: override.position || element.position,
            style: override.style ? { ...element.style, ...override.style } : element.style
          };
        }
      }
      return element;
    })
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  
  // Resolve variables in text
  function resolveVariables(text) {
    if (!text || typeof text !== 'string') return text || '';
    let resolved = text;
    for (const [key, value] of Object.entries(variables || {})) {
      resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return resolved;
  }
  
  // Calculate blur expansion for an element
  function getBlurExpansion(element) {
    const blur = element.style?.blur || 0;
    if (blur <= 0) {
      return { expansion: 0, hasBlur: false };
    }
    // Blur scatters ~3x the blur radius (captures 99.7% of Gaussian)
    const expansion = Math.ceil(blur * 3 * scale);
    return { expansion, hasBlur: true };
  }
  
  // Build CSS style object for element (with scale applied)
  function getElementStyle(element) {
    const s = element.style || {};
    const { expansion, hasBlur } = getBlurExpansion(element);
    
    // Base position and size (with backward-compat for old flat schema: element.x/y/width/height)
    const posX = element.position?.x ?? element.x ?? 0;
    const posY = element.position?.y ?? element.y ?? 0;
    const elW = element.size?.width ?? element.width ?? 100;
    const elH = element.size?.height ?? element.height ?? 100;
    const baseX = posX * scale;
    const baseY = posY * scale;
    const baseWidth = elW * scale;
    const baseHeight = elH * scale;
    
    // Expand bounds for blur (offset position, increase size)
    const style = {
      position: 'absolute',
      left: `${baseX - expansion}px`,
      top: `${baseY - expansion}px`,
      width: `${baseWidth + expansion * 2}px`,
      height: `${baseHeight + expansion * 2}px`,
      zIndex: element.zIndex || 0,
      // Don't clip when blur is present (blur pixels extend beyond bounds)
      overflow: hasBlur ? 'visible' : 'hidden'
    };
    
    // Opacity
    if (s.opacity !== undefined) {
      style.opacity = s.opacity;
    }
    
    // Build transform string
    const transforms = [];
    if (s.rotation) transforms.push(`rotate(${s.rotation}deg)`);
    if (s.scale && s.scale !== 1) transforms.push(`scale(${s.scale})`);
    if (s.flipX) transforms.push('scaleX(-1)');
    if (s.flipY) transforms.push('scaleY(-1)');
    if (s.skewX) transforms.push(`skewX(${s.skewX}deg)`);
    if (s.skewY) transforms.push(`skewY(${s.skewY}deg)`);
    if (transforms.length > 0) {
      style.transform = transforms.join(' ');
      style.transformOrigin = 'center center';
    }
    
    // Blur filter (scaled)
    if (hasBlur) {
      style.filter = `blur(${s.blur * scale}px)`;
    }
    
    // Drop shadow (scaled)
    if (s.shadowEnabled) {
      const shadowX = (s.shadowX ?? 4) * scale;
      const shadowY = (s.shadowY ?? 4) * scale;
      const shadowBlur = (s.shadowBlur ?? 8) * scale;
      const shadowColor = s.shadowColor || '#000000';
      const shadowOpacity = s.shadowOpacity ?? 0.5;
      // Convert hex to rgba
      const r = parseInt(shadowColor.slice(1, 3), 16);
      const g = parseInt(shadowColor.slice(3, 5), 16);
      const b = parseInt(shadowColor.slice(5, 7), 16);
      style.boxShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px rgba(${r}, ${g}, ${b}, ${shadowOpacity})`;
    }
    
    // Border (scaled)
    if (s.borderEnabled) {
      const borderWidth = (s.borderWidth || 2) * scale;
      const borderRadius = (s.borderRadius || 0) * scale;
      style.border = `${borderWidth}px ${s.borderStyle || 'solid'} ${s.borderColor || '#ffffff'}`;
      if (borderRadius > 0) {
        style.borderRadius = `${borderRadius}px`;
      }
    }
    
    // Opacity gradient mask
    if (s.gradientMaskEnabled) {
      const dir = s.gradientDirection || 'to-right';
      const start = s.gradientStart ?? 0;
      const end = s.gradientEnd ?? 100;
      
      let gradient;
      switch (dir) {
        case 'to-right':
          gradient = `linear-gradient(to right, transparent ${start}%, black ${end}%)`;
          break;
        case 'to-left':
          gradient = `linear-gradient(to left, transparent ${start}%, black ${end}%)`;
          break;
        case 'to-bottom':
          gradient = `linear-gradient(to bottom, transparent ${start}%, black ${end}%)`;
          break;
        case 'to-top':
          gradient = `linear-gradient(to top, transparent ${start}%, black ${end}%)`;
          break;
        case 'to-bottom-right':
          gradient = `linear-gradient(to bottom right, transparent ${start}%, black ${end}%)`;
          break;
        case 'to-bottom-left':
          gradient = `linear-gradient(to bottom left, transparent ${start}%, black ${end}%)`;
          break;
        case 'radial-out':
          gradient = `radial-gradient(circle, black ${start}%, transparent ${end}%)`;
          break;
        case 'radial-in':
          gradient = `radial-gradient(circle, transparent ${start}%, black ${end}%)`;
          break;
        default:
          gradient = `linear-gradient(to right, transparent ${start}%, black ${end}%)`;
      }
      style.maskImage = gradient;
      style.webkitMaskImage = gradient;
    }
    
    return style;
  }
  
  // Build text element style (with scale applied to sizes)
  function getTextStyle(element) {
    const s = element.style || {};
    const strokeWidth = (parseFloat(s.strokeWidth) || 0) * scale;
    const strokeColor = s.strokeColor || '#000000';
    const fontSize = (s.fontSize || 24) * scale;
    const letterSpacing = s.letterSpacing ? s.letterSpacing * scale : 0;
    const padding = s.padding ? s.padding * scale : 0;
    const textAlign = s.textAlign || 'left';
    
    // Map textAlign to justifyContent for flex container
    const justifyMap = {
      'left': 'flex-start',
      'center': 'center',
      'right': 'flex-end'
    };
    
    const style = {
      fontFamily: s.fontFamily || 'Inter, sans-serif',
      fontSize: `${fontSize}px`,
      fontWeight: s.fontWeight || 'normal',
      fontStyle: s.fontStyle || 'normal',
      color: s.color || '#ffffff',
      textAlign: textAlign,
      justifyContent: justifyMap[textAlign] || 'flex-start',
      lineHeight: s.lineHeight || 1.2,
      letterSpacing: letterSpacing ? `${letterSpacing}px` : 'normal',
      textDecoration: s.textDecoration || 'none',
      backgroundColor: s.backgroundColor || 'transparent',
      padding: padding ? `${padding}px` : '0',
      textShadow: s.textShadow || 'none'
    };
    
    // Text stroke/outline using -webkit-text-stroke
    // paintOrder ensures stroke is behind fill
    if (strokeWidth > 0) {
      style.webkitTextStroke = `${strokeWidth}px ${strokeColor}`;
      style.paintOrder = 'stroke fill';
    }
    
    return style;
  }
  
  // Build shape element style (with scale applied to sizes)
  function getShapeStyle(element) {
    const s = element.style || {};
    const borderRadius = (s.borderRadius || 0) * scale;
    const strokeWidth = (s.strokeWidth || 2) * scale;
    
    // Support both UI format (backgroundColor, fillOpacity) and legacy format (fill, opacity)
    const fillColor = s.backgroundColor || s.fill || '#3b82f6';
    const fillOpacity = s.fillOpacity !== undefined ? s.fillOpacity : (s.opacity !== undefined ? s.opacity : 1);
    
    const style = {
      backgroundColor: fillColor,
      borderRadius: `${borderRadius}px`,
      opacity: fillOpacity
    };
    
    if (s.stroke && s.stroke !== 'none') {
      style.border = `${strokeWidth}px solid ${s.stroke}`;
    }
    
    // Handle gradient backgrounds
    const fill = s.backgroundColor || s.fill;
    if (fill?.includes('gradient')) {
      style.background = fill;
      style.backgroundColor = 'transparent';
    }
    
    // Circle support
    if (element.shape === 'circle') {
      style.borderRadius = '50%';
    }
    
    return style;
  }
  
  // Build image element style (with scale applied to sizes)
  function getImageStyle(element) {
    const s = element.style || {};
    const borderRadius = (s.borderRadius || 0) * scale;
    const borderWidth = (s.borderWidth || 0) * scale;
    
    return {
      objectFit: s.objectFit || 'cover',
      opacity: s.opacity !== undefined ? s.opacity : 1,
      borderRadius: `${borderRadius}px`,
      border: borderWidth ? `${borderWidth}px solid ${s.borderColor || '#ffffff'}` : 'none',
      boxShadow: s.shadow || 'none'
    };
  }
  
  // Build nav container style (the outer wrapper with background) - scaled
  function getNavContainerStyle(element) {
    const s = element.style || {};
    const containerBg = s.containerBackground || '#000000';
    const containerOpacity = s.containerOpacity ?? 0.6;
    const containerRgba = hexToRgba(containerBg, containerOpacity);
    const containerRadius = (s.containerRadius ?? 16) * scale;
    const containerPadding = (s.containerPadding ?? 8) * scale;
    const containerBlur = (s.containerBlur || 0) * scale;
    
    const style = {
      background: containerRgba,
      borderRadius: `${containerRadius}px`,
      padding: `${containerPadding}px`,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      opacity: s.opacity ?? 1
    };
    
    // Add backdrop blur for glass effect
    if (containerBlur > 0) {
      style.backdropFilter = `blur(${containerBlur}px)`;
      style.webkitBackdropFilter = `blur(${containerBlur}px)`;
    }
    
    return style;
  }
  
  // Build nav inner style (flexbox layout for items) - scaled
  function getNavStyle(element) {
    const s = element.style || {};
    const itemGap = (s.itemGap || 4) * scale;
    
    return {
      display: 'flex',
      flexDirection: element.layout === 'vertical' ? 'column' : 'row',
      flexWrap: element.layout === 'grid' ? 'wrap' : 'nowrap',
      gap: `${itemGap}px`,
      alignItems: 'stretch',
      width: '100%',
      height: '100%'
    };
  }
  
  // Check if a nav item is the active/current one
  function isNavItemActive(item) {
    if (!item?.action) return false;
    const action = item.action;

    if (action.type === 'group') {
      // Group nav: active if pointing to current group
      return action.group_id === currentGroupId;
    } else if (action.type === 'slide') {
      // Slide nav: must have explicit group_id to determine active state
      // Without group_id, we can't know which group's slide it refers to
      if (!action.group_id) {
        return false;
      }
      // Active if same group AND same slide index
      return action.group_id === currentGroupId && action.slide_index === currentSlideIndex;
    }
    return false;
  }
  
  // Build nav item style with active/hover support - scaled
  function getNavItemStyle(element, item = null) {
    const s = element.style || {};
    const isActive = item ? isNavItemActive(item) : false;
    
    // Calculate background color with opacity (default: transparent for unified bar)
    const bgColor = s.itemBackgroundColor || '#ffffff';
    const bgOpacity = s.itemBackgroundOpacity ?? 0;
    const bgRgba = hexToRgba(bgColor, bgOpacity);
    
    // Active state colors
    const activeBgColor = s.activeBackgroundColor || '#6366f1';
    const activeBgOpacity = s.activeBackgroundOpacity ?? 0.9;
    const activeBgRgba = hexToRgba(activeBgColor, activeBgOpacity);
    
    // Icon position affects flex direction
    const iconPos = s.iconPosition || 'left';
    let flexDir = 'row';
    if (iconPos === 'top') flexDir = 'column';
    else if (iconPos === 'bottom') flexDir = 'column-reverse';
    else if (iconPos === 'right') flexDir = 'row-reverse';
    
    // Scale sizes
    const itemPadding = (s.itemPadding || 12) * scale;
    const itemBorderRadius = (s.itemBorderRadius || 8) * scale;
    const fontSize = (s.fontSize || 15) * scale;
    const gap = (iconPos === 'only' ? 0 : 6) * scale;
    const minWidth = 60 * scale;
    
    const baseStyle = {
      background: isActive ? activeBgRgba : bgRgba,
      color: isActive ? (s.activeTextColor || '#ffffff') : (s.itemColor || '#ffffff'),
      padding: `${itemPadding}px`,
      borderRadius: `${itemBorderRadius}px`,
      border: 'none',
      cursor: interactive ? 'pointer' : 'default',
      fontFamily: 'inherit',
      fontSize: `${fontSize}px`,
      fontWeight: '500',
      display: 'flex',
      flexDirection: flexDir,
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${gap}px`,
      flex: element.layout === 'grid' ? '1 1 auto' : '1',
      minWidth: `${minWidth}px`,
      transition: 'all 0.15s ease',
      position: 'relative'
    };
    
    // Add active indicator styles (scaled)
    if (isActive && s.activeIndicator) {
      const indicatorWidth = 3 * scale;
      const borderWidth = 2 * scale;
      const glowSize = 20 * scale;
      switch (s.activeIndicator) {
        case 'underline':
          baseStyle.borderBottom = `${indicatorWidth}px solid ${s.activeTextColor || '#ffffff'}`;
          break;
        case 'border':
          baseStyle.border = `${borderWidth}px solid ${s.activeTextColor || '#ffffff'}`;
          break;
        case 'glow':
          baseStyle.boxShadow = `0 0 ${glowSize}px ${activeBgRgba}`;
          break;
        // 'background' and 'dot' handled differently
      }
    }
    
    return baseStyle;
  }
  
  // Helper to convert hex to rgba
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // Get icon style - scaled
  function getNavIconStyle(element) {
    const s = element.style || {};
    const iconSize = (s.iconSize || 20) * scale;
    return {
      width: `${iconSize}px`,
      height: `${iconSize}px`,
      flexShrink: '0'
    };
  }
  
  // Get hover CSS variables
  function getNavHoverVars(element) {
    const s = element.style || {};
    const hoverBgColor = s.hoverBackgroundColor || '#ffffff';
    const hoverBgOpacity = s.hoverBackgroundOpacity ?? 0.15;
    return {
      '--hover-bg': hexToRgba(hoverBgColor, hoverBgOpacity),
      '--hover-scale': s.hoverScale || 1.02
    };
  }
  
  // Build ping button style - scaled
  function getPingStyle(element) {
    const s = element.style || {};
    const fontSize = (s.fontSize || 20) * scale;
    const borderRadius = (s.borderRadius || 8) * scale;
    const gap = 8 * scale;
    
    return {
      background: s.background || '#ef4444',
      color: s.color || '#ffffff',
      fontSize: `${fontSize}px`,
      fontWeight: '600',
      borderRadius: `${borderRadius}px`,
      border: 'none',
      cursor: interactive ? 'pointer' : 'default',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${gap}px`,
      width: '100%',
      height: '100%',
      transition: 'all 0.2s ease'
    };
  }
  
  // Handle element click
  function handleElementClick(e, element) {
    if (!interactive) return;
    e.stopPropagation();
    dispatch('elementClick', { element });
  }
  
  // Handle element select (for edit mode)
  function handleElementSelect(e, element) {
    if (!editMode) return;
    // Background elements cannot be selected
    if (element.type === 'background') return;
    // Locked elements cannot be selected by clicking on canvas
    // (they can only be selected via the Layers panel)
    if (element.locked) return;
    e.stopPropagation();
    dispatch('elementSelect', { element });
  }
  
  // Handle element double-click (for edit mode - opens config)
  function handleElementDoubleClick(e, element) {
    if (!editMode) return;
    // Background elements cannot be configured
    if (element.type === 'background') return;
    e.stopPropagation();
    dispatch('elementDoubleClick', { element });
  }
  
  // Handle nav item action
  function handleNavAction(item) {
    if (!interactive) return;
    dispatch('navAction', { item, action: item.action });
  }
  
  // Handle ping action
  function handlePing(element) {
    if (!interactive) return;
    dispatch('ping', { pingName: element.ping_name, element });
  }
  
  // Convert style object to CSS string
  function styleToString(styleObj) {
    return Object.entries(styleObj)
      .map(([key, value]) => {
        // Handle vendor prefixes (webkit, moz, ms, o)
        let cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (cssKey.startsWith('webkit-') || cssKey.startsWith('moz-') || cssKey.startsWith('ms-') || cssKey.startsWith('o-')) {
          cssKey = '-' + cssKey;
        }
        return `${cssKey}: ${value}`;
      })
      .join('; ');
  }
</script>

<div 
  class="slide-renderer"
  class:show-grid={showGrid}
  style="
    width: {width * scale}px;
    height: {height * scale}px;
    background: {slide?.backgroundColor || '#000000'};
  "
  on:click={() => editMode && dispatch('backgroundClick')}
>
  {#each sortedElements as element (element.id)}
    <div 
      class="element-wrapper"
      class:selected={editMode && selectedElementId === element.id}
      class:interactive
      class:locked={editMode && element.locked}
      style={styleToString(getElementStyle(element))}
      on:click={(e) => editMode ? handleElementSelect(e, element) : handleElementClick(e, element)}
      on:dblclick={(e) => editMode && handleElementDoubleClick(e, element)}
    >
      <!-- Image Element -->
      {#if element.type === 'image'}
        <img 
          src={element.asset_id ? `/api/extensions/slidecast/protocol/asset/${element.asset_id}` : (element.src || '')}
          alt=""
          class="element-image"
          style={styleToString(getImageStyle(element))}
          draggable="false"
        />
      
      <!-- Video Element -->
      {:else if element.type === 'video'}
        {@const videoAutoplay = element.config?.autoplay !== false && element.playback?.autoplay !== false}
        {@const videoLoop = element.config?.loop !== false && element.playback?.loop !== false}
        {@const videoMuted = element.config?.muted !== false && element.playback?.muted !== false}
        <video 
          src={element.asset_id ? `/api/extensions/slidecast/protocol/asset/${element.asset_id}` : (element.src || '')}
          class="element-video"
          style={styleToString(getImageStyle(element))}
          autoplay={videoAutoplay}
          loop={videoLoop}
          muted={videoMuted}
          playsinline
        ></video>
      
      <!-- Background Element -->
      {:else if element.type === 'background'}
        <div 
          class="element-background"
          style="width: 100%; height: 100%; background-color: {element.style?.backgroundColor || '#1a1a2e'};"
        ></div>
      
      <!-- Text Element -->
      {:else if element.type === 'text'}
        <div 
          class="element-text"
          style={styleToString(getTextStyle(element))}
        >
          {resolveVariables(element.content)}
        </div>
      
      <!-- Shape Element -->
      {:else if element.type === 'shape'}
        <div 
          class="element-shape"
          style={styleToString(getShapeStyle(element))}
        ></div>
      
      <!-- Navigation Element -->
      {:else if element.type === 'nav'}
        <div 
          class="element-nav-container"
          style={styleToString(getNavContainerStyle(element))}
          on:click|stopPropagation={(e) => editMode && handleElementSelect(e, element)}
        >
          <div 
            class="element-nav"
            style={styleToString({...getNavStyle(element), ...getNavHoverVars(element)})}
          >
            {#each element.items || [] as item (item.id)}
              {@const isActive = isNavItemActive(item)}
              {@const iconPos = element.style?.iconPosition || 'left'}
              {@const iconSize = (element.style?.iconSize || 18) * scale}
              <button 
                class="nav-item"
                class:active={isActive}
                style={styleToString(getNavItemStyle(element, item))}
                on:click|stopPropagation={(e) => {
                  if (editMode) {
                    handleElementSelect(e, element);
                  } else {
                    handleNavAction(item);
                  }
                }}
              >
                {#if iconPos !== 'only' || !item.label}
                  {#if item.iconClass}
                    <i class="{item.iconClass}" style="font-size: {iconSize}px"></i>
                  {:else if item.iconSvg}
                    <svg 
                      style={styleToString(getNavIconStyle(element))}
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      stroke-width="2" 
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >{@html DOMPurify.sanitize(item.iconSvg, {USE_PROFILES: {svg: true}})}</svg>
                  {:else if item.icon}
                    <span class="nav-icon" style="font-size: {iconSize}px">{item.icon}</span>
                  {/if}
                {:else}
                  {#if item.iconClass}
                    <i class="{item.iconClass}" style="font-size: {iconSize}px"></i>
                  {:else if item.iconSvg}
                    <svg
                      style={styleToString(getNavIconStyle(element))}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >{@html DOMPurify.sanitize(item.iconSvg, {USE_PROFILES: {svg: true}})}</svg>
                  {:else if item.icon}
                    <span class="nav-icon" style="font-size: {iconSize}px">{item.icon}</span>
                  {/if}
                {/if}
                {#if iconPos !== 'only'}
                  <span class="nav-label">{item.label}</span>
                {/if}
                {#if isActive && element.style?.activeIndicator === 'dot'}
                  <span class="nav-active-dot" style="background: {element.style?.activeTextColor || '#ffffff'}"></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      
      <!-- Ping Button Element -->
      {:else if element.type === 'ping'}
        <button 
          class="element-ping"
          style={styleToString(getPingStyle(element))}
          on:click|stopPropagation={() => handlePing(element)}
        >
          {#if element.icon}<span class="ping-icon">{element.icon}</span>{/if}
          <span class="ping-label">{element.label}</span>
        </button>
      
      <!-- QR Code Element -->
      {:else if element.type === 'qr' || element.type === 'qrcode'}
        {@const qrUrl = element.data || element.config?.url || element.config?.data || 'https://example.com'}
        <div
          class="element-qrcode"
          style="
            background: {element.style?.background || element.style?.backgroundColor || '#ffffff'};
            padding: {(element.style?.padding || 8) * scale}px;
            border-radius: {(element.style?.borderRadius || 4) * scale}px;
          "
        >
          <img
            src={`/api/extensions/slidecast/protocol/qrcode?data=${encodeURIComponent(qrUrl)}&size=${Math.min(element.size?.width ?? element.width ?? 200, element.size?.height ?? element.height ?? 200)}&fgColor=${(element.style?.foreground || '#000000').replace('#', '')}&bgColor=${(element.style?.background || element.style?.backgroundColor || '#ffffff').replace('#', '')}`}
            alt="QR Code"
            class="qr-image"
          />
        </div>
      
      <!-- Widget Element (new dynamic widget system) -->
      {:else if element.type === 'widget'}
        <div class="element-widget" data-widget-id={element.widgetUuid}>
          {#if element._widgetRenderMode === 'image' && element._widgetImageUrl}
            <!-- Server-rendered image widget -->
            <img 
              src={element._widgetImageUrl}
              alt={element._widgetName || 'Widget'}
              class="widget-image"
              style="width: 100%; height: 100%; object-fit: contain;"
            />
          {:else if element._widgetRenderMode === 'native' && element._widgetPrimitives}
            <!-- Native-rendered widget -->
            <div class="widget-native" style="width: 100%; height: 100%;">
              {@html renderPrimitivesToHtml(element._widgetPrimitives)}
            </div>
          {:else if element._widgetLoading}
            <!-- Loading state -->
            <div class="widget-loading">
              <div class="widget-spinner"></div>
            </div>
          {:else if element._widgetError}
            <!-- Error state -->
            <div class="widget-error">
              <span class="error-icon">⚠️</span>
              <span class="error-text">{element._widgetError}</span>
            </div>
          {:else}
            <!-- Placeholder when no widget data -->
            <div class="widget-placeholder">
              <span class="placeholder-icon">📦</span>
              <span class="placeholder-text">{element.widgetName || 'Widget'}</span>
            </div>
          {/if}
        </div>

      <!-- Legacy: Widget Container (for grouped elements) -->
      {:else if element.type === 'widget-group'}
        <div class="element-widget-group">
          {#if element.children}
            {#each element.children as child (child.id)}
              <svelte:self 
                slide={{ elements: [child] }} 
                {variables}
                scale={1}
                width={element.size?.width ?? element.width ?? 100}
                height={element.size?.height ?? element.height ?? 100}
              />
            {/each}
          {/if}
        </div>
      {/if}
      
      <!-- Selection handles rendered by studio page for proper rotation support -->
    </div>
  {/each}
</div>

<style>
  .slide-renderer {
    position: relative;
    overflow: hidden;
    user-select: none;
  }
  
  .slide-renderer.show-grid {
    background-image: 
      linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 20px 20px;
  }
  
  .element-wrapper {
    box-sizing: border-box;
    overflow: hidden;
  }
  
  .element-wrapper.interactive {
    cursor: pointer;
  }
  
  .element-wrapper.locked {
    cursor: not-allowed;
  }
  
  .element-wrapper.locked::after {
    content: '🔒';
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 12px;
    opacity: 0.7;
    pointer-events: none;
    z-index: 9999;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  
  /* Selection outline handled by studio's drag overlay for proper rotation support */
  .element-wrapper.selected {
    /* outline removed - studio page handles selection box with rotation */
  }
  
  .element-image,
  .element-video {
    width: 100%;
    height: 100%;
    display: block;
  }
  
  .element-text {
    width: 100%;
    height: 100%;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    /* justify-content is set dynamically based on textAlign */
    box-sizing: border-box;
  }
  
  .element-shape {
    width: 100%;
    height: 100%;
  }

  .element-background {
    width: 100%;
    height: 100%;
  }

  .element-nav-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  
  .element-nav {
    width: 100%;
    height: 100%;
  }
  
  .nav-item {
    transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
    position: relative;
    overflow: visible;
  }
  
  .nav-item:hover {
    background: var(--hover-bg, rgba(255,255,255,0.2)) !important;
    transform: scale(var(--hover-scale, 1.05));
  }
  
  .nav-item:active {
    transform: scale(0.98);
  }
  
  .nav-item.active {
    font-weight: 600;
  }
  
  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .nav-label {
    white-space: nowrap;
  }
  
  .nav-active-dot {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  
  .element-ping {
    transition: transform 0.15s ease, filter 0.15s ease;
  }
  
  .element-ping:hover {
    filter: brightness(1.1);
    transform: scale(1.02);
  }
  
  .element-ping:active {
    transform: scale(0.98);
  }
  
  .element-qrcode {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .qr-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  
  .element-widget {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .element-widget-group {
    width: 100%;
    height: 100%;
    position: relative;
  }

  /* Widget styles — :global() wrappers matching shared-renderer/styles.css (for innerHTML-rendered content) */
  :global(.widget-native) { width: 100%; height: 100%; display: flex; flex-direction: column; }
  :global(.widget-native .widget-box) { display: flex; align-items: center; justify-content: center; }
  :global(.widget-native .widget-stack) { display: flex; }
  :global(.widget-native .widget-text) { white-space: pre-wrap; word-wrap: break-word; }
  :global(.widget-image) { width: 100%; height: 100%; object-fit: contain; }
  :global(.widget-placeholder) { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px; }
  :global(.widget-placeholder .placeholder-icon) { font-size: 24px; opacity: 0.5; }
  :global(.widget-placeholder .placeholder-text) { font-size: 12px; color: rgba(255,255,255,0.5); }
  :global(.widget-error) { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 16px; text-align: center; }
  :global(.widget-error .error-icon) { font-size: 24px; }
  :global(.widget-error .error-text) { font-size: 12px; color: #ef4444; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  :global(.widget-loading) { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); border-radius: 8px; }
  :global(.widget-spinner) { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.2); border-top-color: rgba(255,255,255,0.8); border-radius: 50%; animation: widget-spin 0.8s linear infinite; }
  @keyframes -global-widget-spin { to { transform: rotate(360deg); } }

  /* Selection handles now rendered by studio page for proper rotation support */
</style>
