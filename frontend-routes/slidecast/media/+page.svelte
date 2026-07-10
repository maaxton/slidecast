<script>
  import { onMount, onDestroy } from 'svelte';

  let media = [];
  let stats = {};
  let loading = true;
  let uploading = false;
  let uploadProgress = 0;

  let showDeleteModal = false;
  let selectedMedia = null;

  let dragActive = false;
  let fileInput = null;
  
  // Tabs
  let activeTab = 'images'; // 'images' or 'videos'

  // Video processing
  let videoCapabilities = null;
  let showLoopModal = false;
  let loopTarget = null;
  let loopDuration = 60;
  let loopTransition = 'none';
  let loopTransitionDuration = 1.5;
  let loopFadeInOut = false;
  let loopFadeDuration = 1.5;
  let loopQuality = 'medium';
  let loopResolution = 'original';
  let processingJob = null;
  let processingInterval = null;
  let loopEstimate = null;
  let estimateLoading = false;
  
  // Background jobs tracking
  let activeJobs = [];
  let previousJobCount = 0; // Track previous count to detect completion
  let backgroundJobsInterval = null;
  let lastJobId = null; // Track job ID when modal is closed

  function goto(path) {
    window.location.href = path;
  }

  onMount(async () => {
    await loadData();
    await checkVideoCapabilities();
    await checkActiveJobs();
    document.addEventListener('paste', handlePaste);
    
    // Poll for background jobs every 3 seconds
    backgroundJobsInterval = setInterval(checkActiveJobs, 3000);
  });

  onDestroy(() => {
    document.removeEventListener('paste', handlePaste);
    if (processingInterval) clearInterval(processingInterval);
    if (backgroundJobsInterval) clearInterval(backgroundJobsInterval);
  });
  
  async function checkActiveJobs() {
    try {
      const res = await fetch('/api/extensions/slidecast/media/video/jobs');
      const data = await res.json();
      if (data.success) {
        const newJobs = data.jobs || [];
        
        // Only refresh media when jobs complete (went from >0 to 0)
        if (previousJobCount > 0 && newJobs.length === 0 && !showLoopModal) {
          await loadData();
        }
        
        previousJobCount = newJobs.length;
        activeJobs = newJobs;
      }
    } catch (err) {
      // Silently fail - not critical
    }
  }

  async function checkVideoCapabilities() {
    try {
      const res = await fetch('/api/extensions/slidecast/media/video/capabilities');
      const data = await res.json();
      videoCapabilities = data;
    } catch (err) {
      console.error('Failed to check video capabilities:', err);
      videoCapabilities = { available: false };
    }
  }

  async function openLoopModal(item) {
    loopTarget = { ...item };
    showLoopModal = true;
    processingJob = null;
    loopEstimate = null;
    
    // Reset options to defaults
    loopTransition = 'none';
    loopTransitionDuration = 1.5;
    loopFadeInOut = false;
    loopFadeDuration = 1.5;
    loopQuality = 'medium';
    loopResolution = 'original';
    
    // Get full video info
    try {
      const res = await fetch(`/api/extensions/slidecast/media/${item.uuid}/info`);
      const data = await res.json();
      if (data.success) {
        loopTarget = { 
          ...loopTarget, 
          duration: data.duration,
          width: data.width,
          height: data.height,
          bitrate: data.bitrate,
          fps: data.fps,
          codec: data.codec
        };
        // Default loop duration to 2x video length
        loopDuration = Math.ceil(data.duration * 2);
        // Trigger initial estimate
        await updateEstimate();
      }
    } catch (err) {
      console.error('Failed to get video info:', err);
      // Fallback to duration endpoint
      if (!item.duration) {
        try {
          const res = await fetch(`/api/extensions/slidecast/media/${item.uuid}/duration`);
          const data = await res.json();
          if (data.success) {
            loopTarget.duration = data.duration;
            loopDuration = Math.ceil(data.duration * 2);
          }
        } catch (err2) {
          console.error('Failed to get video duration:', err2);
        }
      } else {
        loopDuration = Math.ceil(item.duration * 2);
      }
    }
  }
  
  async function updateEstimate() {
    if (!loopTarget?.uuid || !loopDuration) return;
    
    estimateLoading = true;
    try {
      const res = await fetch(`/api/extensions/slidecast/media/${loopTarget.uuid}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          targetDuration: loopDuration,
          transition: loopTransition,
          quality: loopQuality,
          resolution: loopResolution
        })
      });
      const data = await res.json();
      if (data.success) {
        loopEstimate = data.estimate;
      }
    } catch (err) {
      console.error('Failed to get estimate:', err);
    } finally {
      estimateLoading = false;
    }
  }
  
  // Debounce estimate updates
  let estimateTimeout = null;
  function debouncedEstimate() {
    if (estimateTimeout) clearTimeout(estimateTimeout);
    estimateTimeout = setTimeout(updateEstimate, 300);
  }

  async function startLoopJob() {
    if (!loopTarget || !loopDuration) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/media/${loopTarget.uuid}/loop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          targetDuration: loopDuration,
          transition: loopTransition,
          transitionDuration: loopTransitionDuration,
          fadeInOut: loopFadeInOut,
          fadeDuration: loopFadeDuration,
          quality: loopQuality,
          resolution: loopResolution
        })
      });
      
      const data = await res.json();
      if (data.success) {
        processingJob = data.job;
        // Start polling for progress
        pollJobProgress(data.jobId);
      } else {
        alert('Failed to start processing: ' + data.error);
      }
    } catch (err) {
      console.error('Failed to start loop job:', err);
      alert('Failed to start processing');
    }
  }

  function pollJobProgress(jobId) {
    if (processingInterval) clearInterval(processingInterval);
    
    processingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/extensions/slidecast/media/video/jobs/${jobId}`);
        const data = await res.json();
        
        if (data.success) {
          processingJob = data.job;
          
          if (data.job.status === 'complete') {
            clearInterval(processingInterval);
            processingInterval = null;
            // Reload media to show new video
            await loadData();
          } else if (data.job.status === 'failed') {
            clearInterval(processingInterval);
            processingInterval = null;
            alert('Processing failed: ' + (data.job.error || 'Unknown error'));
          }
        }
      } catch (err) {
        console.error('Failed to poll job progress:', err);
      }
    }, 1000);
  }

  function attemptCloseLoopModal() {
    // If processing, minimize to background (no confirmation needed)
    if (processingJob && processingJob.status === 'processing') {
      minimizeToBackground();
      return;
    }
    closeLoopModal();
  }
  
  function minimizeToBackground() {
    // Store the job ID so we can reopen it
    if (processingJob?.id) {
      lastJobId = processingJob.id;
    }
    // Close modal but job continues in background
    showLoopModal = false;
    loopTarget = null;
    processingJob = null;
    loopEstimate = null;
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }
    if (estimateTimeout) {
      clearTimeout(estimateTimeout);
      estimateTimeout = null;
    }
    // Refresh jobs list to show indicator
    checkActiveJobs();
  }
  
  function closeLoopModal() {
    showLoopModal = false;
    loopTarget = null;
    processingJob = null;
    loopEstimate = null;
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }
    if (estimateTimeout) {
      clearTimeout(estimateTimeout);
      estimateTimeout = null;
    }
    // Refresh jobs list
    checkActiveJobs();
  }
  
  async function reopenJobModal(jobId) {
    // Fetch job details and reopen modal
    try {
      const res = await fetch(`/api/extensions/slidecast/media/video/jobs/${jobId}`);
      const data = await res.json();
      if (data.success && data.job) {
        // Set up modal state from job
        processingJob = data.job;
        loopTarget = {
          name: data.job.sourceName,
          duration: data.job.sourceDuration
        };
        showLoopModal = true;
        
        // Resume polling if still processing
        if (data.job.status === 'processing') {
          pollJobProgress(jobId);
        }
      }
    } catch (err) {
      console.error('Failed to reopen job:', err);
    }
  }

  function formatDuration(seconds) {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  async function loadData() {
    loading = true;
    try {
      const [mediaRes, statsRes] = await Promise.all([
        fetch('/api/extensions/slidecast/media'),
        fetch('/api/extensions/slidecast/media/stats')
      ]);

      const mediaData = await mediaRes.json();
      const statsData = await statsRes.json();

      media = mediaData.media || [];
      stats = statsData.stats || {};
    } catch (err) {
      console.error('Failed to load media:', err);
    } finally {
      loading = false;
    }
  }

  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        await uploadFromBlob(blob, `Pasted ${new Date().toLocaleTimeString()}`);
        break;
      }
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    dragActive = true;
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragActive = false;
  }

  async function handleDrop(e) {
    e.preventDefault();
    dragActive = false;

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        await uploadFile(file);
      }
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      uploadFile(file);
    }
  }

  async function uploadFile(file) {
    uploading = true;
    uploadProgress = 0;

    try {
      const reader = new FileReader();
      
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgress = Math.round((e.loaded / e.total) * 100);
        }
      };

      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        
        const response = await fetch('/api/extensions/slidecast/media/base64', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: file.name,
            data: base64,
            mime_type: file.type
          })
        });

        const data = await response.json();
        if (data.success) {
          await loadData();
        }
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Failed to upload:', err);
    } finally {
      uploading = false;
    }
  }

  async function uploadFromBlob(blob, name) {
    uploading = true;

    try {
      const reader = new FileReader();
      
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        
        const response = await fetch('/api/extensions/slidecast/media/base64', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name,
            data: base64,
            mime_type: blob.type
          })
        });

        const data = await response.json();
        if (data.success) {
          await loadData();
        }
      };

      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Failed to upload:', err);
    } finally {
      uploading = false;
    }
  }

  async function deleteMedia() {
    if (!selectedMedia) return;

    try {
      await fetch(`/api/extensions/slidecast/media/${selectedMedia.uuid}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      showDeleteModal = false;
      selectedMedia = null;
      await loadData();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString();
  }
  
  function formatBitrate(bps) {
    if (!bps) return '--';
    if (bps >= 1000000) {
      return (bps / 1000000).toFixed(1) + ' Mbps';
    } else if (bps >= 1000) {
      return (bps / 1000).toFixed(0) + ' kbps';
    }
    return bps + ' bps';
  }
  
  // Filtered media based on active tab
  $: filteredMedia = media.filter(item => {
    if (activeTab === 'images') return item.type === 'image';
    if (activeTab === 'videos') return item.type === 'video';
    return true;
  });
</script>

<div class="media-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-content">
      <button class="back-btn" on:click={() => goto('/ext/slidecast')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>
      <h1>Media Library</h1>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" on:click={() => fileInput.click()}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Upload
      </button>
      <input 
        bind:this={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        style="display: none;"
        on:change={handleFileSelect}
      />
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs-container">
    <div class="tabs">
      <button 
        class="tab" 
        class:active={activeTab === 'images'}
        on:click={() => activeTab = 'images'}
      >
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Images
        <span class="tab-count">{stats.imageCount || 0}</span>
      </button>
      <button 
        class="tab" 
        class:active={activeTab === 'videos'}
        on:click={() => activeTab = 'videos'}
      >
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Videos
        <span class="tab-count">{stats.videoCount || 0}</span>
      </button>
    </div>
    <div class="storage-info">
      <span class="storage-text">{formatBytes(stats.totalSize)} / {formatBytes(stats.maxStorage)}</span>
      <div class="storage-bar-small">
        <div class="storage-fill" style="width: {stats.usedPercent || 0}%"></div>
      </div>
    </div>
  </div>

  <!-- Drop Zone -->
  <div 
    class="drop-zone"
    class:active={dragActive}
    class:uploading
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    {#if uploading}
      <div class="upload-progress">
        <div class="spinner"></div>
        <span>Uploading... {uploadProgress}%</span>
      </div>
    {:else}
      <div class="drop-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p>Drag & drop images or videos here, or <button class="link-btn" on:click={() => fileInput.click()}>browse</button></p>
      <span class="hint">You can also paste images from clipboard (Ctrl+V)</span>
    {/if}
  </div>

  <!-- Media Grid -->
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading media...</span>
    </div>
  {:else if filteredMedia.length === 0}
    <div class="empty-state">
      {#if activeTab === 'images'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p>No images uploaded yet</p>
      {:else}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p>No videos uploaded yet</p>
      {/if}
    </div>
  {:else}
    <div class="media-grid">
      {#each filteredMedia as item}
        <div class="media-card">
          <div class="media-preview">
            {#if item.type === 'video'}
              <div class="video-thumb-wrapper">
                <video 
                  src={item.url}
                  muted
                  preload="metadata"
                  on:loadeddata={(e) => { e.target.currentTime = 1; }}
                />
                <div class="video-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> Video</div>
              </div>
            {:else}
              <img src={item.url} alt={item.name} loading="lazy" />
            {/if}
          </div>
          <div class="media-info">
            <span class="media-name" title={item.name}>{item.name}</span>
            <span class="media-meta">{formatBytes(item.file_size)} • {formatDate(item.created_at)}</span>
          </div>
          <div class="media-actions">
            <a href={item.url} target="_blank" class="action-btn" title="View">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            {#if item.type === 'video' && videoCapabilities?.available}
              <button class="action-btn" title="Loop/Extend Video" on:click={() => openLoopModal(item)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            {/if}
            <button class="action-btn danger" title="Delete" on:click={() => { selectedMedia = item; showDeleteModal = true; }}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Delete Modal -->
{#if showDeleteModal && selectedMedia}
  <div class="modal-overlay" on:click={() => showDeleteModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Delete Media</h2>
        <button class="close-btn" on:click={() => showDeleteModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete "{selectedMedia.name}"?</p>
        <p class="warning">If this media is used in any casts, it will appear as missing.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showDeleteModal = false}>Cancel</button>
        <button class="btn btn-danger" on:click={deleteMedia}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Video Loop Modal -->
{#if showLoopModal && loopTarget}
  <div class="modal-overlay" on:click={attemptCloseLoopModal}>
    <div class="modal modal-wide" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Extend Video by Looping</h2>
        {#if processingJob?.status === 'processing'}
          <!-- Minimize button during processing -->
          <button class="close-btn minimize-btn" on:click={minimizeToBackground} title="Minimize to background">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        {:else if processingJob?.status !== 'complete'}
          <!-- X button before processing starts -->
          <button class="close-btn" on:click={closeLoopModal}>×</button>
        {/if}
        <!-- No button when complete - user clicks Done -->
      </div>
      <div class="modal-body">
        {#if processingJob && processingJob.status === 'processing'}
          <!-- Progress View -->
          <div class="processing-status">
            <div class="processing-icon">
              <svg class="spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <h3>Processing Video...</h3>
            <div class="progress-bar">
              <div class="progress-fill" style="width: {processingJob.progress || 0}%"></div>
            </div>
            <div class="progress-stats">
              <span class="stat-main">{processingJob.progress || 0}%</span>
              <span>{formatDuration(processingJob.currentTime)} / {formatDuration(processingJob.targetDuration)}</span>
            </div>
            <div class="progress-details">
              {#if processingJob.speed}
                <span class="detail-item">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  {processingJob.speed.toFixed(1)}x speed
                </span>
              {/if}
              {#if processingJob.elapsedSeconds}
                <span class="detail-item">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Elapsed: {formatDuration(processingJob.elapsedSeconds)}
                </span>
              {/if}
              {#if processingJob.eta}
                <span class="detail-item">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  ETA: {formatDuration(processingJob.eta)}
                </span>
              {/if}
            </div>
            <div class="processing-settings">
              <span class="setting-tag">{processingJob.qualityLabel || 'Medium Quality'}</span>
              {#if processingJob.resolution !== 'original'}
                <span class="setting-tag">{processingJob.resolutionLabel}</span>
              {/if}
            </div>
          </div>
        {:else if processingJob && processingJob.status === 'complete'}
          <!-- Complete View -->
          <div class="processing-complete">
            <div class="complete-icon">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3>Processing Complete!</h3>
            <p>Your extended video has been created and added to the library.</p>
            {#if processingJob.actualSize}
              <div class="complete-stats">
                <span>Final Size: {formatBytes(processingJob.actualSize)}</span>
                {#if processingJob.estimatedSize?.bytes}
                  <span class="estimate-comparison">
                    (estimated: {formatBytes(processingJob.estimatedSize.bytes)})
                  </span>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Configuration View -->
          <div class="loop-config">
            <div class="source-info">
              <div class="source-main">
                <strong>Source:</strong> {loopTarget.name}
                {#if loopTarget.duration}
                  <span class="duration-badge">{formatDuration(loopTarget.duration)}</span>
                {/if}
              </div>
              {#if loopTarget.width && loopTarget.height}
                <div class="source-details">
                  <span>{loopTarget.width}×{loopTarget.height}</span>
                  {#if loopTarget.fps}<span>{loopTarget.fps} fps</span>{/if}
                  {#if loopTarget.bitrate}<span>{formatBitrate(loopTarget.bitrate)}</span>{/if}
                </div>
              {/if}
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label for="loopDuration">Target Duration (seconds)</label>
                <input 
                  type="number" 
                  id="loopDuration" 
                  bind:value={loopDuration}
                  on:change={debouncedEstimate}
                  min="1"
                  max="3600"
                />
                <span class="help-text">
                  {#if loopTarget.duration}
                    ~{Math.ceil(loopDuration / loopTarget.duration)} loops
                  {/if}
                </span>
              </div>
            </div>

            <div class="form-section">
              <h4>Quality Settings</h4>
              
              <div class="form-row">
                <div class="form-group flex-1">
                  <label for="loopQuality">Quality</label>
                  <select id="loopQuality" bind:value={loopQuality} on:change={debouncedEstimate}>
                    {#if videoCapabilities?.features?.quality}
                      {#each videoCapabilities.features.quality as q}
                        <option value={q.id}>{q.label}</option>
                      {/each}
                    {:else}
                      <option value="high">High Quality</option>
                      <option value="medium">Medium Quality</option>
                      <option value="low">Low Quality</option>
                    {/if}
                  </select>
                  <span class="help-text">
                    {#if loopQuality === 'high'}
                      Visually lossless, larger files
                    {:else if loopQuality === 'medium'}
                      Good balance of quality and size
                    {:else}
                      Smaller files, faster processing
                    {/if}
                  </span>
                </div>
                
                <div class="form-group flex-1">
                  <label for="loopResolution">Resolution</label>
                  <select id="loopResolution" bind:value={loopResolution} on:change={debouncedEstimate}>
                    {#if videoCapabilities?.features?.resolution}
                      {#each videoCapabilities.features.resolution as r}
                        <option value={r.id}>{r.label}</option>
                      {/each}
                    {:else}
                      <option value="original">Original</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                    {/if}
                  </select>
                  <span class="help-text">
                    {#if loopResolution === 'original'}
                      Keep source resolution
                    {:else}
                      Scale to {loopResolution}
                    {/if}
                  </span>
                </div>
              </div>
            </div>

            <div class="form-section">
              <h4>Loop Transition</h4>
              
              <div class="form-group">
                <select id="loopTransition" bind:value={loopTransition} on:change={debouncedEstimate}>
                  <option value="none">None (hard cuts at loop points)</option>
                  <option value="crossfade">Crossfade (smooth transition)</option>
                </select>
              </div>

              {#if loopTransition === 'crossfade'}
                <div class="form-group">
                  <label for="loopTransitionDuration">Crossfade Duration (seconds)</label>
                  <input 
                    type="number" 
                    id="loopTransitionDuration" 
                    bind:value={loopTransitionDuration}
                    min="0.5"
                    max="5"
                    step="0.5"
                  />
                </div>
              {/if}
            </div>

            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={loopFadeInOut} on:change={debouncedEstimate} />
                <span>Fade In/Out from Black</span>
              </label>
              <span class="help-text">
                Adds a fade in from black at the start and fade out to black at the end of the final video.
              </span>
            </div>

            {#if loopFadeInOut}
              <div class="form-group">
                <label for="loopFadeDuration">Fade Duration (seconds)</label>
                <input 
                  type="number" 
                  id="loopFadeDuration" 
                  bind:value={loopFadeDuration}
                  min="0.5"
                  max="5"
                  step="0.5"
                />
              </div>
            {/if}

            <div class="estimate-box" class:loading={estimateLoading}>
              {#if estimateLoading}
                <div class="estimate-loading">
                  <div class="mini-spinner"></div>
                  <span>Calculating estimates...</span>
                </div>
              {:else if loopEstimate}
                <div class="estimate-row">
                  <div class="estimate-item">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span class="estimate-label">Processing Time:</span>
                    <span class="estimate-value">~{formatDuration(loopEstimate.processingTimeSeconds)}</span>
                  </div>
                  <div class="estimate-item">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span class="estimate-label">Estimated Size:</span>
                    <span class="estimate-value">~{formatBytes(loopEstimate.outputSizeBytes)}</span>
                  </div>
                </div>
                <div class="estimate-note">
                  Estimates are approximate and may vary based on video content
                </div>
              {:else}
                <div class="estimate-row">
                  <div class="estimate-item">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span class="estimate-label">Processing Time:</span>
                    <span class="estimate-value">
                      ~{formatDuration(loopTransition === 'none' && loopResolution === 'original' ? Math.ceil(loopDuration / 20) : Math.ceil(loopDuration / (loopQuality === 'low' ? 2 : loopQuality === 'high' ? 0.3 : 0.8)))}
                    </span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        {#if processingJob?.status === 'complete'}
          <button class="btn btn-primary" on:click={closeLoopModal}>Done</button>
        {:else if processingJob?.status === 'processing'}
          <button class="btn btn-secondary" disabled>Processing...</button>
        {:else}
          <button class="btn btn-secondary" on:click={closeLoopModal}>Cancel</button>
          <button class="btn btn-primary" on:click={startLoopJob} disabled={estimateLoading}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:16px;height:16px;margin-right:6px">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Start Processing
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Active Jobs Indicator -->
{#if activeJobs.length > 0 && !showLoopModal}
  <div class="jobs-indicator">
    <button class="jobs-badge" on:click={() => activeJobs.length === 1 ? reopenJobModal(activeJobs[0].id) : null}>
      <div class="jobs-spinner"></div>
      <span>{activeJobs.length} video{activeJobs.length > 1 ? 's' : ''} processing</span>
      {#if activeJobs.length === 1}
        <svg class="expand-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      {/if}
    </button>
    {#if activeJobs.length > 1}
      <div class="jobs-list">
        {#each activeJobs as job}
          <button class="job-item" on:click={() => reopenJobModal(job.id)}>
            <span class="job-name">{job.sourceName}</span>
            <span class="job-progress">{job.progress}%</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .media-page {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .back-btn {
    width: 40px;
    height: 40px;
    border: none;
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .back-btn:hover {
    background: rgb(var(--color-hover));
  }

  .back-btn svg {
    width: 20px;
    height: 20px;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    font-size: 0.875rem;
  }

  .btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn-secondary {
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    border: 1px solid rgb(var(--color-border));
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  /* Tabs */
  .tabs-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding: 0.5rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab:hover {
    background: rgb(var(--color-hover));
    color: rgb(var(--color-text));
  }

  .tab.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .tab svg {
    width: 18px;
    height: 18px;
  }

  .tab-count {
    background: rgba(255, 255, 255, 0.2);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
  }

  .tab:not(.active) .tab-count {
    background: rgb(var(--color-hover));
  }

  .storage-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-right: 0.5rem;
  }

  .storage-text {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    white-space: nowrap;
  }

  .storage-bar-small {
    width: 100px;
    height: 6px;
    background: rgb(var(--color-hover));
    border-radius: 3px;
    overflow: hidden;
  }

  .storage-fill {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    border-radius: 3px;
    transition: width 0.3s;
  }

  .drop-zone {
    border: 2px dashed rgb(var(--color-border));
    border-radius: 16px;
    padding: 3rem;
    text-align: center;
    margin-bottom: 2rem;
    transition: all 0.2s;
    background: rgb(var(--color-surface));
  }

  .drop-zone.active {
    border-color: rgb(var(--color-primary));
    background: rgba(var(--color-primary), 0.05);
  }

  .drop-zone.uploading {
    border-style: solid;
    border-color: rgb(var(--color-primary));
  }

  .drop-icon svg {
    width: 48px;
    height: 48px;
    margin: 0 auto 1rem;
    color: rgb(var(--color-text-secondary));
  }

  .drop-zone p {
    margin: 0;
    color: rgb(var(--color-text-secondary));
  }

  .drop-zone .hint {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .link-btn {
    background: none;
    border: none;
    color: rgb(var(--color-primary));
    cursor: pointer;
    text-decoration: underline;
  }

  .upload-progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1.5rem;
  }

  .media-card {
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .media-card:hover {
    border-color: rgb(var(--color-primary));
  }

  .media-preview {
    aspect-ratio: 16/9;
    background: rgb(var(--color-hover));
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .media-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-thumb-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
  }

  .video-thumb-wrapper video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: white;
    font-size: 0.7rem;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .media-info {
    padding: 0.75rem 1rem;
  }

  .media-name {
    display: block;
    font-weight: 500;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 0.25rem;
  }

  .media-meta {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .media-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0 1rem 0.75rem;
  }

  .action-btn {
    width: 32px;
    height: 32px;
    border: 1px solid rgb(var(--color-border));
    background: transparent;
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: rgb(var(--color-hover));
    color: rgb(var(--color-text));
  }

  .action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: #ef4444;
    color: #ef4444;
  }

  .action-btn svg {
    width: 16px;
    height: 16px;
  }

  .loading, .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: rgb(var(--color-text-secondary));
  }

  .empty-state svg {
    width: 64px;
    height: 64px;
    margin: 0 auto 1rem;
    opacity: 0.5;
  }

  .empty-state p {
    margin: 0;
  }

  /* Modals */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: rgb(var(--color-surface));
    border-radius: 16px;
    width: 100%;
    max-width: 400px;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .modal-header h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    font-size: 1.5rem;
    cursor: pointer;
    color: rgb(var(--color-text-secondary));
    border-radius: 8px;
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-body p {
    margin: 0 0 0.5rem;
  }

  .modal-body .warning {
    font-size: 0.875rem;
    color: #f59e0b;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgb(var(--color-border));
  }

  /* Video Loop Modal */
  .modal-wide {
    max-width: 560px;
  }

  .loop-config {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .source-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-hover));
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .source-main {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .source-details {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .duration-badge {
    background: rgb(var(--color-primary));
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .form-section h4 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: rgb(var(--color-text-secondary));
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .form-row {
    display: flex;
    gap: 1rem;
  }

  .flex-1 {
    flex: 1;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 500;
    font-size: 0.875rem;
  }

  .form-group input,
  .form-group select {
    padding: 0.625rem 0.875rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: rgb(var(--color-primary));
  }

  .checkbox-group {
    flex-direction: row;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 500;
  }

  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: rgb(var(--color-primary));
  }

  .help-text {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .estimate-box {
    padding: 1rem;
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .estimate-box.loading {
    opacity: 0.7;
  }

  .estimate-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: rgb(var(--color-text-secondary));
  }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .estimate-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  .estimate-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .estimate-item svg {
    width: 16px;
    height: 16px;
    color: rgb(var(--color-primary));
  }

  .estimate-label {
    color: rgb(var(--color-text-secondary));
  }

  .estimate-value {
    font-weight: 600;
  }

  .estimate-note {
    margin-top: 0.75rem;
    font-size: 0.7rem;
    color: rgb(var(--color-text-secondary));
    opacity: 0.8;
  }

  .processing-status,
  .processing-complete {
    text-align: center;
    padding: 1rem 0;
  }

  .processing-icon,
  .complete-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .processing-icon {
    background: rgba(99, 102, 241, 0.1);
    color: rgb(var(--color-primary));
  }

  .processing-icon svg {
    width: 32px;
    height: 32px;
  }

  .complete-icon {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }

  .complete-icon svg {
    width: 32px;
    height: 32px;
  }

  .processing-status h3,
  .processing-complete h3 {
    margin: 0 0 1rem;
    font-size: 1.125rem;
  }

  .progress-bar {
    height: 8px;
    background: rgb(var(--color-hover));
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    border-radius: 4px;
    transition: width 0.3s;
  }

  .progress-stats {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 1rem;
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }

  .stat-main {
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(var(--color-primary));
  }

  .progress-details {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 1rem;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-bottom: 0.75rem;
  }

  .detail-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .detail-item svg {
    width: 12px;
    height: 12px;
  }

  .processing-settings {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
  }

  .setting-tag {
    background: rgb(var(--color-hover));
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
  }

  .complete-stats {
    margin-top: 1rem;
    font-size: 0.875rem;
  }

  .estimate-comparison {
    color: rgb(var(--color-text-secondary));
    font-size: 0.75rem;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Minimize Button */
  .minimize-btn {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .minimize-btn svg {
    width: 20px;
    height: 20px;
  }

  .minimize-btn:hover {
    background: rgb(var(--color-hover));
  }

  /* Active Jobs Indicator */
  .jobs-indicator {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 900;
  }

  .jobs-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .jobs-badge:hover {
    border-color: rgb(var(--color-primary));
    background: rgb(var(--color-hover));
  }

  .jobs-badge .expand-icon {
    width: 16px;
    height: 16px;
    opacity: 0.6;
    margin-left: 0.25rem;
  }

  .jobs-badge:hover .expand-icon {
    opacity: 1;
  }

  .jobs-badge:hover + .jobs-list,
  .jobs-list:hover {
    display: block;
  }

  .jobs-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .jobs-list {
    display: none;
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 0.5rem;
    min-width: 200px;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }

  .job-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid rgb(var(--color-border));
    background: transparent;
    font-size: 0.813rem;
    cursor: pointer;
    transition: background 0.2s;
    text-align: left;
  }

  .job-item:hover {
    background: rgb(var(--color-hover));
  }

  .job-item:last-child {
    border-bottom: none;
  }

  .job-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }

  .job-progress {
    font-weight: 600;
    color: rgb(var(--color-primary));
  }
</style>


