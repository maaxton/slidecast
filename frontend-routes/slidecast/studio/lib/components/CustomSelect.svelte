<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  
  export let value = '';
  export let options = []; // Array of { value, label } objects
  
  const dispatch = createEventDispatcher();
  
  let isOpen = false;
  let triggerEl;
  let dropdownEl;
  let dropdownStyle = '';
  
  function toggle() {
    isOpen = !isOpen;
    if (isOpen) {
      positionDropdown();
    }
  }
  
  function select(option) {
    value = option.value;
    isOpen = false;
    dispatch('change', { value: option.value });
  }
  
  function positionDropdown() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    // Position dropdown below the trigger, using fixed positioning
    dropdownStyle = `
      position: fixed;
      top: ${rect.bottom + 4}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      z-index: 99999;
    `;
  }
  
  function handleClickOutside(e) {
    if (isOpen && triggerEl && !triggerEl.contains(e.target) && dropdownEl && !dropdownEl.contains(e.target)) {
      isOpen = false;
    }
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
    }
  }
  
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
  });
  
  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleKeydown);
  });
  
  $: selectedOption = options.find(o => o.value === value);
  $: selectedLabel = selectedOption?.label || value || 'Select...';
</script>

<div class="custom-select" bind:this={triggerEl}>
  <button type="button" class="custom-select-trigger" on:click={toggle} class:open={isOpen}>
    <span class="custom-select-value">{selectedLabel}</span>
    <svg class="custom-select-arrow" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
    </svg>
  </button>
</div>

{#if isOpen}
  <div class="custom-select-dropdown" style={dropdownStyle} bind:this={dropdownEl}>
    {#each options as option}
      <button 
        type="button"
        class="custom-select-option" 
        class:selected={option.value === value}
        on:click={() => select(option)}
      >
        {#if option.value === value}
          <svg class="check-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        {:else}
          <span class="check-spacer"></span>
        {/if}
        <span>{option.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .custom-select {
    position: relative;
    width: 100%;
  }
  
  .custom-select-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: white;
    font-size: 14px;
    cursor: pointer;
    text-align: left;
  }
  
  .custom-select-trigger:hover {
    border-color: rgba(255, 255, 255, 0.25);
  }
  
  .custom-select-trigger.open {
    border-color: rgba(99, 102, 241, 0.5);
  }
  
  .custom-select-value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .custom-select-arrow {
    width: 16px;
    height: 16px;
    opacity: 0.6;
    transition: transform 0.15s;
  }
  
  .custom-select-trigger.open .custom-select-arrow {
    transform: rotate(180deg);
  }
  
  .custom-select-dropdown {
    background: rgb(30, 32, 40);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    max-height: 300px;
    overflow-y: auto;
  }
  
  .custom-select-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    color: white;
    font-size: 14px;
    cursor: pointer;
    text-align: left;
  }
  
  .custom-select-option:hover {
    background: rgba(99, 102, 241, 0.2);
  }
  
  .custom-select-option.selected {
    background: rgb(59, 130, 246);
  }
  
  .check-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  
  .check-spacer {
    width: 16px;
    flex-shrink: 0;
  }
</style>
