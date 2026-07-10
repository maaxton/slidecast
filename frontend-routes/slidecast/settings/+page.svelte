<script>
  import { onMount } from 'svelte';

  let settings = {};
  let diskSpace = { total: 0, available: 0, recommended: 0 };
  let loading = true;
  let saving = false;
  let saved = false;

  // Slider values in MB for easier handling
  let maxFileSizeMB = 100;
  let totalStorageMB = 1024;

  function goto(path) {
    window.location.href = path;
  }

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    loading = true;
    try {
      const [settingsRes, diskRes] = await Promise.all([
        fetch('/api/extensions/slidecast/settings'),
        fetch('/api/extensions/slidecast/disk-space')
      ]);
      
      const settingsData = await settingsRes.json();
      const diskData = await diskRes.json();
      
      settings = settingsData.settings || {};
      diskSpace = diskData.diskSpace || { total: 0, available: 0, recommended: 0 };
      
      // Convert bytes to MB for sliders
      maxFileSizeMB = Math.round(parseInt(settings.media_max_file_size || 104857600) / (1024 * 1024));
      totalStorageMB = Math.round(parseInt(settings.media_max_total_storage || diskSpace.recommended || 1073741824) / (1024 * 1024));
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      loading = false;
    }
  }

  // Sync slider values back to settings in bytes
  $: if (settings) {
    settings.media_max_file_size = maxFileSizeMB * 1024 * 1024;
    settings.media_max_total_storage = totalStorageMB * 1024 * 1024;
  }

  async function saveSettings() {
    saving = true;
    try {
      await fetch('/api/extensions/slidecast/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(settings)
      });
      saved = true;
      setTimeout(() => saved = false, 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      saving = false;
    }
  }

  function formatBytes(bytes) {
    const val = parseInt(bytes);
    if (!val) return '0 MB';
    if (val >= 1073741824) {
      return (val / 1073741824).toFixed(1) + ' GB';
    }
    return Math.round(val / (1024 * 1024)) + ' MB';
  }

  function formatBytesShort(bytes) {
    const val = parseInt(bytes);
    if (!val) return '0';
    if (val >= 1073741824) {
      return (val / 1073741824).toFixed(1) + 'GB';
    }
    return Math.round(val / (1024 * 1024)) + 'MB';
  }

  // Calculate max values for sliders
  $: maxTotalStorageMB = Math.round(diskSpace.available / (1024 * 1024)) || 102400;
  $: maxFileSizeLimit = Math.min(totalStorageMB, 2048); // Max 2GB per file or total storage
</script>

<div class="settings-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-content">
      <button class="back-btn" on:click={() => goto('/ext/slidecast')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>
      <h1>Settings</h1>
    </div>
    <div class="header-actions">
      {#if saved}
        <span class="saved-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"/></svg>Saved</span>
      {/if}
      <button class="btn btn-primary" on:click={saveSettings} disabled={saving || loading}>
        {#if saving}
          <span class="spinner-sm"></span>
        {/if}
        Save Changes
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading settings...</span>
    </div>
  {:else}
    <div class="settings-sections">
      <!-- Media Settings -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h2>Media Storage</h2>
        </div>
        <div class="section-content">
          <div class="disk-info">
            <span>Available disk space: <strong>{formatBytes(diskSpace.available)}</strong></span>
            <span class="hint">Recommended: {formatBytes(diskSpace.recommended)} (80% of available)</span>
          </div>
          
          <div class="setting-item-full">
            <div class="setting-info">
              <label>Maximum File Size</label>
              <p>Maximum size per uploaded file (images & videos)</p>
            </div>
            <div class="slider-control">
              <input 
                type="range" 
                min="10" 
                max={maxFileSizeLimit}
                step="10"
                bind:value={maxFileSizeMB}
              />
              <div class="slider-input">
                <input 
                  type="number" 
                  min="10" 
                  max={maxFileSizeLimit}
                  bind:value={maxFileSizeMB}
                />
                <span class="unit">MB</span>
              </div>
            </div>
            <div class="slider-labels">
              <span>10 MB</span>
              <span>{formatBytesShort(maxFileSizeLimit * 1024 * 1024)}</span>
            </div>
          </div>
          
          <div class="setting-item-full">
            <div class="setting-info">
              <label>Total Storage Limit</label>
              <p>Maximum total storage for all media files</p>
            </div>
            <div class="slider-control">
              <input 
                type="range" 
                min="100" 
                max={maxTotalStorageMB}
                step="100"
                bind:value={totalStorageMB}
              />
              <div class="slider-input">
                <input 
                  type="number" 
                  min="100" 
                  max={maxTotalStorageMB}
                  bind:value={totalStorageMB}
                />
                <span class="unit">MB</span>
              </div>
            </div>
            <div class="slider-labels">
              <span>100 MB</span>
              <span>{formatBytesShort(maxTotalStorageMB * 1024 * 1024)}</span>
            </div>
            <div class="storage-preview">
              Currently set to: <strong>{formatBytes(totalStorageMB * 1024 * 1024)}</strong>
            </div>
          </div>
        </div>
      </section>

      <!-- Cast Defaults -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h2>Cast Defaults</h2>
        </div>
        <div class="section-content">
          <div class="setting-item">
            <div class="setting-info">
              <label>Default Slide Duration</label>
              <p>How long each slide displays by default</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.default_slide_duration} on:change={() => settings = settings}>
                <option value="5000">5 seconds</option>
                <option value="10000">10 seconds</option>
                <option value="15000">15 seconds</option>
                <option value="30000">30 seconds</option>
                <option value="60000">1 minute</option>
              </select>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <label>Default Transition</label>
              <p>Transition effect between slides</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.default_transition} on:change={() => settings = settings}>
                <option value="fade">Fade</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="cut">Cut (Instant)</option>
              </select>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <label>Transition Duration</label>
              <p>How long the transition animation takes</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.default_transition_duration} on:change={() => settings = settings}>
                <option value="250">0.25 seconds</option>
                <option value="500">0.5 seconds</option>
                <option value="1000">1 second</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- Screen Settings -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <h2>Screen Settings</h2>
        </div>
        <div class="section-content">
          <div class="setting-item">
            <div class="setting-info">
              <label>Heartbeat Timeout</label>
              <p>Mark screen offline after this duration of no heartbeat</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.heartbeat_timeout} on:change={() => settings = settings}>
                <option value="30000">30 seconds</option>
                <option value="60000">1 minute</option>
                <option value="120000">2 minutes</option>
                <option value="300000">5 minutes</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- API Keys (for external feeds) -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <h2>API Keys</h2>
        </div>
        <div class="section-content">
          <p class="section-description">
            API keys for external feed providers. Configure these to enable weather, news, and other dynamic feeds.
          </p>
          <div class="setting-item">
            <div class="setting-info">
              <label>Weather API Key</label>
              <p>OpenWeatherMap API key for weather feeds</p>
            </div>
            <div class="setting-control">
              <input 
                type="password" 
                bind:value={settings.weather_api_key}
                placeholder="Enter API key..."
              />
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <label>News API Key</label>
              <p>NewsAPI key for news feeds (optional)</p>
            </div>
            <div class="setting-control">
              <input 
                type="password" 
                bind:value={settings.news_api_key}
                placeholder="Enter API key..."
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Performance Settings -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h2>Performance</h2>
        </div>
        <div class="section-content">
          <p class="section-description">
            Configure render performance settings. Lower values are better for Raspberry Pi and limited hardware.
          </p>
          <div class="setting-item">
            <div class="setting-info">
              <label>Max Concurrent Renders</label>
              <p>How many slides can render simultaneously (1 for Pi, 2-4 for better hardware)</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.render_max_concurrent} on:change={() => settings = settings}>
                <option value="1">1 (Recommended for Pi)</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <label>Widget Refresh Interval</label>
              <p>How often widgets are refreshed in the background (when screens connected)</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.render_widget_refresh_interval} on:change={() => settings = settings}>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds (Default)</option>
                <option value="120">2 minutes</option>
                <option value="300">5 minutes</option>
              </select>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <label>Render Cleanup</label>
              <p>Automatically delete old rendered images to save disk space</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.render_cleanup_age_days} on:change={() => settings = settings}>
                <option value="3">3 days</option>
                <option value="7">7 days (Default)</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
          </div>
          <div class="setting-note">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Lower concurrent renders and higher refresh intervals reduce CPU usage. Changes take effect after save.</span>
          </div>
        </div>
      </section>

      <!-- Logging Settings -->
      <section class="settings-section">
        <div class="section-header">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2>Logging</h2>
        </div>
        <div class="section-content">
          <p class="section-description">
            Control what gets logged. Higher levels are quieter and keep Docker logs clean.
          </p>
          <div class="setting-item">
            <div class="setting-info">
              <label>Log Level</label>
              <p>Minimum severity to log. Debug shows everything, Error shows only errors.</p>
            </div>
            <div class="setting-control">
              <select bind:value={settings.log_level} on:change={() => settings = settings}>
                <option value="debug">Debug (Verbose)</option>
                <option value="info">Info</option>
                <option value="warn">Warn (Recommended)</option>
                <option value="error">Error (Quietest)</option>
              </select>
            </div>
          </div>
          <div class="setting-note">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Logs are stored in the database and viewable in the main Logs page. Set to "Warn" or "Error" to reduce noise.</span>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .settings-page {
    padding: 2rem;
    max-width: 800px;
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

  .header-actions {
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

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .saved-badge {
    color: #22c55e;
    font-weight: 500;
  }

  .spinner-sm {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .loading {
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

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .settings-section {
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    background: rgb(var(--color-hover));
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .section-header svg {
    width: 24px;
    height: 24px;
    color: rgb(var(--color-primary));
  }

  .section-header h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .section-content {
    padding: 1rem 1.5rem;
  }

  .section-description {
    font-size: 0.875rem;
    color: rgb(var(--color-text-secondary));
    margin: 0 0 1rem;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 0;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .setting-item:last-child {
    border-bottom: none;
  }

  .setting-info label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  .setting-info p {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin: 0;
  }

  .setting-control {
    min-width: 200px;
  }

  .setting-control select,
  .setting-control input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-background));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
  }

  .setting-control select:focus,
  .setting-control input:focus {
    outline: none;
    border-color: rgb(var(--color-primary));
  }

  .disk-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem;
    background: rgb(var(--color-hover));
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .disk-info .hint {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .setting-item-full {
    padding: 1rem 0;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .setting-item-full:last-child {
    border-bottom: none;
  }

  .setting-item-full .setting-info {
    margin-bottom: 1rem;
  }

  .slider-control {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .slider-control input[type="range"] {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgb(var(--color-hover));
    appearance: none;
    -webkit-appearance: none;
  }

  .slider-control input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }

  .slider-control input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }

  .slider-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 120px;
  }

  .slider-input input[type="number"] {
    width: 80px;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-background));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
    text-align: right;
  }

  .slider-input input[type="number"]:focus {
    outline: none;
    border-color: rgb(var(--color-primary));
  }

  .slider-input .unit {
    font-size: 0.875rem;
    color: rgb(var(--color-text-secondary));
    font-weight: 500;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: rgb(var(--color-text-secondary));
    margin-top: 0.5rem;
    padding-right: 140px; /* Offset for the input */
  }

  .storage-preview {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: rgba(102, 126, 234, 0.1);
    border-radius: 6px;
    font-size: 0.8rem;
    color: rgb(var(--color-text-secondary));
  }

  .storage-preview strong {
    color: rgb(var(--color-text));
  }

  .setting-note {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(102, 126, 234, 0.1);
    border-radius: 8px;
    margin-top: 1rem;
    font-size: 0.8rem;
    color: rgb(var(--color-text-secondary));
  }

  .setting-note svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 0.1rem;
    color: rgb(var(--color-primary));
  }
</style>


