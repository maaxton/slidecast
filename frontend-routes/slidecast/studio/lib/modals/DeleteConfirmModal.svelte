<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let type = 'layer'; // 'layer', 'slide', 'group'
  export let itemName = '';
  export let slideCount = 0; // For group deletion

  const dispatch = createEventDispatcher();

  const titles = {
    layer: 'Delete Layer',
    slide: 'Delete Slide',
    group: 'Delete Group'
  };

  const messages = {
    layer: 'Are you sure you want to delete this layer?',
    slide: 'Are you sure you want to delete this slide?',
    group: `Are you sure you want to delete the "${itemName}" group?`
  };

  const subMessages = {
    layer: 'This action cannot be undone.',
    slide: 'All layers on this slide will be permanently removed.',
    group: `This will permanently delete all ${slideCount} slide(s) in this group.`
  };

  function close() {
    show = false;
    dispatch('close');
  }

  function confirm() {
    dispatch('confirm');
    close();
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-delete-confirm" on:click={close}>
    <div class="modal modal-confirm" on:click|stopPropagation>
      <div class="modal-header danger">
        <span class="modal-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
        <h2>{titles[type]}</h2>
      </div>
      <div class="modal-body">
        <p>{type === 'group' ? messages.group : messages[type]}</p>
        <p class="text-secondary">{type === 'group' ? subMessages.group : subMessages[type]}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={close}>Cancel</button>
        <button class="btn btn-danger" on:click={confirm}>Delete {type.charAt(0).toUpperCase() + type.slice(1)}</button>
      </div>
    </div>
  </div>
{/if}
