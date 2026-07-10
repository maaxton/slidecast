<script>
  export let editorContainer = null;
</script>

<!-- Editor Panel -->
<div class="editor-panel">
  <div class="panel-header">
    <span class="panel-title">Code Editor</span>
    <span class="panel-hint">Ctrl+S to save, Ctrl+Enter to run</span>
  </div>
  <div class="editor-container" bind:this={editorContainer}></div>
</div>

<style>
  .editor-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 0; /* Prevent flex overflow */
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .panel-title {
    font-size: 13px;
    font-weight: 500;
    color: #fff;
  }

  .panel-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }

  .editor-container {
    flex: 1;
    overflow: hidden;
    min-height: 200px; /* Ensure minimum height for Monaco */
  }
</style>
