<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let title = 'Confirm';
  export let message = 'Are you sure?';
  export let confirmText = 'Confirm';
  export let cancelText = 'Cancel';
  export let variant = 'danger'; // 'danger', 'warning', 'primary'

  const dispatch = createEventDispatcher();

  function close() {
    show = false;
    dispatch('close');
  }

  function confirm() {
    dispatch('confirm');
    close();
  }

  function cancel() {
    dispatch('cancel');
    close();
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-confirm" on:click={cancel}>
    <div class="modal modal-sm" on:click|stopPropagation>
      <div class="modal-header">
        <h2>{title}</h2>
        <button class="close-btn" on:click={cancel}>×</button>
      </div>
      <div class="modal-body">
        <p>{message}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={cancel}>{cancelText}</button>
        <button class="btn btn-{variant}" on:click={confirm}>{confirmText}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
    isolation: isolate;
  }

  .modal {
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 90vw;
    overflow: hidden;
  }

  .modal-sm {
    width: 400px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 20px;
    color: rgb(var(--color-text-muted));
  }

  .close-btn:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .modal-body {
    padding: 20px;
  }

  .modal-body p {
    margin: 0;
    color: rgb(var(--color-text-muted));
    line-height: 1.5;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    background: rgb(var(--color-surface-alt));
    border-top: 1px solid rgb(var(--color-border));
  }

  .btn {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary {
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    color: rgb(var(--color-text));
  }

  .btn-secondary:hover {
    background: rgb(var(--color-surface));
  }

  .btn-danger {
    background: rgb(239, 68, 68);
    color: white;
  }

  .btn-danger:hover {
    background: rgb(220, 38, 38);
  }

  .btn-warning {
    background: rgb(245, 158, 11);
    color: white;
  }

  .btn-warning:hover {
    background: rgb(217, 119, 6);
  }

  .btn-primary {
    background: rgb(var(--color-primary));
    color: white;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }
</style>
