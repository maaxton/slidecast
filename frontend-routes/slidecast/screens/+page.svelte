<script>
  import { onMount } from 'svelte';
  import { toasts } from '@waiveo/ui';

  // State
  let screens = [];
  let casts = [];
  let tags = [];
  let loading = true;

  // Filters
  let filterTag = '';
  let filterStatus = '';

  // Modals
  let showEditModal = false;
  let showAssignModal = false;
  let showTagModal = false;
  let showPairingModal = false;
  let showSettingsModal = false;
  let showRokuControlModal = false;
  let selectedScreen = null;
  let newTag = '';
  let bulkAssignTag = '';
  let bulkAssignCast = '';
  
  // Roku control state
  let rokuApps = [];
  let rokuInfo = null;
  let rokuLoading = false;
  let rokuError = '';
  
  // Pairing state
  let pairingCode = '';
  let pairingScreenName = '';
  let pairingError = '';
  let pairingLoading = false;
  
  // Settings state
  let settings = {
    pairing_enabled: 'true',
    require_pairing_approval: 'true',
    default_cast_id: '',
    auto_assign_default_cast: 'false',
    screen_offline_threshold: '300',
    debug_mode_enabled: 'false',
    auto_launch_app_id: 'dev',
    screen_watchdog_enabled: 'true'
  };
  let settingsLoading = false;
  let settingsSaving = false;
  let settingsError = '';
  let settingsSuccess = '';
  
  // Auto-launch state
  let autoLaunchStatus = {}; // { screenSerial: { enabled: bool, automation_id: string } }
  let autoLaunchTogglingScreen = null; // Screen serial currently being toggled
  let showDisablePairingWarning = false;

  function goto(path) {
    window.location.href = path;
  }

  onMount(async () => {
    await loadData();
    await loadSettings();
    
    // Check for ?pair= query parameter
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get('pair');
    if (pairCode) {
      pairingCode = pairCode;
      showPairingModal = true;
      // Remove the query param from URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  async function loadData() {
    loading = true;
    try {
      const [screensRes, castsRes, tagsRes, autoLaunchRes] = await Promise.all([
        fetch('/api/extensions/slidecast/screens'),
        fetch('/api/extensions/slidecast/casts'),
        fetch('/api/extensions/slidecast/tags'),
        fetch('/api/extensions/slidecast/auto-launch')
      ]);

      const screensData = await screensRes.json();
      const castsData = await castsRes.json();
      const tagsData = await tagsRes.json();
      const autoLaunchData = await autoLaunchRes.json();

      screens = screensData.screens || [];
      casts = castsData.casts || [];
      tags = tagsData.tags || [];
      autoLaunchStatus = autoLaunchData.screens || {};
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      loading = false;
    }
  }
  
  // Auto-launch functions
  async function toggleAutoLaunch(screen) {
    if (!screen.metadata?.roku_device_id) return;
    
    const currentStatus = autoLaunchStatus[screen.serial]?.enabled;
    const action = currentStatus ? 'disable' : 'enable';
    
    autoLaunchTogglingScreen = screen.serial;
    try {
      const res = await fetch(`/api/extensions/slidecast/screens/${screen.serial}/auto-launch/${action}`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        // Update local state
        autoLaunchStatus[screen.serial] = {
          enabled: action === 'enable',
          automation_id: data.automation_id || null
        };
        autoLaunchStatus = autoLaunchStatus; // Trigger reactivity
      } else {
        toasts.error(data.error || `Failed to ${action} auto-launch`);
      }
    } catch (err) {
      console.error('Failed to toggle auto-launch:', err);
      toasts.error('Failed to toggle auto-launch');
    } finally {
      autoLaunchTogglingScreen = null;
    }
  }
  
  async function loadSettings() {
    settingsLoading = true;
    try {
      const res = await fetch('/api/extensions/slidecast/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        settings = {
          pairing_enabled: data.settings.pairing_enabled || 'true',
          require_pairing_approval: data.settings.require_pairing_approval || 'true',
          default_cast_id: data.settings.default_cast_id || '',
          auto_assign_default_cast: data.settings.auto_assign_default_cast || 'false',
          screen_offline_threshold: data.settings.screen_offline_threshold || '300',
          debug_mode_enabled: data.settings.debug_mode_enabled || 'false',
          screen_watchdog_enabled: data.settings.screen_watchdog_enabled || 'true'
        };
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      settingsLoading = false;
    }
  }
  
  async function saveSettings() {
    settingsSaving = true;
    settingsError = '';
    settingsSuccess = '';
    
    try {
      const res = await fetch('/api/extensions/slidecast/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(settings)
      });
      
      const data = await res.json();
      if (data.success) {
        settingsSuccess = 'Settings saved successfully';
        setTimeout(() => settingsSuccess = '', 3000);
      } else {
        settingsError = data.error || 'Failed to save settings';
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      settingsError = 'Failed to save settings';
    } finally {
      settingsSaving = false;
    }
  }
  
  function handlePairingToggle(e) {
    const newValue = e.target.checked ? 'true' : 'false';
    if (newValue === 'false') {
      showDisablePairingWarning = true;
    } else {
      settings.pairing_enabled = newValue;
    }
  }
  
  function confirmDisablePairing() {
    settings.pairing_enabled = 'false';
    showDisablePairingWarning = false;
  }
  
  function cancelDisablePairing() {
    showDisablePairingWarning = false;
  }
  
  function getDefaultCastName() {
    if (!settings.default_cast_id) return 'None';
    const cast = casts.find(c => c.uuid === settings.default_cast_id);
    return cast ? cast.name : 'Unknown';
  }

  async function toggleWatchdog(screen) {
    const enabled = screen.watchdog_enabled === 0 ? 1 : 0;
    await updateScreen(screen.serial, { watchdog_enabled: enabled });
  }

  async function updateScreen(serial, data) {
    try {
      await fetch(`/api/extensions/slidecast/screens/${serial}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data)
      });
      await loadData();
    } catch (err) {
      console.error('Failed to update screen:', err);
    }
  }

  async function deleteScreen(serial) {
    if (!confirm('Remove this screen from the list?')) return;

    try {
      await fetch(`/api/extensions/slidecast/screens/${serial}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      await loadData();
    } catch (err) {
      console.error('Failed to delete screen:', err);
    }
  }

  // Roku control functions
  async function loadRokuData(screen) {
    if (!screen?.metadata?.roku_device_id) return;
    
    rokuLoading = true;
    rokuError = '';
    rokuApps = [];
    rokuInfo = null;
    
    try {
      const [appsRes, infoRes] = await Promise.all([
        fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/apps`),
        fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/info`)
      ]);
      
      const appsData = await appsRes.json();
      const infoData = await infoRes.json();
      
      if (appsData.success) {
        rokuApps = appsData.apps || [];
      }
      if (infoData.success) {
        rokuInfo = infoData.info || null;
      }
    } catch (err) {
      console.error('Failed to load Roku data:', err);
      rokuError = 'Failed to load Roku device data';
    } finally {
      rokuLoading = false;
    }
  }
  
  async function rokuPowerOn(screen) {
    rokuLoading = true;
    try {
      const res = await fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/power/on`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.success) {
        rokuError = data.error || 'Failed to power on';
      }
    } catch (err) {
      rokuError = 'Failed to power on';
    } finally {
      rokuLoading = false;
    }
  }
  
  async function rokuPowerOff(screen) {
    rokuLoading = true;
    try {
      const res = await fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/power/off`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.success) {
        rokuError = data.error || 'Failed to power off';
      }
    } catch (err) {
      rokuError = 'Failed to power off';
    } finally {
      rokuLoading = false;
    }
  }
  
  async function rokuLaunchApp(screen, appId) {
    rokuLoading = true;
    try {
      const res = await fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/launch/${appId}`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.success) {
        rokuError = data.error || 'Failed to launch app';
      }
    } catch (err) {
      rokuError = 'Failed to launch app';
    } finally {
      rokuLoading = false;
    }
  }
  
  async function rokuSendKey(screen, key) {
    try {
      const res = await fetch(`/api/extensions/slidecast/screens/${screen.serial}/roku/keypress/${key}`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.success) {
        rokuError = data.error || `Failed to send ${key}`;
      }
    } catch (err) {
      rokuError = `Failed to send ${key}`;
    }
  }
  
  function openRokuControlModal(screen) {
    selectedScreen = screen;
    showRokuControlModal = true;
    loadRokuData(screen);
  }

  async function assignCast(serial, castId) {
    try {
      await fetch(`/api/extensions/slidecast/screens/${serial}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cast_id: castId })
      });
      showAssignModal = false;
      await loadData();
    } catch (err) {
      console.error('Failed to assign cast:', err);
    }
  }

  async function bulkAssignByTag() {
    if (!bulkAssignTag || !bulkAssignCast) return;

    try {
      await fetch('/api/extensions/slidecast/screens/assign-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ 
          tag: bulkAssignTag, 
          cast_id: bulkAssignCast 
        })
      });
      await loadData();
    } catch (err) {
      console.error('Failed to bulk assign:', err);
    }
  }

  async function addTagToScreen(serial, tag) {
    const screen = screens.find(s => s.serial === serial);
    if (!screen) return;

    const newTags = [...(screen.tags || []), tag];
    await updateScreen(serial, { tags: newTags });
  }

  async function removeTagFromScreen(serial, tag) {
    const screen = screens.find(s => s.serial === serial);
    if (!screen) return;

    const newTags = (screen.tags || []).filter(t => t !== tag);
    await updateScreen(serial, { tags: newTags });
  }

  function getCastName(castId) {
    const cast = casts.find(c => c.uuid === castId);
    return cast?.name || 'Unassigned';
  }

  /**
   * Check if screen is actively on (not just reachable)
   * For Roku: must be online AND power state indicates the display is on.
   * Uses the normalized power_state from the entity system ('on', 'off', 'playing', 'idle')
   * which correctly interprets all Roku power modes (PowerOn, Ready, Headless, etc.)
   */
  function isScreenActive(screen) {
    if (screen.source_device) {
      // Use source integration data
      const isOnline = screen.source_device.online || screen.source_device.status === 'online';

      // Prefer normalized power_state from entity system (on/off/playing/idle)
      const powerState = screen.source_device.power_state;
      if (powerState) {
        const isPoweredOn = powerState === 'on' || powerState === 'playing' || powerState === 'idle';
        return isOnline && isPoweredOn;
      }

      // Fallback: interpret raw power_mode from Roku ECP
      const rawMode = (screen.source_device.power_mode || '').toLowerCase();
      const isPoweredOn = rawMode === 'poweron' || rawMode === 'power on' || rawMode === 'headless';
      return isOnline && isPoweredOn;
    }
    // Fallback to slidecast status
    return screen.status === 'online';
  }

  function getFilteredScreens() {
    return screens.filter(screen => {
      const screenStatus = isScreenActive(screen) ? 'online' : 'offline';
      if (filterStatus && screenStatus !== filterStatus) return false;
      if (filterTag && !(screen.tags || []).includes(filterTag)) return false;
      return true;
    });
  }

  function getTimeSince(dateStr) {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function completePairing() {
    if (!pairingCode || pairingCode.length !== 6) {
      pairingError = 'Please enter a 6-digit pairing code';
      return;
    }
    
    pairingError = '';
    pairingLoading = true;
    
    try {
      const response = await fetch('/api/extensions/slidecast/protocol/complete-pairing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ 
          code: pairingCode,
          screen_name: pairingScreenName || undefined
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        showPairingModal = false;
        pairingCode = '';
        pairingScreenName = '';
        await loadData();
      } else {
        pairingError = result.error || 'Pairing failed';
      }
    } catch (err) {
      console.error('Pairing failed:', err);
      pairingError = 'Failed to complete pairing';
    } finally {
      pairingLoading = false;
    }
  }

  async function revokeDeviceToken(serial) {
    if (!confirm(`Revoke token for ${serial}? The device will need to pair again.`)) return;
    
    try {
      await fetch('/api/extensions/slidecast/protocol/revoke-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ device_serial: serial })
      });
      await loadData();
    } catch (err) {
      console.error('Failed to revoke token:', err);
    }
  }
</script>

<div class="screens-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-content">
      <button class="back-btn" on:click={() => goto('/ext/slidecast')}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>
      <h1>Screens</h1>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" on:click={() => showSettingsModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>
      <button class="btn btn-primary" on:click={() => showPairingModal = true}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Pair Screen
      </button>
      <div class="header-stats">
        {#if settings.pairing_enabled === 'false'}
          <span class="stat info">
            <span class="stat-label">Auto-Pair Mode</span>
          </span>
        {/if}
        <span class="stat">
          <span class="stat-value">{screens.filter(s => isScreenActive(s)).length}</span>
          <span class="stat-label">Online</span>
        </span>
        <span class="stat">
          <span class="stat-value">{screens.length}</span>
          <span class="stat-label">Total</span>
        </span>
      </div>
    </div>
  </div>

  <!-- Filters & Bulk Actions -->
  <div class="toolbar">
    <div class="filters">
      <select bind:value={filterStatus}>
        <option value="">All Status</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
      </select>
      <select bind:value={filterTag}>
        <option value="">All Tags</option>
        {#each tags as tag}
          <option value={tag}>{tag}</option>
        {/each}
      </select>
    </div>
    <div class="bulk-actions">
      <select bind:value={bulkAssignTag}>
        <option value="">Select tag...</option>
        {#each tags as tag}
          <option value={tag}>{tag}</option>
        {/each}
      </select>
      <select bind:value={bulkAssignCast}>
        <option value="">Select cast...</option>
        {#each casts as cast}
          <option value={cast.uuid}>{cast.name}</option>
        {/each}
      </select>
      <button class="btn btn-secondary" disabled={!bulkAssignTag || !bulkAssignCast} on:click={bulkAssignByTag}>
        Apply to Tag
      </button>
    </div>
  </div>

  <!-- Screens List -->
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading screens...</span>
    </div>
  {:else if screens.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <h3>No Screens Registered</h3>
      <p>Screens will appear here when they connect to Slidecast</p>
    </div>
  {:else}
    <div class="screens-list">
      {#each getFilteredScreens() as screen}
        <div class="screen-card">
          <div class="screen-status-indicator" class:online={isScreenActive(screen)}></div>
          
          <div class="screen-info">
            <div class="screen-header">
              <h3>{screen.name}</h3>
              <span class="screen-serial">{screen.serial}</span>
            </div>
            
            <div class="screen-meta">
              <span class="platform-badge">{screen.platform || 'Unknown'}</span>
              {#if screen.metadata?.discovery_linked}
                <span class="badge badge-discovery" title="Auto-discovered and linked to Roku device">
                  <svg viewBox="0 0 20 20" fill="currentColor" style="width: 12px; height: 12px; margin-right: 4px;">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  Linked
                </span>
              {/if}
            </div>
            
            <!-- Connection Status (stacked) -->
            {#if true}
              {@const screenPowerState = screen.source_device?.power_state}
              {@const isPoweredOn = screenPowerState === 'on' || screenPowerState === 'playing' || screenPowerState === 'idle'}
              {@const isPlaying = screenPowerState === 'playing'}
              {@const isIdle = screenPowerState === 'idle'}
              {@const activeApp = screen.source_device?.active_app}
              <div class="screen-status-badges">
                <div
                  class="status-row"
                  class:status-good={screen.device_online && isPoweredOn}
                  class:status-warn={screen.device_online && !isPoweredOn}
                  class:status-bad={!screen.device_online}
                >
                  <span class="status-dot-small"></span>
                  <span class="status-label">Device:</span>
                  <span class="status-value">{#if !screen.device_online}Offline{:else if isPoweredOn}On{:else}Standby{/if}</span>
                </div>
              <div
                class="status-row"
                class:status-good={screen.app_connected}
                class:status-bad={!screen.app_connected}
              >
                <span class="status-dot-small"></span>
                <span class="status-label">App:</span>
                <span class="status-value">{screen.app_connected ? 'Connected' : 'Not Running'}</span>
              </div>
              <!--
                Playback row — distinguishes Playing / Idle / Home using the live
                media_player entity power_state from roku-integration:
                  'playing' -> Playing (green pulse, optionally with active app name)
                  'idle'    -> Idle (gray, screensaver running)
                  'on'      -> Home (gray, on the Roku home screen)
                Only shown when the device is reachable and powered on; the Device
                row already covers Offline / Standby.
              -->
              {#if screen.device_online && isPoweredOn}
                <div
                  class="status-row playback-row"
                  class:status-playing={isPlaying}
                  class:status-good={isPlaying}
                  class:status-neutral={!isPlaying}
                >
                  <span class="status-dot-small" class:status-dot-pulse={isPlaying}></span>
                  <span class="status-label">Playback:</span>
                  <span class="status-value">
                    {#if isPlaying}
                      Playing{#if activeApp && activeApp !== 'Home'} · {activeApp}{/if}
                    {:else if isIdle}
                      Idle{#if activeApp && activeApp !== 'Home'} · {activeApp}{/if}
                    {:else}
                      Home
                    {/if}
                  </span>
                </div>
              {/if}
              <div class="status-row status-neutral">
                <span class="status-label">Last seen:</span>
                <span class="status-value">{getTimeSince(screen.last_seen_at)}</span>
              </div>
              </div>
            {/if}

            <div class="screen-tags">
              {#each screen.tags || [] as tag}
                <span class="tag">
                  {tag}
                  <button class="tag-remove" on:click={() => removeTagFromScreen(screen.serial, tag)}>×</button>
                </span>
              {/each}
              <button class="add-tag-btn" on:click={() => { selectedScreen = screen; showTagModal = true; }}>
                + Add Tag
              </button>
            </div>
          </div>

          <div class="screen-cast">
            <span class="cast-label">Playing:</span>
            <span class="cast-name" class:unassigned={!screen.assigned_cast_id}>
              {getCastName(screen.assigned_cast_id)}
            </span>
          </div>

          <div class="screen-actions">
            <button class="btn btn-small" on:click={() => { selectedScreen = screen; showAssignModal = true; }}>
              Change Cast
            </button>
            {#if screen.metadata?.roku_device_id}
              <button class="btn btn-small btn-roku" on:click={() => openRokuControlModal(screen)} title="Control linked Roku device">
                <svg viewBox="0 0 20 20" fill="currentColor" style="width: 14px; height: 14px; margin-right: 4px;">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                </svg>
                Roku
              </button>
              <div class="auto-launch-toggle" title={autoLaunchStatus[screen.serial]?.enabled ? 'Auto-launch enabled' : 'Auto-launch disabled'}>
                <span class="auto-launch-label">Auto-Launch</span>
                <label class="toggle-small">
                  <input 
                    type="checkbox" 
                    checked={autoLaunchStatus[screen.serial]?.enabled}
                    on:change={() => toggleAutoLaunch(screen)}
                    disabled={autoLaunchTogglingScreen === screen.serial}
                  />
                  <span class="toggle-slider-small"></span>
                </label>
              </div>
            {/if}
            <div class="auto-launch-toggle" title={screen.watchdog_enabled !== 0 ? 'Watchdog enabled — auto-recovers this screen from Home' : 'Watchdog disabled for this screen'}>
              <span class="auto-launch-label">Watchdog</span>
              <label class="toggle-small">
                <input
                  type="checkbox"
                  checked={screen.watchdog_enabled !== 0}
                  on:change={() => toggleWatchdog(screen)}
                />
                <span class="toggle-slider-small"></span>
              </label>
            </div>
            <button class="btn btn-small btn-secondary" on:click={() => { selectedScreen = screen; showEditModal = true; }}>
              Edit
            </button>
            <button class="btn btn-small btn-danger" on:click={() => revokeDeviceToken(screen.serial)} title="Revoke device token">
              Unpair
            </button>
            <button class="btn btn-small btn-danger" on:click={() => deleteScreen(screen.serial)}>
              Remove
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Edit Screen Modal -->
{#if showEditModal && selectedScreen}
  <div class="modal-overlay" on:click={() => showEditModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Edit Screen</h2>
        <button class="close-btn" on:click={() => showEditModal = false}>×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Name</label>
          <input type="text" bind:value={selectedScreen.name} />
        </div>
        <div class="form-group">
          <label>Serial</label>
          <input type="text" value={selectedScreen.serial} disabled />
        </div>
        <div class="form-group">
          <label>Platform</label>
          <input type="text" value={selectedScreen.platform} disabled />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showEditModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={() => { updateScreen(selectedScreen.serial, { name: selectedScreen.name }); showEditModal = false; }}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- Assign Cast Modal -->
{#if showAssignModal && selectedScreen}
  <div class="modal-overlay" on:click={() => showAssignModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Assign Cast to {selectedScreen.name}</h2>
        <button class="close-btn" on:click={() => showAssignModal = false}>×</button>
      </div>
      <div class="modal-body">
        {#if casts.length === 0}
          <p>No casts available. Create a cast first.</p>
        {:else}
          <div class="cast-list">
            <button 
              class="cast-option"
              class:selected={!selectedScreen.assigned_cast_id}
              on:click={() => assignCast(selectedScreen.serial, null)}
            >
              <span class="cast-option-name">None (Unassigned)</span>
            </button>
            {#each casts as cast}
              <button 
                class="cast-option"
                class:selected={selectedScreen.assigned_cast_id === cast.uuid}
                on:click={() => assignCast(selectedScreen.serial, cast.uuid)}
              >
                <span class="cast-option-name">{cast.name}</span>
                <span class="cast-option-slides">{cast.slideCount || 0} slides</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Add Tag Modal -->
{#if showTagModal && selectedScreen}
  <div class="modal-overlay" on:click={() => showTagModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Add Tag</h2>
        <button class="close-btn" on:click={() => showTagModal = false}>×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>New Tag</label>
          <input 
            type="text" 
            bind:value={newTag} 
            placeholder="lobby, kitchen, office..."
            on:keydown={(e) => { if (e.key === 'Enter') { addTagToScreen(selectedScreen.serial, newTag); newTag = ''; showTagModal = false; }}}
          />
        </div>
        {#if tags.length > 0}
          <div class="existing-tags">
            <label>Or select existing:</label>
            <div class="tag-options">
              {#each tags as tag}
                {#if !(selectedScreen.tags || []).includes(tag)}
                  <button class="tag-option" on:click={() => { addTagToScreen(selectedScreen.serial, tag); showTagModal = false; }}>
                    {tag}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showTagModal = false}>Cancel</button>
        <button class="btn btn-primary" disabled={!newTag} on:click={() => { addTagToScreen(selectedScreen.serial, newTag); newTag = ''; showTagModal = false; }}>Add</button>
      </div>
    </div>
  </div>
{/if}

<!-- Pairing Modal -->
{#if showPairingModal}
  <div class="modal-overlay" on:click={() => showPairingModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Pair New Screen</h2>
        <button class="close-btn" on:click={() => showPairingModal = false}>×</button>
      </div>
      <div class="modal-body">
        <p class="pairing-instructions">
          Enter the 6-digit code displayed on your TV screen, or scan the QR code with your phone to open this page with the code pre-filled.
        </p>
        
        {#if pairingError}
          <div class="error-message">{pairingError}</div>
        {/if}
        
        <div class="form-group">
          <label>Pairing Code</label>
          <input 
            type="text" 
            bind:value={pairingCode}
            placeholder="000000"
            maxlength="6"
            pattern="[0-9]*"
            class="pairing-code-input"
            on:keydown={(e) => { if (e.key === 'Enter') completePairing(); }}
          />
        </div>
        
        <div class="form-group">
          <label>Screen Name (optional)</label>
          <input 
            type="text" 
            bind:value={pairingScreenName}
            placeholder="Living Room TV"
          />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showPairingModal = false}>Cancel</button>
        <button 
          class="btn btn-primary" 
          disabled={pairingLoading || !pairingCode || pairingCode.length !== 6} 
          on:click={completePairing}
        >
          {pairingLoading ? 'Pairing...' : 'Complete Pairing'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Settings Modal -->
{#if showSettingsModal}
  <div class="modal-overlay" on:click={() => showSettingsModal = false}>
    <div class="modal modal-large" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Screen Settings</h2>
        <button class="close-btn" on:click={() => showSettingsModal = false}>×</button>
      </div>
      <div class="modal-body">
        {#if settingsError}
          <div class="error-message">{settingsError}</div>
        {/if}
        {#if settingsSuccess}
          <div class="success-message">{settingsSuccess}</div>
        {/if}
        
        <!-- Pairing Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Device Pairing
          </h3>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Require Pairing Code</label>
              <p class="setting-description">When enabled, new devices must enter a 6-digit code to pair</p>
            </div>
            <label class="toggle">
              <input 
                type="checkbox" 
                checked={settings.pairing_enabled === 'true'}
                on:change={handlePairingToggle}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          
          {#if settings.pairing_enabled === 'false'}
            <div class="info-box">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span><strong>Auto-Pair Mode:</strong> New devices will connect automatically without requiring a code. Good for trusted networks.</span>
            </div>
          {/if}
        </div>
        
        <!-- Default Cast Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            Default Cast
          </h3>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Default Cast</label>
              <p class="setting-description">Cast to assign to newly paired screens</p>
            </div>
            <select bind:value={settings.default_cast_id} class="setting-select">
              <option value="">None</option>
              {#each casts as cast}
                <option value={cast.uuid}>{cast.name}</option>
              {/each}
            </select>
          </div>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Auto-Assign on Pairing</label>
              <p class="setting-description">Automatically assign the default cast when a new device pairs</p>
            </div>
            <label class="toggle">
              <input 
                type="checkbox" 
                checked={settings.auto_assign_default_cast === 'true'}
                on:change={(e) => settings.auto_assign_default_cast = e.target.checked ? 'true' : 'false'}
                disabled={!settings.default_cast_id}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        
        <!-- Monitoring Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Monitoring
          </h3>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Offline Threshold</label>
              <p class="setting-description">Seconds before a screen is marked offline</p>
            </div>
            <select bind:value={settings.screen_offline_threshold} class="setting-select">
              <option value="60">1 minute</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
              <option value="600">10 minutes</option>
              <option value="1800">30 minutes</option>
            </select>
          </div>
        </div>

        <!-- Screen Watchdog Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Screen Watchdog
          </h3>

          <div class="setting-item">
            <div class="setting-info">
              <label>Auto-Recover Screens</label>
              <p class="setting-description">Relaunch Waiveo automatically on screens that drop to the Home screen (power blip, crash). Disable to stop all automatic relaunches fleet-wide.</p>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settings.screen_watchdog_enabled === 'true'}
                on:change={(e) => settings.screen_watchdog_enabled = e.target.checked ? 'true' : 'false'}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Auto-Launch Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Auto-Launch
          </h3>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Waiveo App ID</label>
              <p class="setting-description">The app ID used for auto-launch automations</p>
            </div>
            <input 
              type="text" 
              bind:value={settings.auto_launch_app_id}
              placeholder="dev"
              class="setting-input"
            />
          </div>
          
          <div class="info-box">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Use <strong>"dev"</strong> for sideloaded development builds. Once published to app stores, use the assigned app ID.</span>
          </div>
        </div>

        <!-- Debug Section -->
        <div class="settings-section">
          <h3>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Developer
          </h3>
          
          <div class="setting-item">
            <div class="setting-info">
              <label>Debug Mode</label>
              <p class="setting-description">Enable verbose logging for troubleshooting</p>
            </div>
            <label class="toggle">
              <input 
                type="checkbox" 
                checked={settings.debug_mode_enabled === 'true'}
                on:change={(e) => settings.debug_mode_enabled = e.target.checked ? 'true' : 'false'}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showSettingsModal = false}>Cancel</button>
        <button 
          class="btn btn-primary" 
          disabled={settingsSaving}
          on:click={saveSettings}
        >
          {settingsSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Auto-Pair Warning Modal -->
{#if showDisablePairingWarning}
  <div class="modal-overlay" on:click={cancelDisablePairing}>
    <div class="modal modal-warning" on:click|stopPropagation>
      <div class="modal-header warning">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="24" height="24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h2>Enable Auto-Pair Mode?</h2>
        <button class="close-btn" on:click={cancelDisablePairing}>×</button>
      </div>
      <div class="modal-body">
        <div class="warning-content">
          <p><strong>Warning:</strong> Enabling auto-pair mode allows ANY device on your network to connect automatically without approval.</p>
          <ul>
            <li>New devices will pair instantly without entering a code</li>
            <li>No user approval is required for new connections</li>
            <li>Existing paired devices continue to work normally</li>
            <li>You can re-enable pairing codes at any time</li>
          </ul>
          <p class="warning-note">Only use this on trusted networks where you control all devices.</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={cancelDisablePairing}>Cancel</button>
        <button class="btn btn-warning" on:click={confirmDisablePairing}>
          Enable Auto-Pair
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Roku Control Modal -->
{#if showRokuControlModal && selectedScreen}
  <div class="modal-overlay" on:click={() => showRokuControlModal = false}>
    <div class="modal modal-roku" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Roku Control - {selectedScreen.name}</h2>
        <button class="close-btn" on:click={() => showRokuControlModal = false}>×</button>
      </div>
      <div class="modal-body">
        {#if rokuError}
          <div class="error-message">{rokuError}</div>
        {/if}
        
        <div class="roku-info">
          <div class="roku-detail">
            <span class="label">Device ID:</span>
            <span class="value">{selectedScreen.metadata?.roku_device_id || 'N/A'}</span>
          </div>
          <div class="roku-detail">
            <span class="label">IP Address:</span>
            <span class="value">{selectedScreen.metadata?.ip_address || 'Unknown'}</span>
          </div>
          {#if rokuInfo}
            <div class="roku-detail">
              <span class="label">Model:</span>
              <span class="value">{rokuInfo.modelName || 'Unknown'}</span>
            </div>
            <div class="roku-detail">
              <span class="label">Software:</span>
              <span class="value">{rokuInfo.softwareVersion || 'Unknown'}</span>
            </div>
          {/if}
        </div>
        
        <div class="roku-controls">
          <h4>Power</h4>
          <div class="control-row">
            <button class="btn btn-success" on:click={() => rokuPowerOn(selectedScreen)} disabled={rokuLoading}>
              Power On
            </button>
            <button class="btn btn-danger" on:click={() => rokuPowerOff(selectedScreen)} disabled={rokuLoading}>
              Power Off
            </button>
          </div>
        </div>
        
        <div class="roku-controls">
          <h4>Navigation</h4>
          <div class="remote-grid">
            <div></div>
            <button class="btn btn-small" on:click={() => rokuSendKey(selectedScreen, 'Up')}>▲</button>
            <div></div>
            <button class="btn btn-small" on:click={() => rokuSendKey(selectedScreen, 'Left')}>◀</button>
            <button class="btn btn-small btn-primary" on:click={() => rokuSendKey(selectedScreen, 'Select')}>OK</button>
            <button class="btn btn-small" on:click={() => rokuSendKey(selectedScreen, 'Right')}>▶</button>
            <div></div>
            <button class="btn btn-small" on:click={() => rokuSendKey(selectedScreen, 'Down')}>▼</button>
            <div></div>
          </div>
          <div class="control-row">
            <button class="btn btn-small btn-secondary" on:click={() => rokuSendKey(selectedScreen, 'Back')}>Back</button>
            <button class="btn btn-small btn-secondary" on:click={() => rokuSendKey(selectedScreen, 'Home')}>Home</button>
            <button class="btn btn-small btn-secondary" on:click={() => rokuSendKey(selectedScreen, 'Info')}>Info</button>
          </div>
        </div>
        
        {#if rokuApps.length > 0}
          <div class="roku-controls">
            <h4>Apps ({rokuApps.length})</h4>
            <div class="apps-grid">
              {#each rokuApps.slice(0, 12) as app}
                <button class="app-btn" on:click={() => rokuLaunchApp(selectedScreen, app.id)} disabled={rokuLoading} title={app.name}>
                  {app.name.substring(0, 10)}{app.name.length > 10 ? '...' : ''}
                </button>
              {/each}
            </div>
            {#if rokuApps.length > 12}
              <p class="apps-more">+{rokuApps.length - 12} more apps</p>
            {/if}
          </div>
        {/if}
        
        {#if rokuLoading}
          <div class="loading-indicator">Loading...</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn" on:click={() => loadRokuData(selectedScreen)} disabled={rokuLoading}>
          Refresh
        </button>
        <button class="btn btn-secondary" on:click={() => showRokuControlModal = false}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .screens-page {
    padding: 2rem;
    max-width: 1200px;
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

  .header-stats {
    display: flex;
    gap: 2rem;
  }

  .stat {
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(var(--color-text));
  }

  .stat-label {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .filters, .bulk-actions {
    display: flex;
    gap: 0.5rem;
  }

  select {
    padding: 0.5rem 1rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    font-size: 0.875rem;
  }

  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
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
    background: transparent;
    color: #ef4444;
    border: 1px solid #ef4444;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .screens-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .screen-card {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 12px;
  }

  .screen-status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #94a3b8;
    flex-shrink: 0;
  }

  .screen-status-indicator.online {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }

  .screen-info {
    flex: 1;
  }

  .screen-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .screen-header h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .screen-serial {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    font-family: monospace;
  }

  .screen-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-bottom: 0.5rem;
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .badge-discovery {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-auto {
    background: rgba(139, 92, 246, 0.15);
    color: #8b5cf6;
    border: 1px solid rgba(139, 92, 246, 0.3);
  }

  /* Connection Status Badges */
  .badge-status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 500;
    border-radius: 4px;
  }

  .badge-status .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .badge-online {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .badge-online .status-dot {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.6);
  }

  .badge-offline {
    background: rgba(107, 114, 128, 0.15);
    color: #9ca3af;
    border: 1px solid rgba(107, 114, 128, 0.3);
  }

  .badge-offline .status-dot {
    background: #6b7280;
  }

  .badge-app-connected {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge-app-connected .status-dot {
    background: #3b82f6;
    box-shadow: 0 0 4px rgba(59, 130, 246, 0.6);
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .badge-app-disconnected {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .badge-app-disconnected .status-dot {
    background: #ef4444;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Platform Badge */
  .platform-badge {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Stacked Status Badges */
  .screen-status-badges {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: rgba(var(--color-surface-alt), 0.5);
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-dot-small {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-row.status-good .status-dot-small {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
  }

  .status-row.status-bad .status-dot-small {
    background: #ef4444;
  }

  .status-row.status-neutral .status-dot-small {
    display: none;
  }

  .status-label {
    color: rgb(var(--color-text-secondary));
    min-width: 60px;
  }

  .status-value {
    color: rgb(var(--color-text));
    font-weight: 500;
  }

  .status-row.status-good .status-value {
    color: #22c55e;
  }

  .status-row.status-bad .status-value {
    color: #f87171;
  }

  .status-row.status-warn .status-dot-small {
    background: #f59e0b;
    box-shadow: 0 0 4px rgba(245, 158, 11, 0.5);
  }

  .status-row.status-warn .status-value {
    color: #fbbf24;
  }

  /* Playback row — distinguishes Playing / Idle / Home from the live entity state */
  .status-row.playback-row .status-label {
    color: rgb(var(--color-text-secondary));
  }

  .status-row.status-playing .status-value {
    color: #22c55e;
    font-weight: 600;
  }

  .status-dot-small.status-dot-pulse {
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  /* Auto-Launch Toggle */
  .auto-launch-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: rgb(var(--color-surface-alt));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
  }

  .auto-launch-label {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .toggle-small {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
  }

  .toggle-small input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider-small {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    transition: 0.3s;
    border-radius: 20px;
  }

  .toggle-slider-small:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 2px;
    bottom: 2px;
    background-color: rgb(var(--color-text-secondary));
    transition: 0.3s;
    border-radius: 50%;
  }

  .toggle-small input:checked + .toggle-slider-small {
    background-color: #22c55e;
    border-color: #22c55e;
  }

  .toggle-small input:checked + .toggle-slider-small:before {
    transform: translateX(16px);
    background-color: white;
  }

  .toggle-small input:disabled + .toggle-slider-small {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .screen-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .tag {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .tag-remove {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    font-size: 1rem;
    padding: 0;
    line-height: 1;
  }

  .add-tag-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: rgb(var(--color-text-secondary));
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
  }

  .add-tag-btn:hover {
    color: rgb(var(--color-primary));
  }

  .screen-cast {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 150px;
  }

  .cast-label {
    font-size: 0.625rem;
    color: rgb(var(--color-text-secondary));
    text-transform: uppercase;
  }

  .cast-name {
    font-weight: 500;
  }

  .cast-name.unassigned {
    color: rgb(var(--color-text-secondary));
    font-style: italic;
  }

  .screen-actions {
    display: flex;
    gap: 0.5rem;
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
    max-height: 80vh;
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
    overflow-y: auto;
    max-height: 60vh;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgb(var(--color-border));
  }

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

  .form-group input:disabled {
    opacity: 0.6;
  }

  .cast-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cast-option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgb(var(--color-background));
    border: 2px solid rgb(var(--color-border));
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }

  .cast-option:hover {
    border-color: rgb(var(--color-primary));
  }

  .cast-option.selected {
    border-color: rgb(var(--color-primary));
    background: rgba(var(--color-primary), 0.1);
  }

  .cast-option-name {
    font-weight: 500;
  }

  .cast-option-slides {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .existing-tags {
    margin-top: 1.5rem;
  }

  .existing-tags label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .tag-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tag-option {
    padding: 0.5rem 1rem;
    background: rgb(var(--color-hover));
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .tag-option:hover {
    background: rgba(var(--color-primary), 0.1);
    color: rgb(var(--color-primary));
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .pairing-instructions {
    margin-bottom: 1.5rem;
    color: rgb(var(--color-text-secondary));
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .pairing-code-input {
    font-size: 2rem !important;
    font-family: monospace;
    text-align: center;
    letter-spacing: 0.5rem;
    padding: 1rem !important;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .success-message {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  /* Settings Modal */
  .modal-large {
    max-width: 600px;
    width: 100%;
  }

  .modal-warning {
    max-width: 500px;
    width: 100%;
  }

  .modal-header.warning {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: #f59e0b;
  }

  .modal-header.warning h2 {
    flex: 1;
  }

  .settings-section {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid rgb(var(--color-border));
  }

  .settings-section:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .settings-section h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: rgb(var(--color-text));
  }

  .settings-section h3 svg {
    opacity: 0.7;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0;
  }

  .setting-info {
    flex: 1;
    margin-right: 1rem;
  }

  .setting-info label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  .setting-description {
    font-size: 0.8rem;
    color: rgb(var(--color-text-secondary));
    margin: 0;
  }

  .setting-select {
    padding: 0.5rem 1rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
    min-width: 150px;
  }

  .setting-input {
    padding: 0.5rem 1rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 8px;
    background: rgb(var(--color-surface));
    color: rgb(var(--color-text));
    font-size: 0.875rem;
    min-width: 150px;
  }

  .setting-input:focus {
    outline: none;
    border-color: rgb(var(--color-primary));
    box-shadow: 0 0 0 2px rgba(var(--color-primary), 0.2);
  }

  .setting-input::placeholder {
    color: rgb(var(--color-text-secondary));
    opacity: 0.6;
  }

  /* Toggle Switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 26px;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgb(var(--color-border));
    transition: 0.3s;
    border-radius: 26px;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  .toggle input:checked + .toggle-slider {
    background-color: rgb(var(--color-primary));
  }

  .toggle input:checked + .toggle-slider:before {
    transform: translateX(22px);
  }

  .toggle input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Warning Box */
  .warning-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    color: #f59e0b;
    font-size: 0.875rem;
    margin-top: 1rem;
  }

  .warning-box svg {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  /* Info Box */
  .info-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    color: #3b82f6;
    font-size: 0.875rem;
    margin-top: 1rem;
  }

  .info-box svg {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .info-box strong {
    color: #2563eb;
  }

  .warning-content {
    color: rgb(var(--color-text));
  }

  .warning-content p {
    margin: 0 0 1rem 0;
  }

  .warning-content ul {
    margin: 0 0 1rem 0;
    padding-left: 1.5rem;
  }

  .warning-content li {
    margin-bottom: 0.5rem;
    color: rgb(var(--color-text-secondary));
  }

  .warning-note {
    font-size: 0.875rem;
    color: rgb(var(--color-text-secondary));
    font-style: italic;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-danger:hover {
    background: #dc2626;
  }

  .btn-warning {
    background: #f59e0b;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-warning:hover {
    background: #d97706;
  }

  .stat.warning {
    background: rgba(245, 158, 11, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    color: #f59e0b;
  }

  .stat.warning .stat-label {
    color: #f59e0b;
    font-weight: 500;
  }

  .stat.info {
    background: rgba(59, 130, 246, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    color: #3b82f6;
  }

  .stat.info .stat-label {
    color: #3b82f6;
    font-weight: 500;
  }

  .header-actions .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Roku Button */
  .btn-roku {
    background: linear-gradient(135deg, #662d91, #8b5cf6);
    color: white;
    border: none;
    display: inline-flex;
    align-items: center;
  }

  .btn-roku:hover {
    background: linear-gradient(135deg, #7c3aed, #a78bfa);
  }

  /* Roku Control Modal */
  .modal-roku {
    max-width: 500px;
  }

  .roku-info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 1rem;
    background: rgb(var(--color-surface));
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .roku-detail {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .roku-detail .label {
    font-size: 0.7rem;
    color: rgb(var(--color-text-secondary));
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .roku-detail .value {
    font-size: 0.875rem;
    font-family: monospace;
  }

  .roku-controls {
    margin-bottom: 1.5rem;
  }

  .roku-controls h4 {
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
    color: rgb(var(--color-text-secondary));
  }

  .control-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .remote-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    max-width: 180px;
    margin-bottom: 1rem;
  }

  .remote-grid button {
    padding: 0.75rem;
    font-size: 1rem;
  }

  .apps-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .app-btn {
    padding: 0.5rem;
    font-size: 0.7rem;
    background: rgb(var(--color-surface));
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-btn:hover {
    background: rgb(var(--color-hover));
    border-color: rgb(var(--color-primary));
  }

  .apps-more {
    font-size: 0.75rem;
    color: rgb(var(--color-text-secondary));
    margin-top: 0.5rem;
  }

  .loading-indicator {
    text-align: center;
    padding: 1rem;
    color: rgb(var(--color-text-secondary));
    font-size: 0.875rem;
  }

  .error-message {
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    color: #ef4444;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }
</style>


