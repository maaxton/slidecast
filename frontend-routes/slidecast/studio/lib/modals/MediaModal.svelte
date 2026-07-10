<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let mediaLibrary = [];
  export let uploadingMedia = false;

  const dispatch = createEventDispatcher();

  let isDraggingMedia = false;
  let mediaFileInput = null;
  let importUrl = '';
  let importingUrl = false;

  function close() {
    show = false;
    dispatch('close');
  }

  function handleMediaDrop(e) {
    isDraggingMedia = false;
    const files = e.dataTransfer?.files;
    if (files?.length) {
      dispatch('upload', { files });
    }
  }

  function handleMediaFileSelect(e) {
    const files = e.target?.files;
    if (files?.length) {
      dispatch('upload', { files });
    }
  }

  function selectMedia(media) {
    dispatch('select', { media });
    close();
  }

  function importFromUrl() {
    if (!importUrl) return;
    importingUrl = true;
    dispatch('importUrl', { url: importUrl });
    // Parent will set importingUrl = false when done
  }

  // Reset import state when import completes
  export function resetImport() {
    importingUrl = false;
    importUrl = '';
  }
</script>

{#if show}
  <div class="modal-overlay" data-testid="modal-media" on:click={close}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Media Library</h2>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      <div class="modal-body">
        <div 
          class="upload-zone"
          data-testid="media-upload-zone"
          class:dragover={isDraggingMedia} 
          on:dragover|preventDefault={() => isDraggingMedia = true} 
          on:dragleave={() => isDraggingMedia = false} 
          on:drop|preventDefault={handleMediaDrop} 
          on:click={() => mediaFileInput?.click()}
          role="button"
          tabindex="0"
          on:keypress={(e) => e.key === 'Enter' && mediaFileInput?.click()}
        >
          <input type="file" accept="image/*,video/*" style="display: none" bind:this={mediaFileInput} on:change={handleMediaFileSelect} data-testid="media-file-input" />
          <p><strong>Click to upload</strong> or drag and drop</p>
          <p class="hint">Images or Videos</p>
        </div>
        {#if uploadingMedia}
          <div class="upload-progress">
            <div class="spinner"></div>
            <span>Uploading...</span>
          </div>
        {/if}
        
        <!-- URL Import -->
        <div class="url-import-section">
          <h4>Import from URL</h4>
          <div class="url-import-row">
            <input type="url" bind:value={importUrl} placeholder="https://example.com/video.mp4" class="url-input" data-testid="media-url-input" />
            <button class="btn btn-primary" on:click={importFromUrl} disabled={importingUrl || !importUrl} data-testid="media-url-import">
              {importingUrl ? 'Importing...' : 'Import'}
            </button>
          </div>
          <p class="hint">Paste a direct link to an image or video file</p>
        </div>

        {#if mediaLibrary.length > 0}
          <h4>Library</h4>
          <div class="media-grid">
            {#each mediaLibrary as media}
              <div 
                class="media-item"
                data-testid="media-item"
                data-media-uuid={media.uuid}
                on:click={() => selectMedia(media)}
                role="button"
                tabindex="0"
                on:keypress={(e) => e.key === 'Enter' && selectMedia(media)}
              >
                {#if media.type === 'video'}
                  <div class="media-video-thumb">
                    <video 
                      src={media.url || `/api/extensions/slidecast/protocol/asset/${media.uuid}`}
                      muted
                      preload="metadata"
                      on:loadeddata={(e) => { e.target.currentTime = 1; }}
                    />
                    <div class="video-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </div>
                  </div>
                {:else}
                  <img src={media.url || `/api/extensions/slidecast/protocol/asset/${media.uuid}`} alt={media.name} />
                {/if}
                <span class="media-name">{media.name}</span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <p>No media uploaded yet</p>
          </div>
        {/if}
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
    isolation: isolate; /* Create new stacking context */
  }

  .modal {
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 90vw;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-lg {
    width: 700px;
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
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: rgba(var(--color-text), 0.1);
    color: rgb(var(--color-text));
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .upload-zone {
    border: 2px dashed rgb(var(--color-border));
    border-radius: 8px;
    padding: 32px;
    text-align: center;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-bottom: 20px;
  }

  .upload-zone:hover,
  .upload-zone.dragover {
    border-color: rgb(var(--color-primary));
    background: rgba(var(--color-primary), 0.05);
  }

  .upload-zone p {
    margin: 0;
    color: rgb(var(--color-text-muted));
  }

  .upload-zone p strong {
    color: rgb(var(--color-primary));
  }

  .hint {
    font-size: 12px;
    margin-top: 4px !important;
    opacity: 0.7;
  }

  .upload-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    background: rgba(var(--color-primary), 0.1);
    border-radius: 6px;
    margin-bottom: 16px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgb(var(--color-primary) / 0.3);
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .url-import-section {
    margin-bottom: 20px;
    padding: 16px;
    background: rgb(var(--color-surface-alt));
    border-radius: 8px;
  }

  .url-import-section h4 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
  }

  .url-import-row {
    display: flex;
    gap: 8px;
  }

  .url-input {
    flex: 1;
    padding: 8px 12px;
    font-size: 13px;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    color: rgb(var(--color-text));
  }

  .modal-body h4 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: rgb(var(--color-text-muted));
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .media-item {
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .media-item:hover {
    border-color: rgb(var(--color-primary));
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .media-item img,
  .media-video-thumb video {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
  }

  .media-video-thumb {
    position: relative;
  }

  .video-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .media-name {
    display: block;
    padding: 8px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-state {
    text-align: center;
    padding: 40px;
    color: rgb(var(--color-text-muted));
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

  .btn-primary {
    background: rgb(var(--color-primary));
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
