<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;

  const dispatch = createEventDispatcher();

  let newGroupName = '';

  function close() {
    show = false;
    newGroupName = '';
    dispatch('close');
  }

  function submit() {
    if (newGroupName.trim()) {
      dispatch('create', { name: newGroupName.trim() });
      close();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && newGroupName.trim()) {
      submit();
    }
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-add-group" on:click={close}>
    <div class="modal modal-sm" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Add Group</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <p class="help-text">Groups let you organize slides into separate sections. Use navigation elements to switch between groups.</p>
        <div class="form-row">
          <label>Group Name</label>
          <input 
            type="text" 
            bind:value={newGroupName} 
            placeholder="e.g., Specials, Menu, About" 
            class="group-name-field"
            on:keydown={handleKeydown}
          />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <button 
          class="btn btn-primary" 
          disabled={!newGroupName.trim()}
          on:click={submit}
        >
          Create Group
        </button>
      </div>
    </div>
  </div>
{/if}
