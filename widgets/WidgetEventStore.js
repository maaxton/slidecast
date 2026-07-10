import logger from '../utils/Logger.js';
/**
 * WidgetEventStore - Event store for widget subscriptions
 *
 * Maintains a ring buffer of recent events that widgets can query.
 * Events are stored in the database and pruned automatically.
 *
 * This is a PULL model - widgets query events when they render,
 * rather than receiving push notifications.
 */

class WidgetEventStore {
  constructor(api) {
    this.api = api;
    this.model = null;
    this.maxEvents = 1000; // Maximum events to keep
    this.maxAge = 24 * 60 * 60 * 1000; // 24 hours
    this.pruneInterval = null;
    // Job id from the platform scheduler (#1031, Wave 2 of #1024). Stored
    // so destroy() / scheduler.shutdown() can drain the recurring prune
    // and we don't leak a closure across hot-reload — the previous code
    // kept a setInterval handle but no destroy hook was wired by the
    // extension, so EVERY reload of slidecast leaked an hourly prune.
    this._pruneJobId = null;
    this.eventBusListeners = [];
  }

  async init() {
    this.model = this.api.model('slidecast_widget_events');

    // Start periodic pruning (every hour) via the platform scheduler so the
    // recurring sweep is cancelled cleanly on hot-reload (#1031). Falls
    // back to raw setInterval only when api.scheduler is missing (legacy
    // test fixtures).
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._pruneJobId = this.api.scheduler.schedule(
        () => this.pruneOldEvents(),
        { intervalMs: 60 * 60 * 1000, name: 'widget-event-prune' },
      );
    } else {
      this.pruneInterval = setInterval(() => this.pruneOldEvents(), 60 * 60 * 1000);
    }

    // Initial prune
    await this.pruneOldEvents();

    logger.info('WidgetEventStore initialized');
  }

  /**
   * Subscribe to global event bus events
   * Call this after ExtensionAPI has the globalEventBus
   */
  subscribeToGlobalEvents(globalEventBus) {
    if (!globalEventBus) {
      logger.warn('No global event bus available for widget events');
      return;
    }

    // Subscribe to entity state changes
    const stateChangeHandler = async (event) => {
      try {
        await this.recordEvent('entity:state_changed', {
          entityId: event.entityId,
          newState: event.state,
          oldState: event.previousState,
          attributes: event.attributes,
        }, 'state_manager', event.entityId);
      } catch (err) {
        logger.warn(`Failed to record state change event: ${err.message}`);
      }
    };
    globalEventBus.on('state:changed', stateChangeHandler);
    this.eventBusListeners.push({ event: 'state:changed', handler: stateChangeHandler });

    // Subscribe to automation triggers
    const triggerHandler = async (event) => {
      try {
        await this.recordEvent('automation:trigger', {
          trigger: event.trigger,
          data: event.data,
        }, event.source || 'automation');
      } catch (err) {
        logger.warn(`Failed to record automation trigger: ${err.message}`);
      }
    };
    globalEventBus.on('automation:trigger', triggerHandler);
    this.eventBusListeners.push({ event: 'automation:trigger', handler: triggerHandler });

    // Subscribe to device events
    const deviceEventHandler = async (event) => {
      try {
        await this.recordEvent('device:event', {
          deviceId: event.deviceId,
          deviceType: event.deviceType,
          eventType: event.eventType,
          data: event.data,
        }, event.source || 'device', event.deviceId);
      } catch (err) {
        logger.warn(`Failed to record device event: ${err.message}`);
      }
    };
    globalEventBus.on('device:event', deviceEventHandler);
    this.eventBusListeners.push({ event: 'device:event', handler: deviceEventHandler });

    logger.debug('Subscribed to global event bus for widget events');
  }

  /**
   * Record an event in the store
   */
  async recordEvent(eventType, data, source = null, entityId = null) {
    try {
      // Model API handles JSON serialization for jsonFields
      await this.model.create({
        event_type: eventType,
        source,
        entity_id: entityId,
        data, // Let Model API handle JSON serialization
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`Failed to record event: ${error.message}`);
    }
  }

  /**
   * Get recent events matching a pattern
   * @param {string} eventType - Event type to match (supports wildcards: 'entity:*')
   * @param {number} limit - Maximum events to return
   * @param {string} since - ISO timestamp to get events since
   * @param {string} entityId - Optional entity ID filter
   */
  async getRecent(eventType = '*', limit = 10, since = null, entityId = null) {
    try {
      const query = {};

      // Build where clause
      if (eventType && eventType !== '*') {
        if (eventType.includes('*')) {
          // Wildcard matching - will be handled after fetch
          // SQLite doesn't have great pattern matching, so we filter in JS
        } else {
          query.event_type = eventType;
        }
      }

      if (entityId) {
        query.entity_id = entityId;
      }

      // Fetch events
      let events = await this.model.findAll({
        where: Object.keys(query).length > 0 ? query : undefined,
        orderBy: 'created_at DESC',
        limit: limit * 2, // Fetch extra for filtering
      });

      // Apply wildcard filter if needed
      if (eventType && eventType.includes('*')) {
        const pattern = eventType.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        events = events.filter((e) => regex.test(e.event_type));
      }

      // Apply since filter
      if (since) {
        const sinceDate = new Date(since);
        events = events.filter((e) => new Date(e.created_at) > sinceDate);
      }

      // Limit results
      events = events.slice(0, limit);

      // Format for API response
      // Model API handles JSON deserialization for jsonFields
      return events.map((e) => ({
        id: e.id,
        type: e.event_type,
        source: e.source,
        entityId: e.entity_id,
        data: e.data, // Already deserialized by Model API
        timestamp: e.created_at,
      }));
    } catch (error) {
      logger.error(`Failed to get recent events: ${error.message}`);
      return [];
    }
  }

  /**
   * Get the most recent event matching criteria
   */
  async getLatest(eventType = '*', entityId = null) {
    const events = await this.getRecent(eventType, 1, null, entityId);
    return events.length > 0 ? events[0] : null;
  }

  /**
   * Get events for a specific entity
   */
  async getEntityEvents(entityId, limit = 10) {
    return this.getRecent('*', limit, null, entityId);
  }

  /**
   * Manually emit an event (for widgets or internal use)
   */
  async emit(eventType, data, source = 'widget') {
    await this.recordEvent(eventType, data, source);
  }

  /**
   * Prune old events to maintain ring buffer behavior
   */
  async pruneOldEvents() {
    try {
      const cutoff = new Date(Date.now() - this.maxAge);
      let prunedCount = 0;

      // Get all events ordered by date (oldest first for age pruning)
      const allEvents = await this.model.findAll({
        orderBy: 'created_at ASC',
      });

      // Delete events older than cutoff
      for (const event of allEvents) {
        const eventDate = new Date(event.created_at);
        if (eventDate < cutoff) {
          await this.model.delete(event.id);
          prunedCount++;
        } else {
          break; // Events are ordered, so stop once we hit recent ones
        }
      }

      if (prunedCount > 0) {
        logger.debug(`Pruned ${prunedCount} old widget events`);
      }

      // Re-fetch and enforce max events limit
      const remainingEvents = await this.model.findAll({
        orderBy: 'created_at DESC',
      });

      if (remainingEvents.length > this.maxEvents) {
        const toDelete = remainingEvents.slice(this.maxEvents);
        for (const event of toDelete) {
          await this.model.delete(event.id);
        }
        logger.debug(`Pruned ${toDelete.length} excess widget events`);
      }
    } catch (error) {
      logger.warn(`Failed to prune events: ${error.message}`);
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy(globalEventBus = null) {
    if (this._pruneJobId !== null) {
      try {
        this.api?.scheduler?.cancel?.(this._pruneJobId);
      } catch { /* noop */ }
      this._pruneJobId = null;
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }

    // Unsubscribe from event bus
    if (globalEventBus) {
      for (const { event, handler } of this.eventBusListeners) {
        globalEventBus.off(event, handler);
      }
    }
    this.eventBusListeners = [];

    logger.debug('WidgetEventStore destroyed');
  }
}

export default WidgetEventStore;
