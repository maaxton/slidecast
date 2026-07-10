import logger from './utils/Logger.js';
/**
 * PreviewManager - Manages WebSocket connections and preview sessions
 */

class PreviewManager {
  constructor(api, screenManager) {
    this.api = api;
    this.screenManager = screenManager;
    this.connections = new Map(); // serial -> websocket info
    this.previews = new Map(); // serial -> preview session
    this._heartbeatJobId = null;
  }

  async init() {
    // Start heartbeat checker via the platform scheduler so the timer is
    // tracked + cancelled on extension reload (#1027). Falls back to a raw
    // setInterval only when the host did not wire a scheduler (older tests).
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._heartbeatJobId = this.api.scheduler.schedule(
        () => this.checkHeartbeats(),
        { intervalMs: 30000, name: 'preview-heartbeat' },
      );
    } else {
      this._heartbeatHandle = setInterval(() => this.checkHeartbeats(), 30000);
    }
  }

  /**
   * Stop the heartbeat checker. Called by the slidecast extension's dispose
   * hook (and by ContextFactory.shutdownPrimitives() indirectly via the
   * scheduler). Also safe to call from tests.
   */
  dispose() {
    if (this._heartbeatJobId !== null) {
      try {
        this.api?.scheduler?.cancel?.(this._heartbeatJobId);
      } catch { /* noop */ }
      this._heartbeatJobId = null;
    }
    if (this._heartbeatHandle) {
      clearInterval(this._heartbeatHandle);
      this._heartbeatHandle = null;
    }
  }

  /**
   * Register a WebSocket connection for a screen
   */
  registerConnection(serial, ws) {
    this.connections.set(serial, {
      ws,
      connectedAt: new Date().toISOString(),
    });
    logger.debug(`Screen ${serial} connected via WebSocket`);
  }

  /**
   * Remove a WebSocket connection
   */
  removeConnection(serial) {
    this.connections.delete(serial);
    this.previews.delete(serial);
    logger.debug(`Screen ${serial} disconnected`);
  }

  /**
   * Send message to a specific screen
   */
  sendToScreen(serial, message) {
    const conn = this.connections.get(serial);
    if (conn && conn.ws && conn.ws.readyState === 1) { // WebSocket.OPEN
      conn.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Broadcast message to all connected screens
   */
  broadcastToAll(message) {
    let count = 0;
    for (const [serial, conn] of this.connections) {
      if (conn.ws && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify(message));
        count++;
      }
    }
    return count;
  }

  /**
   * Notify a screen to tune to a new cast
   */
  notifyScreenTune(serial, castId) {
    this.sendToScreen(serial, {
      action: 'tune',
      cast_id: castId,
    });
  }

  /**
   * Notify screens that a cast was updated
   */
  notifyCastUpdated(castId) {
    // Find all screens showing this cast
    this.connections.forEach((conn, serial) => {
      // We'd need to track which cast each screen is showing
      // For now, broadcast refresh to all
      this.sendToScreen(serial, {
        action: 'refresh',
      });
    });
  }

  /**
   * Start preview mode on a screen
   */
  startPreview(serial, cast) {
    const previewId = `preview-${Date.now()}`;

    this.previews.set(serial, {
      previewId,
      cast,
      startedAt: new Date().toISOString(),
    });

    this.sendToScreen(serial, {
      action: 'preview_start',
      preview_id: previewId,
      cast,
    });

    return previewId;
  }

  /**
   * Update preview on a screen
   */
  updatePreview(serial, cast) {
    const preview = this.previews.get(serial);
    if (!preview) return false;

    preview.cast = cast;

    this.sendToScreen(serial, {
      action: 'preview_update',
      preview_id: preview.previewId,
      cast,
    });

    return true;
  }

  /**
   * Stop preview mode on a screen
   */
  stopPreview(serial) {
    const preview = this.previews.get(serial);
    if (!preview) return false;

    this.sendToScreen(serial, {
      action: 'preview_stop',
      preview_id: preview.previewId,
    });

    this.previews.delete(serial);
    return true;
  }

  /**
   * Check if a screen is in preview mode
   */
  isInPreview(serial) {
    return this.previews.has(serial);
  }

  /**
   * Get connected screen count
   */
  getConnectedCount() {
    let count = 0;
    for (const [serial, conn] of this.connections) {
      if (conn.ws && conn.ws.readyState === 1) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check heartbeats and mark offline screens
   */
  async checkHeartbeats() {
    try {
      await this.screenManager.markOfflineScreens(60000);
    } catch (error) {
      logger.warn(`Heartbeat check error: ${error.message}`);
    }
  }

  /**
   * Get list of online screens (for UI)
   */
  getOnlineScreens() {
    const online = [];
    for (const [serial, conn] of this.connections) {
      if (conn.ws && conn.ws.readyState === 1) {
        online.push({
          serial,
          connectedAt: conn.connectedAt,
          inPreview: this.previews.has(serial),
        });
      }
    }
    return online;
  }
}

export default PreviewManager;
