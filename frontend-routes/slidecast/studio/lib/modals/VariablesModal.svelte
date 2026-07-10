<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let cast = null;

  const dispatch = createEventDispatcher();

  function close() {
    show = false;
    dispatch('close');
  }

  function addVariable() {
    const name = prompt('Variable name:');
    if (name) { 
      cast.definition.variables[name] = ''; 
      dispatch('update');
    }
  }

  function deleteVariable(key) {
    delete cast.definition.variables[key];
    dispatch('update');
  }

  function updateVariable() {
    dispatch('update');
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-variables" on:click={close}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Variables</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <p class="help-text">Use <code>{"{{name}}"}</code> in text elements</p>
        {#each Object.entries(cast?.definition?.variables || {}) as [key, value]}
          <div class="variable-row">
            <input type="text" value={key} disabled />
            <input type="text" bind:value={cast.definition.variables[key]} on:input={updateVariable} />
            <button class="icon-btn danger" on:click={() => deleteVariable(key)}>×</button>
          </div>
        {/each}
        <button class="btn btn-ghost" on:click={addVariable}>+ Add Variable</button>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}
