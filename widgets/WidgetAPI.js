/**
 * WidgetAPI - API surface available to widget code
 * Provides http, system, media, entities, storage, secrets, and logging
 *
 * Relay Architecture:
 * - All external HTTP requests go through the main server
 * - Main server can cache responses for Relay efficiency
 * - Widgets never make direct external calls when running on Relays
 */

// SL3: module-level HTTP response cache, keyed by widget UUID, so it PERSISTS
// across executions. WidgetRuntime constructs a fresh WidgetAPI on every render
// tick — a per-instance `new Map()` was therefore always empty, so `cacheTtl`
// never hit and every refresh re-called the third-party API. Sharing one Map
// per widget makes cacheTtl actually work. Each per-widget Map is self-capped
// at 50 entries (see createHttpApi), and the number of widgets is bounded.
const httpCacheStore = new Map(); // widgetUuid -> Map<cacheKey, { data, timestamp, ttl }>

class WidgetAPI {
  constructor(api, widgetUuid, instanceId = null) {
    this.extensionApi = api;
    this.widgetUuid = widgetUuid;
    this.instanceId = instanceId;
    if (!httpCacheStore.has(widgetUuid)) {
      httpCacheStore.set(widgetUuid, new Map());
    }
    this.httpCache = httpCacheStore.get(widgetUuid);
    this.logs = [];
    this.requestId = `${widgetUuid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.tableSchema = null; // Set by runtime from widget definition
  }

  /**
   * Set the table schema for this widget (called by WidgetRuntime)
   */
  setTableSchema(tableSchema) {
    this.tableSchema = tableSchema;
  }

  /**
   * Set the event store reference (called by WidgetRuntime)
   */
  setEventStore(eventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Set the already-initialized WidgetSecrets singleton (called by WidgetRuntime)
   */
  setSecrets(secrets) {
    this.secrets = secrets;
  }

  /**
   * Set animation context for sprite sheet generation (called by WidgetRuntime)
   * @param {Object} animation - Animation context
   * @param {number} animation.frame - Current frame index (0-based)
   * @param {number} animation.frameCount - Total number of frames
   * @param {number} animation.progress - Progress as 0-1 value (frame/frameCount)
   * @param {number} animation.time - Time in ms since animation start
   */
  setAnimation(animation) {
    this.animation = animation;
  }

  /**
   * Create the API object to inject into widget context
   */
  createContext(config = {}, styles = {}) {
    const logApi = this.createLogApi();

    const ctx = {
      config,
      styles,
      // Animation context for sprite sheet generation (undefined when not animating)
      // Widgets can check `if (context.animation)` to render different frames
      animation: this.animation || undefined,
      // Shorthand: context.log.info() instead of context.api.log.info()
      log: logApi,
      // Even shorter: context.debug('message') for quick debugging
      debug: (message) => logApi.debug(typeof message === 'string' ? message : JSON.stringify(message)),
      api: {
        http: this.createHttpApi(),
        db: this.createDbApi(),
        system: this.createSystemApi(),
        media: this.createMediaApi(),
        entities: this.createEntitiesApi(),
        storage: this.createStorageApi(),
        secrets: this.createSecretsApi(),
        events: this.createEventsApi(),
        assets: this.createAssetsApi(),
        log: logApi,
      },
    };

    return ctx;
  }

  /**
   * Database API - Widget-defined tables
   *
   * Widgets define their tables in their manifest/code:
   * ```javascript
   * tables: {
   *   geocode_cache: {
   *     zip_code: 'string',
   *     latitude: 'number',
   *     longitude: 'number'
   *   }
   * }
   * ```
   *
   * Then access via api.db:
   * ```javascript
   * const cached = await api.db.get('geocode_cache', { zip_code: '90210' });
   * await api.db.insert('geocode_cache', { zip_code: '90210', latitude: 34.09, longitude: -118.41 });
   * ```
   */
  createDbApi() {
    const self = this;
    const { widgetUuid } = this;

    // Get the real table name (namespaced to this widget)
    const getTableName = (tableName) => {
      const safeUuid = widgetUuid.replace(/-/g, '_');
      return `slidecast_w_${safeUuid}_${tableName}`;
    };

    // Validate table exists in schema
    const validateTable = (tableName) => {
      if (!self.tableSchema || !self.tableSchema[tableName]) {
        throw new Error(`Table '${tableName}' not defined in widget schema. Add it to your widget's 'tables' definition.`);
      }
    };

    // Get or create model for table
    const getModel = (tableName) => {
      const fullTable = getTableName(tableName);
      try {
        return self.extensionApi.model(fullTable);
      } catch (err) {
        // Model might not be registered yet - happens during widget execution
        // We'll use queryBuilder instead for raw access
        return null;
      }
    };

    return {
      /**
       * Get a single row from a widget table
       * @param {string} table - Table name (as defined in widget schema)
       * @param {Object} where - Conditions { column: value }
       * @returns {Object|null} Row object or null
       */
      async get(table, where = {}) {
        validateTable(table);
        const model = getModel(table);

        if (model) {
          try {
            const rows = await model.findAll({ where, limit: 1 });
            const row = rows && rows.length > 0 ? rows[0] : null;
            self.logs.push({
              type: 'db', op: 'get', table, found: !!row, timestamp: Date.now(),
            });
            return row;
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'get', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          for (const [key, value] of Object.entries(where)) {
            qb.where(key, '=', value);
          }
          const rows = await qb.limit(1).get();
          const row = rows && rows.length > 0 ? rows[0] : null;
          self.logs.push({
            type: 'db', op: 'get', table, found: !!row, timestamp: Date.now(),
          });
          return row;
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'get', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Get all rows matching conditions
       * @param {string} table - Table name
       * @param {Object} where - Conditions (optional)
       * @param {Object} options - { orderBy, limit, offset }
       * @returns {Array} Array of row objects
       */
      async getAll(table, where = {}, options = {}) {
        validateTable(table);
        const model = getModel(table);

        if (model) {
          try {
            const findOptions = { where };
            if (options.limit) findOptions.limit = options.limit;
            if (options.offset) findOptions.offset = options.offset;
            if (options.orderBy) findOptions.orderBy = options.orderBy;

            const rows = await model.findAll(findOptions);
            self.logs.push({
              type: 'db', op: 'getAll', table, count: rows?.length || 0, timestamp: Date.now(),
            });
            return rows || [];
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'getAll', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          for (const [key, value] of Object.entries(where)) {
            qb.where(key, '=', value);
          }
          if (options.orderBy) qb.orderBy(options.orderBy);
          if (options.limit) qb.limit(options.limit);
          if (options.offset) qb.offset(options.offset);

          const rows = await qb.get();
          self.logs.push({
            type: 'db', op: 'getAll', table, count: rows?.length || 0, timestamp: Date.now(),
          });
          return rows || [];
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'getAll', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Insert a row into a widget table
       * @param {string} table - Table name
       * @param {Object} data - Row data { column: value }
       * @returns {Object} { id, changes }
       */
      async insert(table, data) {
        validateTable(table);
        const model = getModel(table);

        if (model) {
          try {
            const result = await model.create(data);
            const id = result?.id || result?.lastID;
            self.logs.push({
              type: 'db', op: 'insert', table, id, timestamp: Date.now(),
            });
            return { id, changes: 1 };
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'insert', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          const id = await qb.insert(data);
          self.logs.push({
            type: 'db', op: 'insert', table, id, timestamp: Date.now(),
          });
          return { id, changes: 1 };
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'insert', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Update rows in a widget table
       * @param {string} table - Table name
       * @param {Object} where - Conditions to match
       * @param {Object} data - Values to update
       * @returns {Object} { changes }
       */
      async update(table, where, data) {
        validateTable(table);
        const model = getModel(table);
        const processedData = { ...data, updated_at: new Date().toISOString() };

        if (model) {
          try {
            // Find rows matching where clause, then update each
            const rows = await model.findAll({ where });
            let changes = 0;
            for (const row of rows) {
              await model.update(row.id, processedData);
              changes++;
            }
            self.logs.push({
              type: 'db', op: 'update', table, changes, timestamp: Date.now(),
            });
            return { changes };
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'update', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          for (const [key, value] of Object.entries(where)) {
            qb.where(key, '=', value);
          }
          const changes = await qb.update(processedData);
          self.logs.push({
            type: 'db', op: 'update', table, changes, timestamp: Date.now(),
          });
          return { changes };
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'update', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Delete rows from a widget table
       * @param {string} table - Table name
       * @param {Object} where - Conditions to match
       * @returns {Object} { changes }
       */
      async delete(table, where) {
        validateTable(table);

        if (!where || Object.keys(where).length === 0) {
          throw new Error('DELETE requires a WHERE clause. Use clear() to delete all rows.');
        }

        const model = getModel(table);

        if (model) {
          try {
            const rows = await model.findAll({ where });
            let changes = 0;
            for (const row of rows) {
              await model.delete(row.id);
              changes++;
            }
            self.logs.push({
              type: 'db', op: 'delete', table, changes, timestamp: Date.now(),
            });
            return { changes };
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'delete', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          for (const [key, value] of Object.entries(where)) {
            qb.where(key, '=', value);
          }
          const changes = await qb.delete();
          self.logs.push({
            type: 'db', op: 'delete', table, changes, timestamp: Date.now(),
          });
          return { changes };
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'delete', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Clear all rows from a widget table
       * @param {string} table - Table name
       * @returns {Object} { changes }
       */
      async clear(table) {
        validateTable(table);
        const model = getModel(table);

        if (model) {
          try {
            const rows = await model.findAll({});
            let changes = 0;
            for (const row of rows) {
              await model.delete(row.id);
              changes++;
            }
            self.logs.push({
              type: 'db', op: 'clear', table, changes, timestamp: Date.now(),
            });
            return { changes };
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'clear', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder raw
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          const changes = await qb.delete();
          self.logs.push({
            type: 'db', op: 'clear', table, changes, timestamp: Date.now(),
          });
          return { changes };
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'clear', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },

      /**
       * Count rows in a widget table
       * @param {string} table - Table name
       * @param {Object} where - Conditions (optional)
       * @returns {number} Row count
       */
      async count(table, where = {}) {
        validateTable(table);
        const model = getModel(table);

        if (model) {
          try {
            const rows = await model.findAll({ where });
            self.logs.push({
              type: 'db', op: 'count', table, count: rows?.length || 0, timestamp: Date.now(),
            });
            return rows?.length || 0;
          } catch (err) {
            self.logs.push({
              type: 'db_error', op: 'count', table, error: err.message, timestamp: Date.now(),
            });
            throw err;
          }
        }

        // Fallback: use queryBuilder
        const fullTable = getTableName(table);
        try {
          const qb = self.extensionApi.queryBuilder(fullTable);
          for (const [key, value] of Object.entries(where)) {
            qb.where(key, '=', value);
          }
          const rows = await qb.get();
          const count = rows?.length || 0;
          self.logs.push({
            type: 'db', op: 'count', table, count, timestamp: Date.now(),
          });
          return count;
        } catch (err) {
          self.logs.push({
            type: 'db_error', op: 'count', table, error: err.message, timestamp: Date.now(),
          });
          throw err;
        }
      },
    };
  }

  /**
   * HTTP API - Make external requests with intelligent caching
   *
   * RELAY NOTE: When running on a Relay, all HTTP requests are proxied through
   * the main server to enable centralized caching and API key management.
   * The Relay then caches the response locally for its TVs.
   */
  createHttpApi() {
    const self = this;

    return {
      /**
       * GET request with automatic caching
       * @param {string} url - URL to fetch
       * @param {Object} options - Request options
       * @param {Object} options.params - Query parameters
       * @param {Object} options.headers - Request headers
       * @param {number} options.cacheTtl - Cache TTL in ms (default: 60000)
       * @param {number} options.timeout - Request timeout in ms (default: 10000)
       * @param {boolean} options.noCache - Skip cache (default: false)
       */
      async get(url, options = {}) {
        const cacheKey = `${self.widgetUuid}:${url}:${JSON.stringify(options.params || {})}`;
        const cacheTtl = options.cacheTtl || 60000; // 1 minute default

        // Check in-memory cache first (fastest)
        if (!options.noCache) {
          const cached = self.httpCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < cacheTtl) {
            self.logs.push({
              type: 'http_cache_hit',
              url,
              age: Date.now() - cached.timestamp,
              timestamp: Date.now(),
            });
            return cached.data;
          }
        }

        try {
          // Build URL with params
          const urlObj = new URL(url);
          if (options.params) {
            for (const [key, value] of Object.entries(options.params)) {
              urlObj.searchParams.set(key, value);
            }
          }

          const startTime = Date.now();

          const response = await fetch(urlObj.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': `Slidecast-Widget/${self.widgetUuid}`,
              'X-Widget-Request': self.requestId,
              ...options.headers,
            },
            signal: AbortSignal.timeout(options.timeout || 10000),
          });

          const duration = Date.now() - startTime;

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Try to parse as JSON, fall back to text
          let data;
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          // Cache response
          self.httpCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            ttl: cacheTtl,
          });

          // Limit cache size to prevent memory issues
          if (self.httpCache.size > 50) {
            const firstKey = self.httpCache.keys().next().value;
            self.httpCache.delete(firstKey);
          }

          self.logs.push({
            type: 'http',
            method: 'GET',
            url: urlObj.toString(),
            status: response.status,
            duration,
            timestamp: Date.now(),
          });

          return data;
        } catch (error) {
          self.logs.push({
            type: 'http_error',
            method: 'GET',
            url,
            error: error.message,
            timestamp: Date.now(),
          });
          throw error;
        }
      },

      /**
       * POST request (not cached)
       */
      async post(url, data = {}, options = {}) {
        try {
          const startTime = Date.now();

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'User-Agent': `Slidecast-Widget/${self.widgetUuid}`,
              'X-Widget-Request': self.requestId,
              ...options.headers,
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(options.timeout || 10000),
          });

          const duration = Date.now() - startTime;

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const responseData = await response.json();

          self.logs.push({
            type: 'http',
            method: 'POST',
            url,
            status: response.status,
            duration,
            timestamp: Date.now(),
          });

          return responseData;
        } catch (error) {
          self.logs.push({
            type: 'http_error',
            method: 'POST',
            url,
            error: error.message,
            timestamp: Date.now(),
          });
          throw error;
        }
      },

      /**
       * Clear HTTP cache (useful for forcing refresh)
       */
      clearCache() {
        self.httpCache.clear();
        self.logs.push({
          type: 'http_cache_clear',
          timestamp: Date.now(),
        });
      },
    };
  }

  /**
   * System API - Time, date, timezone
   * Uses Waiveo's configured system timezone (from Settings)
   */
  createSystemApi() {
    const self = this;

    // Get system timezone from Waiveo settings
    const getSystemTimezone = () => {
      try {
        // ExtensionAPI has timezoneService access
        if (self.extensionApi.timezoneService) {
          return self.extensionApi.timezoneService.getTimezone();
        }
        // Fallback to America/New_York (EST)
        return 'America/New_York';
      } catch (e) {
        return 'America/New_York';
      }
    };

    // Get current time in the system timezone
    const getLocalizedDate = (timezone) => {
      const now = new Date();
      // Convert to timezone-aware string and parse components
      const options = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        weekday: 'long',
      };

      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(now);

      const getPart = (type) => {
        const part = parts.find((p) => p.type === type);
        return part ? part.value : '';
      };

      // Note: en-US with hour12:false returns "24" for midnight instead of "00"
      // We need to convert 24 to 0 for correct AM/PM calculation
      let hours = parseInt(getPart('hour'), 10);
      if (hours === 24) hours = 0;

      return {
        year: parseInt(getPart('year'), 10),
        month: parseInt(getPart('month'), 10),
        day: parseInt(getPart('day'), 10),
        hours,
        minutes: parseInt(getPart('minute'), 10),
        seconds: parseInt(getPart('second'), 10),
        weekday: getPart('weekday'),
        timestamp: now.getTime(),
        iso: now.toISOString(),
      };
    };

    return {
      time() {
        const tz = getSystemTimezone();
        const local = getLocalizedDate(tz);

        const hours24 = local.hours;
        const hours12 = hours24 % 12 || 12;
        const { minutes } = local;
        const { seconds } = local;
        const period = hours24 >= 12 ? 'PM' : 'AM';

        return {
          hours: hours24,
          hours12,
          minutes,
          seconds,
          period,
          formatted: `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`,
          formatted24: `${hours24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
          timestamp: local.timestamp,
          iso: local.iso,
          timezone: tz,
        };
      },

      date() {
        const tz = getSystemTimezone();
        const local = getLocalizedDate(tz);

        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];

        // Get weekday index from name
        const weekdayIndex = weekdays.indexOf(local.weekday);

        return {
          year: local.year,
          month: local.month,
          day: local.day,
          weekday: local.weekday,
          weekdayShort: local.weekday.substring(0, 3),
          monthName: months[local.month - 1],
          monthShort: months[local.month - 1].substring(0, 3),
          formatted: `${local.weekday}, ${months[local.month - 1]} ${local.day}, ${local.year}`,
          short: `${local.month}/${local.day}/${local.year}`,
          iso: local.iso.split('T')[0],
          timezone: tz,
        };
      },

      timezone() {
        return getSystemTimezone();
      },
    };
  }

  /**
   * Media API - Access to media library
   */
  createMediaApi() {
    const self = this;

    return {
      getUrl(assetId) {
        if (!assetId) return null;
        return `/api/extensions/slidecast/protocol/asset/${assetId}`;
      },

      async getInfo(assetId) {
        if (!assetId) return null;
        try {
          const media = await self.extensionApi.model('slidecast_media').findAll({
            where: { uuid: assetId },
          });
          if (!media || media.length === 0) return null;

          const m = media[0];
          return {
            id: m.uuid,
            name: m.name,
            type: m.type,
            mimeType: m.mime_type,
            width: m.width,
            height: m.height,
            size: m.file_size,
          };
        } catch (error) {
          return null;
        }
      },
    };
  }

  /**
   * Entities API - platform entity access
   */
  createEntitiesApi() {
    const self = this;

    return {
      async get(entityId) {
        try {
          const states = await self.extensionApi.model('entity_states').findAll({
            where: { entity_id: entityId },
          });

          if (!states || states.length === 0) return null;

          const state = states[0];
          return {
            entityId: state.entity_id,
            state: state.state,
            attributes: typeof state.attributes === 'string'
              ? JSON.parse(state.attributes)
              : state.attributes,
            lastUpdated: state.last_updated,
            lastChanged: state.last_changed,
          };
        } catch (error) {
          self.logs.push({
            type: 'entity_error',
            entityId,
            error: error.message,
            timestamp: Date.now(),
          });
          return null;
        }
      },

      async list(domain) {
        try {
          const entities = await self.extensionApi.model('entity_registry').findAll({
            where: domain ? { domain } : undefined,
          });

          return entities.map((e) => ({
            entityId: e.entity_id,
            name: e.name,
            domain: e.domain,
            type: e.entity_type,
          }));
        } catch (error) {
          return [];
        }
      },
    };
  }

  /**
   * Storage API - Persistent DB-backed key-value storage
   *
   * Two scopes:
   * - api.storage.* - Instance-level (per widget placement on a slide)
   * - api.storage.widget.* - Widget-level (shared across all instances)
   *
   * All data persists to SQLite and survives restarts.
   */
  createStorageApi() {
    const self = this;
    const { widgetUuid } = self;
    const instanceId = self.instanceId || 'default';

    // Helper to get storage model with error handling
    const getModel = () => {
      try {
        return self.extensionApi.model('slidecast_widget_storage');
      } catch (error) {
        self.logs.push({
          type: 'storage_error',
          op: 'getModel',
          error: error.message,
          timestamp: Date.now(),
        });
        return null;
      }
    };

    // Instance-level storage (per-placement)
    const instanceStorage = {
      async get(key) {
        try {
          const model = getModel();
          if (!model) {
            self.logs.push({
              type: 'storage_error', op: 'get', key, error: 'Storage model not available', timestamp: Date.now(),
            });
            return undefined;
          }
          const results = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
              key,
            },
          });
          if (results && results.length > 0) {
            // Unwrap value from object storage format
            const stored = results[0].value;
            return stored && typeof stored === 'object' && 'data' in stored ? stored.data : stored;
          }
          return undefined;
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'get', key, error: error.message, timestamp: Date.now(),
          });
          return undefined;
        }
      },

      async set(key, value) {
        try {
          const model = getModel();
          if (!model) {
            self.logs.push({
              type: 'storage_error', op: 'set', key, error: 'Storage model not available', timestamp: Date.now(),
            });
            return;
          }
          // Wrap value in object for JSON field storage
          const wrappedValue = { data: value };

          // Check if entry exists
          const existing = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
              key,
            },
          });

          if (existing && existing.length > 0) {
            // Update existing
            await model.update(existing[0].id, {
              value: wrappedValue,
              updated_at: new Date().toISOString(),
            });
          } else {
            // Create new
            await model.create({
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
              key,
              value: wrappedValue,
            });
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'set', key, error: error.message, timestamp: Date.now(),
          });
        }
      },

      async delete(key) {
        try {
          const model = getModel();
          if (!model) return;
          const existing = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
              key,
            },
          });
          if (existing && existing.length > 0) {
            await model.delete(existing[0].id);
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'delete', key, error: error.message, timestamp: Date.now(),
          });
        }
      },

      async clear() {
        try {
          const model = getModel();
          if (!model) return;
          const all = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
            },
          });
          for (const entry of all) {
            await model.delete(entry.id);
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'clear', error: error.message, timestamp: Date.now(),
          });
        }
      },

      async keys() {
        try {
          const model = getModel();
          if (!model) return [];
          const all = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              instance_id: instanceId,
              scope: 'instance',
            },
          });
          return all.map((entry) => entry.key);
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'keys', error: error.message, timestamp: Date.now(),
          });
          return [];
        }
      },
    };

    // Widget-level storage (shared across all instances of this widget)
    const widgetStorage = {
      async get(key) {
        try {
          const model = getModel();
          if (!model) {
            self.logs.push({
              type: 'storage_error', op: 'widget.get', key, error: 'Storage model not available', timestamp: Date.now(),
            });
            return undefined;
          }
          const results = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              scope: 'widget',
              key,
            },
          });
          if (results && results.length > 0) {
            // Unwrap value from object storage format
            const stored = results[0].value;
            return stored && typeof stored === 'object' && 'data' in stored ? stored.data : stored;
          }
          return undefined;
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'widget.get', key, error: error.message, timestamp: Date.now(),
          });
          return undefined;
        }
      },

      async set(key, value) {
        try {
          const model = getModel();
          if (!model) {
            self.logs.push({
              type: 'storage_error', op: 'widget.set', key, error: 'Storage model not available', timestamp: Date.now(),
            });
            return;
          }
          // Wrap value in object for JSON field storage
          const wrappedValue = { data: value };

          // Check if entry exists
          const existing = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              scope: 'widget',
              key,
            },
          });

          if (existing && existing.length > 0) {
            // Update existing
            await model.update(existing[0].id, {
              value: wrappedValue,
              updated_at: new Date().toISOString(),
            });
          } else {
            // Create new (instance_id is NULL for widget-level)
            await model.create({
              widget_uuid: widgetUuid,
              instance_id: null,
              scope: 'widget',
              key,
              value: wrappedValue,
            });
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'widget.set', key, error: error.message, timestamp: Date.now(),
          });
        }
      },

      async delete(key) {
        try {
          const model = getModel();
          if (!model) return;
          const existing = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              scope: 'widget',
              key,
            },
          });
          if (existing && existing.length > 0) {
            await model.delete(existing[0].id);
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'widget.delete', key, error: error.message, timestamp: Date.now(),
          });
        }
      },

      async clear() {
        try {
          const model = getModel();
          if (!model) return;
          const all = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              scope: 'widget',
            },
          });
          for (const entry of all) {
            await model.delete(entry.id);
          }
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'widget.clear', error: error.message, timestamp: Date.now(),
          });
        }
      },

      async keys() {
        try {
          const model = getModel();
          if (!model) return [];
          const all = await model.findAll({
            where: {
              widget_uuid: widgetUuid,
              scope: 'widget',
            },
          });
          return all.map((entry) => entry.key);
        } catch (error) {
          self.logs.push({
            type: 'storage_error', op: 'widget.keys', error: error.message, timestamp: Date.now(),
          });
          return [];
        }
      },
    };

    // Return combined API - instance storage at top level, widget storage nested
    return {
      // Instance-level methods (backwards compatible)
      get: instanceStorage.get,
      set: instanceStorage.set,
      delete: instanceStorage.delete,
      clear: instanceStorage.clear,
      keys: instanceStorage.keys,

      // Widget-level methods (new)
      widget: widgetStorage,
    };
  }

  /**
   * Events API - Query recent system events
   *
   * This is a PULL model - widgets query events when they render,
   * rather than receiving push notifications. This aligns with the
   * "run live and cache as needed" architecture.
   *
   * Event types:
   * - entity:state_changed - entity state changes
   * - automation:trigger - Automation trigger events
   * - device:event - Device events (e.g., Roku button press)
   * - widget:* - Custom widget events
   *
   * Wildcards supported: 'entity:*', '*:state_changed'
   */
  createEventsApi() {
    const self = this;

    return {
      /**
       * Get recent events matching a pattern
       * @param {string} eventType - Event type pattern (supports wildcards)
       * @param {object} options - Query options
       * @returns {Array} Array of events
       */
      async getRecent(eventType = '*', options = {}) {
        const { limit = 10, since = null, entityId = null } = options;

        try {
          if (!self.eventStore) {
            self.logs.push({
              type: 'events_warning',
              message: 'Event store not available',
              timestamp: Date.now(),
            });
            return [];
          }

          return await self.eventStore.getRecent(eventType, limit, since, entityId);
        } catch (error) {
          self.logs.push({
            type: 'events_error',
            op: 'getRecent',
            eventType,
            error: error.message,
            timestamp: Date.now(),
          });
          return [];
        }
      },

      /**
       * Get the most recent event matching criteria
       * @param {string} eventType - Event type pattern
       * @param {string} entityId - Optional entity ID filter
       * @returns {Object|null} Most recent event or null
       */
      async getLatest(eventType = '*', entityId = null) {
        try {
          if (!self.eventStore) {
            return null;
          }

          return await self.eventStore.getLatest(eventType, entityId);
        } catch (error) {
          self.logs.push({
            type: 'events_error',
            op: 'getLatest',
            eventType,
            error: error.message,
            timestamp: Date.now(),
          });
          return null;
        }
      },

      /**
       * Get events for a specific entity
       * @param {string} entityId - Entity ID
       * @param {number} limit - Max events to return
       * @returns {Array} Array of events
       */
      async getForEntity(entityId, limit = 10) {
        try {
          if (!self.eventStore) {
            return [];
          }

          return await self.eventStore.getEntityEvents(entityId, limit);
        } catch (error) {
          self.logs.push({
            type: 'events_error',
            op: 'getForEntity',
            entityId,
            error: error.message,
            timestamp: Date.now(),
          });
          return [];
        }
      },

      /**
       * Emit a custom widget event
       * @param {string} eventType - Event type (will be prefixed with 'widget:')
       * @param {object} data - Event data
       */
      async emit(eventType, data = {}) {
        try {
          if (!self.eventStore) {
            return;
          }

          // Prefix with widget: if not already
          const fullType = eventType.startsWith('widget:') ? eventType : `widget:${eventType}`;
          await self.eventStore.emit(fullType, {
            ...data,
            widgetUuid: self.widgetUuid,
            instanceId: self.instanceId,
          }, 'widget');

          self.logs.push({
            type: 'event_emitted',
            eventType: fullType,
            timestamp: Date.now(),
          });
        } catch (error) {
          self.logs.push({
            type: 'events_error',
            op: 'emit',
            eventType,
            error: error.message,
            timestamp: Date.now(),
          });
        }
      },
    };
  }

  /**
   * Assets API - Access to widget-bundled assets (images, icons)
   */
  createAssetsApi() {
    const self = this;

    // Use instance-level cache so preload() persists across contexts
    if (!this._assetCache) {
      this._assetCache = new Map();
    }
    const assetCache = this._assetCache;

    return {
      /**
       * Get data URI for a widget asset (synchronous)
       * Returns cached data URI or empty string if not loaded
       * @param {string} filename - Asset filename
       * @returns {string} Data URI or empty string
       */
      get(filename) {
        return assetCache.get(filename) || '';
      },

      /**
       * Get URL for a widget asset (for external use)
       * @param {string} filename - Asset filename
       * @returns {string} URL to fetch the asset
       */
      getUrl(filename) {
        return `/api/extensions/slidecast/protocol/widget/${self.widgetUuid}/asset/${encodeURIComponent(filename)}`;
      },

      /**
       * Pre-load all assets into cache as data URIs
       * Called automatically before widget execution
       * @returns {Promise<void>}
       */
      async preload() {
        try {
          const model = self.extensionApi.model('slidecast_widget_assets');
          const assets = await model.findAll({
            where: { widget_uuid: self.widgetUuid },
          });

          for (const asset of assets) {
            if (asset.data) {
              let buffer;
              if (Buffer.isBuffer(asset.data)) {
                buffer = asset.data;
              } else if (typeof asset.data === 'string') {
                // Try to parse as JSON (may be JSON-serialized byte array)
                try {
                  const parsed = JSON.parse(asset.data);
                  if (typeof parsed === 'object' && parsed !== null && '0' in parsed) {
                    const values = Object.keys(parsed).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((k) => parsed[k]);
                    buffer = Buffer.from(values);
                  } else {
                    buffer = Buffer.from(asset.data, 'utf8');
                  }
                } catch {
                  // Not JSON, treat as raw string
                  buffer = Buffer.from(asset.data, 'utf8');
                }
              } else if (typeof asset.data === 'object' && asset.data !== null && '0' in asset.data) {
                // Handle JSON-serialized byte array object: {0: 137, 1: 80, ...}
                const values = Object.keys(asset.data).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((k) => asset.data[k]);
                buffer = Buffer.from(values);
              } else {
                buffer = Buffer.from(asset.data);
              }
              const base64 = buffer.toString('base64');
              const mimeType = asset.mime_type || 'application/octet-stream';
              assetCache.set(asset.filename, `data:${mimeType};base64,${base64}`);
            }
          }

          self.logs.push({
            type: 'assets',
            op: 'preload',
            count: assetCache.size,
            timestamp: Date.now(),
          });
        } catch (err) {
          self.logs.push({
            type: 'assets_error',
            op: 'preload',
            error: err.message,
            timestamp: Date.now(),
          });
        }
      },

      /**
       * List all assets for this widget
       * @returns {Promise<Array>} Array of asset info objects
       */
      async list() {
        try {
          const model = self.extensionApi.model('slidecast_widget_assets');
          const assets = await model.findAll({
            where: { widget_uuid: self.widgetUuid },
          });

          return assets.map((a) => ({
            filename: a.filename,
            mimeType: a.mime_type,
            size: a.size,
            url: `/api/extensions/slidecast/protocol/widget/${self.widgetUuid}/asset/${encodeURIComponent(a.filename)}`,
            dataUri: assetCache.get(a.filename) || null,
          }));
        } catch (error) {
          self.logs.push({
            type: 'assets_error',
            op: 'list',
            error: error.message,
            timestamp: Date.now(),
          });
          return [];
        }
      },

      /**
       * Check if an asset exists
       * @param {string} filename - Asset filename
       * @returns {Promise<boolean>} True if asset exists
       */
      async exists(filename) {
        try {
          const model = self.extensionApi.model('slidecast_widget_assets');
          const asset = await model.findOne({
            where: { widget_uuid: self.widgetUuid, filename },
          });
          return !!asset;
        } catch (error) {
          return false;
        }
      },
    };
  }

  /**
   * Secrets API - Access to encrypted widget secrets
   */
  createSecretsApi() {
    const self = this;

    return {
      async get(keyName) {
        try {
          // Prefer the already-initialized singleton injected by WidgetRuntime
          let { secrets } = self;
          if (!secrets) {
            // Fallback: import WidgetSecrets dynamically to avoid circular deps
            const { default: WidgetSecrets } = await import('./WidgetSecrets.js');
            secrets = new WidgetSecrets(self.extensionApi);
            await secrets.init();
          }
          return await secrets.getDecrypted(self.widgetUuid, keyName);
        } catch (error) {
          self.logs.push({
            type: 'secret_error',
            keyName,
            error: error.message,
            timestamp: Date.now(),
          });
          return null;
        }
      },
    };
  }

  /**
   * Log API - Widget logging
   */
  createLogApi() {
    const self = this;

    return {
      info(message) {
        self.logs.push({ level: 'info', message, timestamp: Date.now() });
        self.extensionApi.log(`[Widget ${self.widgetUuid}] ${message}`, 'info');
      },

      warn(message) {
        self.logs.push({ level: 'warn', message, timestamp: Date.now() });
        self.extensionApi.log(`[Widget ${self.widgetUuid}] ${message}`, 'warn');
      },

      error(message) {
        self.logs.push({ level: 'error', message, timestamp: Date.now() });
        self.extensionApi.log(`[Widget ${self.widgetUuid}] ${message}`, 'error');
      },

      debug(message) {
        self.logs.push({ level: 'debug', message, timestamp: Date.now() });
      },
    };
  }

  /**
   * Get collected logs
   */
  getLogs() {
    return this.logs;
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }
}

export default WidgetAPI;
