/**
 * WidgetRegistry - CRUD operations for widget definitions
 * Handles versioning, export/import, and widget lifecycle
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../utils/Logger.js';
import TableManager from './TableManager.js';

class WidgetRegistry {
  constructor(api) {
    this.api = api;
    this.model = null;
    this.versionsModel = null;
    this.tableManager = null;
    this.MAX_VERSIONS = 5;
    this.imageRenderer = null;
    this.runtime = null;
  }

  async init() {
    this.model = this.api.model('slidecast_widgets');
    this.versionsModel = this.api.model('slidecast_widget_versions');
    this.tableManager = new TableManager(this.api);
    logger.info('WidgetRegistry initialized with TableManager');
  }

  /**
   * Set image renderer reference for thumbnail generation
   */
  setImageRenderer(imageRenderer) {
    this.imageRenderer = imageRenderer;
  }

  /**
   * Set runtime reference for widget execution
   */
  setRuntime(runtime) {
    this.runtime = runtime;
  }

  /**
   * Create a new widget
   */
  async create(definition) {
    // Support both new UUID and preserving existing UUID (for imports)
    const uuid = definition.uuid || uuidv4();
    const now = new Date().toISOString();

    const widget = await this.model.create({
      uuid,
      name: definition.name || 'Untitled Widget',
      description: definition.description || '',
      category: definition.category || 'custom',
      render_mode: definition.renderMode || 'image',
      code: definition.code || this.getDefaultCode(),
      server_code: definition.serverCode || '',
      client_code: definition.clientCode || '',
      html_template: definition.htmlTemplate || '',
      config_schema: definition.configSchema || {},
      style_schema: definition.styleSchema || {},
      table_schema: definition.tableSchema || null,
      preview_primitives: definition.previewPrimitives || null,
      default_size: definition.defaultSize || { width: 300, height: 150 },
      refresh_interval: definition.refreshInterval || 60000,
      supports_animation: definition.supportsAnimation || false,
      is_system: definition.isSystem || false,
      is_published: false,
      current_version: definition.currentVersion || 1,
      created_at: now,
      updated_at: now,
    });

    const formatted = this.formatWidget(widget);

    // Create widget-defined tables if schema provided
    if (definition.tableSchema && Object.keys(definition.tableSchema).length > 0) {
      try {
        await this.tableManager.createTablesForWidget(uuid, definition.tableSchema);
        logger.info(`Created ${Object.keys(definition.tableSchema).length} tables for widget: ${widget.name}`);
      } catch (err) {
        logger.error(`Failed to create tables for ${widget.name}: ${err.message}`);
      }
    }

    // Execute onInstall lifecycle hook if runtime is available
    if (this.runtime && definition.code) {
      try {
        await this.runtime.executeLifecycleHook(formatted, 'onInstall', {
          isNew: true,
        });
      } catch (err) {
        logger.error(`onInstall hook failed for ${widget.name}: ${err.message}`);
      }
    }

    logger.info(`Widget created: ${widget.name} (${uuid})`);
    return formatted;
  }

  /**
   * Get widget by UUID
   */
  async getByUuid(uuid) {
    const results = await this.model.findAll({ where: { uuid } });
    if (!results || results.length === 0) return null;
    return this.formatWidget(results[0]);
  }

  /**
   * Get widget by database ID
   */
  async getById(id) {
    const widget = await this.model.findById(id);
    return widget ? this.formatWidget(widget) : null;
  }

  /**
   * Get all widgets with optional filtering
   */
  async getAll(filters = {}) {
    const where = {};

    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.renderMode) {
      where.render_mode = filters.renderMode;
    }
    if (filters.isPublished !== undefined) {
      where.is_published = filters.isPublished ? 1 : 0;
    }
    if (filters.isSystem !== undefined) {
      where.is_system = filters.isSystem ? 1 : 0;
    }

    const widgets = await this.model.findAll({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: 'updated_at DESC',
    });

    return widgets.map((w) => this.formatWidget(w));
  }

  /**
   * Update a widget (auto-creates version)
   */
  async update(uuid, updates) {
    const existing = await this.getByUuid(uuid);
    if (!existing) return null;

    // Create version before updating (full snapshot)
    if (existing.isPublished) {
      await this.createVersion(existing);
    }

    // Track if any code file is changing (legacy code, serverCode, clientCode, or htmlTemplate).
    // Any of these edits must invalidate the runtime module cache below, otherwise the
    // WidgetRuntime keeps serving stale compiled code until a full restart.
    const codeChanged = (updates.code !== undefined && updates.code !== existing.code)
      || (updates.serverCode !== undefined && updates.serverCode !== existing.serverCode)
      || (updates.clientCode !== undefined && updates.clientCode !== existing.clientCode)
      || (updates.htmlTemplate !== undefined && updates.htmlTemplate !== existing.htmlTemplate);
    const tableSchemaChanged = updates.tableSchema !== undefined
      && JSON.stringify(updates.tableSchema) !== JSON.stringify(existing.tableSchema);

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.renderMode !== undefined) updateData.render_mode = updates.renderMode;
    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.serverCode !== undefined) updateData.server_code = updates.serverCode;
    if (updates.clientCode !== undefined) updateData.client_code = updates.clientCode;
    if (updates.htmlTemplate !== undefined) updateData.html_template = updates.htmlTemplate;
    if (updates.configSchema !== undefined) updateData.config_schema = updates.configSchema;
    if (updates.styleSchema !== undefined) updateData.style_schema = updates.styleSchema;
    if (updates.tableSchema !== undefined) updateData.table_schema = updates.tableSchema;
    if (updates.previewPrimitives !== undefined) updateData.preview_primitives = updates.previewPrimitives;
    if (updates.defaultSize !== undefined) updateData.default_size = updates.defaultSize;
    if (updates.refreshInterval !== undefined) updateData.refresh_interval = updates.refreshInterval;
    if (updates.supportsAnimation !== undefined) updateData.supports_animation = updates.supportsAnimation ? 1 : 0;
    if (updates.isPublished !== undefined) updateData.is_published = updates.isPublished ? 1 : 0;

    await this.model.update(existing.id, updateData);

    // Handle table schema migration if changed
    if (tableSchemaChanged && updates.tableSchema) {
      try {
        await this.tableManager.migrateTablesForWidget(uuid, existing.tableSchema, updates.tableSchema);
        logger.info(`Migrated tables for widget: ${existing.name}`);
      } catch (err) {
        logger.error(`Table migration failed for ${existing.name}: ${err.message}`);
      }
    }

    const updated = await this.getByUuid(uuid);

    // Execute onUpdate lifecycle hook if code changed and runtime is available
    if (this.runtime && codeChanged) {
      try {
        // Clear cache for this widget since code changed
        this.runtime.clearCache(uuid);

        await this.runtime.executeLifecycleHook(updated, 'onUpdate', {
          previousVersion: !!existing.code,
        });
      } catch (err) {
        logger.warn(`onUpdate hook failed for ${existing.name}: ${err.message}`);
      }
    }

    logger.info(`Widget updated: ${existing.name} (${uuid})`);
    return updated;
  }

  /**
   * Publish a widget (marks it as ready for use)
   * Generates thumbnail on publish
   */
  async publish(uuid) {
    const existing = await this.getByUuid(uuid);
    if (!existing) return null;

    // Create version on publish
    await this.createVersion(existing);

    // Generate thumbnail
    let thumbnail = null;
    try {
      thumbnail = await this.generateThumbnail(existing);
    } catch (err) {
      logger.warn(`Failed to generate thumbnail for ${existing.name}: ${err.message}`);
    }

    const updateData = {
      is_published: 1,
      updated_at: new Date().toISOString(),
    };

    if (thumbnail) {
      updateData.thumbnail = thumbnail;
    }

    await this.model.update(existing.id, updateData);

    logger.info(`Widget published: ${existing.name} (${uuid})`);
    return this.getByUuid(uuid);
  }

  /**
   * Generate a thumbnail for a widget
   * Uses previewPrimitives if available (static sample data), otherwise runs actual widget code
   * @param {Object} widget - The widget definition
   * @returns {string|null} - Base64 encoded thumbnail or null
   */
  async generateThumbnail(widget) {
    if (!this.imageRenderer) {
      logger.warn('Cannot generate thumbnail: missing imageRenderer');
      return null;
    }

    try {
      let primitives = null;

      // First, try to use previewPrimitives (static sample data - preferred for thumbnails)
      const previewPrimitives = widget.previewPrimitives || widget.preview_primitives;
      if (previewPrimitives) {
        // Parse if it's a JSON string
        primitives = typeof previewPrimitives === 'string'
          ? JSON.parse(previewPrimitives)
          : previewPrimitives;

        // Ensure it's an array
        if (!Array.isArray(primitives)) {
          primitives = [primitives];
        }
      }

      // Fallback: execute actual widget code (may fail for widgets needing server data)
      if (!primitives || primitives.length === 0) {
        if (!this.runtime) {
          logger.warn('Cannot generate thumbnail: no previewPrimitives and no runtime');
          return null;
        }

        const renderResult = await this.runtime.execute(
          widget, // Pass full widget object
          {}, // Empty config (use defaults)
          {}, // Empty styles (use defaults)
          'thumbnail', // Instance ID for thumbnail generation
        );

        if (!renderResult || !renderResult.primitives) {
          return null;
        }
        primitives = renderResult.primitives;
      }

      // Render to image at thumbnail size (200x100)
      const thumbnailSize = { width: 200, height: 100 };
      const imageBuffer = await this.imageRenderer.renderToImage(
        primitives,
        thumbnailSize,
        'png',
      );

      if (imageBuffer) {
        // Return as base64 data URL
        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
      }
    } catch (err) {
      logger.error(`Thumbnail generation error: ${err.message}`);
    }

    return null;
  }

  /**
   * Regenerate thumbnail for a widget
   */
  async regenerateThumbnail(uuid) {
    const widget = await this.getByUuid(uuid);
    if (!widget) return null;

    const thumbnail = await this.generateThumbnail(widget);
    if (thumbnail) {
      await this.model.update(widget.id, {
        thumbnail,
        updated_at: new Date().toISOString(),
      });
      return thumbnail;
    }
    return null;
  }

  /**
   * Delete a widget
   */
  async delete(uuid) {
    const existing = await this.getByUuid(uuid);
    if (!existing) return false;

    // Execute onUninstall lifecycle hook before deletion
    if (this.runtime) {
      try {
        await this.runtime.executeLifecycleHook(existing, 'onUninstall', {
          isDeleting: true,
        });
      } catch (err) {
        logger.warn(`onUninstall hook failed for ${existing.name}: ${err.message}`);
        // Continue with deletion even if hook fails
      }

      // Clear widget from runtime cache
      this.runtime.clearCache(uuid);
    }

    // Delete versions
    const versions = await this.versionsModel.findAll({ where: { widget_uuid: uuid } });
    for (const v of versions) {
      await this.versionsModel.delete(v.id);
    }

    // Drop widget-defined tables
    if (existing.tableSchema && Object.keys(existing.tableSchema).length > 0) {
      try {
        await this.tableManager.dropTablesForWidget(uuid, existing.tableSchema);
        logger.info(`Dropped ${Object.keys(existing.tableSchema).length} tables for widget: ${existing.name}`);
      } catch (err) {
        logger.warn(`Failed to drop widget tables: ${err.message}`);
      }
    }

    // Delete all widget storage (both instance and widget-level)
    try {
      const storageModel = this.api.model('slidecast_widget_storage');
      const storageEntries = await storageModel.findAll({ where: { widget_uuid: uuid } });
      for (const entry of storageEntries) {
        await storageModel.delete(entry.id);
      }
      if (storageEntries.length > 0) {
        logger.debug(`Deleted ${storageEntries.length} storage entries for widget: ${existing.name}`);
      }
    } catch (err) {
      logger.warn(`Failed to clean up widget storage: ${err.message}`);
    }

    // Delete widget secrets
    try {
      const secretsModel = this.api.model('slidecast_widget_secrets');
      const secrets = await secretsModel.findAll({ where: { widget_uuid: uuid } });
      for (const secret of secrets) {
        await secretsModel.delete(secret.id);
      }
    } catch (err) {
      logger.warn(`Failed to clean up widget secrets: ${err.message}`);
    }

    // Delete widget assets
    try {
      const assetsModel = this.api.model('slidecast_widget_assets');
      const assets = await assetsModel.findAll({ where: { widget_uuid: uuid } });
      for (const asset of assets) {
        await assetsModel.delete(asset.id);
      }
      if (assets.length > 0) {
        logger.debug(`Deleted ${assets.length} assets for widget: ${existing.name}`);
      }
    } catch (err) {
      logger.warn(`Failed to clean up widget assets: ${err.message}`);
    }

    // Delete widget
    await this.model.delete(existing.id);

    logger.info(`Widget deleted: ${existing.name} (${uuid})`);
    return true;
  }

  /**
   * Duplicate a widget (complete copy including assets, DB data, and all settings)
   */
  async duplicate(uuid) {
    const original = await this.getByUuid(uuid);
    if (!original) return null;

    // Create the new widget with ALL fields copied
    const newWidget = await this.create({
      name: `${original.name} (Copy)`,
      description: original.description,
      category: original.category,
      renderMode: original.renderMode,
      code: original.code,
      serverCode: original.serverCode,
      clientCode: original.clientCode,
      htmlTemplate: original.htmlTemplate,
      configSchema: original.configSchema,
      styleSchema: original.styleSchema,
      tableSchema: original.tableSchema, // This will create the tables via create()
      previewPrimitives: original.previewPrimitives,
      defaultSize: original.defaultSize,
      refreshInterval: original.refreshInterval,
      isSystem: false,
    });

    if (!newWidget) return null;

    // Copy assets
    try {
      const assetsModel = this.api.model('slidecast_widget_assets');
      const originalAssets = await assetsModel.findAll({ where: { widget_uuid: uuid } });

      for (const asset of originalAssets) {
        await assetsModel.create({
          widget_uuid: newWidget.uuid,
          filename: asset.filename,
          mime_type: asset.mime_type,
          size: asset.size,
          data: asset.data, // Copy the binary data
          created_at: new Date().toISOString(),
        });
      }

      if (originalAssets.length > 0) {
        logger.info(`Copied ${originalAssets.length} assets to duplicated widget: ${newWidget.name}`);
      }
    } catch (err) {
      logger.warn(`Failed to copy assets during duplication: ${err.message}`);
    }

    // Copy database data if widget has tables
    if (original.tableSchema && Object.keys(original.tableSchema).length > 0) {
      try {
        // Export data from original widget's tables
        const exportData = await this.tableManager.exportWidgetTables(uuid, original.tableSchema);

        if (exportData && exportData.data) {
          // Import data into new widget's tables (table by table)
          for (const [tableName, rows] of Object.entries(exportData.data)) {
            if (rows && rows.length > 0) {
              // Remove id field from rows to avoid conflicts
              const rowsWithoutId = rows.map((row) => {
                const { id, ...rest } = row;
                return rest;
              });
              await this.tableManager.importTableData(newWidget.uuid, tableName, rowsWithoutId);
            }
          }
          logger.info(`Copied database data to duplicated widget: ${newWidget.name}`);
        }
      } catch (err) {
        logger.warn(`Failed to copy database data during duplication: ${err.message}`);
      }
    }

    return newWidget;
  }

  /**
   * Create a version snapshot (full snapshot: code, schema, DB data, assets)
   */
  async createVersion(widget) {
    // Get current version count
    const versions = await this.versionsModel.findAll({
      where: { widget_uuid: widget.uuid },
      orderBy: 'version DESC',
    });

    const nextVersion = versions.length > 0 ? versions[0].version + 1 : 1;

    // Snapshot DB data for all widget tables
    let dbSnapshot = null;
    if (widget.tableSchema && Object.keys(widget.tableSchema).length > 0) {
      try {
        const exportData = await this.tableManager.exportWidgetTables(widget.uuid, widget.tableSchema);
        dbSnapshot = exportData.data;
      } catch (err) {
        logger.warn(`Failed to snapshot DB data for ${widget.name}: ${err.message}`);
      }
    }

    // Snapshot assets (metadata only, not binary data)
    let assetsSnapshot = null;
    try {
      const assetsModel = this.api.model('slidecast_widget_assets');
      const assets = await assetsModel.findAll({ where: { widget_uuid: widget.uuid } });
      if (assets.length > 0) {
        assetsSnapshot = assets.map((a) => ({
          filename: a.filename,
          mimeType: a.mime_type,
          size: a.size,
        }));
      }
    } catch (err) {
      logger.warn(`Failed to snapshot assets for ${widget.name}: ${err.message}`);
    }

    // Create new version with full snapshot
    await this.versionsModel.create({
      widget_uuid: widget.uuid,
      version: nextVersion,
      // All code files
      code: widget.code,
      server_code: widget.serverCode,
      client_code: widget.clientCode,
      html_template: widget.htmlTemplate,
      // Schemas
      config_schema: widget.configSchema,
      style_schema: widget.styleSchema,
      table_schema: widget.tableSchema,
      // Data snapshots
      db_snapshot: dbSnapshot,
      assets_snapshot: assetsSnapshot,
      created_at: new Date().toISOString(),
    });

    // Update widget's current version number
    await this.model.update(widget.id, { current_version: nextVersion });

    // Prune old versions (keep last MAX_VERSIONS)
    if (versions.length >= this.MAX_VERSIONS) {
      const toDelete = versions.slice(this.MAX_VERSIONS - 1);
      for (const v of toDelete) {
        await this.versionsModel.delete(v.id);
      }
    }

    logger.debug(`Version ${nextVersion} created for widget: ${widget.name} (with DB snapshot: ${dbSnapshot ? 'yes' : 'no'})`);
    return nextVersion;
  }

  /**
   * Get version history for a widget
   */
  async getVersions(uuid) {
    const versions = await this.versionsModel.findAll({
      where: { widget_uuid: uuid },
      orderBy: 'version DESC',
    });

    return versions.map((v) => ({
      version: v.version,
      createdAt: v.created_at,
      codePreview: `${v.code?.substring(0, 100)}...`,
    }));
  }

  /**
   * Restore a previous version (full restore: code, schema, DB data)
   */
  async restoreVersion(uuid, version) {
    const versionData = await this.versionsModel.findAll({
      where: { widget_uuid: uuid, version },
    });

    if (!versionData || versionData.length === 0) {
      return null;
    }

    const v = versionData[0];
    const parseJson = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch { return null; }
    };

    const tableSchema = parseJson(v.table_schema);
    const dbSnapshot = parseJson(v.db_snapshot);

    // Restore code and schemas
    const updated = await this.update(uuid, {
      code: v.code,
      serverCode: v.server_code,
      clientCode: v.client_code,
      htmlTemplate: v.html_template,
      configSchema: parseJson(v.config_schema),
      styleSchema: parseJson(v.style_schema),
      tableSchema,
    });

    // Restore DB data if snapshot exists
    if (dbSnapshot && tableSchema) {
      try {
        // Recreate tables from snapshot schema
        await this.tableManager.dropTablesForWidget(uuid, tableSchema);
        await this.tableManager.createTablesForWidget(uuid, tableSchema);

        // Import data
        for (const [tableName, rows] of Object.entries(dbSnapshot)) {
          if (rows && rows.length > 0) {
            await this.tableManager.importTableData(uuid, tableName, rows, false);
          }
        }
        logger.info(`Restored DB snapshot for widget: ${updated.name}`);
      } catch (err) {
        logger.error(`Failed to restore DB snapshot for ${updated.name}: ${err.message}`);
      }
    }

    return updated;
  }

  /**
   * Export widget as .widget ZIP package
   * @param {string} uuid - Widget UUID
   * @param {Object} options - Export options
   * @param {boolean} options.includeDbData - Include database table data
   * @param {string[]} options.tables - Specific tables to include (null = all)
   * @returns {Object} { manifest, files: { name: content }, dbData }
   */
  async export(uuid, options = {}) {
    const widget = await this.getByUuid(uuid);
    if (!widget) return null;

    const { includeDbData = false, tables = null } = options;

    // Build manifest.json
    const manifest = {
      formatVersion: 2,
      uuid: widget.uuid,
      name: widget.name,
      version: widget.currentVersion || 1,
      description: widget.description,
      category: widget.category,
      renderMode: widget.renderMode,
      refreshInterval: widget.refreshInterval,
      defaultSize: widget.defaultSize,
      configSchema: widget.configSchema,
      styleSchema: widget.styleSchema,
      tables: widget.tableSchema,
      exportedAt: new Date().toISOString(),
    };

    // Collect code files
    const files = {};
    if (widget.serverCode) files['server.js'] = widget.serverCode;
    if (widget.clientCode) files['client.js'] = widget.clientCode;
    if (widget.htmlTemplate) files['template.html'] = widget.htmlTemplate;
    if (widget.code) files['code.js'] = widget.code; // Legacy support

    // Get assets
    const assets = [];
    try {
      const assetsModel = this.api.model('slidecast_widget_assets');
      const assetRecords = await assetsModel.findAll({ where: { widget_uuid: uuid } });
      for (const asset of assetRecords) {
        assets.push({
          filename: asset.filename,
          mimeType: asset.mime_type,
          size: asset.size,
          data: asset.data, // Binary data
        });
      }
    } catch (err) {
      logger.warn(`Failed to get assets for export: ${err.message}`);
    }

    // Get database data if requested
    let dbData = null;
    if (includeDbData && widget.tableSchema) {
      const tablesToExport = tables || Object.keys(widget.tableSchema);
      dbData = {};
      for (const tableName of tablesToExport) {
        if (widget.tableSchema[tableName]) {
          try {
            dbData[tableName] = await this.tableManager.getTableData(uuid, tableName);
          } catch (err) {
            logger.warn(`Failed to export table ${tableName}: ${err.message}`);
            dbData[tableName] = [];
          }
        }
      }
    }

    return {
      manifest,
      files,
      assets,
      dbData,
    };
  }

  /**
   * Import widget from .widget package data
   * Handles UUID preservation and versioning
   * @param {Object} data - Parsed widget package { manifest, files, assets, dbData }
   * @returns {Object} Imported widget
   */
  async import(data) {
    // Support both old JSON format and new .widget format
    if (data.widget && !data.manifest) {
      // Old JSON format
      const w = data.widget;
      return await this.create({
        name: w.name,
        description: w.description,
        category: w.category,
        renderMode: w.renderMode,
        code: w.code,
        configSchema: w.configSchema,
        styleSchema: w.styleSchema,
        defaultSize: w.defaultSize,
        refreshInterval: w.refreshInterval,
      });
    }

    // New .widget format
    const {
      manifest, files = {}, assets = [], dbData = null,
    } = data;

    if (!manifest || !manifest.uuid) {
      throw new Error('Invalid widget package: missing manifest or UUID');
    }

    // Check if widget with this UUID already exists
    const existing = await this.getByUuid(manifest.uuid);

    if (existing) {
      // Create version snapshot of existing before updating
      await this.createVersion(existing);

      // Update existing widget with new code
      const updated = await this.update(manifest.uuid, {
        name: manifest.name,
        description: manifest.description,
        category: manifest.category,
        renderMode: manifest.renderMode,
        refreshInterval: manifest.refreshInterval,
        defaultSize: manifest.defaultSize,
        configSchema: manifest.configSchema,
        styleSchema: manifest.styleSchema,
        tableSchema: manifest.tables,
        previewPrimitives: manifest.previewPrimitives,
        serverCode: files['server.js'] || '',
        clientCode: files['client.js'] || '',
        htmlTemplate: files['template.html'] || '',
        code: files['code.js'] || existing.code,
      });

      logger.info(`Widget updated via import: ${manifest.name} (v${manifest.version})`);

      // Handle DB data import (replace existing)
      if (dbData && manifest.tables) {
        try {
          for (const [tableName, rows] of Object.entries(dbData)) {
            if (manifest.tables[tableName] && rows.length > 0) {
              await this.tableManager.importTableData(manifest.uuid, tableName, rows, true);
            }
          }
          logger.info(`Imported DB data for widget: ${manifest.name}`);
        } catch (err) {
          logger.error(`Failed to import DB data: ${err.message}`);
        }
      }

      // Import assets (replace existing)
      if (assets.length > 0) {
        await this.importAssets(manifest.uuid, assets);
      }

      return await this.getByUuid(manifest.uuid);
    }

    // Create new widget with preserved UUID
    const widget = await this.create({
      uuid: manifest.uuid,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      renderMode: manifest.renderMode,
      refreshInterval: manifest.refreshInterval,
      defaultSize: manifest.defaultSize,
      configSchema: manifest.configSchema,
      styleSchema: manifest.styleSchema,
      tableSchema: manifest.tables,
      previewPrimitives: manifest.previewPrimitives,
      serverCode: files['server.js'] || '',
      clientCode: files['client.js'] || '',
      htmlTemplate: files['template.html'] || '',
      code: files['code.js'] || '',
      currentVersion: manifest.version || 1,
    });

    // Import DB data if provided
    if (dbData && manifest.tables) {
      try {
        for (const [tableName, rows] of Object.entries(dbData)) {
          if (manifest.tables[tableName] && rows.length > 0) {
            await this.tableManager.importTableData(manifest.uuid, tableName, rows, false);
          }
        }
        logger.info(`Imported DB data for new widget: ${manifest.name}`);
      } catch (err) {
        logger.error(`Failed to import DB data: ${err.message}`);
      }
    }

    // Import assets
    if (assets.length > 0) {
      await this.importAssets(manifest.uuid, assets);
    }

    logger.info(`Widget imported: ${manifest.name} (${manifest.uuid})`);
    return widget;
  }

  /**
   * Import assets for a widget
   */
  async importAssets(uuid, assets) {
    const assetsModel = this.api.model('slidecast_widget_assets');

    // Delete existing assets
    try {
      const existing = await assetsModel.findAll({ where: { widget_uuid: uuid } });
      for (const asset of existing) {
        await assetsModel.delete(asset.id);
      }
    } catch (err) {
      logger.warn(`Failed to clear existing assets: ${err.message}`);
    }

    // Import new assets
    for (const asset of assets) {
      try {
        await assetsModel.create({
          widget_uuid: uuid,
          filename: asset.filename,
          mime_type: asset.mimeType,
          size: asset.size,
          data: asset.data,
        });
      } catch (err) {
        logger.warn(`Failed to import asset ${asset.filename}: ${err.message}`);
      }
    }

    logger.debug(`Imported ${assets.length} assets for widget`);
  }

  /**
   * Format widget for API response
   */
  formatWidget(widget) {
    const parseJson = (val) => {
      if (!val) return {};
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    };

    const parseJsonNullable = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    };

    return {
      id: widget.id,
      uuid: widget.uuid,
      name: widget.name,
      description: widget.description,
      category: widget.category,
      renderMode: widget.render_mode,
      code: widget.code,
      // Multi-file widget code structure
      serverCode: widget.server_code || '',
      clientCode: widget.client_code || '',
      htmlTemplate: widget.html_template || '',
      serverLanguage: widget.server_language || 'nodejs',
      configSchema: parseJson(widget.config_schema),
      styleSchema: parseJson(widget.style_schema),
      tableSchema: parseJsonNullable(widget.table_schema), // Widget-defined database tables
      defaultSize: parseJson(widget.default_size),
      previewPrimitives: parseJson(widget.preview_primitives), // Static preview for Studio canvas
      refreshInterval: widget.refresh_interval,
      supportsAnimation: !!widget.supports_animation,
      isSystem: !!widget.is_system,
      isPublished: !!widget.is_published,
      currentVersion: widget.current_version || 1, // Simple version number (v1, v2, v3)
      createdAt: widget.created_at,
      updatedAt: widget.updated_at,
    };
  }

  /**
   * Get default widget code template
   */
  getDefaultCode() {
    return `export default {
  // Render mode: 'image' (server-rendered PNG), 'native' (client-rendered), or 'hybrid'
  renderMode: 'image',
  
  // How often to refresh (milliseconds)
  refreshInterval: 60000,
  
  // Configuration options (shown in Widget Factory)
  configSchema: {
    message: {
      type: 'string',
      label: 'Message',
      default: 'Hello World'
    }
  },
  
  // Style options (shown when widget is placed in a cast)
  styleSchema: {
    backgroundColor: {
      type: 'color',
      label: 'Background',
      default: 'transparent',
      group: 'Background'
    },
    textColor: {
      type: 'color',
      label: 'Text Color',
      default: '#ffffff',
      group: 'Typography'
    },
    fontSize: {
      type: 'slider',
      label: 'Font Size',
      min: 12,
      max: 120,
      default: 24,
      group: 'Typography'
    }
  },
  
  // Render function - called on each refresh
  async render({ config, styles, api }) {
    return {
      type: 'box',
      background: styles.backgroundColor,
      padding: 16,
      children: [{
        type: 'text',
        content: config.message,
        style: {
          color: styles.textColor,
          fontSize: styles.fontSize
        }
      }]
    };
  }
};`;
  }
}

export default WidgetRegistry;
