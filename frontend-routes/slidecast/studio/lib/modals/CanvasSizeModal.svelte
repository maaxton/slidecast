<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;

  const dispatch = createEventDispatcher();

  function close() {
    show = false;
    dispatch('close');
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-canvas-size" on:click={close}>
    <div class="modal modal-sm" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Canvas Size</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <p class="help-text">Slidecast uses a fixed 16:9 aspect ratio optimized for modern displays and TVs.</p>
        <div class="canvas-size-display">
          <div class="size-preview">
            <div class="size-box">
              <span class="size-value">1920 × 1080</span>
              <span class="size-label">Full HD (16:9)</span>
            </div>
          </div>
        </div>
        <p class="info-text" style="margin-top: 1rem; font-size: 0.75rem; color: rgb(var(--color-text-secondary));">
          <i class="fa-solid fa-circle-info" style="margin-right: 0.25rem;"></i>Support for custom resolutions coming soon.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}
