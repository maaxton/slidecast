import logger from './utils/Logger.js';
/**
 * UpdateTracker - Track pending updates for long-polling clients
 *
 * Allows Roku and other clients to receive real-time updates without WebSockets.
 * Clients poll /protocol/updates?since=timestamp and connection is held until:
 * - Updates are available
 * - Timeout occurs (default 30s)
 *
 * Update types:
 * - cast_updated: Cast definition changed
 * - cast_assigned: New cast assigned to screen
 * - widget_refreshed: Widget content updated
 * - slide_rendered: Slide render completed
 */

class UpdateTracker {
  constructor(api, options = {}) {
    this.api = api;

    // Settings (can be overridden via api.getSetting)
    this.defaultTimeout = options.pollTimeout || 30000; // 30 seconds
    this.retentionMs = (options.retentionMinutes || 5) * 60 * 1000; // 5 minutes
    this.maxUpdatesPerScreen = options.maxUpdatesPerScreen || 100;

    // Storage: Map<screenSerial, Update[]>
    this.updates = new Map();

    // Waiting long-poll clients: Map<screenSerial, Array<{ resolve, timeout, since }>>
    // (SL12). Must be a LIST, not a single slot — a screen can briefly have >1
    // in-flight poll during reconnect (old request still draining while the new
    // one arrives). A single slot silently clobbered the earlier client, which
    // then hung until its own timeout instead of getting the pushed update.
    this.waitingClients = new Map();

    // Cleanup interval — handle from raw setInterval (legacy fallback path)
    this.cleanupInterval = null;
    // Job id from the platform scheduler (#1026 — Wave 2 of #1024). Stored
    // so shutdown()/scheduler.shutdown() can drain the recurring cleanup
    // and we don't leak a closure across hot-reload.
    this._cleanupJobId = null;
  }

  /**
   * Initialize the tracker
   */
  async init() {
    // Start cleanup checker via the platform scheduler so the timer is
    // tracked + cancelled on extension reload (#1026). Falls back to a raw
    // setInterval only when the host did not wire a scheduler (older tests).
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._cleanupJobId = this.api.scheduler.schedule(
        () => this.cleanup(),
        { intervalMs: 60000, name: 'update-tracker-cleanup' },
      );
    } else {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }
    logger.info('UpdateTracker initialized');
  }

  /**
   * Shutdown the tracker
   */
  shutdown() {
    if (this._cleanupJobId !== null) {
      try {
        this.api?.scheduler?.cancel?.(this._cleanupJobId);
      } catch { /* noop */ }
      this._cleanupJobId = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Resolve all waiting clients with empty updates
    for (const [, clients] of this.waitingClients) {
      for (const client of clients) {
        clearTimeout(client.timeout);
        client.resolve({ updates: [], serverTime: Date.now(), reason: 'shutdown' });
      }
    }
    this.waitingClients.clear();
  }

  /**
   * Push an update for a screen
   * @param {string} screenSerial - Target screen (or 'all' for broadcast)
   * @param {Object} update - Update payload
   */
  pushUpdate(screenSerial, update) {
    const now = Date.now();
    const updateWithTimestamp = {
      ...update,
      timestamp: now,
    };

    // Add to screen's update queue. For an 'all' broadcast, target the UNION of
    // serials with a queued update AND serials with an active long-poll waiting
    // client — otherwise a screen whose queue was just emptied and deleted by
    // cleanup() (see below) while it is still long-polling gets silently missed,
    // which is the intermittent "healthy poll, no delivery" bug.
    const screens = screenSerial === 'all'
      ? Array.from(new Set([...this.updates.keys(), ...this.waitingClients.keys()]))
      : [screenSerial];

    for (const serial of screens) {
      if (!this.updates.has(serial)) {
        this.updates.set(serial, []);
      }

      const queue = this.updates.get(serial);
      queue.push(updateWithTimestamp);

      // Trim queue if too large
      if (queue.length > this.maxUpdatesPerScreen) {
        queue.shift();
      }

      // Resolve every client waiting on this serial (SL12), each with the
      // updates since its own `since` cursor.
      const waitingList = this.waitingClients.get(serial);
      if (waitingList && waitingList.length > 0) {
        this.waitingClients.delete(serial);
        for (const client of waitingList) {
          clearTimeout(client.timeout);
          client.resolve({
            updates: this.getUpdatesSince(serial, client.since),
            serverTime: now,
          });
        }
      }
    }

    logger.debug(`Update pushed: ${update.type} for ${screenSerial}`);
  }

  /**
   * Push update to all screens showing a specific cast
   */
  pushCastUpdate(castId, update) {
    // Note: In production, we'd look up which screens have this cast assigned
    // For now, we broadcast to all (screens filter by their assigned cast)
    this.pushUpdate('all', {
      ...update,
      castId,
    });
  }

  /**
   * Wait for updates (long-polling)
   * @param {string} screenSerial - Screen to get updates for
   * @param {number} since - Timestamp to get updates since
   * @param {number} timeout - Max time to wait in ms
   * @returns {Promise<{updates: Array, serverTime: number}>}
   */
  async waitForUpdates(screenSerial, since = 0, timeout = null) {
    const timeoutMs = timeout || this.defaultTimeout;

    // Initialize screen queue if needed
    if (!this.updates.has(screenSerial)) {
      this.updates.set(screenSerial, []);
    }

    // Check for existing updates
    const existingUpdates = this.getUpdatesSince(screenSerial, since);
    if (existingUpdates.length > 0) {
      return {
        updates: existingUpdates,
        serverTime: Date.now(),
      };
    }

    // No updates yet - wait for them
    return new Promise((resolve) => {
      const client = { resolve, since, timeout: null };

      // Set timeout to return empty if no updates. Removes ONLY this client
      // from the serial's waiting list (SL12), leaving any concurrent poller.
      client.timeout = setTimeout(() => {
        const list = this.waitingClients.get(screenSerial);
        if (list) {
          const idx = list.indexOf(client);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.waitingClients.delete(screenSerial);
        }
        resolve({
          updates: [],
          serverTime: Date.now(),
          timedOut: true,
        });
      }, timeoutMs);

      // Register waiting client (append — a serial may have >1 in flight)
      if (!this.waitingClients.has(screenSerial)) {
        this.waitingClients.set(screenSerial, []);
      }
      this.waitingClients.get(screenSerial).push(client);
    });
  }

  /**
   * Get updates since a timestamp
   */
  getUpdatesSince(screenSerial, since) {
    const queue = this.updates.get(screenSerial) || [];
    return queue.filter((u) => u.timestamp > since);
  }

  /**
   * Clean up old updates
   */
  cleanup() {
    const cutoff = Date.now() - this.retentionMs;
    let cleaned = 0;

    for (const [serial, queue] of this.updates) {
      const before = queue.length;

      // Remove updates older than retention period
      const filtered = queue.filter((u) => u.timestamp > cutoff);

      if (filtered.length < before) {
        cleaned += before - filtered.length;
        this.updates.set(serial, filtered);
      }

      // Remove empty queues
      if (filtered.length === 0) {
        this.updates.delete(serial);
      }
    }

    if (cleaned > 0) {
      logger.debug(`UpdateTracker cleanup: removed ${cleaned} old updates`);
    }
  }

  /**
   * Get status for diagnostics
   */
  getStatus() {
    let totalUpdates = 0;
    for (const queue of this.updates.values()) {
      totalUpdates += queue.length;
    }

    let waitingClients = 0;
    for (const list of this.waitingClients.values()) {
      waitingClients += list.length;
    }

    return {
      screens: this.updates.size,
      totalUpdates,
      waitingClients,
      retentionMinutes: this.retentionMs / 60000,
      defaultTimeoutMs: this.defaultTimeout,
    };
  }
}

// Helper functions to create standard update payloads
export const UpdateTypes = {
  castUpdated: (castId, version) => ({
    type: 'cast_updated',
    castId,
    version,
  }),

  castAssigned: (castId, castName) => ({
    type: 'cast_assigned',
    castId,
    castName,
  }),

  widgetRefreshed: (widgetId, contentHash) => ({
    type: 'widget_refreshed',
    widgetId,
    contentHash,
  }),

  slideRendered: (castId, slideIndex) => ({
    type: 'slide_rendered',
    castId,
    slideIndex,
  }),

  screenCommand: (command, data = {}) => ({
    type: 'screen_command',
    command,
    ...data,
  }),
};

export default UpdateTracker;
