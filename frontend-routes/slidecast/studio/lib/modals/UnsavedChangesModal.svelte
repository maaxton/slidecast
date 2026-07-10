<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;

  const dispatch = createEventDispatcher();

  function cancel() {
    dispatch('cancel');
    show = false;
  }

  function discard() {
    dispatch('discard');
    show = false;
  }

  function save() {
    dispatch('save');
    show = false;
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-unsaved-changes" on:click={cancel}>
    <div class="modal modal-confirm" on:click|stopPropagation>
      <div class="modal-header warning">
        <span class="modal-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </span>
        <h2>Unsaved Changes</h2>
      </div>
      <div class="modal-body">
        <p>You have unsaved changes. What would you like to do?</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={cancel}>Cancel</button>
        <button class="btn btn-danger" on:click={discard}>Discard Changes</button>
        <button class="btn btn-primary" on:click={save}>Save & Continue</button>
      </div>
    </div>
  </div>
{/if}
