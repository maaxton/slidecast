<script>
  import { createEventDispatcher } from 'svelte';
  
  export let element = null;
  export let currentSlide = null;
  
  const dispatch = createEventDispatcher();
  
  function onColorChange() {
    // Mark as custom background and update the slide's backgroundColor
    if (currentSlide) {
      currentSlide._hasCustomBackground = true;
      currentSlide.backgroundColor = element.style.backgroundColor;
    }
    dispatch('change', { property: 'background color' });
  }
</script>

{#if element?.type === 'background'}
<div class="prop-group">
  <h4>Background</h4>
  <div class="prop-row">
    <label>Color</label>
    <input 
      type="color" 
      value={element.style.backgroundColor || '#1a1a2e'} 
      on:input={(e) => { element.style.backgroundColor = e.target.value; onColorChange(); }}
    />
  </div>
</div>
{/if}
