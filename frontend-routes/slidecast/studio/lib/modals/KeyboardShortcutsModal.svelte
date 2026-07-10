<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let modKey = '⌘';

  const dispatch = createEventDispatcher();

  function close() {
    show = false;
    dispatch('close');
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-keyboard-shortcuts" on:click={close}>
    <div class="modal modal-md" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Keyboard Shortcuts</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body shortcuts-grid">
        <div class="shortcut-section">
          <h4>File</h4>
          <div class="shortcut-row"><span>Save</span><kbd>{modKey}S</kbd></div>
        </div>
        
        <div class="shortcut-section">
          <h4>Edit</h4>
          <div class="shortcut-row"><span>Undo</span><kbd>{modKey}Z</kbd></div>
          <div class="shortcut-row"><span>Redo</span><kbd>{modKey}⇧Z</kbd></div>
          <div class="shortcut-row"><span>Cut</span><kbd>{modKey}X</kbd></div>
          <div class="shortcut-row"><span>Copy</span><kbd>{modKey}C</kbd></div>
          <div class="shortcut-row"><span>Paste</span><kbd>{modKey}V</kbd></div>
          <div class="shortcut-row"><span>Duplicate</span><kbd>{modKey}D</kbd></div>
          <div class="shortcut-row"><span>Delete</span><kbd>⌫</kbd></div>
          <div class="shortcut-row"><span>Deselect</span><kbd>Esc</kbd></div>
        </div>
        
        <div class="shortcut-section">
          <h4>View</h4>
          <div class="shortcut-row"><span>Zoom In</span><kbd>{modKey}+</kbd></div>
          <div class="shortcut-row"><span>Zoom Out</span><kbd>{modKey}-</kbd></div>
          <div class="shortcut-row"><span>Zoom to Fit</span><kbd>{modKey}0</kbd></div>
          <div class="shortcut-row"><span>Scroll Zoom</span><kbd>Scroll Wheel</kbd></div>
          <div class="shortcut-row"><span>Pan Canvas</span><kbd>Middle Mouse</kbd></div>
        </div>
        
        <div class="shortcut-section">
          <h4>Arrange</h4>
          <div class="shortcut-row"><span>Bring to Front</span><kbd>{modKey}⇧]</kbd></div>
          <div class="shortcut-row"><span>Bring Forward</span><kbd>{modKey}]</kbd></div>
          <div class="shortcut-row"><span>Send Backward</span><kbd>{modKey}[</kbd></div>
          <div class="shortcut-row"><span>Send to Back</span><kbd>{modKey}⇧[</kbd></div>
        </div>
        
        <div class="shortcut-section">
          <h4>Move Element</h4>
          <div class="shortcut-row"><span>Move 1px</span><kbd>Arrow Keys</kbd></div>
          <div class="shortcut-row"><span>Move 10px</span><kbd>⇧ + Arrow Keys</kbd></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}
