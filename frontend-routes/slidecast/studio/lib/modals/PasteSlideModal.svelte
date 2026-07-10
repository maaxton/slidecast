<script>
  import { createEventDispatcher } from 'svelte';
  import * as store from '../stores/studioStore.js';
  import { get } from 'svelte/store';
  import * as actions from '../utils/studioActions.js';

  export let show = false;
  export let slideClipboard = null;
  export let clipboardOperation = null;
  export let cast = null;

  const dispatch = createEventDispatcher();

  $: currentGroupId = get(store.currentGroupId);
  $: sourceGroup = cast?.definition?.groups?.find(g => g.id === slideClipboard?.sourceGroupId);

  function close() {
    show = false;
    dispatch('close');
  }

  function pasteToGroup(groupId) {
    actions.pasteSlideToGroup(groupId);
  }
</script>

{#if show && slideClipboard}
  <div class="modal-overlay" data-testid="modal-paste-slide" on:click={close}>
    <div class="modal modal-sm" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Paste Slide</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <p>Paste <strong>"{slideClipboard.slide.name}"</strong> to which group?</p>
        <div class="paste-group-list">
          {#each cast?.definition?.groups || [] as group}
            <button 
              class="paste-group-option" 
              class:current={group.id === currentGroupId}
              on:click={() => pasteToGroup(group.id)}
            >
              {#if group.id === 'home'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              {/if}
              {group.name || 'Home'}
              {#if group.id === currentGroupId}
                <span class="current-badge">Current</span>
              {/if}
            </button>
          {/each}
        </div>
        {#if clipboardOperation === 'cut'}
          <p class="help-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            This is a cut operation. The slide will be moved from "{sourceGroup?.name || 'Home'}".
          </p>
        {/if}
      </div>
      <div class="modal-footer">
        <button 
          class="btn btn-secondary" 
          on:click={() => {
            close();
            if (clipboardOperation === 'cut') {
              dispatch('cancelCut');
            }
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}
