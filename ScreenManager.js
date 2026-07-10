/**
 * ScreenManager - Manages connected TV screens
 */

class ScreenManager {
  constructor(api, options = {}) {
    this.api = api;
    this.model = null;
    // Optional event bus for emitting lifecycle events (cast:started, etc.)
    this.eventBus = options.eventBus || api?.globalEventBus || null;
  }

  async init() {
    this.model = this.api.model('slidecast_screens');
  }

  /**
   * Emit cast:started for a screen that just transitioned into
   * "actively playing" state (online + assigned_cast_id present).
   * Safe no-op if no eventBus is configured.
   * @private
   */
  _emitCastStartedIfActive(screen) {
    if (!this.eventBus || !screen) return;
    if (screen.status !== 'online') return;
    if (!screen.assigned_cast_id) return;
    try {
      this.eventBus.emit('cast:started', {
        castId: screen.assigned_cast_id,
        screenId: screen.id,
        screenSerial: screen.serial,
      });
    } catch (err) {
      // Swallow — event bus failures must not break screen updates.
    }
  }

  /**
   * Emit cast:ended for a screen that was previously actively playing a
   * given cast but is no longer (either cast unassigned, swapped, or screen
   * went offline). Phase 2 of #1117 (#1134) — WidgetRefreshService listens
   * to this to cancel per-instance micro-jobs.
   * @private
   */
  _emitCastEnded(screen, endedCastId) {
    if (!this.eventBus || !screen || !endedCastId) return;
    try {
      this.eventBus.emit('cast:ended', {
        castId: endedCastId,
        screenId: screen.id,
        screenSerial: screen.serial,
      });
    } catch (err) {
      // Swallow.
    }
  }

  /**
   * Emit screen-offline when a screen transitions to offline. Listened to
   * by WidgetRefreshService (#1134) so per-instance micro-jobs for this
   * screen can be cancelled immediately instead of waiting for the next
   * reconcile cycle.
   * @private
   */
  _emitScreenOffline(screen) {
    if (!this.eventBus || !screen) return;
    try {
      this.eventBus.emit('screen-offline', {
        screenId: screen.id,
        screenSerial: screen.serial,
        previousCastId: screen.assigned_cast_id || null,
      });
    } catch (err) {
      // Swallow.
    }
  }

  /**
   * Get all screens
   */
  async getAll() {
    const screens = await this.model.findAll();
    return screens.map((screen) => this.formatScreen(screen));
  }

  /**
   * Get screen by serial number
   */
  async getBySerial(serial) {
    const results = await this.model.findAll({ where: { serial } });
    return results && results.length > 0 ? this.formatScreen(results[0]) : null;
  }

  /**
   * Get screens by tag
   */
  async getByTag(tag) {
    const allScreens = await this.getAll();
    return allScreens.filter((screen) => {
      const tags = screen.tags || [];
      return tags.includes(tag);
    });
  }

  /**
   * Get all screens currently assigned to a given cast.
   * Used by SlideImageRenderer to push slideRendered updates to Roku devices
   * after a widget layer re-renders (#1153).
   */
  async getScreensForCast(castId) {
    if (!castId) return [];
    const results = await this.model.findAll({ where: { assigned_cast_id: castId } });
    return (results || []).map((screen) => this.formatScreen(screen));
  }

  /**
   * Register a new screen or update existing
   */
  async register(data) {
    const {
      serial, platform, model, metadata,
    } = data;

    const existing = await this.getBySerial(serial);

    if (existing) {
      // Update existing screen
      return this.update(serial, {
        platform,
        model,
        metadata: { ...existing.metadata, ...metadata },
        status: 'online',
        last_seen_at: new Date().toISOString(),
      });
    }

    // Create new screen - Model API returns the full record
    const screen = await this.model.create({
      serial,
      name: `Screen ${serial.slice(-6)}`,
      platform: platform || 'unknown',
      model: model || null,
      ip_address: null,
      assigned_cast_id: null,
      tags: [],
      status: 'online',
      last_seen_at: new Date().toISOString(),
      metadata: metadata || {},
    });

    return this.formatScreen(screen);
  }

  /**
   * Update screen
   */
  async update(serial, data) {
    const existing = await this.getBySerial(serial);
    if (!existing) return null;

    const updateData = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.platform !== undefined) updateData.platform = data.platform;
    if (data.model !== undefined) updateData.model = data.model;
    if (data.ip_address !== undefined) updateData.ip_address = data.ip_address;
    if (data.assigned_cast_id !== undefined) updateData.assigned_cast_id = data.assigned_cast_id;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.last_seen_at !== undefined) updateData.last_seen_at = data.last_seen_at;
    if (data.app_last_heartbeat !== undefined) updateData.app_last_heartbeat = data.app_last_heartbeat;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.watchdog_enabled !== undefined) updateData.watchdog_enabled = data.watchdog_enabled ? 1 : 0;

    await this.model.update(existing.id, updateData);
    const updated = await this.getBySerial(serial);

    // Detect "cast became active" transitions so downstream services
    // (WidgetRefreshService, etc.) can react instantly instead of waiting
    // for the next periodic tick.
    const wasActive = existing.status === 'online' && !!existing.assigned_cast_id;
    const isActive = updated && updated.status === 'online' && !!updated.assigned_cast_id;
    const castChanged = existing.assigned_cast_id !== updated?.assigned_cast_id;
    if (isActive && (!wasActive || castChanged)) {
      this._emitCastStartedIfActive(updated);
    }

    // cast:ended transitions (#1134) — the previous active cast is no
    // longer active on this screen.
    //   - wasActive && !isActive        → went inactive entirely
    //   - wasActive && castChanged       → swapped to a different cast
    //   - screen went offline while a cast was assigned
    if (wasActive && !isActive && existing.assigned_cast_id) {
      this._emitCastEnded(updated || existing, existing.assigned_cast_id);
    } else if (wasActive && castChanged && existing.assigned_cast_id) {
      // Swap: old cast ended even though a new cast started.
      this._emitCastEnded(updated || existing, existing.assigned_cast_id);
    }

    // screen-offline transitions (#1134) — fire when we transition from
    // online → non-online regardless of cast assignment.
    if (existing.status === 'online' && updated && updated.status !== 'online') {
      this._emitScreenOffline(updated);
    }

    return updated;
  }

  /**
   * Delete screen
   */
  async delete(serial) {
    const existing = await this.getBySerial(serial);
    if (!existing) return false;

    await this.model.delete(existing.id);
    return true;
  }

  /**
   * Handle heartbeat from screen (Waiveo app)
   */
  async heartbeat(serial, data) {
    const screen = await this.getBySerial(serial);
    if (!screen) return null;

    const now = new Date().toISOString();
    const updateData = {
      status: 'online',
      last_seen_at: now,
      app_last_heartbeat: now, // Track when Waiveo app last communicated
    };

    if (data.metadata) {
      updateData.metadata = { ...screen.metadata, ...data.metadata };
    }

    await this.model.update(screen.id, updateData);
    const refreshed = await this.getBySerial(serial);

    // If this heartbeat transitioned the screen from any non-online state
    // into online and a cast is assigned, fire cast:started so WidgetRefresh
    // can do an instant first pass instead of waiting for its interval.
    const wasOnline = screen.status === 'online';
    if (!wasOnline && refreshed?.status === 'online' && refreshed.assigned_cast_id) {
      this._emitCastStartedIfActive(refreshed);
    }

    return refreshed;
  }

  /**
   * Assign cast to screen
   */
  async assignCast(serial, castId) {
    return this.update(serial, { assigned_cast_id: castId });
  }

  /**
   * Assign cast to all screens with tag
   */
  async assignCastToTag(tag, castId) {
    const screens = await this.getByTag(tag);
    for (const screen of screens) {
      await this.assignCast(screen.serial, castId);
    }
    return screens.length;
  }

  /**
   * Add tag to screen
   */
  async addTag(serial, tag) {
    const screen = await this.getBySerial(serial);
    if (!screen) return null;

    const tags = screen.tags || [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      await this.update(serial, { tags });
    }
    return this.getBySerial(serial);
  }

  /**
   * Remove tag from screen
   */
  async removeTag(serial, tag) {
    const screen = await this.getBySerial(serial);
    if (!screen) return null;

    const tags = (screen.tags || []).filter((t) => t !== tag);
    await this.update(serial, { tags });
    return this.getBySerial(serial);
  }

  /**
   * Get all unique tags
   */
  async getAllTags() {
    const screens = await this.getAll();
    const tagsSet = new Set();

    for (const screen of screens) {
      const tags = screen.tags || [];
      tags.forEach((tag) => tagsSet.add(tag));
    }

    return Array.from(tagsSet).sort();
  }

  /**
   * Mark offline screens (heartbeat timeout)
   */
  async markOfflineScreens(timeoutMs = 60000) {
    const screens = await this.getAll();
    const now = Date.now();

    for (const screen of screens) {
      if (screen.status === 'online') {
        const lastSeen = new Date(screen.last_seen_at).getTime();
        if (now - lastSeen > timeoutMs) {
          const previousCastId = screen.assigned_cast_id || null;
          await this.update(screen.serial, { status: 'offline' });

          // Fire automation trigger
          this.api.fireTrigger('screen_disconnected', {
            screen_id: screen.serial,
            screen_name: screen.name,
            serial: screen.serial,
          });

          // Event bus emits for WidgetRefreshService (#1134). The update()
          // call above will also emit these when status transitions, but
          // emit here too for defence-in-depth in case a model layer
          // short-circuits the status-transition path.
          this._emitScreenOffline({ ...screen, status: 'offline' });
          if (previousCastId) {
            this._emitCastEnded({ ...screen, status: 'offline' }, previousCastId);
          }
        }
      }
    }
  }

  /**
   * Format screen for response
   */
  formatScreen(screen) {
    return {
      id: screen.id,
      serial: screen.serial,
      name: screen.name,
      platform: screen.platform,
      model: screen.model,
      ip_address: screen.ip_address,
      assigned_cast_id: screen.assigned_cast_id,
      tags: typeof screen.tags === 'string' ? JSON.parse(screen.tags) : (screen.tags || []),
      status: screen.status,
      last_seen_at: screen.last_seen_at,
      app_last_heartbeat: screen.app_last_heartbeat,
      metadata: typeof screen.metadata === 'string' ? JSON.parse(screen.metadata) : (screen.metadata || {}),
      // NULL/undefined (pre-migration rows, or a raw row read before the
      // column existed) means the watchdog is enabled — only an explicit 0
      // opts a screen out (#D3).
      watchdog_enabled: screen.watchdog_enabled === undefined || screen.watchdog_enabled === null
        ? 1
        : screen.watchdog_enabled,
      created_at: screen.created_at,
    };
  }
}

export default ScreenManager;
