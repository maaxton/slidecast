<script>
  import { createEventDispatcher } from 'svelte';
  
  export let widget = null;
  export let activeFile = 'client'; // 'server', 'client', 'template'
  export let assets = [];
  
  const dispatch = createEventDispatcher();
  
  function selectFile(file) {
    dispatch('select', { file });
  }
  
  function openAssetManager() {
    dispatch('openAssets');
  }
  
  // Determine which files exist/are relevant
  $: hasServerCode = !!widget?.serverCode;
  $: hasClientCode = !!widget?.clientCode || !!widget?.code;
  $: hasTemplate = !!widget?.htmlTemplate;
</script>

<div class="file-tree">
  <div class="tree-section">
    <h4>Code Files</h4>
    
    <button 
      class="tree-item" 
      class:active={activeFile === 'server'}
      on:click={() => selectFile('server')}
    >
      <span class="file-icon">📦</span>
      <span class="file-name">server.js</span>
      {#if hasServerCode}
        <span class="file-badge has-content">•</span>
      {:else}
        <span class="file-badge empty">+</span>
      {/if}
    </button>
    
    <button 
      class="tree-item" 
      class:active={activeFile === 'template'}
      on:click={() => selectFile('template')}
    >
      <span class="file-icon">📄</span>
      <span class="file-name">template.html</span>
      {#if hasTemplate}
        <span class="file-badge has-content">•</span>
      {:else}
        <span class="file-badge empty">+</span>
      {/if}
    </button>
    
    <button 
      class="tree-item" 
      class:active={activeFile === 'client'}
      on:click={() => selectFile('client')}
    >
      <span class="file-icon">⚡</span>
      <span class="file-name">client.js</span>
      {#if hasClientCode}
        <span class="file-badge has-content">•</span>
      {:else}
        <span class="file-badge empty">+</span>
      {/if}
    </button>
  </div>
  
  <div class="tree-section">
    <h4>Assets</h4>
    
    <button class="tree-item assets-btn" on:click={openAssetManager}>
      <span class="file-icon">🖼️</span>
      <span class="file-name">assets/</span>
      <span class="file-badge count">{assets.length}</span>
    </button>
    
    {#each assets.slice(0, 5) as asset}
      <div class="tree-item asset-item" title={asset.filename}>
        <span class="file-icon">{asset.mimeType?.startsWith('image/') ? '🖼️' : '📎'}</span>
        <span class="file-name truncate">{asset.filename}</span>
      </div>
    {/each}
    
    {#if assets.length > 5}
      <button class="tree-item more-assets" on:click={openAssetManager}>
        <span class="file-name">+{assets.length - 5} more...</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .file-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
  }
  
  .tree-section {
    margin-bottom: 16px;
  }
  
  .tree-section h4 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 8px;
    padding: 0 8px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .tree-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }
  
  .tree-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  
  .tree-item.active {
    background: rgba(102, 126, 234, 0.2);
    color: #667eea;
  }
  
  .tree-item.asset-item {
    padding-left: 24px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    cursor: default;
  }
  
  .tree-item.asset-item:hover {
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
  }
  
  .tree-item.more-assets {
    padding-left: 24px;
    font-size: 11px;
    color: rgba(102, 126, 234, 0.8);
  }
  
  .tree-item.more-assets:hover {
    color: #667eea;
  }
  
  .file-icon {
    font-size: 14px;
    width: 18px;
    text-align: center;
  }
  
  .file-name {
    flex: 1;
  }
  
  .file-name.truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
  
  .file-badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
  }
  
  .file-badge.has-content {
    color: #10b981;
    font-size: 16px;
  }
  
  .file-badge.empty {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.4);
  }
  
  .file-badge.count {
    background: rgba(102, 126, 234, 0.2);
    color: #667eea;
  }
  
  .assets-btn {
    margin-bottom: 4px;
  }
</style>
