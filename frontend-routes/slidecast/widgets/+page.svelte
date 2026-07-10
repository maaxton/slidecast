<script>
  import { onMount } from 'svelte';

  // State
  let widgets = [];
  let categories = [];
  let loading = true;
  let error = null;
  let searchQuery = '';
  let selectedCategory = 'all';
  let filterSystem = 'all'; // 'all', 'system', 'custom'

  // Modal states
  let showDeleteModal = false;
  let showImportModal = false;
  let showExportModal = false;
  let selectedWidget = null;
  let importError = '';
  
  // Export options
  let exportIncludeAssets = true;
  let exportIncludeDbData = true;
  let exportSelectedTables = [];
  let exportAvailableTables = [];
  let exportLoading = false;
  
  // Import state
  let importFile = null;
  let importFileName = '';
  let importPreview = null;
  let importLoading = false;
  let fileInput;
  
  // Toast state
  let toasts = [];
  let toastId = 0;

  // Toast functions
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

  // Task #1010: per-widget last-refresh map (uuid -> { last_refresh_ts, age_ms, next_scheduled_ts })
  let refreshMap = {};
  let refreshPollHandle = null;

  onMount(async () => {
    await loadData();
    await loadRefreshHealth();
    // Poll every 10s while the page is open so the indicator stays live
    refreshPollHandle = setInterval(loadRefreshHealth, 10000);
    return () => {
      if (refreshPollHandle) clearInterval(refreshPollHandle);
    };
  });

  async function loadRefreshHealth() {
    try {
      const res = await fetch('/api/extensions/slidecast/health/widget-refresh', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.success) return;
      const next = {};
      for (const w of (data.widgets || [])) {
        next[w.uuid] = w;
      }
      refreshMap = next;
    } catch (_e) { /* network blip — keep last known */ }
  }

  // Render a "5s ago" / "2m ago" string for a refresh age
  function formatRefreshAge(uuid) {
    const w = refreshMap[uuid];
    if (!w || !w.last_refresh_ts) return null;
    const ageSec = Math.floor((w.age_ms || 0) / 1000);
    if (ageSec < 5) return 'just now';
    if (ageSec < 60) return `${ageSec}s ago`;
    const ageMin = Math.floor(ageSec / 60);
    if (ageMin < 60) return `${ageMin}m ago`;
    const ageHr = Math.floor(ageMin / 60);
    return `${ageHr}h ago`;
  }

  async function loadData() {
    loading = true;
    try {
      const [widgetsRes, categoriesRes] = await Promise.all([
        fetch('/api/extensions/slidecast/widgets'),
        fetch('/api/extensions/slidecast/widgets/meta/categories')
      ]);

      const widgetsData = await widgetsRes.json();
      const categoriesData = await categoriesRes.json();

      widgets = widgetsData.widgets || [];
      categories = categoriesData.categories || [];
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  // Filtered widgets
  $: filteredWidgets = widgets.filter(w => {
    // Search filter
    if (searchQuery && !w.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    // Category filter
    if (selectedCategory !== 'all' && w.category !== selectedCategory) {
      return false;
    }
    // System/Custom filter
    if (filterSystem === 'system' && !w.isSystem) return false;
    if (filterSystem === 'custom' && w.isSystem) return false;
    return true;
  });

  async function createWidget() {
    try {
      const response = await fetch('/api/extensions/slidecast/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: 'New Widget' })
      });
      const data = await response.json();
      if (data.success) {
        showToast('Widget created!', 'success');
        goto(`/ext/slidecast/widgets/factory?id=${data.widget.uuid}`);
      } else {
        showToast(data.error || 'Failed to create widget', 'error');
      }
    } catch (err) {
      showToast('Failed to create widget', 'error');
    }
  }

  function editWidget(widget) {
    goto(`/ext/slidecast/widgets/factory?id=${widget.uuid}`);
  }

  async function duplicateWidget(widget) {
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${widget.uuid}/duplicate`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast(`Duplicated: ${data.widget.name}`, 'success');
        await loadData();
      } else {
        showToast(data.error || 'Failed to duplicate', 'error');
      }
    } catch (err) {
      showToast('Failed to duplicate widget', 'error');
    }
  }

  function confirmDelete(widget) {
    selectedWidget = widget;
    showDeleteModal = true;
  }

  async function deleteWidget() {
    if (!selectedWidget) return;
    try {
      const response = await fetch(`/api/extensions/slidecast/widgets/${selectedWidget.uuid}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (data.success) {
        showToast('Widget deleted', 'success');
        showDeleteModal = false;
        selectedWidget = null;
        await loadData();
      } else {
        showToast(data.error || 'Failed to delete', 'error');
      }
    } catch (err) {
      showToast('Failed to delete widget', 'error');
    }
  }

  async function openExportModal(widget) {
    selectedWidget = widget;
    exportIncludeAssets = true;
    exportIncludeDbData = true;
    exportSelectedTables = [];
    
    // Get available tables from widget's table schema
    if (widget.tableSchema && typeof widget.tableSchema === 'object') {
      exportAvailableTables = Object.keys(widget.tableSchema);
      exportSelectedTables = [...exportAvailableTables]; // Select all by default
    } else {
      exportAvailableTables = [];
    }
    
    showExportModal = true;
  }
  
  async function downloadWidget() {
    if (!selectedWidget) return;
    exportLoading = true;
    
    try {
      // Build query params
      const params = new URLSearchParams();
      if (exportIncludeDbData && exportSelectedTables.length > 0) {
        params.set('includeDb', 'true');
        params.set('tables', exportSelectedTables.join(','));
      }
      
      const url = `/api/extensions/slidecast/widgets/${selectedWidget.uuid}/export.widget?${params}`;
      
      const response = await fetch(url, { credentials: 'same-origin' });
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${selectedWidget.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}.widget`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      
      // Download the file
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      
      showToast(`Exported: ${filename}`, 'success');
      showExportModal = false;
    } catch (err) {
      showToast('Failed to export widget: ' + err.message, 'error');
    } finally {
      exportLoading = false;
    }
  }
  
  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    importFile = file;
    importFileName = file.name;
    importError = '';
    importPreview = null;
    
    // Validate file type
    if (!file.name.endsWith('.widget') && !file.name.endsWith('.zip') && !file.name.endsWith('.json')) {
      importError = 'Please select a .widget, .zip, or .json file';
      return;
    }
    
    // Read file for preview if JSON
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          importPreview = {
            name: data.manifest?.name || data.name || data.widget?.name || 'Unknown',
            version: data.manifest?.version || data.version || data.widget?.version || 1,
            description: data.manifest?.description || data.description || data.widget?.description || '',
            category: data.manifest?.category || data.category || data.widget?.category || 'custom'
          };
        } catch (err) {
          importError = 'Invalid JSON format';
        }
      };
      reader.readAsText(file);
    } else {
      // For .widget files, just show basic info
      importPreview = {
        name: file.name.replace('.widget', '').replace('.zip', ''),
        version: '?',
        description: 'Widget package file',
        category: 'package'
      };
    }
  }
  
  function triggerFileSelect() {
    fileInput?.click();
  }
  
  function handleFileDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      // Manually trigger the same handling as file select
      importFile = file;
      importFileName = file.name;
      importError = '';
      importPreview = null;
      
      if (!file.name.endsWith('.widget') && !file.name.endsWith('.zip') && !file.name.endsWith('.json')) {
        importError = 'Please select a .widget, .zip, or .json file';
        return;
      }
      
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            importPreview = {
              name: data.manifest?.name || data.name || data.widget?.name || 'Unknown',
              version: data.manifest?.version || data.version || data.widget?.version || 1,
              description: data.manifest?.description || data.description || data.widget?.description || '',
              category: data.manifest?.category || data.category || data.widget?.category || 'custom'
            };
          } catch (err) {
            importError = 'Invalid JSON format';
          }
        };
        reader.readAsText(file);
      } else {
        importPreview = {
          name: file.name.replace('.widget', '').replace('.zip', ''),
          version: '?',
          description: 'Widget package file',
          category: 'package'
        };
      }
    }
  }
  
  function handleDragOver(event) {
    event.preventDefault();
  }
  
  async function importWidget() {
    if (!importFile) {
      importError = 'Please select a file to import';
      return;
    }
    
    importError = '';
    importLoading = true;
    
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      
      const response = await fetch('/api/extensions/slidecast/widgets/import', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast(`Imported: ${data.widget.name}`, 'success');
        closeImportModal();
        await loadData();
      } else {
        importError = data.error || 'Failed to import widget';
      }
    } catch (err) {
      importError = 'Import failed: ' + err.message;
    } finally {
      importLoading = false;
    }
  }
  
  function closeImportModal() {
    showImportModal = false;
    importFile = null;
    importFileName = '';
    importPreview = null;
    importError = '';
    if (fileInput) fileInput.value = '';
  }
  
  function toggleTableSelection(tableName) {
    if (exportSelectedTables.includes(tableName)) {
      exportSelectedTables = exportSelectedTables.filter(t => t !== tableName);
    } else {
      exportSelectedTables = [...exportSelectedTables, tableName];
    }
  }
  
  function selectAllTables() {
    exportSelectedTables = [...exportAvailableTables];
  }
  
  function deselectAllTables() {
    exportSelectedTables = [];
  }

  function getCategoryInfo(categoryId) {
    return categories.find(c => c.id === categoryId) || { label: categoryId, icon: '✨' };
  }

  function getRenderModeLabel(mode) {
    switch (mode) {
      case 'native': return 'Native';
      case 'image': return 'Image';
      case 'hybrid': return 'Hybrid';
      default: return mode;
    }
  }

  function formatRefreshInterval(ms) {
    if (!ms || ms === 0) return 'Static';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${ms / 1000}s`;
    if (ms < 3600000) return `${ms / 60000}m`;
    return `${ms / 3600000}h`;
  }
</script>

<div class="widgets-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-left">
      <button class="back-btn" on:click={() => goto('/ext/slidecast')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div class="header-text">
        <h1>Widget Library</h1>
        <p>Create and manage dynamic widget components</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" on:click={() => showImportModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Import
      </button>
      <button class="btn btn-primary" on:click={createWidget}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New Widget
      </button>
    </div>
  </div>

  <!-- Filters -->
  <div class="filters-bar">
    <div class="search-box">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        placeholder="Search widgets..."
        bind:value={searchQuery}
      />
    </div>
    
    <div class="filter-group">
      <select bind:value={selectedCategory}>
        <option value="all">All Categories</option>
        {#each categories as cat}
          <option value={cat.id}>{cat.icon} {cat.name}</option>
        {/each}
      </select>
    </div>

    <div class="filter-pills">
      <button 
        class="pill" 
        class:active={filterSystem === 'all'}
        on:click={() => filterSystem = 'all'}
      >All</button>
      <button 
        class="pill"
        class:active={filterSystem === 'system'}
        on:click={() => filterSystem = 'system'}
      >System</button>
      <button 
        class="pill"
        class:active={filterSystem === 'custom'}
        on:click={() => filterSystem = 'custom'}
      >Custom</button>
    </div>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading widgets...</p>
    </div>
  {:else if error}
    <div class="error-state">
      <p>Error: {error}</p>
      <button class="btn btn-primary" on:click={loadData}>Retry</button>
    </div>
  {:else if filteredWidgets.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      </div>
      <h3>No widgets found</h3>
      <p>Create your first widget to get started</p>
      <button class="btn btn-primary" on:click={createWidget}>Create Widget</button>
    </div>
  {:else}
    <div class="widgets-grid">
      {#each filteredWidgets as widget}
        <div class="widget-card" class:system={widget.isSystem}>
          <div class="widget-header">
            <span class="category-badge">
              {getCategoryInfo(widget.category).icon}
            </span>
            <div class="widget-badges">
              {#if widget.isSystem}
                <span class="badge system">System</span>
              {/if}
              {#if widget.supportsAnimation}
                <span class="badge animated">Animated</span>
              {/if}
              {#if widget.isPublished}
                <span class="badge published">Published</span>
              {:else}
                <span class="badge draft">Draft</span>
              {/if}
            </div>
          </div>
          
          <div class="widget-body" on:click={() => editWidget(widget)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && editWidget(widget)}>
            <!-- Thumbnail Preview -->
            {#if widget.thumbnail}
              <div class="widget-thumbnail">
                <img src={widget.thumbnail} alt="{widget.name} preview" />
              </div>
            {:else}
              <div class="widget-thumbnail widget-thumbnail-placeholder">
                <span class="placeholder-icon">{getCategoryInfo(widget.category).icon}</span>
              </div>
            {/if}
            
            <h3>{widget.name}</h3>
            <p class="widget-description">{widget.description || 'No description'}</p>
            
            <div class="widget-meta">
              <span class="meta-item">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                {getRenderModeLabel(widget.renderMode)}
              </span>
              <span class="meta-item">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {formatRefreshInterval(widget.refreshInterval)}
              </span>
              <span class="meta-item">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                {widget.defaultSize?.width || 300}×{widget.defaultSize?.height || 150}
              </span>
              <!-- Task #1010: live last-refresh indicator (only shows if widget is in active rotation) -->
              {#if formatRefreshAge(widget.uuid)}
                <span class="meta-item meta-refresh" title="Last server-side refresh">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatRefreshAge(widget.uuid)}
                </span>
              {/if}
            </div>
          </div>

          <div class="widget-actions">
            <button class="action-btn" title="Edit" on:click={() => editWidget(widget)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button class="action-btn" title="Duplicate" on:click={() => duplicateWidget(widget)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button class="action-btn" title="Export" on:click={() => openExportModal(widget)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            {#if !widget.isSystem}
              <button class="action-btn danger" title="Delete" on:click={() => confirmDelete(widget)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Delete Confirmation Modal -->
{#if showDeleteModal}
  <div class="modal-overlay" on:click={() => showDeleteModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Delete Widget</h2>
        <button class="close-btn" on:click={() => showDeleteModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete <strong>{selectedWidget?.name}</strong>?</p>
        <p class="warning-text">This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showDeleteModal = false}>Cancel</button>
        <button class="btn btn-danger" on:click={deleteWidget}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Export Modal -->
{#if showExportModal && selectedWidget}
  <div class="modal-overlay" on:click={() => showExportModal = false}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Export Widget</h2>
        <button class="close-btn" on:click={() => showExportModal = false}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="export-widget-info">
          <div class="widget-icon">{getCategoryInfo(selectedWidget.category).icon}</div>
          <div class="widget-details">
            <h3>{selectedWidget.name}</h3>
            <p>{selectedWidget.description || 'No description'}</p>
          </div>
        </div>
        
        <div class="export-options">
          <h4>Export Options</h4>
          
          <label class="export-option">
            <input type="checkbox" bind:checked={exportIncludeAssets} />
            <span class="option-label">
              <span class="option-icon">🖼️</span>
              <span class="option-text">
                <strong>Include Assets</strong>
                <small>Images, icons, and other files</small>
              </span>
            </span>
          </label>
          
          <label class="export-option">
            <input type="checkbox" bind:checked={exportIncludeDbData} />
            <span class="option-label">
              <span class="option-icon">🗄️</span>
              <span class="option-text">
                <strong>Include Database Data</strong>
                <small>Cached data, settings, and state</small>
              </span>
            </span>
          </label>
          
          {#if exportIncludeDbData && exportAvailableTables.length > 0}
            <div class="table-selection">
              <div class="table-selection-header">
                <span>Select Tables ({exportSelectedTables.length}/{exportAvailableTables.length})</span>
                <div class="table-selection-actions">
                  <button class="link-btn" on:click={selectAllTables}>Select All</button>
                  <button class="link-btn" on:click={deselectAllTables}>Clear</button>
                </div>
              </div>
              <div class="table-list">
                {#each exportAvailableTables as tableName}
                  <label class="table-item">
                    <input 
                      type="checkbox" 
                      checked={exportSelectedTables.includes(tableName)}
                      on:change={() => toggleTableSelection(tableName)}
                    />
                    <span class="table-name">{tableName}</span>
                  </label>
                {/each}
              </div>
            </div>
          {:else if exportIncludeDbData && exportAvailableTables.length === 0}
            <p class="no-tables-msg">This widget has no database tables.</p>
          {/if}
        </div>
        
        <div class="export-preview">
          <h4>Package Contents</h4>
          <ul class="package-contents">
            <li>✓ Widget definition (manifest.json)</li>
            <li>✓ Client code (client.js)</li>
            <li>✓ Server code (server.js)</li>
            <li>✓ Configuration schema</li>
            <li>✓ Style schema</li>
            {#if exportIncludeAssets}
              <li>✓ Assets folder</li>
            {/if}
            {#if exportIncludeDbData && exportSelectedTables.length > 0}
              <li>✓ Database data ({exportSelectedTables.length} table{exportSelectedTables.length !== 1 ? 's' : ''})</li>
            {/if}
          </ul>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showExportModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={downloadWidget} disabled={exportLoading}>
          {#if exportLoading}
            <span class="btn-spinner"></span>
            Exporting...
          {:else}
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download .widget
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Import Modal -->
{#if showImportModal}
  <div class="modal-overlay" on:click={closeImportModal}>
    <div class="modal modal-lg" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Import Widget</h2>
        <button class="close-btn" on:click={closeImportModal}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <input 
          type="file" 
          accept=".widget,.zip,.json"
          bind:this={fileInput}
          on:change={handleFileSelect}
          style="display: none;"
        />
        
        <div 
          class="drop-zone" 
          class:has-file={importFile}
          class:has-error={importError}
          on:drop={handleFileDrop}
          on:dragover={handleDragOver}
          on:click={triggerFileSelect}
          role="button"
          tabindex="0"
          on:keypress={(e) => e.key === 'Enter' && triggerFileSelect()}
        >
          {#if importFile}
            <div class="file-preview">
              <div class="file-icon">📦</div>
              <div class="file-info">
                <span class="file-name">{importFileName}</span>
                <span class="file-size">{(importFile.size / 1024).toFixed(1)} KB</span>
              </div>
              <button class="remove-file" on:click|stopPropagation={() => { importFile = null; importFileName = ''; importPreview = null; if (fileInput) fileInput.value = ''; }}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {:else}
            <div class="drop-zone-content">
              <div class="drop-icon">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p class="drop-text">Drop your <strong>.widget</strong> file here</p>
              <p class="drop-subtext">or click to browse</p>
              <span class="supported-formats">Supports: .widget, .zip, .json</span>
            </div>
          {/if}
        </div>
        
        {#if importPreview}
          <div class="import-preview">
            <h4>Preview</h4>
            <div class="preview-details">
              <div class="preview-row">
                <span class="preview-label">Name:</span>
                <span class="preview-value">{importPreview.name}</span>
              </div>
              {#if importPreview.version !== '?'}
                <div class="preview-row">
                  <span class="preview-label">Version:</span>
                  <span class="preview-value">{importPreview.version}</span>
                </div>
              {/if}
              {#if importPreview.description}
                <div class="preview-row">
                  <span class="preview-label">Description:</span>
                  <span class="preview-value">{importPreview.description}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
        
        {#if importError}
          <div class="import-error">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{importError}</span>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={closeImportModal}>Cancel</button>
        <button class="btn btn-primary" on:click={importWidget} disabled={!importFile || importLoading}>
          {#if importLoading}
            <span class="btn-spinner"></span>
            Importing...
          {:else}
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import Widget
          {/if}
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
  .widgets-page {
    min-height: 100vh;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
    color: #fff;
    padding: 24px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .back-btn {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .back-btn svg {
    width: 20px;
    height: 20px;
  }

  .header-text h1 {
    font-size: 24px;
    font-weight: 600;
    margin: 0;
  }

  .header-text p {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    margin: 4px 0 0;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 8px;
    border: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn svg {
    width: 18px;
    height: 18px;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
  }

  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .btn-danger {
    background: #ef4444;
    color: #fff;
  }

  .btn-danger:hover {
    background: #dc2626;
  }

  .filters-bar {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 0 12px;
    flex: 1;
    min-width: 200px;
  }

  .search-box svg {
    width: 18px;
    height: 18px;
    color: rgba(255, 255, 255, 0.5);
  }

  .search-box input {
    background: none;
    border: none;
    color: #fff;
    padding: 10px 0;
    width: 100%;
    outline: none;
    font-size: 14px;
  }

  .search-box input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .filter-group select {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: #fff;
    padding: 10px 16px;
    font-size: 14px;
    cursor: pointer;
    outline: none;
  }

  .filter-group select option {
    background: #1a1a2e;
  }

  .filter-pills {
    display: flex;
    gap: 4px;
    background: rgba(255, 255, 255, 0.1);
    padding: 4px;
    border-radius: 8px;
  }

  .pill {
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .pill:hover {
    color: #fff;
  }

  .pill.active {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    gap: 16px;
    text-align: center;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-icon {
    width: 80px;
    height: 80px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-icon svg {
    width: 40px;
    height: 40px;
    color: rgba(255, 255, 255, 0.3);
  }

  .empty-state h3 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .empty-state p {
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  .widgets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }

  .widget-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .widget-card:hover {
    transform: translateY(-2px);
    border-color: rgba(102, 126, 234, 0.5);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .widget-card.system {
    border-color: rgba(139, 92, 246, 0.3);
  }

  .widget-thumbnail {
    width: 100%;
    height: 100px;
    margin-bottom: 12px;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .widget-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .widget-thumbnail-placeholder {
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(139, 92, 246, 0.1));
    border: 1px dashed rgba(255, 255, 255, 0.15);
  }

  .widget-thumbnail-placeholder .placeholder-icon {
    font-size: 36px;
    opacity: 0.3;
  }

  .widget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .category-badge {
    font-size: 24px;
  }

  .widget-badges {
    display: flex;
    gap: 8px;
  }

  .badge {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
  }

  .badge.system {
    background: rgba(139, 92, 246, 0.2);
    color: #a78bfa;
  }

  .badge.published {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
  }

  .badge.draft {
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
  }

  .badge.animated {
    background: rgba(251, 146, 60, 0.2);
    color: #fb923c;
  }

  .widget-body {
    padding: 16px;
    cursor: pointer;
  }

  .widget-body h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px;
  }

  .widget-description {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 16px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .widget-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .meta-item svg {
    width: 14px;
    height: 14px;
  }

  .widget-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }

  .action-btn {
    width: 36px;
    height: 36px;
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

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .action-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Modal Styles */
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
    max-width: 400px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal.modal-lg {
    max-width: 600px;
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
    padding: 24px;
  }

  .modal-body p {
    margin: 0 0 12px;
    color: rgba(255, 255, 255, 0.8);
  }

  .warning-text {
    color: #ef4444 !important;
    font-size: 13px;
  }

  .export-textarea {
    width: 100%;
    height: 200px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: #fff;
    padding: 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    resize: vertical;
  }

  .export-textarea:focus {
    outline: none;
    border-color: rgba(102, 126, 234, 0.5);
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

  .export-textarea.error {
    border-color: #ef4444;
  }

  .error-text {
    color: #ef4444;
    font-size: 13px;
    margin-top: 8px;
  }
  
  /* Export Modal Styles */
  .export-widget-info {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    margin-bottom: 20px;
  }
  
  .export-widget-info .widget-icon {
    font-size: 36px;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 12px;
  }
  
  .export-widget-info .widget-details h3 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
  }
  
  .export-widget-info .widget-details p {
    margin: 0;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }
  
  .export-options h4,
  .export-preview h4,
  .import-preview h4 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px;
    color: rgba(255, 255, 255, 0.8);
  }
  
  .export-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .export-option:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  
  .export-option input[type="checkbox"] {
    margin-top: 2px;
    width: 18px;
    height: 18px;
    accent-color: #667eea;
  }
  
  .option-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex: 1;
  }
  
  .option-icon {
    font-size: 20px;
  }
  
  .option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .option-text strong {
    font-size: 14px;
  }
  
  .option-text small {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .table-selection {
    margin-left: 30px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    margin-bottom: 8px;
  }
  
  .table-selection-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }
  
  .table-selection-actions {
    display: flex;
    gap: 12px;
  }
  
  .link-btn {
    background: none;
    border: none;
    color: #667eea;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  
  .link-btn:hover {
    text-decoration: underline;
  }
  
  .table-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .table-item {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
  }
  
  .table-item input[type="checkbox"] {
    accent-color: #667eea;
  }
  
  .table-name {
    font-family: 'JetBrains Mono', monospace;
    color: rgba(255, 255, 255, 0.8);
  }
  
  .no-tables-msg {
    margin-left: 30px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }
  
  .export-preview {
    margin-top: 20px;
    padding: 16px;
    background: rgba(102, 126, 234, 0.1);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 8px;
  }
  
  .package-contents {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  
  .package-contents li {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    margin-right: 8px;
  }
  
  /* Import Modal Styles */
  .drop-zone {
    border: 2px dashed rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    padding: 40px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: rgba(0, 0, 0, 0.2);
  }
  
  .drop-zone:hover {
    border-color: rgba(102, 126, 234, 0.5);
    background: rgba(102, 126, 234, 0.05);
  }
  
  .drop-zone.has-file {
    border-color: rgba(16, 185, 129, 0.5);
    background: rgba(16, 185, 129, 0.05);
    padding: 20px;
  }
  
  .drop-zone.has-error {
    border-color: rgba(239, 68, 68, 0.5);
  }
  
  .drop-zone-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  
  .drop-icon {
    width: 60px;
    height: 60px;
    background: rgba(102, 126, 234, 0.1);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .drop-icon svg {
    width: 30px;
    height: 30px;
    color: #667eea;
  }
  
  .drop-text {
    font-size: 16px;
    margin: 0;
    color: rgba(255, 255, 255, 0.8);
  }
  
  .drop-subtext {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
  }
  
  .supported-formats {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 10px;
    border-radius: 4px;
    margin-top: 8px;
  }
  
  .file-preview {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .file-icon {
    font-size: 32px;
  }
  
  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    text-align: left;
  }
  
  .file-name {
    font-size: 14px;
    font-weight: 500;
  }
  
  .file-size {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .remove-file {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.2);
    border: none;
    color: #ef4444;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  
  .remove-file:hover {
    background: rgba(239, 68, 68, 0.3);
  }
  
  .remove-file svg {
    width: 16px;
    height: 16px;
  }
  
  .import-preview {
    margin-top: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }
  
  .preview-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .preview-row {
    display: flex;
    gap: 12px;
  }
  
  .preview-label {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    width: 80px;
    flex-shrink: 0;
  }
  
  .preview-value {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.9);
  }
  
  .import-error {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    padding: 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 13px;
  }
  
  .import-error svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  /* Toast Styles */
  .toast-container {
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-radius: 10px;
    background: rgba(30, 30, 46, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: slideIn 0.3s ease;
    backdrop-filter: blur(10px);
    font-size: 14px;
    color: #fff;
  }

  .toast svg {
    width: 18px;
    height: 18px;
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

  .toast-info svg {
    color: #60a5fa;
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
</style>
