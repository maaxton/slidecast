<script>
  import { onMount, onDestroy } from 'svelte';
  import SlideRenderer from './lib/SlideRenderer.svelte';

  // State
  let casts = [];
  let screens = [];
  let storageStats = {};
  let templates = [];
  let widgetCount = 0;
  let loading = true;
  let error = null;

  // Modal states
  let showNewCastModal = false;
  let showTemplateModal = false;
  let showDeleteModal = false;
  let showAssignModal = false;
  let showDeleteTemplateModal = false;
  let showImportModal = false;
  let showCacheModal = false;
  let selectedCast = null;
  let newCastName = '';
  let selectedTemplate = null;
  let templateToDelete = null;
  
  // Import state
  let importUrl = '';
  let importFile = null;
  let importForce = false;
  let importWidgets = true;
  let importCache = true;
  let importing = false;
  let exportingCast = null;

  // Export options state
  let showExportModal = false;
  let exportCastTarget = null;
  let exportPreview = null;
  let exportLoading = false;
  let exportIncludeWidgets = true;
  let exportIncludeCache = false;

  // Cache state
  let castCacheStatus = {}; // Map of castId -> cache status
  let cacheModalCast = null;
  let cacheModalStatus = null;
  let cacheModalLoading = false;
  let activeCacheJobs = []; // Active cache rendering jobs
  let cachePollingInterval = null;
  let showActiveJobsModal = false; // Combined view of all active cache jobs

  // Toast state
  let toasts = [];
  let toastId = 0;

  function showToast(message, type = 'info', duration = 3000) {
    const id = ++toastId;
    toasts = [...toasts, { id, message, type }];
    setTimeout(() => {
      toasts = toasts.filter(t => t.id !== id);
    }, duration);
  }

  // Navigation
  function goto(path) {
    window.location.href = path;
  }

  onMount(async () => {
    await loadData();
    // Start polling for cache status updates
    cachePollingInterval = setInterval(updateActiveCacheJobs, 3000);
  });

  onDestroy(() => {
    if (cachePollingInterval) {
      clearInterval(cachePollingInterval);
    }
  });

  async function loadData() {
    loading = true;
    try {
      const [castsRes, screensRes, statsRes, templatesRes, widgetsRes] = await Promise.all([
        fetch('/api/extensions/slidecast/casts'),
        fetch('/api/extensions/slidecast/screens'),
        fetch('/api/extensions/slidecast/media/stats'),
        fetch('/api/extensions/slidecast/templates'),
        fetch('/api/extensions/slidecast/widgets')
      ]);

      const castsData = await castsRes.json();
      const screensData = await screensRes.json();
      const statsData = await statsRes.json();
      const templatesData = await templatesRes.json();
      const widgetsData = await widgetsRes.json();

      casts = castsData.casts || [];
      screens = screensData.screens || [];
      storageStats = statsData.stats || {};
      templates = templatesData.templates || [];
      widgetCount = widgetsData.widgets?.length || 0;

      // Load cache status for all casts (non-blocking)
      loadAllCacheStatus();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function createCast() {
    if (!newCastName.trim()) {
      showToast('Please enter a cast name', 'error');
      return;
    }

    try {
      const response = await fetch('/api/extensions/slidecast/casts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newCastName })
      });

      const data = await response.json();
      if (data.success) {
        showToast(`Cast "${newCastName}" created`, 'success');
        goto(`/ext/slidecast/studio?id=${data.cast.uuid}`);
      } else {
        showToast(data.error || 'Failed to create cast', 'error');
      }
    } catch (err) {
      console.error('Failed to create cast:', err);
      showToast('Failed to create cast', 'error');
    }
  }

  async function createFromTemplate() {
    if (!selectedTemplate) return;

    try {
      const castName = newCastName || `${selectedTemplate.name} Copy`;
      const response = await fetch(`/api/extensions/slidecast/templates/${selectedTemplate.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: castName })
      });

      const data = await response.json();
      if (data.success) {
        showToast(`Cast "${castName}" created from template`, 'success');
        goto(`/ext/slidecast/studio?id=${data.cast.uuid}`);
      } else {
        showToast(data.error || 'Failed to create from template', 'error');
      }
    } catch (err) {
      console.error('Failed to create from template:', err);
      showToast('Failed to create from template', 'error');
    }
  }

  function confirmDeleteTemplate(template) {
    templateToDelete = template;
    showDeleteTemplateModal = true;
  }

  async function deleteTemplate() {
    if (!templateToDelete) return;
    
    try {
      const response = await fetch(`/api/extensions/slidecast/templates/${templateToDelete.id}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        templates = templates.filter(t => t.id !== templateToDelete.id);
        if (selectedTemplate?.id === templateToDelete.id) {
          selectedTemplate = null;
        }
        showToast(`Template "${templateToDelete.name}" deleted`, 'success');
      } else {
        showToast(data.error || 'Failed to delete template', 'error');
      }
    } catch (err) {
      console.error('Failed to delete template:', err);
      showToast('Failed to delete template', 'error');
    } finally {
      showDeleteTemplateModal = false;
      templateToDelete = null;
    }
  }

  async function duplicateCast(cast) {
    try {
      const response = await fetch(`/api/extensions/slidecast/casts/${cast.id}/duplicate`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Cast duplicated`, 'success');
        await loadData();
      } else {
        showToast(data.error || 'Failed to duplicate cast', 'error');
      }
    } catch (err) {
      console.error('Failed to duplicate cast:', err);
      showToast('Failed to duplicate cast', 'error');
    }
  }

  async function deleteCast() {
    if (!selectedCast) return;

    try {
      const response = await fetch(`/api/extensions/slidecast/casts/${selectedCast.id}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Cast "${selectedCast.name}" deleted`, 'success');
      } else {
        showToast(data.error || 'Failed to delete cast', 'error');
      }
      showDeleteModal = false;
      selectedCast = null;
      await loadData();
    } catch (err) {
      console.error('Failed to delete cast:', err);
      showToast('Failed to delete cast', 'error');
    }
  }

  async function assignCast(screenSerial) {
    if (!selectedCast) return;

    try {
      const response = await fetch(`/api/extensions/slidecast/screens/${screenSerial}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cast_id: selectedCast.uuid })
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Cast assigned to screen`, 'success');
      } else {
        showToast(data.error || 'Failed to assign cast', 'error');
      }
      showAssignModal = false;
      await loadData();
    } catch (err) {
      console.error('Failed to assign cast:', err);
      showToast('Failed to assign cast', 'error');
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getOnlineScreenCount() {
    // Count screens where the Waiveo app is connected (not just device online)
    return screens.filter(s => s.app_connected === true).length;
  }

  function getFirstSlide(cast) {
    const def = cast.definition || cast;
    // New structure: groups contain slides
    if (def?.groups?.length > 0) {
      const firstGroup = def.groups[0];
      if (firstGroup?.slides?.length > 0) {
        return firstGroup.slides[0];
      }
    }
    // Legacy fallback: flat slides array
    if (def?.slides?.length > 0) {
      return def.slides[0];
    }
    return null;
  }

  function getCastVariables(cast) {
    const def = cast.definition || cast;
    return def?.variables || {};
  }

  // Open export options modal
  async function openExportModal(cast) {
    exportCastTarget = cast;
    exportPreview = null;
    exportLoading = true;
    showExportModal = true;
    exportIncludeWidgets = true;
    exportIncludeCache = false;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${cast.uuid}/export/preview`, {
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        exportPreview = data.preview;
      }
    } catch (err) {
      console.error('Failed to load export preview:', err);
    } finally {
      exportLoading = false;
    }
  }

  // Export cast as .cast file with options
  async function exportCast() {
    if (!exportCastTarget) return;
    
    const cast = exportCastTarget;
    exportingCast = cast.id;
    showExportModal = false;
    
    try {
      const params = new URLSearchParams({
        includeCustomWidgets: exportIncludeWidgets,
        includeCache: exportIncludeCache
      });
      
      const response = await fetch(`/api/extensions/slidecast/casts/${cast.uuid}/export?${params}`, {
        credentials: 'same-origin'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${cast.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}.cast`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Cast exported: ${filename}`, 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast(err.message || 'Failed to export cast', 'error');
    } finally {
      exportingCast = null;
      exportCastTarget = null;
    }
  }

  // Import cast from file or URL
  async function importCast() {
    if (!importFile && !importUrl.trim()) {
      showToast('Please select a file or enter a URL', 'error');
      return;
    }

    importing = true;
    try {
      let response;
      
      if (importFile) {
        // Upload file
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('force', importForce);
        formData.append('importWidgets', importWidgets);
        formData.append('importCache', importCache);

        response = await fetch('/api/extensions/slidecast/casts/import', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData
        });
      } else {
        // Import from URL
        response = await fetch('/api/extensions/slidecast/casts/import-url', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: importUrl,
            force: importForce,
            importWidgets,
            importCache
          })
        });
      }

      const data = await response.json();
      
      if (data.success) {
        showToast(`Cast imported: ${data.cast.name}`, 'success');
        showImportModal = false;
        importFile = null;
        importUrl = '';
        importForce = false;
        await loadData();
      } else {
        if (data.details) {
          // Dependency errors
          showToast(`Import failed: ${data.details.join(', ')}`, 'error', 5000);
        } else {
          showToast(data.error || 'Import failed', 'error');
        }
      }
    } catch (err) {
      console.error('Import failed:', err);
      showToast(err.message || 'Failed to import cast', 'error');
    } finally {
      importing = false;
    }
  }

  function handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
      importFile = file;
      importUrl = ''; // Clear URL when file is selected
    }
  }

  function clearImportFile() {
    importFile = null;
  }

  // ==================== CACHE MANAGEMENT ====================

  async function loadCacheStatus(castUuid) {
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${castUuid}/cache-status`);
      const data = await res.json();
      if (data.success) {
        // Create new object reference to properly trigger Svelte reactivity
        castCacheStatus = { ...castCacheStatus, [castUuid]: data };
      }
      return data;
    } catch (err) {
      console.error('Failed to load cache status:', err);
      return null;
    }
  }

  async function loadAllCacheStatus() {
    for (const cast of casts) {
      await loadCacheStatus(cast.uuid);
    }
  }

  async function updateActiveCacheJobs() {
    // Check for any active renders across all casts
    const jobs = [];
    for (const cast of casts) {
      const status = castCacheStatus[cast.uuid];
      if (status && (status.activeRenders > 0 || status.queuedRenders > 0)) {
        jobs.push({
          castId: cast.uuid,
          castName: cast.name,
          active: status.activeRenders,
          queued: status.queuedRenders,
          renderingSlides: status.renderingSlides || [],
          queuedSlides: status.queuedSlides || []
        });
      }
    }
    activeCacheJobs = jobs;
    
    // Refresh the status for active casts (after setting jobs to avoid flicker)
    for (const job of jobs) {
      await loadCacheStatus(job.castId);
    }

    // Also refresh modal if open
    if (showCacheModal && cacheModalCast) {
      const data = await loadCacheStatus(cacheModalCast.uuid);
      if (data?.success) {
        cacheModalStatus = data;
      }
    }
  }

  function getCacheStatusBadge(castUuid) {
    const status = castCacheStatus[castUuid];
    if (!status) return null;
    
    if (status.activeRenders > 0 || status.queuedRenders > 0) {
      return { type: 'rendering', label: 'Rendering...', color: 'blue' };
    }
    if (status.isFullyCached && !status.hasStale) {
      return { type: 'cached', label: 'Cached', color: 'green' };
    }
    if (status.hasStale) {
      return { type: 'stale', label: 'Stale', color: 'yellow' };
    }
    if (status.notCachedCount > 0) {
      return { type: 'partial', label: `${status.cachedCount}/${status.totalSlides}`, color: 'orange' };
    }
    return null;
  }

  async function openCacheModal(cast) {
    cacheModalCast = cast;
    cacheModalLoading = true;
    showCacheModal = true;
    
    const data = await loadCacheStatus(cast.uuid);
    if (data?.success) {
      cacheModalStatus = data;
    }
    cacheModalLoading = false;
  }

  function closeCacheModal() {
    showCacheModal = false;
    cacheModalCast = null;
    cacheModalStatus = null;
  }

  async function cacheAllSlides(force = false) {
    if (!cacheModalCast) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${cacheModalCast.uuid}/cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        // Refresh status
        setTimeout(async () => {
          const status = await loadCacheStatus(cacheModalCast.uuid);
          if (status?.success) {
            cacheModalStatus = status;
          }
        }, 1000);
      } else {
        showToast(data.error || 'Failed to start caching', 'error');
      }
    } catch (err) {
      console.error('Failed to cache slides:', err);
      showToast('Failed to start caching', 'error');
    }
  }

  async function cacheSlide(slideIndex, force = false) {
    if (!cacheModalCast) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${cacheModalCast.uuid}/cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slides: [slideIndex], force, priority: true })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Slide ${slideIndex + 1} queued for rendering`, 'success');
        // Refresh status
        setTimeout(async () => {
          const status = await loadCacheStatus(cacheModalCast.uuid);
          if (status?.success) {
            cacheModalStatus = status;
          }
        }, 1000);
      } else {
        showToast(data.error || 'Failed to cache slide', 'error');
      }
    } catch (err) {
      console.error('Failed to cache slide:', err);
      showToast('Failed to cache slide', 'error');
    }
  }

  async function clearCache() {
    if (!cacheModalCast) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${cacheModalCast.uuid}/cache`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        showToast('Cache cleared', 'success');
        // Refresh status
        const status = await loadCacheStatus(cacheModalCast.uuid);
        if (status?.success) {
          cacheModalStatus = status;
        }
      } else {
        showToast(data.error || 'Failed to clear cache', 'error');
      }
    } catch (err) {
      console.error('Failed to clear cache:', err);
      showToast('Failed to clear cache', 'error');
    }
  }

  async function cancelCacheRenders() {
    if (!cacheModalCast) return;
    
    if (!confirm('Cancel all pending renders for this cast?')) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/casts/${cacheModalCast.uuid}/cache/cancel`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Renders cancelled', 'success');
        // Refresh status
        const status = await loadCacheStatus(cacheModalCast.uuid);
        if (status?.success) {
          cacheModalStatus = status;
        }
      } else {
        showToast(data.error || 'Failed to cancel renders', 'error');
      }
    } catch (err) {
      console.error('Failed to cancel renders:', err);
      showToast('Failed to cancel renders', 'error');
    }
  }

  async function cancelAllRenders() {
    if (!confirm('Cancel ALL pending renders across all casts?')) return;
    
    try {
      const res = await fetch(`/api/extensions/slidecast/cache/cancel-all`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'All renders cancelled', 'success');
        // Refresh all cast data
        await loadCasts();
      } else {
        showToast(data.error || 'Failed to cancel renders', 'error');
      }
    } catch (err) {
      console.error('Failed to cancel renders:', err);
      showToast('Failed to cancel renders', 'error');
    }
  }

  function formatCacheSize(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function getSlideStatusIcon(status) {
    switch (status) {
      case 'cached': return '✓';
      case 'stale': return '⟳';
      case 'rendering': return '●';
      case 'queued': return '○';
      default: return '✗';
    }
  }
</script>

<div class="slidecast-dashboard">
  <!-- Header -->
  <div class="page-header">
    <div class="header-content">
      <div class="header-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
      <div class="header-text">
        <h1>Slidecast</h1>
        <p>Digital signage for your TV screens</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" on:click={() => goto('/ext/slidecast/screens')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Screens
      </button>
      <button class="btn btn-secondary" on:click={() => goto('/ext/slidecast/media')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Media
      </button>
      <button class="btn btn-secondary" on:click={() => goto('/ext/slidecast/widgets')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
        Widgets
      </button>
      <button class="btn btn-secondary" on:click={() => goto('/ext/slidecast/marketplace')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        Marketplace
      </button>
      <button class="btn btn-ghost" aria-label="Settings" on:click={() => goto('/ext/slidecast/settings')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <button class="btn btn-secondary" on:click={() => showImportModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Import
      </button>
      <button class="btn btn-primary" on:click={() => showNewCastModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New Cast
      </button>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-icon blue">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <div class="stat-info">
        <span class="stat-value">{casts.length}</span>
        <span class="stat-label">Casts</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="stat-info">
        <span class="stat-value">{getOnlineScreenCount()}/{screens.length}</span>
        <span class="stat-label">Screens Online</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="stat-info">
        <span class="stat-value">{storageStats.totalCount || 0}</span>
        <span class="stat-label">Media Files</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
      </div>
      <div class="stat-info">
        <span class="stat-value">{formatBytes(storageStats.totalSize)}</span>
        <span class="stat-label">Storage Used</span>
      </div>
    </div>
    <div class="stat-card clickable" on:click={() => goto('/ext/slidecast/widgets')} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && goto('/ext/slidecast/widgets')}>
      <div class="stat-icon cyan">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      </div>
      <div class="stat-info">
        <span class="stat-value">{widgetCount}</span>
        <span class="stat-label">Widgets</span>
      </div>
    </div>
  </div>

  <!-- Casts Grid -->
  <div class="section">
    <div class="section-header">
      <h2>Your Casts</h2>
      <button class="btn btn-ghost" on:click={() => showTemplateModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
        Templates
      </button>
    </div>

    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading...</span>
      </div>
    {:else if casts.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3>No casts yet</h3>
        <p>Create your first slidecast to get started</p>
        <button class="btn btn-primary" on:click={() => showNewCastModal = true}>
          Create Cast
        </button>
      </div>
    {:else}
      <div class="casts-grid">
        {#each casts as cast}
          {@const cacheStatus = castCacheStatus[cast.uuid]}
          {@const cacheBadge = cacheStatus ? getCacheStatusBadge(cast.uuid) : null}
          <div class="cast-card">
            <div class="cast-thumbnail" on:click={() => goto(`/ext/slidecast/studio?id=${cast.uuid}`)}>
              {#if getFirstSlide(cast)}
                <div class="cast-preview-container">
                  <div class="cast-preview-scaler">
                    <SlideRenderer 
                      slide={getFirstSlide(cast)} 
                      variables={getCastVariables(cast)}
                      feedData={{}}
                      scale={0.146}
                      width={1920}
                      height={1080}
                      interactive={false}
                    />
                  </div>
                </div>
              {:else}
                <div class="thumbnail-placeholder">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              {/if}
            </div>
            <div class="cast-info">
              <h3>{cast.name}</h3>
              <div class="cast-meta">
                <span class="slide-count">{cast.slideCount || 0} slides</span>
                {#if cacheBadge}
                  <span class="cache-status-inline cache-status-inline-{cacheBadge.color}" title="Click to manage cache">
                    {#if cacheBadge.type === 'cached'}
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Cached
                    {:else if cacheBadge.type === 'rendering'}
                      <div class="cache-inline-spinner"></div>
                      Caching...
                    {:else if cacheBadge.type === 'stale'}
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Stale
                    {:else}
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {cacheBadge.label}
                    {/if}
                  </span>
                {:else}
                  <span class="cache-status-inline cache-status-inline-grey" title="Not cached">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
                    </svg>
                    No cache
                  </span>
                {/if}
              </div>
            </div>
            <div class="cast-actions">
              <button class="action-btn" title="Edit" on:click={() => goto(`/ext/slidecast/studio?id=${cast.uuid}`)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button class="action-btn" title="Cache Manager" on:click={() => openCacheModal(cast)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              </button>
              <button class="action-btn" title="Assign to Screen" on:click={() => { selectedCast = cast; showAssignModal = true; }}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </button>
              <button 
                class="action-btn" 
                title="Export" 
                on:click={() => openExportModal(cast)}
                disabled={exportingCast === cast.id}
              >
                {#if exportingCast === cast.id}
                  <div class="action-spinner"></div>
                {:else}
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                {/if}
              </button>
              <button class="action-btn" title="Duplicate" on:click={() => duplicateCast(cast)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button class="action-btn danger" title="Delete" on:click={() => { selectedCast = cast; showDeleteModal = true; }}>
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
</div>

<!-- New Cast Modal -->
{#if showNewCastModal}
  <div class="modal-overlay" on:click={() => showNewCastModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Create New Cast</h2>
        <button class="close-btn" on:click={() => showNewCastModal = false}>×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="cast-name">Cast Name</label>
          <input 
            id="cast-name" 
            type="text" 
            bind:value={newCastName} 
            placeholder="My Slidecast"
            on:keydown={(e) => e.key === 'Enter' && createCast()}
          />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showNewCastModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={createCast}>Create</button>
      </div>
    </div>
  </div>
{/if}

<!-- Template Modal -->
{#if showTemplateModal}
  <div class="modal-overlay" on:click={() => showTemplateModal = false}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Choose a Template</h2>
        <button class="close-btn" on:click={() => showTemplateModal = false}>×</button>
      </div>
      <div class="modal-body">
        <!-- Built-in Templates -->
        {#if templates.filter(t => t.is_builtin).length > 0}
          <h4 class="template-section-title">Built-in Templates</h4>
          <div class="templates-grid">
            {#each templates.filter(t => t.is_builtin) as template}
              <div 
                class="template-card" 
                class:selected={selectedTemplate?.id === template.id}
                on:click={() => selectedTemplate = template}
              >
                <div class="template-preview">
                  {#if template.thumbnail}
                    <img src={template.thumbnail} alt={template.name} />
                  {:else}
                    <div class="template-placeholder">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                      </svg>
                    </div>
                  {/if}
                </div>
                <div class="template-info">
                  <h4>{template.name}</h4>
                  <p>{template.description}</p>
                  <span class="template-badge builtin">Built-in</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        
        <!-- User Templates -->
        {#if templates.filter(t => !t.is_builtin).length > 0}
          <h4 class="template-section-title" style="margin-top: 1.5rem;">Your Templates</h4>
          <div class="templates-grid">
            {#each templates.filter(t => !t.is_builtin) as template}
              <div 
                class="template-card" 
                class:selected={selectedTemplate?.id === template.id}
                on:click={() => selectedTemplate = template}
              >
                <div class="template-preview">
                  {#if template.thumbnail}
                    <img src={template.thumbnail} alt={template.name} />
                  {:else}
                    <div class="template-placeholder">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                      </svg>
                    </div>
                  {/if}
                </div>
                <div class="template-info">
                  <h4>{template.name}</h4>
                  <p>{template.description}</p>
                  <span class="template-badge user">Custom</span>
                </div>
                <button 
                  class="template-delete-btn" 
                  on:click|stopPropagation={() => confirmDeleteTemplate(template)}
                  title="Delete template"
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
        
        {#if templates.length === 0}
          <div class="no-templates">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="48" height="48">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
            </svg>
            <p>No templates available yet.</p>
            <p class="hint">Create a cast and save it as a template to get started!</p>
          </div>
        {/if}
        
        {#if selectedTemplate}
          <div class="form-group" style="margin-top: 1rem;">
            <label for="template-name">Cast Name</label>
            <input 
              id="template-name" 
              type="text" 
              bind:value={newCastName} 
              placeholder={selectedTemplate.name + ' Copy'}
            />
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showTemplateModal = false}>Cancel</button>
        <button class="btn btn-primary" disabled={!selectedTemplate} on:click={createFromTemplate}>
          Use Template
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Modal -->
{#if showDeleteModal}
  <div class="modal-overlay" on:click={() => showDeleteModal = false}>
    <div class="modal modal-confirm" on:click|stopPropagation>
      <div class="modal-header danger">
        <span class="modal-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span>
        <h2>Delete Cast</h2>
        <button class="close-btn" on:click={() => showDeleteModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete "<strong>{selectedCast?.name}</strong>"?</p>
        <p class="text-secondary">This will permanently remove this cast and all its slides. This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showDeleteModal = false}>Cancel</button>
        <button class="btn btn-danger" on:click={deleteCast}>Delete Cast</button>
      </div>
    </div>
  </div>
{/if}

<!-- Assign Modal -->
{#if showAssignModal}
  <div class="modal-overlay" on:click={() => showAssignModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Assign to Screen</h2>
        <button class="close-btn" on:click={() => showAssignModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p>Assign "{selectedCast?.name}" to a screen:</p>
        {#if screens.length === 0}
          <div class="empty-state small">
            <p>No screens registered yet</p>
          </div>
        {:else}
          <div class="screen-list">
            {#each screens as screen}
              <button class="screen-item" on:click={() => assignCast(screen.serial)}>
                <div class="screen-status" class:online={screen.status === 'online'}></div>
                <div class="screen-info">
                  <span class="screen-name">{screen.name}</span>
                  <span class="screen-platform">{screen.platform}</span>
                </div>
                {#if screen.assigned_cast_id === selectedCast?.uuid}
                  <span class="assigned-badge">Current</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showAssignModal = false}>Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- Import Modal -->
{#if showImportModal}
  <div class="modal-overlay" on:click={() => showImportModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Import Cast</h2>
        <button class="close-btn" on:click={() => showImportModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p class="modal-description">Import a cast from a .cast file or URL</p>
        
        <!-- File Upload -->
        <div class="import-section">
          <h4>Upload File</h4>
          <div class="file-dropzone" class:has-file={importFile}>
            {#if importFile}
              <div class="file-info">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{importFile.name}</span>
                <button class="clear-file" on:click|stopPropagation={clearImportFile}>×</button>
              </div>
            {:else}
              <input 
                type="file" 
                accept=".cast,.zip" 
                on:change={handleFileSelect}
                id="import-file-input"
              />
              <label for="import-file-input">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="32" height="32">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>Click to select or drag & drop a .cast file</span>
              </label>
            {/if}
          </div>
        </div>

        <div class="import-divider">
          <span>or</span>
        </div>

        <!-- URL Import -->
        <div class="import-section">
          <h4>Import from URL</h4>
          <input 
            type="url"
            placeholder="https://example.com/template.cast"
            bind:value={importUrl}
            disabled={!!importFile}
          />
        </div>

        <!-- Options -->
        <div class="import-options">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={importForce} />
            <span>Overwrite if cast name already exists</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={importWidgets} />
            <span>Import custom widgets (if included)</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={importCache} />
            <span>Import pre-rendered cache (if included)</span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showImportModal = false}>Cancel</button>
        <button 
          class="btn btn-primary" 
          on:click={importCast}
          disabled={importing || (!importFile && !importUrl.trim())}
        >
          {#if importing}
            <div class="btn-spinner"></div>
            Importing...
          {:else}
            Import Cast
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Export Options Modal -->
{#if showExportModal}
  <div class="modal-overlay" on:click={() => showExportModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Export Cast</h2>
        <button class="close-btn" on:click={() => showExportModal = false}>×</button>
      </div>
      <div class="modal-body">
        {#if exportLoading}
          <div class="export-loading">
            <div class="spinner"></div>
            <span>Loading export preview...</span>
          </div>
        {:else if exportPreview}
          <div class="export-preview">
            <h4>{exportPreview.cast.name}</h4>
            
            <div class="export-summary">
              <div class="export-stat">
                <span class="export-stat-value">{exportPreview.media.length}</span>
                <span class="export-stat-label">Media files</span>
              </div>
              <div class="export-stat">
                <span class="export-stat-value">{exportPreview.widgets.filter(w => !w.isSystem).length}</span>
                <span class="export-stat-label">Custom widgets</span>
              </div>
              {#if exportPreview.cache}
                <div class="export-stat">
                  <span class="export-stat-value">{exportPreview.cache.slidesCount}</span>
                  <span class="export-stat-label">Cached slides</span>
                </div>
              {/if}
            </div>

            <div class="export-options">
              <h5>Include in export:</h5>
              <label class="checkbox-label">
                <input type="checkbox" checked disabled />
                <span>Media files ({exportPreview.media.length} files)</span>
              </label>
              {#if exportPreview.widgets.filter(w => !w.isSystem).length > 0}
                <label class="checkbox-label">
                  <input type="checkbox" bind:checked={exportIncludeWidgets} />
                  <span>Custom widgets ({exportPreview.widgets.filter(w => !w.isSystem).length})</span>
                </label>
              {/if}
              {#if exportPreview.cache}
                <label class="checkbox-label">
                  <input type="checkbox" bind:checked={exportIncludeCache} />
                  <span>Pre-rendered cache ({exportPreview.cache.totalSizeFormatted})</span>
                </label>
              {/if}
            </div>

            <div class="export-size-estimate">
              <span>Estimated size:</span>
              <strong>
                {exportIncludeCache && exportPreview.cache 
                  ? exportPreview.estimatedSizeWithCacheFormatted 
                  : exportPreview.estimatedSizeFormatted}
              </strong>
            </div>
          </div>
        {:else}
          <p>Failed to load export preview</p>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showExportModal = false}>Cancel</button>
        <button 
          class="btn btn-primary" 
          on:click={exportCast}
          disabled={exportLoading || !exportPreview}
        >
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Template Modal -->
{#if showDeleteTemplateModal}
  <div class="modal-overlay" on:click={() => showDeleteTemplateModal = false}>
    <div class="modal modal-confirm" on:click|stopPropagation>
      <div class="modal-header danger">
        <span class="modal-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
        <h2>Delete Template</h2>
        <button class="close-btn" on:click={() => showDeleteTemplateModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete "<strong>{templateToDelete?.name}</strong>"?</p>
        <p class="text-secondary">This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showDeleteTemplateModal = false}>Cancel</button>
        <button class="btn btn-danger" on:click={deleteTemplate}>Delete Template</button>
      </div>
    </div>
  </div>
{/if}

<!-- Cache Manager Modal -->
{#if showCacheModal}
  <div class="modal-overlay" on:click={closeCacheModal}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-content">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          <h2>Cache Manager - {cacheModalCast?.name}</h2>
        </div>
        <button class="close-btn" on:click={closeCacheModal}>×</button>
      </div>
      <div class="modal-body">
        {#if cacheModalLoading}
          <div class="cache-loading">
            <div class="spinner"></div>
            <span>Loading cache status...</span>
          </div>
        {:else if cacheModalStatus}
          <!-- Summary Stats -->
          <div class="cache-summary">
            <div class="cache-stat">
              <span class="cache-stat-value">{cacheModalStatus.cachedCount}</span>
              <span class="cache-stat-label">Cached</span>
            </div>
            <div class="cache-stat">
              <span class="cache-stat-value cache-stat-stale">{cacheModalStatus.staleCount}</span>
              <span class="cache-stat-label">Stale</span>
            </div>
            <div class="cache-stat">
              <span class="cache-stat-value cache-stat-missing">{cacheModalStatus.notCachedCount}</span>
              <span class="cache-stat-label">Not Cached</span>
            </div>
            <div class="cache-stat">
              <span class="cache-stat-value">{cacheModalStatus.totalSizeMB} MB</span>
              <span class="cache-stat-label">Size</span>
            </div>
          </div>

          <!-- Progress Bar -->
          {#if cacheModalStatus.totalSlides > 0}
            <div class="cache-progress">
              <div class="cache-progress-bar">
                <div 
                  class="cache-progress-fill cached" 
                  style="width: {(cacheModalStatus.cachedCount / cacheModalStatus.totalSlides) * 100}%"
                ></div>
                <div 
                  class="cache-progress-fill stale" 
                  style="width: {(cacheModalStatus.staleCount / cacheModalStatus.totalSlides) * 100}%"
                ></div>
              </div>
              <span class="cache-progress-text">
                {cacheModalStatus.cachedCount + cacheModalStatus.staleCount} / {cacheModalStatus.totalSlides} slides
              </span>
            </div>
          {/if}

          <!-- Active Renders Info -->
          {#if cacheModalStatus.activeRenders > 0 || cacheModalStatus.queuedRenders > 0}
            <div class="cache-active-info">
              <div class="cache-active-indicator"></div>
              <span>
                {cacheModalStatus.activeRenders} rendering, {cacheModalStatus.queuedRenders} queued
              </span>
              {#if cacheModalStatus.queuedRenders > 0}
                <button class="btn btn-sm btn-ghost danger-text" on:click={cancelCacheRenders} title="Cancel pending renders">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </button>
              {/if}
            </div>
          {/if}

          <!-- Action Buttons -->
          <div class="cache-actions-bar">
            <button class="btn btn-primary" on:click={() => cacheAllSlides(false)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Cache All
            </button>
            <button class="btn btn-secondary" on:click={() => cacheAllSlides(true)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Force Refresh All
            </button>
            <button class="btn btn-ghost danger-text" on:click={clearCache}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear Cache
            </button>
          </div>

          <!-- Slide List -->
          <div class="cache-slides-list">
            <h4>Slides</h4>
            {#each cacheModalStatus.slides as slide}
              {@const isRendering = cacheModalStatus.renderingSlides?.includes(slide.index)}
              {@const isQueued = cacheModalStatus.queuedSlides?.includes(slide.index)}
              <div class="cache-slide-item">
                <div class="cache-slide-info">
                  <span class="cache-slide-index">Slide {slide.index + 1}</span>
                  <span class="cache-slide-status cache-status-{isRendering ? 'rendering' : isQueued ? 'queued' : slide.status}">
                    {#if isRendering}
                      <div class="cache-slide-spinner"></div>
                      Rendering...
                    {:else if isQueued}
                      <span class="status-icon">○</span> Queued
                    {:else if slide.status === 'cached'}
                      <span class="status-icon green">✓</span> Cached
                    {:else if slide.status === 'stale'}
                      <span class="status-icon yellow">⟳</span> Stale
                    {:else}
                      <span class="status-icon red">✗</span> Not Cached
                    {/if}
                  </span>
                </div>
                <div class="cache-slide-meta">
                  {#if slide.layerCount > 0}
                    <span>{slide.layerCount} layers</span>
                  {/if}
                  {#if slide.size > 0}
                    <span>{formatCacheSize(slide.size)}</span>
                  {/if}
                  {#if slide.renderStats}
                    <span class="render-stats" title="Last render stats">
                      {slide.renderStats.rendered} rendered, {slide.renderStats.skipped} skipped
                    </span>
                  {/if}
                </div>
                <div class="cache-slide-actions">
                  <button 
                    class="btn btn-sm btn-ghost" 
                    title="Cache this slide"
                    on:click={() => cacheSlide(slide.index, false)}
                    disabled={isRendering || isQueued}
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button 
                    class="btn btn-sm btn-ghost" 
                    title="Force refresh"
                    on:click={() => cacheSlide(slide.index, true)}
                    disabled={isRendering || isQueued}
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="cache-error">
            <p>Failed to load cache status</p>
            <button class="btn btn-secondary" on:click={() => openCacheModal(cacheModalCast)}>Retry</button>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={closeCacheModal}>Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- Active Cache Jobs Indicator -->
{#if activeCacheJobs.length > 0}
  <div class="cache-jobs-indicator" on:click={() => showActiveJobsModal = true}>
    <div class="cache-jobs-spinner"></div>
    <div class="cache-jobs-info">
      <span class="cache-jobs-title">Caching in progress</span>
      <span class="cache-jobs-detail">
        {activeCacheJobs.reduce((sum, j) => sum + j.active, 0)} rendering, 
        {activeCacheJobs.reduce((sum, j) => sum + j.queued, 0)} queued
      </span>
    </div>
  </div>
{/if}

<!-- All Active Jobs Modal -->
{#if showActiveJobsModal}
  <div class="modal-overlay" on:click|self={() => showActiveJobsModal = false}>
    <div class="modal active-jobs-modal">
      <div class="modal-header">
        <div class="modal-title-row">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <h2>Active Cache Jobs</h2>
        </div>
        <button class="modal-close" on:click={() => showActiveJobsModal = false}>×</button>
      </div>
      
      <div class="active-jobs-content">
        <!-- Summary Stats -->
        <div class="active-jobs-summary">
          <div class="active-jobs-stat">
            <span class="active-jobs-stat-value active-jobs-stat-rendering">
              {activeCacheJobs.reduce((sum, j) => sum + j.active, 0)}
            </span>
            <span class="active-jobs-stat-label">Rendering</span>
          </div>
          <div class="active-jobs-stat">
            <span class="active-jobs-stat-value active-jobs-stat-queued">
              {activeCacheJobs.reduce((sum, j) => sum + j.queued, 0)}
            </span>
            <span class="active-jobs-stat-label">Queued</span>
          </div>
          <div class="active-jobs-stat">
            <span class="active-jobs-stat-value">
              {activeCacheJobs.length}
            </span>
            <span class="active-jobs-stat-label">Casts</span>
          </div>
          {#if activeCacheJobs.reduce((sum, j) => sum + j.queued, 0) > 0}
            <button class="btn btn-sm btn-danger" on:click={cancelAllRenders}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel All
            </button>
          {/if}
        </div>

        <!-- Per-Cast Breakdown -->
        <div class="active-jobs-list">
          {#each activeCacheJobs as job}
            {@const cast = casts.find(c => c.uuid === job.castId)}
            <div class="active-job-item">
              <div class="active-job-header">
                <span class="active-job-name">{job.castName || cast?.name || 'Unknown Cast'}</span>
                <button 
                  class="active-job-open-btn"
                  on:click={() => { showActiveJobsModal = false; openCacheModal(cast); }}
                >
                  Open
                </button>
              </div>
              <div class="active-job-progress">
                <div class="active-job-stats">
                  <span class="active-job-rendering">
                    <div class="active-job-dot rendering"></div>
                    {job.active} rendering
                  </span>
                  <span class="active-job-queued">
                    <div class="active-job-dot queued"></div>
                    {job.queued} queued
                  </span>
                </div>
                {#if job.renderingSlides?.length > 0}
                  <div class="active-job-slides">
                    Slides: {job.renderingSlides.map(s => s + 1).join(', ')}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if activeCacheJobs.length === 0}
          <div class="active-jobs-empty">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="48" height="48">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 13l4 4L19 7" />
            </svg>
            <span>No active cache jobs</span>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showActiveJobsModal = false}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Toast Container -->
<div class="toast-container">
  {#each toasts as toast (toast.id)}
    <div class="toast toast-{toast.type}">
      {#if toast.type === 'success'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      {:else if toast.type === 'error'}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      {:else}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      {/if}
      <span>{toast.message}</span>
    </div>
  {/each}
</div>

<style>
  .slidecast-dashboard {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding: 2rem;
    background: linear-gradient(135deg, rgb(var(--color-surface)) 0%, rgb(var(--color-surface-hover) / 0.5) 100%);
    border-radius: 16px;
    border: 1px solid rgb(var(--color-border) / 0.3);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .header-icon {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
  }

  .header-icon svg {
    width: 32px;
    height: 32px;
    color: white;
  }

  .header-text h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .header-text p {
    margin: 0.25rem 0 0;
    color: rgb(var(--color-text-secondary));
  }

  .header-actions {
    display: flex;
    gap: 0.75rem;
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
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
  }

  .btn-secondary {
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    border: 1px solid rgb(var(--color-border));
  }

  .btn-secondary:hover {
    background: rgb(var(--color-hover));
  }

  .btn-ghost {
    background: transparent;
    color: rgb(var(--color-text-secondary));
  }

  .btn-ghost:hover {
    background: rgb(var(--color-hover));
    color: rgb(var(--color-text));
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  .btn-danger:hover {
    background: #dc2626;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    transition: all 0.2s;
  }

  .stat-card:hover {
    border-color: rgb(var(--color-primary));
  }

  .stat-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stat-icon svg {
    width: 24px;
    height: 24px;
  }

  .stat-icon.blue { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
  .stat-icon.green { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
  .stat-icon.purple { background: rgba(168, 85, 247, 0.1); color: #a855f7; }
  .stat-icon.orange { background: rgba(249, 115, 22, 0.1); color: #f97316; }
  .stat-icon.cyan { background: rgba(6, 182, 212, 0.1); color: #06b6d4; }

  .stat-card.clickable {
    cursor: pointer;
  }

  .stat-card.clickable:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .stat-info {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(var(--color-text));
  }

  .stat-label {
    font-size: 0.875rem;
    color: rgb(var(--color-text-secondary));
  }

  .section {
    margin-bottom: 2rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .casts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .cast-card {
    --preview-scale: 0.146;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .cast-card:hover {
    border-color: rgb(var(--color-primary));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  }

  .cast-thumbnail {
    aspect-ratio: 16/9;
    background: rgb(var(--color-hover));
    cursor: pointer;
    overflow: hidden;
    position: relative;
  }

  .cast-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cast-preview-container {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cast-preview-scaler {
    pointer-events: none;
  }

  .thumbnail-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(var(--color-text-secondary));
  }

  .thumbnail-placeholder svg {
    width: 48px;
    height: 48px;
  }

  .cast-info {
    padding: 1rem;
  }

  .cast-info h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .cast-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .slide-count {
    font-size: 0.875rem;
    color: rgb(var(--color-text-secondary));
  }

  .cache-status-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .cache-status-inline-green {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .cache-status-inline-yellow {
    background: rgba(234, 179, 8, 0.15);
    color: #ca8a04;
  }

  .cache-status-inline-orange {
    background: rgba(249, 115, 22, 0.15);
    color: #ea580c;
  }

  .cache-status-inline-blue {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
  }

  .cache-status-inline-grey {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }

  .cache-inline-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(59, 130, 246, 0.3);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .cast-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0 1rem 1rem;
  }

  .action-btn {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: 1px solid rgb(var(--color-border));
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
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
    width: 18px;
    height: 18px;
  }

  .loading, .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: rgb(var(--color-text-secondary));
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-icon {
    width: 80px;
    height: 80px;
    margin: 0 auto 1rem;
    background: rgb(var(--color-hover));
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-icon svg {
    width: 40px;
    height: 40px;
  }

  .empty-state h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: rgb(var(--color-text));
    margin: 0 0 0.5rem;
  }

  .empty-state p {
    margin: 0 0 1.5rem;
  }

  .empty-state.small {
    padding: 2rem 1rem;
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
    max-width: 480px;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
  }

  .modal-lg {
    max-width: 720px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .modal-header h2 {
    font-size: 1.25rem;
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

  .close-btn:hover {
    background: rgb(var(--color-hover));
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    max-height: 60vh;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid rgb(var(--color-border));
  }
  
  /* Confirmation Modal Styles */
  .modal-confirm { max-width: 420px; }
  .modal-confirm .modal-header {
    gap: 0.75rem;
    justify-content: flex-start;
  }
  .modal-confirm .modal-header.danger { background: rgba(239, 68, 68, 0.1); }
  .modal-confirm .modal-header.warning { background: rgba(251, 191, 36, 0.1); }
  .modal-confirm .modal-icon { font-size: 1.5rem; }
  .modal-confirm .modal-header .close-btn { margin-left: auto; }
  .modal-confirm .modal-body p { margin: 0 0 0.5rem; }
  .modal-confirm .modal-body p:last-child { margin-bottom: 0; }
  .modal-confirm .text-secondary { font-size: 0.85rem; color: rgb(var(--color-text-secondary)); }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .form-group input {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-background));
    color: rgb(var(--color-text));
    font-size: 1rem;
  }

  .form-group input:focus {
    outline: none;
    border-color: rgb(var(--color-primary));
  }

  .templates-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .template-card {
    border: 2px solid rgb(var(--color-border));
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
  }

  .template-card:hover {
    border-color: rgb(var(--color-primary));
  }

  .template-card.selected {
    border-color: rgb(var(--color-primary));
    box-shadow: 0 0 0 3px rgba(var(--color-primary), 0.2);
  }

  .template-preview {
    aspect-ratio: 16/9;
    background: rgb(var(--color-hover));
  }

  .template-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(var(--color-text-secondary));
  }

  .template-placeholder svg {
    width: 32px;
    height: 32px;
  }

  .template-info {
    padding: 0.75rem;
  }

  .template-info h4 {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }

  .template-info p {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin: 0;
    line-height: 1.4;
  }

  .template-section-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(var(--color-text-secondary));
    margin: 0 0 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .template-badge {
    display: inline-block;
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    text-transform: uppercase;
    margin-top: 0.5rem;
  }

  .template-badge.builtin {
    background: rgba(var(--color-primary), 0.2);
    color: rgb(var(--color-primary));
  }

  .template-badge.user {
    background: rgba(34, 197, 94, 0.2);
    color: rgb(34, 197, 94);
  }

  .template-card {
    position: relative;
  }

  .template-delete-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: rgba(239, 68, 68, 0.9);
    border: none;
    border-radius: 6px;
    padding: 0.375rem;
    cursor: pointer;
    color: white;
    opacity: 0;
    transition: opacity 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .template-card:hover .template-delete-btn {
    opacity: 1;
  }

  .template-delete-btn:hover {
    background: rgb(239, 68, 68);
  }

  .no-templates {
    text-align: center;
    padding: 2rem;
    color: rgb(var(--color-text-secondary));
  }

  .no-templates svg {
    opacity: 0.5;
    margin-bottom: 1rem;
  }

  .no-templates .hint {
    font-size: 0.875rem;
    opacity: 0.7;
  }

  .screen-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .screen-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-background));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
    width: 100%;
  }

  .screen-item:hover {
    border-color: rgb(var(--color-primary));
    background: rgb(var(--color-hover));
  }

  .screen-status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #94a3b8;
  }

  .screen-status.online {
    background: #22c55e;
  }

  .screen-info {
    flex: 1;
  }

  .screen-name {
    display: block;
    font-weight: 500;
  }

  .screen-platform {
    display: block;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .assigned-badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border-radius: 4px;
  }

  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
      gap: 1.5rem;
      text-align: center;
    }

    .header-content {
      flex-direction: column;
    }

    .header-actions {
      flex-wrap: wrap;
      justify-content: center;
    }
  }

  /* Toast Styles */
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgb(var(--color-surface));
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease-out;
    min-width: 280px;
    border: 1px solid rgb(var(--color-border));
  }

  .toast svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .toast-success {
    border-color: rgba(16, 185, 129, 0.5);
  }

  .toast-success svg {
    color: #10b981;
  }

  .toast-error {
    border-color: rgba(239, 68, 68, 0.5);
  }

  .toast-error svg {
    color: #ef4444;
  }

  .toast-info {
    border-color: rgba(59, 130, 246, 0.5);
  }

  .toast-info svg {
    color: #3b82f6;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Import Modal Styles */
  .modal-description {
    color: rgb(var(--color-text-secondary));
    margin: 0 0 1.5rem;
  }

  .import-section {
    margin-bottom: 1rem;
  }

  .import-section h4 {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .import-section input[type="url"] {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-background));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
  }

  .import-section input[type="url"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-dropzone {
    border: 2px dashed rgb(var(--color-border));
    border-radius: 12px;
    padding: 2rem;
    text-align: center;
    transition: all 0.2s;
    position: relative;
  }

  .file-dropzone:hover:not(.has-file) {
    border-color: rgb(var(--color-primary));
    background: rgb(var(--color-hover));
  }

  .file-dropzone.has-file {
    border-style: solid;
    background: rgb(var(--color-hover));
  }

  .file-dropzone input[type="file"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .file-dropzone label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    color: rgb(var(--color-text-secondary));
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: center;
  }

  .file-info span {
    font-weight: 500;
  }

  .clear-file {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    background: rgb(var(--color-border));
    color: rgb(var(--color-text));
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear-file:hover {
    background: #ef4444;
    color: white;
  }

  .import-divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1.5rem 0;
    color: rgb(var(--color-text-secondary));
  }

  .import-divider::before,
  .import-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgb(var(--color-border));
  }

  .import-options {
    margin-top: 1.5rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .checkbox-label input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: rgb(var(--color-primary));
  }

  /* Action button spinner */
  .action-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgb(var(--color-border));
    border-top-color: rgb(var(--color-primary));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Cache Badge Styles */
  .cache-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    backdrop-filter: blur(4px);
  }

  .cache-badge-green {
    background: rgba(34, 197, 94, 0.9);
    color: white;
  }

  .cache-badge-yellow {
    background: rgba(234, 179, 8, 0.9);
    color: #422006;
  }

  .cache-badge-orange {
    background: rgba(249, 115, 22, 0.9);
    color: white;
  }

  .cache-badge-blue {
    background: rgba(59, 130, 246, 0.9);
    color: white;
  }

  .cache-badge-spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* Cache Modal Styles */
  .modal-header-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .modal-header-content svg {
    color: rgb(var(--color-primary));
  }

  .cache-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    color: rgb(var(--color-text-secondary));
  }

  .cache-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .cache-stat {
    text-align: center;
    padding: 1rem;
    background: rgb(var(--color-hover));
    border-radius: 8px;
  }

  .cache-stat-value {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(var(--color-text));
  }

  .cache-stat-value.cache-stat-stale {
    color: #eab308;
  }

  .cache-stat-value.cache-stat-missing {
    color: #ef4444;
  }

  .cache-stat-label {
    display: block;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-top: 0.25rem;
  }

  .cache-progress {
    margin-bottom: 1rem;
  }

  .cache-progress-bar {
    height: 8px;
    background: rgb(var(--color-hover));
    border-radius: 4px;
    overflow: hidden;
    display: flex;
  }

  .cache-progress-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .cache-progress-fill.cached {
    background: #22c55e;
  }

  .cache-progress-fill.stale {
    background: #eab308;
  }

  .cache-progress-text {
    display: block;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-top: 0.5rem;
    text-align: right;
  }

  .cache-active-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
    color: #3b82f6;
  }

  .cache-active-indicator {
    width: 10px;
    height: 10px;
    background: #3b82f6;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .cache-actions-bar {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .danger-text {
    color: #ef4444 !important;
  }

  .danger-text:hover {
    background: rgba(239, 68, 68, 0.1) !important;
  }

  .cache-slides-list {
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    overflow: hidden;
  }

  .cache-slides-list h4 {
    padding: 0.75rem 1rem;
    margin: 0;
    background: rgb(var(--color-hover));
    font-size: 0.875rem;
    font-weight: 600;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .cache-slide-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgb(var(--color-border));
    gap: 1rem;
  }

  .cache-slide-item:last-child {
    border-bottom: none;
  }

  .cache-slide-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 200px;
  }

  .cache-slide-index {
    font-weight: 500;
  }

  .cache-slide-status {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .cache-status-cached {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }

  .cache-status-stale {
    background: rgba(234, 179, 8, 0.1);
    color: #eab308;
  }

  .cache-status-not_cached {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

  .cache-status-rendering {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .cache-status-queued {
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
  }

  .status-icon {
    font-size: 0.875rem;
  }

  .status-icon.green { color: #22c55e; }
  .status-icon.yellow { color: #eab308; }
  .status-icon.red { color: #ef4444; }

  .cache-slide-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(59, 130, 246, 0.3);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .cache-slide-meta {
    display: flex;
    gap: 1rem;
    flex: 1;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .render-stats {
    font-style: italic;
  }

  .cache-slide-actions {
    display: flex;
    gap: 0.25rem;
  }

  .btn-sm {
    padding: 0.375rem 0.5rem !important;
  }

  .cache-error {
    text-align: center;
    padding: 2rem;
    color: rgb(var(--color-text-secondary));
  }

  /* Floating Cache Jobs Indicator */
  .cache-jobs-indicator {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    transition: all 0.2s;
    z-index: 100;
  }

  .cache-jobs-indicator:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
    border-color: rgb(var(--color-primary));
  }

  .cache-jobs-spinner {
    width: 20px;
    height: 20px;
    border: 3px solid rgba(59, 130, 246, 0.3);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .cache-jobs-info {
    display: flex;
    flex-direction: column;
  }

  .cache-jobs-title {
    font-weight: 600;
    font-size: 0.875rem;
    color: rgb(var(--color-text));
  }

  .cache-jobs-detail {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  /* Active Jobs Modal */
  .active-jobs-modal {
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .active-jobs-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .active-jobs-summary {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: rgba(var(--color-surface-alt), 0.5);
    border-radius: 12px;
  }

  .active-jobs-stat {
    flex: 1;
    text-align: center;
  }

  .active-jobs-stat-value {
    display: block;
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 0.25rem;
  }

  .active-jobs-stat-rendering {
    color: #3b82f6;
  }

  .active-jobs-stat-queued {
    color: #f59e0b;
  }

  .active-jobs-stat-label {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .active-jobs-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .active-job-item {
    padding: 1rem;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
  }

  .active-job-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .active-job-name {
    font-weight: 600;
    color: rgb(var(--color-text));
  }

  .active-job-open-btn {
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid rgb(var(--color-border));
    border-radius: 4px;
    color: rgb(var(--color-text-secondary));
    cursor: pointer;
    transition: all 0.2s;
  }

  .active-job-open-btn:hover {
    background: rgb(var(--color-surface));
    border-color: rgb(var(--color-primary));
    color: rgb(var(--color-primary));
  }

  .active-job-progress {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .active-job-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
  }

  .active-job-rendering,
  .active-job-queued {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: rgb(var(--color-text-secondary));
  }

  .active-job-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .active-job-dot.rendering {
    background: #3b82f6;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .active-job-dot.queued {
    background: #f59e0b;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .active-job-slides {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-top: 0.25rem;
  }

  .active-jobs-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem;
    color: rgb(var(--color-text-secondary));
  }

  .active-jobs-empty svg {
    opacity: 0.5;
    color: #22c55e;
  }

  /* Export Modal Styles */
  .export-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    color: rgb(var(--color-text-secondary));
  }

  .export-preview h4 {
    margin: 0 0 1rem;
    font-size: 1.125rem;
  }

  .export-summary {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: rgb(var(--color-hover));
    border-radius: 8px;
  }

  .export-stat {
    text-align: center;
  }

  .export-stat-value {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(var(--color-text));
  }

  .export-stat-label {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .export-options {
    margin-bottom: 1rem;
  }

  .export-options h5 {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .export-options .checkbox-label {
    margin-bottom: 0.5rem;
  }

  .export-size-estimate {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-hover));
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .export-size-estimate strong {
    color: rgb(var(--color-primary));
  }
</style>


