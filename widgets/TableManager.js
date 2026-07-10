import logger from '../utils/Logger.js';
/**
 * TableManager - Dynamic table management for widget-defined tables
 *
 * Each widget can define its own tables in the 'tables' field of its manifest.
 * Tables are namespaced with: slidecast_w_{uuid}_{tablename}
 *
 * Example widget table definition:
 * ```javascript
 * tables: {
 *   geocode_cache: {
 *     zip_code: 'string',
 *     country: 'string',
 *     latitude: 'number',
 *     longitude: 'number',
 *     city: 'string',
 *     state: 'string'
 *   },
 *   api_responses: {
 *     endpoint: 'string',
 *     response: 'json',
 *     fetched_at: 'datetime'
 *   }
 * }
 * ```
 */

class TableManager {
  constructor(api) {
    this.api = api;
    // Cache of registered models to avoid re-registering
    this.registeredModels = new Set();
  }

  /**
   * Get the SQLite table name for a widget table
   * Format: slidecast_w_{uuid_underscored}_{tablename}
   */
  getTableName(widgetUuid, tableName) {
    const safeUuid = widgetUuid.replace(/-/g, '_');
    return `slidecast_w_${safeUuid}_${tableName}`;
  }

  /**
   * Convert widget schema type to model API type
   */
  getModelType(type) {
    const typeMap = {
      string: 'string',
      text: 'string',
      number: 'number',
      integer: 'integer',
      int: 'integer',
      boolean: 'boolean',
      bool: 'boolean',
      json: 'json',
      datetime: 'datetime',
      date: 'string',
      blob: 'string',
    };
    return typeMap[type?.toLowerCase()] || 'string';
  }

  /**
   * Convert widget schema type to SQLite type (for raw queries)
   */
  getSqliteType(type) {
    const typeMap = {
      string: 'TEXT',
      text: 'TEXT',
      number: 'REAL',
      integer: 'INTEGER',
      int: 'INTEGER',
      boolean: 'INTEGER',
      bool: 'INTEGER',
      json: 'TEXT',
      datetime: 'TEXT',
      date: 'TEXT',
      blob: 'BLOB',
    };
    return typeMap[type?.toLowerCase()] || 'TEXT';
  }

  /**
   * Create all tables defined in a widget's schema
   * @param {string} widgetUuid - Widget UUID
   * @param {Object} tableSchema - Tables definition from widget manifest
   */
  async createTablesForWidget(widgetUuid, tableSchema) {
    if (!tableSchema || typeof tableSchema !== 'object') {
      return;
    }

    const tableNames = Object.keys(tableSchema);
    if (tableNames.length === 0) {
      return;
    }

    logger.info(`Creating ${tableNames.length} tables for widget ${widgetUuid}`);

    for (const [tableName, columns] of Object.entries(tableSchema)) {
      await this.createTable(widgetUuid, tableName, columns);
    }
  }

  /**
   * Create a single table using the Model API
   */
  async createTable(widgetUuid, tableName, columns) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    // Skip if already registered in this session
    if (this.registeredModels.has(fullTableName)) {
      return;
    }

    // Build schema fields for Model API
    const fields = {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
    };

    const jsonFields = [];

    for (const [colName, colType] of Object.entries(columns)) {
      const typeStr = typeof colType === 'object' ? colType.type : colType;
      const modelType = this.getModelType(typeStr);
      fields[colName] = { type: modelType };

      if (modelType === 'json') {
        jsonFields.push(colName);
      }
    }

    // Add standard timestamp columns
    fields.created_at = { type: 'datetime', default: 'CURRENT_TIMESTAMP' };
    fields.updated_at = { type: 'datetime', default: 'CURRENT_TIMESTAMP' };

    // Create model schema
    const schema = {
      tableName: fullTableName,
      fields,
      jsonFields,
      dateFields: ['created_at', 'updated_at'],
    };

    try {
      // Register and create the table using Model API
      await this.api.registerModel(fullTableName, schema);
      await this.api.model(fullTableName).createTable();

      this.registeredModels.add(fullTableName);
      logger.debug(`Created table: ${fullTableName}`);
    } catch (err) {
      // Table might already exist from previous run
      if (err.message.includes('already exists') || err.message.includes('UNIQUE constraint')) {
        this.registeredModels.add(fullTableName);
        logger.debug(`Table already exists: ${fullTableName}`);
      } else {
        logger.error(`Failed to create table ${fullTableName}: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Migrate tables when schema changes
   * - Adds new columns (safe)
   * - Does NOT remove columns (data safety)
   * - Does NOT change column types (data safety)
   */
  async migrateTablesForWidget(widgetUuid, oldSchema, newSchema) {
    if (!newSchema || typeof newSchema !== 'object') {
      return;
    }

    const oldTables = Object.keys(oldSchema || {});
    const newTables = Object.keys(newSchema);

    // Create new tables (or re-register existing ones)
    for (const tableName of newTables) {
      await this.createTable(widgetUuid, tableName, newSchema[tableName]);
    }

    // Log removed tables (but don't drop them - data safety)
    for (const tableName of oldTables) {
      if (!newTables.includes(tableName)) {
        logger.warn(`Widget ${widgetUuid} no longer uses table '${tableName}' - kept for data safety`);
      }
    }
  }

  /**
   * Drop all tables for a widget
   * WARNING: This permanently deletes all data!
   * Note: Uses queryBuilder raw() for table drop since Model API doesn't support DROP
   */
  async dropTablesForWidget(widgetUuid, tableSchema) {
    if (!tableSchema || typeof tableSchema !== 'object') {
      return;
    }

    for (const tableName of Object.keys(tableSchema)) {
      await this.dropTable(widgetUuid, tableName);
    }
  }

  /**
   * Drop a single table
   */
  async dropTable(widgetUuid, tableName) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    try {
      // Use queryBuilder's raw method for DROP TABLE
      const qb = this.api.queryBuilder(fullTableName);
      await qb.raw(`DROP TABLE IF EXISTS ${fullTableName}`);
      this.registeredModels.delete(fullTableName);
      logger.debug(`Dropped table: ${fullTableName}`);
    } catch (err) {
      logger.error(`Failed to drop table ${fullTableName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get all data from a widget table
   */
  async getTableData(widgetUuid, tableName) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    try {
      // Ensure model is registered
      if (!this.registeredModels.has(fullTableName)) {
        // Try to get from existing model
        const model = this.api.model(fullTableName);
        if (model) {
          this.registeredModels.add(fullTableName);
        }
      }

      const model = this.api.model(fullTableName);
      if (!model) {
        return [];
      }

      const rows = await model.findAll({});
      return rows || [];
    } catch (err) {
      if (err.message.includes('no such table') || err.message.includes('not found')) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Clear all data from a widget table (but keep the table structure)
   */
  async clearTable(widgetUuid, tableName) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    try {
      const model = this.api.model(fullTableName);
      if (!model) {
        return;
      }

      // Delete all rows using model
      const rows = await model.findAll({});
      for (const row of rows) {
        await model.delete(row.id);
      }

      logger.debug(`Cleared table: ${fullTableName}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        logger.error(`Failed to clear table ${fullTableName}: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Get row count for a widget table
   */
  async getTableRowCount(widgetUuid, tableName) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    try {
      const model = this.api.model(fullTableName);
      if (!model) {
        return 0;
      }

      const rows = await model.findAll({});
      return rows?.length || 0;
    } catch (err) {
      if (err.message.includes('no such table')) {
        return 0;
      }
      throw err;
    }
  }

  /**
   * Import data into a widget table
   * @param {string} widgetUuid - Widget UUID
   * @param {string} tableName - Table name
   * @param {Array} rows - Array of row objects to import
   * @param {boolean} clearFirst - Whether to clear existing data first
   */
  async importTableData(widgetUuid, tableName, rows, clearFirst = false) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    if (clearFirst) {
      await this.clearTable(widgetUuid, tableName);
    }

    if (!rows || rows.length === 0) {
      return 0;
    }

    const model = this.api.model(fullTableName);
    if (!model) {
      logger.warn(`Cannot import - model ${fullTableName} not found`);
      return 0;
    }

    let imported = 0;
    for (const row of rows) {
      // Remove id field to let autoincrement work
      const { id, ...data } = row;

      try {
        await model.create(data);
        imported++;
      } catch (err) {
        logger.warn(`Failed to import row into ${fullTableName}: ${err.message}`);
      }
    }

    return imported;
  }

  /**
   * Export all tables and data for a widget
   * @returns {Object} { schema: {...}, data: { tableName: [...rows] } }
   */
  async exportWidgetTables(widgetUuid, tableSchema) {
    if (!tableSchema || typeof tableSchema !== 'object') {
      return { schema: {}, data: {} };
    }

    const data = {};
    for (const tableName of Object.keys(tableSchema)) {
      data[tableName] = await this.getTableData(widgetUuid, tableName);
    }

    return {
      schema: tableSchema,
      data,
    };
  }

  /**
   * Check if a table exists
   */
  async tableExists(widgetUuid, tableName) {
    const fullTableName = this.getTableName(widgetUuid, tableName);

    try {
      const model = this.api.model(fullTableName);
      if (!model) {
        return false;
      }
      // Try to query - will fail if table doesn't exist
      await model.findAll({ limit: 1 });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get list of all tables for a widget that actually exist
   */
  async getExistingTables(widgetUuid) {
    // This is harder to implement without raw SQL access
    // For now, return tables from the registry that match this widget
    const prefix = `slidecast_w_${widgetUuid.replace(/-/g, '_')}_`;
    const tables = [];

    for (const fullName of this.registeredModels) {
      if (fullName.startsWith(prefix)) {
        tables.push(fullName.replace(prefix, ''));
      }
    }

    return tables;
  }
}

export default TableManager;
