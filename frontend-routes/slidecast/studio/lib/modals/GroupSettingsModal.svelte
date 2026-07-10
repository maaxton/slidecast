<script>
  import { createEventDispatcher } from 'svelte';
  
  export let show = false;
  export let currentGroup = null;
  export let cast = null;
  
  const dispatch = createEventDispatcher();
  
  function close() {
    dispatch('close');
  }
  
  function updateCast() {
    dispatch('update');
  }
  
  function pushHistory(action) {
    dispatch('history', action);
  }
  
  function updateGroupDefaultBackgrounds(color) {
    dispatch('updateDefaultBackgrounds', { group: currentGroup, color });
  }
</script>

{#if show && currentGroup}
  <div class="modal-overlay" data-testid="modal-group-settings" on:click={close}>
    <div class="modal modal-md" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Group Settings: {currentGroup.name || 'Home'}</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <h4>General</h4>
          {#if currentGroup.id !== 'home'}
          <div class="form-row">
            <label>Group Name</label>
            <input type="text" bind:value={currentGroup.name} on:input={() => { updateCast(); pushHistory(); }} />
          </div>
          {:else}
          <p class="help-text">The Home group cannot be renamed.</p>
          {/if}
          <div class="form-row">
            <div class="toggle-label-row">
              <span>Loop slides in this group</span>
              <label class="toggle-switch">
                <input type="checkbox" bind:checked={currentGroup.loop} on:change={() => { updateCast(); pushHistory(); }} />
                <span class="toggle-slider"></span>
            </label>
            </div>
            <p class="setting-hint">
              {#if currentGroup.loop}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Slides will loop continuously
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> Plays through once, stays on last slide
              {/if}
            </p>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Slide Advancement</h4>
          <div class="form-row">
            <div class="toggle-label-row">
              <span>Auto-advance slides</span>
              <label class="toggle-switch">
              <input 
                type="checkbox" 
                checked={currentGroup.autoAdvance !== false}
                on:change={(e) => { currentGroup.autoAdvance = e.target.checked; updateCast(); pushHistory(); }} 
              />
                <span class="toggle-slider"></span>
            </label>
            </div>
            <p class="setting-hint">
              {#if currentGroup.autoAdvance !== false}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Slides advance automatically based on duration
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 8l5 4-5 4"/></svg> Menu-driven navigation only (no auto-advance)
              {/if}
            </p>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Default Slide Settings</h4>
          <p class="help-text">These are defaults for new slides. Each slide can override these.</p>
          <div class="form-row">
            <label>Default Duration</label>
            <select 
              value={currentGroup.defaultDuration || 10000} 
              on:change={(e) => { currentGroup.defaultDuration = parseInt(e.target.value); updateCast(); pushHistory(); }}
              disabled={currentGroup.autoAdvance === false}
            >
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
            {#if currentGroup.autoAdvance === false}
              <p class="setting-hint warning">Duration not used when auto-advance is disabled</p>
            {/if}
          </div>
          <div class="form-row">
            <label>Default Background</label>
            <input 
              type="color" 
              value={currentGroup.defaultBackgroundColor || '#1a1a2e'} 
              on:change={(e) => { 
                currentGroup.defaultBackgroundColor = e.target.value; 
                updateGroupDefaultBackgrounds(e.target.value);
                updateCast(); 
                pushHistory('Change group default background'); 
              }} 
            />
          </div>
        </div>
        
        <div class="settings-section">
          <h4>Transition Settings</h4>
          <div class="form-row">
            <label>Transition Type</label>
            <select 
              value={currentGroup.transition?.type || cast?.definition?.settings?.transition?.type || 'fade'} 
              on:change={(e) => { 
                if (!currentGroup.transition) currentGroup.transition = {}; 
                currentGroup.transition.type = e.target.value; 
                updateCast(); 
                pushHistory(); 
              }}
            >
              <option value="fade">Fade</option>
              <option value="cut">Cut (instant)</option>
              <option value="slide-left">Slide Left</option>
              <option value="slide-right">Slide Right</option>
              <option value="slide-up">Slide Up</option>
              <option value="slide-down">Slide Down</option>
            </select>
          </div>
          {#if (currentGroup.transition?.type || 'fade') !== 'cut'}
          <div class="form-row">
            <label>Transition Speed</label>
            <select 
              value={currentGroup.transition?.duration || cast?.definition?.settings?.transition?.duration || 500} 
              on:change={(e) => { 
                if (!currentGroup.transition) currentGroup.transition = {}; 
                currentGroup.transition.duration = parseInt(e.target.value); 
                updateCast(); 
                pushHistory(); 
              }}
            >
              <option value={300}>Fast (0.3s)</option>
              <option value={500}>Normal (0.5s)</option>
              <option value={800}>Slow (0.8s)</option>
              <option value={1000}>Very Slow (1s)</option>
              <option value={1500}>Extra Slow (1.5s)</option>
              <option value={2000}>Super Slow (2s)</option>
            </select>
          </div>
          {/if}
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
