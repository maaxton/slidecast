<script>
  import { createEventDispatcher } from 'svelte';
  
  export let show = false;
  export let slide = null;
  export let slideIndex = null;
  export let currentGroup = null;
  
  const dispatch = createEventDispatcher();
  
  // Computed values
  $: groupDefaults = { 
    duration: currentGroup?.defaultDuration || 10000,
    backgroundColor: currentGroup?.defaultBackgroundColor || '#1a1a2e'
  };
  $: groupAutoAdvance = currentGroup?.autoAdvance !== false;
  $: slideWillAutoAdvance = slide?.autoAdvance === undefined ? groupAutoAdvance : slide?.autoAdvance;
  
  function close() {
    dispatch('close');
  }
  
  function updateSlide() {
    dispatch('update');
  }
  
  function pushHistory(action) {
    dispatch('history', action);
  }
  
  function updateBackgroundColor(color) {
    dispatch('updateBackgroundColor', { slide, color });
  }
  
  function resetBackground() {
    dispatch('resetBackground', { slide, defaultColor: groupDefaults.backgroundColor });
  }
</script>

{#if show && slide}
  <div class="modal-overlay" data-testid="modal-slide-settings" on:click={close}>
    <div class="modal modal-md" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Slide Settings: {slide.name}</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <h4>General</h4>
          <div class="form-row">
            <label>Slide Name</label>
            <input type="text" bind:value={slide.name} on:input={() => { updateSlide(); pushHistory(); }} />
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Slide Advancement</h4>
          <div class="form-row">
            <div class="toggle-label-row">
              <span>Auto-advance this slide</span>
              <label class="toggle-switch">
              <input 
                type="checkbox" 
                checked={slide.autoAdvance === undefined ? groupAutoAdvance : slide.autoAdvance}
                on:change={(e) => { 
                  slide.autoAdvance = e.target.checked; 
                  updateSlide(); 
                  pushHistory(); 
                }} 
              />
                <span class="toggle-slider"></span>
            </label>
            </div>
            <p class="setting-hint">
              {#if slide.autoAdvance === undefined}
                <span class="inherit-badge">Inherited from Group</span>
                {#if groupAutoAdvance}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-left: 6px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Will advance after duration
                {:else}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-left: 6px;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 8l5 4-5 4"/></svg> Menu-driven (no auto-advance)
                {/if}
              {:else if slide.autoAdvance}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Will advance automatically after duration
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 8l5 4-5 4"/></svg> Stays on this slide until navigation
              {/if}
            </p>
            {#if slide.autoAdvance !== undefined}
              <button class="reset-to-group-btn" on:click={() => { slide.autoAdvance = undefined; updateSlide(); pushHistory(); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Reset to Group Setting
              </button>
            {/if}
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Timing & Appearance <span class="override-hint">(overrides group defaults)</span></h4>
          <div class="form-row">
            <label>
              Duration
              <span class="default-indicator">Group default: {groupDefaults.duration / 1000}s</span>
            </label>
            <div class="override-control">
              <select 
                bind:value={slide.duration} 
                on:change={() => { updateSlide(); pushHistory(); }}
                disabled={!slideWillAutoAdvance}
              >
                <option value={null}>Use Group Default ({groupDefaults.duration / 1000}s)</option>
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
                <option value={15000}>15 seconds</option>
                <option value={20000}>20 seconds</option>
                <option value={30000}>30 seconds</option>
                <option value={45000}>45 seconds</option>
                <option value={60000}>60 seconds</option>
                <option value={90000}>90 seconds</option>
                <option value={120000}>2 minutes</option>
              </select>
              {#if slide.duration}
                <button class="reset-btn" on:click={() => { slide.duration = null; updateSlide(); pushHistory(); }} title="Reset to group default"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
              {/if}
            </div>
            {#if !slideWillAutoAdvance}
              <p class="setting-hint warning">Duration not used when auto-advance is disabled</p>
            {/if}
          </div>
          <div class="form-row">
            <label>
              Background Color
              <span class="default-indicator">Group default: {groupDefaults.backgroundColor}</span>
            </label>
            <div class="override-control">
              <input 
                type="color" 
                value={slide._hasCustomBackground ? slide.backgroundColor : groupDefaults.backgroundColor}
                on:change={(e) => { 
                  slide._hasCustomBackground = true;
                  updateBackgroundColor(e.target.value);
                  updateSlide(); 
                  pushHistory('Change slide background color'); 
                }} 
              />
              {#if slide._hasCustomBackground}
                <button class="reset-btn" on:click={() => { 
                  resetBackground();
                  updateSlide(); 
                  pushHistory('Reset slide background to default'); 
                }} title="Reset to group default"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
              {/if}
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Transition Override</h4>
          <p class="help-text">Leave blank to use the group's transition settings.</p>
          <div class="form-row">
            <label>Transition Type</label>
            <div class="override-control">
              <select 
                value={slide.transition?.type || ''} 
                on:change={(e) => { 
                  if (!slide.transition) slide.transition = {};
                  slide.transition.type = e.target.value || null;
                  if (!e.target.value) slide.transition = null;
                  updateSlide(); 
                  pushHistory(); 
                }}
              >
                <option value="">Use Group Default</option>
                <option value="fade">Fade</option>
                <option value="cut">Cut (instant)</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="slide-up">Slide Up</option>
                <option value="slide-down">Slide Down</option>
              </select>
              {#if slide.transition?.type}
                <button class="reset-btn" on:click={() => { slide.transition = null; updateSlide(); pushHistory(); }} title="Reset to group default"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
              {/if}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Styles inherited from main page CSS */
</style>
