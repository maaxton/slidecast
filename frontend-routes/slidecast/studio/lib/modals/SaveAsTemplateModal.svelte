<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let defaultName = 'My Template';
  export let saving = false;

  const dispatch = createEventDispatcher();

  let templateName = '';
  let templateDescription = '';

  function close() {
    show = false;
    templateName = '';
    templateDescription = '';
    dispatch('close');
  }

  function submit() {
    dispatch('save', { 
      name: templateName || defaultName, 
      description: templateDescription 
    });
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-save-template" on:click={close}>
    <div class="modal modal-sm" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Save as Template</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <p class="help-text">Save this cast as a reusable template. Templates can be used to quickly create new casts with the same structure.</p>
        <div class="form-row">
          <label>Template Name</label>
          <input 
            type="text" 
            bind:value={templateName}
            placeholder={defaultName}
          />
        </div>
        <div class="form-row">
          <label>Description</label>
          <textarea 
            bind:value={templateDescription}
            placeholder="Describe what this template is for..."
            rows="3"
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={close}>Cancel</button>
        <button class="btn btn-primary" on:click={submit} disabled={saving}>
          {#if saving}Saving...{:else}Save Template{/if}
        </button>
      </div>
    </div>
  </div>
{/if}
