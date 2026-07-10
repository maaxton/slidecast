<script>
  import { createEventDispatcher } from 'svelte';
  
  export let show = false;
  export let widgetId = null;
  export let assets = [];
  
  const dispatch = createEventDispatcher();
  
  let uploading = false;
  let uploadError = null;
  let dragOver = false;
  let fileInput;
  let previewAsset = null; // For lightbox
  
  function close() {
    dispatch('close');
  }
  
  function openPreview(asset) {
    if (asset.mimeType?.startsWith('image/')) {
      previewAsset = asset;
    }
  }
  
  function closePreview() {
    previewAsset = null;
  }
  
  function getAssetUrl(filename) {
    return `/api/extensions/slidecast/widgets/${widgetId}/assets/${encodeURIComponent(filename)}`;
  }
  
  async function handleUpload(files) {
    if (!files || files.length === 0) return;
    
    uploading = true;
    uploadError = null;
    
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`/api/extensions/slidecast/widgets/${widgetId}/assets`, {
          method: 'POST',
          credentials: 'same-origin',
          body: formData
        });
        
        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Upload failed');
        }
      }
      
      dispatch('refresh');
    } catch (err) {
      uploadError = err.message;
    } finally {
      uploading = false;
    }
  }
  
  function handleDrop(event) {
    event.preventDefault();
    dragOver = false;
    const files = event.dataTransfer?.files;
    if (files) handleUpload(files);
  }
  
  function handleDragOver(event) {
    event.preventDefault();
    dragOver = true;
  }
  
  function handleDragLeave() {
    dragOver = false;
  }
  
  function handleFileSelect(event) {
    const files = event.target.files;
    if (files) handleUpload(files);
  }
  
  async function deleteAsset(filename) {
    if (!confirm(`Delete ${filename}?`)) return;
    
    try {
      const response = await fetch(
        `/api/extensions/slidecast/widgets/${widgetId}/assets/${encodeURIComponent(filename)}`, 
        {
          method: 'DELETE',
          credentials: 'same-origin'
        }
      );
      
      const data = await response.json();
      if (data.success) {
        dispatch('refresh');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }
  
  function copyAssetUrl(filename) {
    const url = `{{assets.${filename}}}`;
    navigator.clipboard.writeText(url);
    dispatch('toast', { message: 'Copied to clipboard!', type: 'success' });
  }
  
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

{#if show}
  <div class="modal-overlay" on:click={close}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Widget Assets</h2>
        <button class="close-btn" on:click={close}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <div class="modal-body">
        <!-- Upload Zone -->
        <div 
          class="upload-zone" 
          class:drag-over={dragOver}
          class:uploading
          on:drop={handleDrop}
          on:dragover={handleDragOver}
          on:dragleave={handleDragLeave}
          role="button"
          tabindex="0"
          on:click={() => fileInput.click()}
          on:keypress={(e) => e.key === 'Enter' && fileInput.click()}
        >
          <input 
            bind:this={fileInput}
            type="file" 
            multiple 
            accept="image/*,.svg,.ico"
            on:change={handleFileSelect}
            hidden
          />
          
          {#if uploading}
            <div class="upload-spinner"></div>
            <p>Uploading...</p>
          {:else}
            <svg class="upload-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p>Drop images here or click to upload</p>
            <span class="hint">PNG, JPG, SVG, ICO</span>
          {/if}
        </div>
        
        {#if uploadError}
          <div class="error-message">{uploadError}</div>
        {/if}
        
        <!-- Asset Grid -->
        <div class="assets-grid">
          {#if assets.length === 0}
            <p class="no-assets">No assets uploaded yet</p>
          {:else}
            {#each assets as asset}
              <div class="asset-card">
                <div 
                  class="asset-thumbnail"
                  class:clickable={asset.mimeType?.startsWith('image/')}
                  on:click={() => openPreview(asset)}
                  on:keypress={(e) => e.key === 'Enter' && openPreview(asset)}
                  role="button"
                  tabindex="0"
                >
                  {#if asset.mimeType?.startsWith('image/')}
                    <img 
                      src={getAssetUrl(asset.filename)} 
                      alt={asset.filename}
                      loading="lazy"
                    />
                    <div class="zoom-hint">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  {:else}
                    <span class="file-icon">📎</span>
                  {/if}
                </div>
                <div class="asset-details">
                  <span class="asset-name" title={asset.filename}>{asset.filename}</span>
                  <span class="asset-meta">{formatSize(asset.size)}</span>
                </div>
                <div class="asset-actions">
                  <button 
                    class="action-btn copy" 
                    title="Copy template variable"
                    on:click|stopPropagation={() => copyAssetUrl(asset.filename)}
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button 
                    class="action-btn delete" 
                    title="Delete"
                    on:click|stopPropagation={() => deleteAsset(asset.filename)}
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
        
        <div class="usage-hint">
          <h4>Usage in Templates</h4>
          <code>{'{{assets.filename.png}}'}</code>
          <p>Use this syntax in your HTML template to reference assets</p>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={close}>Close</button>
      </div>
    </div>
  </div>
  
  <!-- Lightbox Preview -->
  {#if previewAsset}
    <div class="lightbox-overlay" on:click={closePreview}>
      <button class="lightbox-close" on:click={closePreview}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div class="lightbox-content" on:click|stopPropagation>
        <img 
          src={getAssetUrl(previewAsset.filename)} 
          alt={previewAsset.filename}
        />
        <div class="lightbox-info">
          <span class="lightbox-filename">{previewAsset.filename}</span>
          <span class="lightbox-size">{formatSize(previewAsset.size)}</span>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }
  
  .modal {
    background: #1a1a2e;
    border-radius: 16px;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    color: #fff;
  }
  
  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }
  
  .close-btn svg {
    width: 18px;
    height: 18px;
  }
  
  .modal-body {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
  }
  
  .upload-zone {
    border: 2px dashed rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    padding: 32px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 20px;
  }
  
  .upload-zone:hover,
  .upload-zone.drag-over {
    border-color: #667eea;
    background: rgba(102, 126, 234, 0.1);
  }
  
  .upload-zone.uploading {
    pointer-events: none;
    opacity: 0.7;
  }
  
  .upload-icon {
    width: 48px;
    height: 48px;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 12px;
  }
  
  .upload-zone p {
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 4px;
  }
  
  .upload-zone .hint {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .upload-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 12px;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error-message {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 12px;
    color: #ef4444;
    margin-bottom: 20px;
    font-size: 13px;
  }
  
  .assets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  
  .no-assets {
    text-align: center;
    color: rgba(255, 255, 255, 0.4);
    padding: 24px;
    grid-column: 1 / -1;
  }
  
  .asset-card {
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.2s;
  }
  
  .asset-card:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
  }
  
  .asset-thumbnail {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  
  .asset-thumbnail.clickable {
    cursor: pointer;
  }
  
  .asset-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 8px;
    transition: transform 0.2s;
  }
  
  .asset-thumbnail.clickable:hover img {
    transform: scale(1.05);
  }
  
  .asset-thumbnail .zoom-hint {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
  }
  
  .asset-thumbnail.clickable:hover .zoom-hint {
    opacity: 1;
  }
  
  .zoom-hint svg {
    width: 14px;
    height: 14px;
    color: #fff;
  }
  
  .asset-thumbnail .file-icon {
    font-size: 32px;
  }
  
  .asset-details {
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .asset-name {
    display: block;
    font-size: 11px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }
  
  .asset-meta {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .asset-actions {
    display: flex;
    gap: 2px;
    padding: 6px;
    justify-content: center;
  }
  
  .action-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }
  
  .action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
  
  .action-btn svg {
    width: 14px;
    height: 14px;
  }
  
  .usage-hint {
    background: rgba(102, 126, 234, 0.1);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 8px;
    padding: 16px;
  }
  
  .usage-hint h4 {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 8px;
    color: #667eea;
  }
  
  .usage-hint code {
    display: block;
    background: rgba(0, 0, 0, 0.3);
    padding: 8px 12px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: #a78bfa;
    margin-bottom: 8px;
  }
  
  .usage-hint p {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }
  
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0 0 16px 16px;
  }
  
  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  /* Lightbox Styles */
  .lightbox-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 40px;
    cursor: zoom-out;
  }
  
  .lightbox-close {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 10;
  }
  
  .lightbox-close:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
  
  .lightbox-close svg {
    width: 24px;
    height: 24px;
  }
  
  .lightbox-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 90vw;
    max-height: 80vh;
    cursor: default;
  }
  
  .lightbox-content img {
    max-width: 100%;
    max-height: calc(80vh - 60px);
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  
  .lightbox-info {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 16px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }
  
  .lightbox-filename {
    font-size: 14px;
    color: #fff;
    font-weight: 500;
  }
  
  .lightbox-size {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }
</style>
