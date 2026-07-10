<script>
  import { createEventDispatcher } from 'svelte';
  
  // Sub-components
  import PositionSizeProps from './properties/PositionSizeProps.svelte';
  import TransformProps from './properties/TransformProps.svelte';
  import GradientMaskProps from './properties/GradientMaskProps.svelte';
  import ShadowProps from './properties/ShadowProps.svelte';
  import BorderProps from './properties/BorderProps.svelte';
  import BackgroundProps from './properties/BackgroundProps.svelte';
  import TextProps from './properties/TextProps.svelte';
  import ImageProps from './properties/ImageProps.svelte';
  import ShapeProps from './properties/ShapeProps.svelte';
  import WidgetProps from './properties/WidgetProps.svelte';
  import NavProps from './properties/NavProps.svelte';
  import QRProps from './properties/QRProps.svelte';
  import PingProps from './properties/PingProps.svelte';
  import VideoProps from './properties/VideoProps.svelte';
  
  // Props
  export let element = null;
  export let currentSlide = null;
  export let widgets = [];
  export let collapsed = false;
  export let show = true;
  
  const dispatch = createEventDispatcher();
  
  // Computed title
  $: title = element?.name || (element ? element.type.charAt(0).toUpperCase() + element.type.slice(1) : 'Properties');
  
  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('toggleCollapse', { collapsed });
  }
  
  function duplicateElement() {
    dispatch('duplicate');
  }
  
  function deleteElement() {
    dispatch('delete');
  }
  
  // Forward events from sub-components
  function handleChange(e) {
    dispatch('change', e.detail);
  }
  
  function handleUpdate() {
    dispatch('update');
  }
  
  function handleHistory(e) {
    dispatch('history', e.detail);
  }
  
  function handleOpenConfig(e) {
    dispatch('openConfig', e.detail);
  }
  
  function handleOpenMedia() {
    dispatch('openMedia');
  }
  
  function handleRefreshWidget(e) {
    dispatch('refreshWidget', e.detail);
  }
</script>

{#if show}
<div class="right-panel properties-panel" class:collapsed data-testid="properties-panel">
  <div class="panel-header" on:click={toggleCollapse} data-testid="properties-panel-header">
    <h3>{title}</h3>
    <div class="panel-actions">
      {#if element && !collapsed && element.type !== 'background' && !element.locked}
        <button class="icon-btn" title="Duplicate" on:click|stopPropagation={duplicateElement} data-testid="properties-duplicate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
        <button class="icon-btn danger" title="Delete" on:click|stopPropagation={deleteElement} data-testid="properties-delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      {/if}
      {#if element && !collapsed && element.locked}
        <span class="locked-icon" title="Layer is locked">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
        </span>
      {/if}
      <button class="icon-btn">{collapsed ? '‹' : '›'}</button>
    </div>
  </div>
  
  {#if !collapsed}
  <div class="panel-content">
    {#if element}
      {#if element.locked}
        <div class="locked-notice" data-testid="properties-locked-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
          <span>Layer is locked</span>
          <p>Unlock this layer in the Layers panel to edit its properties.</p>
        </div>
      {/if}
      <div class="properties-content" class:locked={element.locked}>
        
        <!-- Background Element -->
        <BackgroundProps 
          {element} 
          {currentSlide}
          on:change={handleChange}
        />
        
        {#if element.type !== 'background'}
          <!-- Position & Size (shared) -->
          <PositionSizeProps 
            {element} 
            hideSize={element.type === 'widget'}
            on:change={handleChange}
          />
          
          <!-- Transforms (shared) -->
          <TransformProps 
            {element}
            on:change={handleChange}
          />
          
          <!-- Gradient Mask (shared) -->
          <GradientMaskProps 
            {element}
            on:update={handleUpdate}
            on:history={handleHistory}
          />
          
          <!-- Shadow (shared) -->
          <ShadowProps 
            {element}
            on:update={handleUpdate}
            on:history={handleHistory}
          />
          
          <!-- Border (shared) -->
          <BorderProps 
            {element}
            on:update={handleUpdate}
            on:history={handleHistory}
          />
        {/if}
        
        <!-- Element-specific properties -->
        <TextProps 
          {element}
          on:change={handleChange}
          on:openConfig={handleOpenConfig}
        />
        
        <ImageProps 
          {element}
          on:update={handleUpdate}
          on:openMedia={handleOpenMedia}
        />
        
        <ShapeProps 
          {element}
          on:change={handleChange}
        />
        
        <WidgetProps 
          {element}
          {widgets}
          on:change={handleChange}
          on:openConfig={handleOpenConfig}
          on:refreshWidget={handleRefreshWidget}
        />
        
        <NavProps 
          {element}
          on:openConfig={handleOpenConfig}
        />
        
        <QRProps 
          {element}
          on:change={handleChange}
          on:openConfig={handleOpenConfig}
        />
        
        <PingProps 
          {element}
          on:change={handleChange}
        />
        
        <VideoProps 
          {element}
          on:update={handleUpdate}
          on:openMedia={handleOpenMedia}
        />
        
      </div>
    {:else}
      <div class="no-selection" data-testid="properties-empty">
        <p>Select an element to edit</p>
      </div>
    {/if}
  </div>
  {/if}
</div>
{/if}

<style>
  .properties-panel {
    display: flex;
    flex-direction: column;
    background: rgb(var(--color-surface));
    border-left: 1px solid rgb(var(--color-border));
    overflow: hidden;
  }
  
  .properties-panel.collapsed {
    width: 40px;
  }
  
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: rgb(var(--color-surface-alt));
    border-bottom: 1px solid rgb(var(--color-border));
    cursor: pointer;
    user-select: none;
  }
  
  .panel-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  
  .panel-actions {
    display: flex;
    gap: 4px;
  }
  
  .icon-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }
  
  .icon-btn:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }
  
  .icon-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
  }
  
  .locked-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: rgb(234, 179, 8);
  }
  
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  
  .properties-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .no-selection {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgb(var(--color-text-muted));
  }
  
  .no-selection p {
    margin: 0;
    font-size: 13px;
  }
  
  .locked-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    margin-bottom: 12px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 8px;
    color: rgb(234, 179, 8);
    text-align: center;
  }
  
  .locked-notice svg {
    opacity: 0.8;
  }
  
  .locked-notice span {
    font-weight: 600;
    font-size: 13px;
  }
  
  .locked-notice p {
    margin: 0;
    font-size: 11px;
    color: rgb(var(--color-text-muted));
    line-height: 1.4;
  }
  
  .properties-content.locked {
    opacity: 0.5;
    pointer-events: none;
    user-select: none;
  }
  
  /* Global styles for prop groups (shared across sub-components) */
  :global(.prop-group) {
    margin-bottom: 16px;
  }
  
  :global(.prop-group h4) {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--color-text-muted));
  }
  
  :global(.prop-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  :global(.prop-row label) {
    flex: 0 0 70px;
    font-size: 12px;
    color: rgb(var(--color-text-muted));
  }
  
  :global(.prop-row input[type="number"]),
  :global(.prop-row input[type="text"]),
  :global(.prop-row select) {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    font-size: 12px;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    color: rgb(var(--color-text));
  }
  
  :global(.prop-row input[type="color"]) {
    width: 32px;
    height: 28px;
    padding: 2px;
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    cursor: pointer;
  }
  
  :global(.slider-with-value) {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  :global(.slider-with-value input[type="range"]) {
    flex: 1;
  }
  
  :global(.slider-with-value .slider-value) {
    flex: 0 0 45px;
    font-size: 11px;
    color: rgb(var(--color-text-muted));
    text-align: right;
  }
  
  :global(.btn-group) {
    display: flex;
    gap: 4px;
  }
  
  :global(.flip-btn) {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    cursor: pointer;
    color: rgb(var(--color-text-muted));
    transition: all 0.15s ease;
  }
  
  :global(.flip-btn:hover) {
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
  }
  
  :global(.flip-btn.active) {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
    color: white;
  }
  
  :global(.prop-group.collapsible) {
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    overflow: hidden;
  }
  
  :global(.prop-group.collapsible .collapsible-header) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgb(var(--color-surface-alt));
    cursor: pointer;
    user-select: none;
  }
  
  :global(.prop-group.collapsible .collapse-icon) {
    font-size: 10px;
    color: rgb(var(--color-text-muted));
  }
  
  :global(.prop-group.collapsible.collapsed) {
    border-color: transparent;
    background: rgb(var(--color-surface-alt));
    border-radius: 6px;
  }
  
  :global(.prop-group.collapsible:not(.collapsed) > :not(.collapsible-header)) {
    padding: 12px;
  }
  
  :global(.toggle-switch) {
    position: relative;
    display: inline-flex;
    width: 44px;
    height: 24px;
    margin-left: auto;
    flex-shrink: 0;
  }

  :global(.toggle-switch input) {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  :global(.toggle-switch .toggle-slider) {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    transition: background 0.2s, border-color 0.2s;
  }

  :global(.toggle-switch .toggle-slider:before) {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 3px !important;
    top: 3px !important;
    bottom: auto !important;
    transform: none !important;
    background: white;
    border-radius: 50%;
    transition: left 0.2s;
    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
  }

  :global(.toggle-switch input:checked + .toggle-slider) {
    background: rgb(var(--color-primary));
    border-color: rgb(var(--color-primary));
  }

  :global(.toggle-switch input:checked + .toggle-slider:before) {
    left: 23px !important;
    transform: none !important;
  }

  :global(.toggle-switch.small) {
    width: 36px;
    height: 20px;
  }

  :global(.toggle-switch.small .toggle-slider:before) {
    height: 14px;
    width: 14px;
    left: 2px !important;
    top: 2px !important;
  }

  :global(.toggle-switch.small input:checked + .toggle-slider:before) {
    left: 18px !important;
  }
</style>
