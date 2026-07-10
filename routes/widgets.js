/**
 * Widget Routes - Widget library, execution, and protocol endpoints
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */
import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/Logger.js';

export default function createWidgetRoutes(deps) {
  const {
    widgetRegistry,
    widgetRuntime,
    widgetResolver,
    widgetProviderRegistry,
    widgetCache,
    widgetSecrets,
    widgetImageRenderer,
    widgetEventStore,
    spriteSheetGenerator,
    api,
    logger: log,
    eventBus,
  } = deps;

  // Backend debug logging helper - broadcasts debug events via WebSocket
  async function emitBackendDebugEvent(ctx, category, action, data = {}) {
    try {
      // Check if debug mode is enabled by checking the setting
      const debugSetting = await ctx.data.slidecast_settings.findOne({ key: 'debug_mode_enabled' }).catch(() => null);
      if (debugSetting?.value === 'true' || debugSetting?.value === true) {
        ctx.broadcast('debug:event', {
          id: `be-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: new Date().toISOString(),
          extension: 'slidecast',
          category,
          action,
          source: 'backend',
          data,
        });
      }
    } catch (e) {
      // Ignore debug logging errors
    }
  }

  /**
   * Parse a .widget ZIP file into import data
   */
  async function parseWidgetZip(buffer) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    // Read manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid .widget file: missing manifest.json');
    }
    const manifest = JSON.parse(await manifestFile.async('string'));

    // Read code files
    const files = {};
    for (const filename of ['server.js', 'client.js', 'template.html', 'code.js']) {
      const file = zip.file(filename);
      if (file) {
        files[filename] = await file.async('string');
      }
    }

    // Read assets
    const assets = [];
    const assetsFolder = zip.folder('assets');
    if (assetsFolder) {
      const assetFiles = [];
      assetsFolder.forEach((relativePath, file) => {
        if (!file.dir) {
          assetFiles.push({ relativePath, file });
        }
      });

      for (const { relativePath, file } of assetFiles) {
        const data = await file.async('nodebuffer');
        // Determine MIME type from extension
        const ext = relativePath.split('.').pop().toLowerCase();
        const mimeTypes = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          webp: 'image/webp',
          mp4: 'video/mp4',
          webm: 'video/webm',
        };
        assets.push({
          filename: relativePath,
          mimeType: mimeTypes[ext] || 'application/octet-stream',
          size: data.length,
          data,
        });
      }
    }

    // Read DB data
    let dbData = null;
    const dataFolder = zip.folder('data');
    if (dataFolder) {
      dbData = {};
      const dataFiles = [];
      dataFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.endsWith('.json')) {
          dataFiles.push({ relativePath, file });
        }
      });

      for (const { relativePath, file } of dataFiles) {
        const tableName = relativePath.replace('.json', '');
        const content = await file.async('string');
        dbData[tableName] = JSON.parse(content);
      }
    }

    return {
      manifest, files, assets, dbData,
    };
  }

  // Helper to infer MIME type from filename
  function inferMimeType(filename, storedMimeType) {
    if (storedMimeType) return storedMimeType;
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Shape extension-provided widgets (from the WidgetProviderRegistry) into the
   * SAME object shape the studio picker expects for a DB widget, so the picker
   * and placement path render/place them without special-casing. The colon in
   * the uuid ("<provider>:<type>") guarantees it never collides with a DB uuid.
   */
  function getProviderWidgets(filters = {}) {
    if (!widgetProviderRegistry || typeof widgetProviderRegistry.getAll !== 'function') {
      return [];
    }
    let providerWidgets;
    try {
      providerWidgets = widgetProviderRegistry.getAll() || [];
    } catch {
      return [];
    }

    return providerWidgets
      .map((w) => ({
        // uuid = "<provider>:<type>" — placing it sets element.widgetUuid to the
        // provider id, which WidgetResolver + the render pipeline already handle.
        id: `${w.provider}:${w.type}`,
        uuid: `${w.provider}:${w.type}`,
        name: w.name || w.type,
        description: w.description || '',
        category: 'integration',
        renderMode: w.renderMode || 'image',
        code: '',
        serverCode: '',
        clientCode: '',
        htmlTemplate: '',
        serverLanguage: 'nodejs',
        configSchema: w.configSchema || {},
        styleSchema: w.styleSchema || {},
        tableSchema: null,
        defaultSize: w.defaultSize || { width: 300, height: 150 },
        previewPrimitives: {},
        refreshInterval: typeof w.refreshInterval === 'number' ? w.refreshInterval : 60000,
        interactions: Array.isArray(w.interactions) ? w.interactions : [],
        supportsAnimation: false,
        isSystem: false,
        isPublished: true,
        currentVersion: 1,
        createdAt: null,
        updatedAt: null,
        // Provenance so the UI can label extension-provided widgets.
        source: 'provider',
        provider: w.provider,
      }))
      .filter((w) => {
        if (filters.category && w.category !== filters.category) return false;
        // Provider widgets are always "published" and never "system".
        if (filters.isSystem === true) return false;
        return true;
      });
  }

  // ==================== ROUTE DEFINITIONS ====================

  return {
    // ==================== WIDGET LIBRARY ====================

    // List all widgets
    'GET /widgets': async (ctx) => {
      const filters = {};
      if (ctx.query.category) filters.category = ctx.query.category;
      if (ctx.query.published === 'true') filters.isPublished = true;
      if (ctx.query.system === 'true') filters.isSystem = true;
      if (ctx.query.system === 'false') filters.isSystem = false;

      const widgets = await widgetRegistry.getAll(filters);
      // Also surface extension-provided widgets from the provider registry so
      // they appear in the studio picker alongside user-authored DB widgets.
      const providerWidgets = getProviderWidgets(filters);
      return { success: true, widgets: [...widgets, ...providerWidgets] };
    },

    // Get single widget
    'GET /widgets/:uuid': async (ctx) => {
      const widget = await widgetRegistry.getByUuid(ctx.params.uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }
      return { success: true, widget };
    },

    // Create widget
    'POST /widgets': async (ctx) => {
      const widget = await widgetRegistry.create(ctx.body);
      return { success: true, widget };
    },

    // Update widget
    'PUT /widgets/:uuid': async (ctx) => {
      const widget = await widgetRegistry.update(ctx.params.uuid, ctx.body);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }
      // Invalidate cache when widget is updated
      await widgetCache.invalidateWidget(ctx.params.uuid);

      // Emit widget:definition_changed so WidgetRefreshService (#1202) can
      // reconcile per-instance micro-jobs when refreshInterval or other
      // widget-definition fields change. Without this emit, per-widget
      // interval edits are silently ignored by the refresh service.
      if (eventBus) {
        try {
          eventBus.emit('widget:definition_changed', {
            widgetUuid: ctx.params.uuid,
            refreshInterval: widget?.refreshInterval,
          });
        } catch { /* event bus failures must not break updates */ }
      }

      // Regenerate thumbnail in background (don't block the response)
      // This ensures the thumbnail stays up-to-date with code changes
      widgetRegistry.regenerateThumbnail(ctx.params.uuid).catch((err) => {
        console.log(`[Slidecast] Background thumbnail regeneration failed for ${ctx.params.uuid}:`, err.message);
      });

      return { success: true, widget };
    },

    // Publish widget
    'POST /widgets/:uuid/publish': async (ctx) => {
      const widget = await widgetRegistry.publish(ctx.params.uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }
      return { success: true, widget };
    },

    // Regenerate widget thumbnail
    'POST /widgets/:uuid/thumbnail': async (ctx) => {
      const thumbnail = await widgetRegistry.regenerateThumbnail(ctx.params.uuid);
      if (!thumbnail) {
        return { success: false, error: 'Failed to generate thumbnail', status: 400 };
      }
      return { success: true, thumbnail };
    },

    // Regenerate ALL widget thumbnails (useful after seeding)
    'POST /widgets/thumbnails/regenerate-all': async (ctx) => {
      const widgets = await widgetRegistry.getAll({});
      const results = { success: 0, failed: 0, errors: [] };

      for (const widget of widgets) {
        try {
          const thumbnail = await widgetRegistry.regenerateThumbnail(widget.uuid);
          if (thumbnail) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push({ widget: widget.name, error: 'No thumbnail generated' });
          }
        } catch (err) {
          results.failed++;
          results.errors.push({ widget: widget.name, error: err.message });
        }
      }

      return {
        success: true,
        message: `Regenerated ${results.success} thumbnails, ${results.failed} failed`,
        results,
      };
    },

    // Duplicate widget
    'POST /widgets/:uuid/duplicate': async (ctx) => {
      const widget = await widgetRegistry.duplicate(ctx.params.uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }
      return { success: true, widget };
    },

    // Delete all widgets (for cleanup/reset)
    'DELETE /widgets': async (ctx) => {
      const widgets = await widgetRegistry.getAll();
      let deleted = 0;
      for (const widget of widgets) {
        const success = await widgetRegistry.delete(widget.uuid);
        if (success) {
          await widgetCache.invalidateWidget(widget.uuid);
          deleted++;
        }
      }
      return { success: true, deleted, message: `Deleted ${deleted} widget(s)` };
    },

    // Delete widget
    'DELETE /widgets/:uuid': async (ctx) => {
      const success = await widgetRegistry.delete(ctx.params.uuid);
      if (!success) {
        return { success: false, error: 'Cannot delete widget', status: 400 };
      }
      // Clean up cache
      await widgetCache.invalidateWidget(ctx.params.uuid);
      return { success: true };
    },

    // Export widget as JSON (legacy, for backwards compatibility)
    'GET /widgets/:uuid/export': async (ctx) => {
      const includeDbData = ctx.query.includeDb === 'true';
      const tables = ctx.query.tables ? ctx.query.tables.split(',') : null;

      const exportData = await widgetRegistry.export(ctx.params.uuid, { includeDbData, tables });
      if (!exportData) {
        return { success: false, error: 'Widget not found', status: 404 };
      }
      return { success: true, export: exportData };
    },

    // Export widget as .widget ZIP file
    'GET /widgets/:uuid/export.widget [stream]': async (ctx) => {
      const includeDbData = ctx.query.includeDb === 'true';
      const tables = ctx.query.tables ? ctx.query.tables.split(',') : null;

      const exportData = await widgetRegistry.export(ctx.params.uuid, { includeDbData, tables });
      if (!exportData) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      const {
        manifest, files, assets, dbData,
      } = exportData;

      // Create ZIP using JSZip (no external dependency)
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add manifest.json
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // Add code files
      for (const [filename, content] of Object.entries(files)) {
        zip.file(filename, content);
      }

      // Add assets - handle IPC serialization of binary data
      const assetsFolder = zip.folder('assets');
      for (const asset of assets) {
        let { data } = asset;

        // Handle IPC serialization: BLOB data can come as JSON string from worker threads
        // Step 1: If data is a string (double-serialized JSON), parse it first
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {
            // Not JSON, keep as-is
          }
        }

        // Step 2: Convert serialized object formats to Buffer
        if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
          if (data.type === 'Buffer' && Array.isArray(data.data)) {
            // Standard Buffer serialization: {type:'Buffer', data:[...]}
            data = Buffer.from(data.data);
          } else if ('0' in data && !Array.isArray(data)) {
            // Indexed object serialization: {"0":137,"1":80,...}
            const keys = Object.keys(data).filter((k) => /^\d+$/.test(k));
            const values = keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((k) => data[k]);
            data = Buffer.from(values);
          }
        }

        assetsFolder.file(asset.filename, data);
      }

      // Add DB data if included
      if (dbData) {
        const dataFolder = zip.folder('data');
        for (const [tableName, rows] of Object.entries(dbData)) {
          dataFolder.file(`${tableName}.json`, JSON.stringify(rows, null, 2));
        }
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const safeName = manifest.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const filename = `${safeName}-v${manifest.version}.widget`;

      // Write to temp file to avoid worker IPC serialization corruption
      const tempPath = `/tmp/widget-export-${Date.now()}-${Math.random().toString(36).slice(2)}.widget`;
      await fs.writeFile(tempPath, zipBuffer);

      logger.info(`Export: wrote ${zipBuffer.length} bytes to ${tempPath}`);

      // Use __file pattern to stream from disk (avoids binary corruption in worker IPC)
      return {
        __file: true,
        path: tempPath,
        contentType: 'application/zip',
        contentLength: zipBuffer.length, // Tell browser exact size
        filename,
        attachment: true, // Force download instead of inline display
        deleteAfter: true, // Clean up temp file after download
      };
    },

    // Import widget (supports both JSON and .widget ZIP via file upload)
    'POST /widgets/import [upload]': async (ctx) => {
      try {
        let importData;

        // Check if it's a file upload (multipart form) — multer uses
        // memoryStorage, so the file arrives as a buffer, not a disk path.
        if (ctx.file && ctx.file.buffer) {
          const fileBuffer = Buffer.isBuffer(ctx.file.buffer)
            ? ctx.file.buffer
            : Buffer.from(ctx.file.buffer);
          const filename = ctx.file.originalname || '';

          // Check if it's a .widget ZIP file
          if (filename.endsWith('.widget') || filename.endsWith('.zip')) {
            // Parse ZIP file
            importData = await parseWidgetZip(fileBuffer);
          } else {
            // Assume JSON file
            importData = JSON.parse(fileBuffer.toString('utf-8'));
          }
        } else if (ctx.body && ctx.body.data) {
          // JSON body (legacy)
          importData = ctx.body.data;
        } else if (ctx.body && ctx.body.manifest) {
          // Direct JSON with manifest (new format)
          importData = ctx.body;
        } else {
          return { success: false, error: 'No import data provided', status: 400 };
        }

        const widget = await widgetRegistry.import(importData);
        return { success: true, widget };
      } catch (error) {
        logger.error(`Widget import error: ${error.message}`);
        return { success: false, error: error.message, status: 400 };
      }
    },

    // ==================== WIDGET VERSIONS ====================

    // Get version history
    'GET /widgets/:uuid/versions': async (ctx) => {
      const versions = await widgetRegistry.getVersions(ctx.params.uuid);
      return { success: true, versions };
    },

    // Restore version
    'POST /widgets/:uuid/versions/:version/restore': async (ctx) => {
      const widget = await widgetRegistry.restoreVersion(ctx.params.uuid, parseInt(ctx.params.version, 10));
      if (!widget) {
        return { success: false, error: 'Version not found', status: 404 };
      }
      await widgetCache.invalidateWidget(ctx.params.uuid);
      return { success: true, widget };
    },

    // ==================== WIDGET SECRETS ====================

    // List secrets (names only, not values)
    'GET /widgets/:uuid/secrets': async (ctx) => {
      const secrets = await widgetSecrets.list(ctx.params.uuid);
      return { success: true, secrets };
    },

    // Set secret
    'POST /widgets/:uuid/secrets': async (ctx) => {
      if (!ctx.body.keyName || !ctx.body.value) {
        return { success: false, error: 'keyName and value required', status: 400 };
      }
      await widgetSecrets.set(ctx.params.uuid, ctx.body.keyName, ctx.body.value);
      return { success: true };
    },

    // Delete secret
    'DELETE /widgets/:uuid/secrets/:keyName': async (ctx) => {
      const success = await widgetSecrets.delete(ctx.params.uuid, ctx.params.keyName);
      return { success };
    },

    // ==================== WIDGET ASSETS ====================

    // List widget assets
    'GET /widgets/:uuid/assets': async (ctx) => {
      try {
        const model = api.model('slidecast_widget_assets');
        const assets = await model.findAll({
          where: { widget_uuid: ctx.params.uuid },
        });

        return {
          success: true,
          assets: assets.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: inferMimeType(a.filename, a.mime_type),
            size: a.size,
            createdAt: a.created_at,
          })),
        };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Get single asset (binary)
    'GET /widgets/:uuid/assets/:filename [stream]': async (ctx) => {
      try {
        const model = api.model('slidecast_widget_assets');
        const filename = decodeURIComponent(ctx.params.filename);
        const asset = await model.findOne({
          where: {
            widget_uuid: ctx.params.uuid,
            filename,
          },
        });

        if (!asset) {
          return { success: false, error: 'Asset not found', status: 404 };
        }

        // Get MIME type - handle both camelCase and snake_case from DB
        // Also infer from filename if not stored
        let mimeType = asset.mimeType || asset.mime_type;
        if (!mimeType) {
          mimeType = inferMimeType(filename);
        }

        // Return raw binary data with correct content type
        return {
          __raw: true,
          contentType: mimeType,
          data: asset.data,
        };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Upload asset (multipart form data)
    'POST /widgets/:uuid/assets [upload]': async (ctx) => {
      try {
        if (!ctx.file) {
          return { success: false, error: 'No file uploaded', status: 400 };
        }

        const { file } = ctx;
        const filename = file.originalname || file.name;
        const mimeType = file.mimetype || file.type || 'application/octet-stream';
        const data = file.buffer || file.data;

        // Check if asset already exists
        const model = api.model('slidecast_widget_assets');
        const existing = await model.findOne({
          where: { widget_uuid: ctx.params.uuid, filename },
        });

        if (existing) {
          // Update existing asset
          await model.update(existing.id, {
            data,
            mime_type: mimeType,
            size: data.length,
          });
          return { success: true, updated: true, filename };
        }

        // Create new asset
        await model.create({
          widget_uuid: ctx.params.uuid,
          filename,
          mime_type: mimeType,
          size: data.length,
          data,
        });

        return { success: true, created: true, filename };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Delete asset
    'DELETE /widgets/:uuid/assets/:filename': async (ctx) => {
      try {
        const model = api.model('slidecast_widget_assets');
        const asset = await model.findOne({
          where: {
            widget_uuid: ctx.params.uuid,
            filename: decodeURIComponent(ctx.params.filename),
          },
        });

        if (!asset) {
          return { success: false, error: 'Asset not found', status: 404 };
        }

        await model.delete(asset.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // ==================== WIDGET PREVIEW/EXECUTION ====================

    // Execute widget for preview (returns primitives + debug info)
    // Supports forceImage: true to show image URL (what Roku/devices would hit)
    // Supports code overrides in body for previewing unsaved changes
    'POST /widgets/:uuid/preview': async (ctx) => {
      const savedWidget = await widgetRegistry.getByUuid(ctx.params.uuid);
      if (!savedWidget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      // Allow unsaved code to override saved widget code for live preview
      const widget = {
        ...savedWidget,
        serverCode: ctx.body.serverCode ?? savedWidget.serverCode,
        clientCode: ctx.body.clientCode ?? savedWidget.clientCode,
        htmlTemplate: ctx.body.htmlTemplate ?? savedWidget.htmlTemplate,
        code: ctx.body.code ?? savedWidget.code,
      };

      const result = await widgetRuntime.executeForPreview(
        widget,
        ctx.body.config || {},
        ctx.body.styles || {},
      );

      // Build the dynamic image URL that Roku/devices will hit
      // This URL generates images on-demand - same endpoint used everywhere
      const width = ctx.body.size?.width || widget.defaultSize?.width || 300;
      const height = ctx.body.size?.height || widget.defaultSize?.height || 150;
      const config = ctx.body.config || {};
      const styles = ctx.body.styles || {};

      // Build the dynamic image URL (add nocache for preview/development)
      const imageUrl = `/api/extensions/slidecast/protocol/widget/${widget.uuid}/image.png?`
        + `config=${encodeURIComponent(JSON.stringify(config))}`
        + `&styles=${encodeURIComponent(JSON.stringify(styles))}`
        + `&width=${width}&height=${height}&nocache=true`;

      // Determine effective render mode for preview
      // For hybrid widgets, use forceImage flag to determine mode
      // For image/native widgets, use their configured mode
      const effectiveRenderMode = ctx.body.forceImage ? 'image'
        : (widget.renderMode === 'hybrid' ? 'native' : (widget.renderMode || 'native'));

      // Include image URL if forcing image mode OR widget is in image-only mode
      if (ctx.body.forceImage || widget.renderMode === 'image') {
        logger.debug(`Preview with image URL for widget ${widget.name}: ${imageUrl}`);

        // Actually test image rendering to catch errors early (show in debug panel)
        let forceImageError = null;
        if (result.primitives && result.primitives.length > 0) {
          try {
            // Test render to catch Satori/Sharp errors before user hits the URL
            await widgetImageRenderer.render(result.primitives, {
              width,
              height,
              format: 'png',
              scale: 1,
            });
          } catch (renderError) {
            forceImageError = `Image rendering failed: ${renderError.message}`;
            logger.error(`Widget image render test failed: ${widget.name} - ${renderError.message}`);
          }
        }

        return {
          success: true,
          ...result,
          renderMode: effectiveRenderMode,
          forceImagePreview: ctx.body.forceImage || false,
          forceImageError,
          imageUrl,
          originalRenderMode: widget.renderMode,
        };
      }

      // For native or hybrid-as-native, return primitives without image URL
      return {
        success: true,
        ...result,
        renderMode: effectiveRenderMode,
        originalRenderMode: widget.renderMode,
      };
    },

    // Validate widget code (supports both legacy and multi-file)
    'POST /widgets/validate': async (ctx) => {
      // Support both single code and multi-file validation
      if (ctx.body.serverCode !== undefined || ctx.body.clientCode !== undefined || ctx.body.htmlTemplate !== undefined) {
        // Multi-file validation
        const validation = widgetRuntime.validateWidget({
          serverCode: ctx.body.serverCode,
          clientCode: ctx.body.clientCode,
          htmlTemplate: ctx.body.htmlTemplate,
          code: ctx.body.code,
        });
        return { success: true, ...validation };
      }
      // Legacy single code validation
      const validation = widgetRuntime.validateCode(ctx.body.code || '', 'legacy');
      return { success: true, ...validation };
    },

    // ==================== WIDGET RENDERING (PROTOCOL) ====================

    // Render widget via POST (for Studio "Run Widget" button)
    // Returns primitives + dynamic image URL (no static file generation)
    'POST /protocol/widget/:uuid/render [public]': async (ctx) => {
      const startTime = Date.now();
      const id = ctx.params.uuid;

      // Extension-provided widget ("<provider>:<type>") — resolve + produce via
      // the unified contract. DB widgets keep the existing path below unchanged
      // (zero regression). This is the same route the slide render prefetch
      // (SlideImageRenderer.renderSlide) and the render-element self-heal fetch,
      // so making it resolver-aware is what lets provider widgets rasterize.
      if (widgetResolver && typeof id === 'string' && id.includes(':')) {
        const resolved = await widgetResolver.resolve(id);
        if (!resolved) return { success: false, error: 'Widget not found', status: 404 };
        const config = ctx.body.config || {};
        const styles = ctx.body.styles || {};
        const width = ctx.body.size?.width || resolved.defaultSize?.width || 300;
        const height = ctx.body.size?.height || resolved.defaultSize?.height || 150;
        try {
          const produced = await resolved.produce({ config, styles, size: { width, height } });
          return {
            success: true,
            primitives: produced.primitives || {},
            renderMode: resolved.renderMode,
            refreshInterval: resolved.refreshInterval,
            duration: Date.now() - startTime,
          };
        } catch (err) {
          return { success: false, error: err.message, status: 500 };
        }
      }

      const widget = await widgetRegistry.getByUuid(ctx.params.uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      emitBackendDebugEvent(ctx, 'widget.server', 'execute.start', {
        uuid: ctx.params.uuid,
        name: widget.name,
        renderMode: widget.renderMode,
      });

      // Parse config and styles from body
      const config = ctx.body.config || {};
      const styles = ctx.body.styles || {};
      const width = ctx.body.size?.width || widget.defaultSize?.width || 300;
      const height = ctx.body.size?.height || widget.defaultSize?.height || 150;

      // Execute widget to get primitives
      const result = await widgetRuntime.execute(widget, config, styles);
      if (!result.success) {
        emitBackendDebugEvent(ctx, 'widget.server', 'execute.error', {
          uuid: ctx.params.uuid,
          name: widget.name,
          error: result.error,
          duration: Date.now() - startTime,
        });
        return { success: false, error: result.error, status: 500 };
      }

      const duration = Date.now() - startTime;

      emitBackendDebugEvent(ctx, 'widget.server', 'execute.complete', {
        uuid: ctx.params.uuid,
        name: widget.name,
        renderMode: widget.renderMode,
        duration,
      });

      // Build dynamic image URL (for image/hybrid modes)
      const imageUrl = `/api/extensions/slidecast/protocol/widget/${widget.uuid}/image.png?`
        + `config=${encodeURIComponent(JSON.stringify(config))}`
        + `&styles=${encodeURIComponent(JSON.stringify(styles))}`
        + `&width=${width}&height=${height}`;

      // Determine effective render mode for client-side rendering
      const effectiveRenderMode = ctx.body.forceImage ? 'image'
        : (widget.renderMode === 'hybrid' ? 'native' : (widget.renderMode || 'native'));

      // Return primitives + image URL for all modes
      return {
        success: true,
        renderMode: effectiveRenderMode,
        originalRenderMode: widget.renderMode,
        primitives: result.primitives,
        imageUrl: (widget.renderMode === 'image' || widget.renderMode === 'hybrid') ? imageUrl : undefined,
        refreshInterval: widget.refreshInterval,
        duration,
      };
    },

    // =============================================================================
    // WIDGET IMAGE ENDPOINT - Returns actual PNG bytes (what Roku/devices hit)
    // =============================================================================
    'GET /protocol/widget/:uuid/image.png [public] [stream]': async (ctx) => {
      const startTime = Date.now();

      const widget = await widgetRegistry.getByUuid(ctx.params.uuid);
      if (!widget) {
        ctx.res.setHeader('Content-Type', 'application/json');
        return { success: false, error: 'Widget not found', status: 404 };
      }

      // Parse config and styles from query params
      let config = {};
      let styles = {};
      try {
        if (ctx.query.config) config = JSON.parse(ctx.query.config);
        if (ctx.query.styles) styles = JSON.parse(ctx.query.styles);
      } catch (parseError) {
        logger.warn(`Widget image request - invalid JSON in query params: ${parseError.message}`);
      }

      const width = parseInt(ctx.query.width, 10) || widget.defaultSize?.width || 300;
      const height = parseInt(ctx.query.height, 10) || widget.defaultSize?.height || 150;
      const format = ctx.query.format || 'png';
      const scale = parseInt(ctx.query.scale, 10) || 1;

      // Generate cache key based on widget + config + styles + size + scale
      const cacheKey = JSON.stringify({
        uuid: ctx.params.uuid,
        config,
        styles,
        width,
        height,
        scale,
        // Add time bucket for refresh interval (cache invalidation)
        _t: Math.floor(Date.now() / (widget.refreshInterval || 60000)),
      });

      // Check cache first - cache stores files on disk (skip if nocache=true)
      const skipCache = ctx.query.nocache === 'true' || ctx.query.nocache === '1';
      if (!skipCache) {
        const cached = await widgetCache.get(ctx.params.uuid, config, styles, cacheKey);
        if (cached?.filePath) {
          logger.debug(`Widget image cache hit: ${widget.name}`);
          ctx.res.setHeader('Cache-Control', `public, max-age=${Math.floor((widget.refreshInterval || 60000) / 1000)}`);
          ctx.res.setHeader('X-Widget-Cached', 'true');
          ctx.res.setHeader('X-Widget-Name', widget.name);
          // Use __file pattern to stream from disk (bypasses worker IPC buffer serialization issue)
          return {
            __file: true,
            path: cached.filePath,
            contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
          };
        }
      } else {
        logger.info(`Widget image cache bypassed: ${widget.name}`);
      }

      // Execute widget to get primitives
      const result = await widgetRuntime.execute(widget, config, styles);

      if (!result.success) {
        logger.error(`Widget execution failed: ${widget.name} - ${result.error}`);
        ctx.res.setHeader('Content-Type', 'application/json');
        return { success: false, error: result.error, status: 500 };
      }

      if (!result.primitives || result.primitives.length === 0) {
        logger.warn(`Widget returned no primitives: ${widget.name}`);
        ctx.res.setHeader('Content-Type', 'application/json');
        return { success: false, error: 'Widget returned no render primitives', status: 500 };
      }

      // Render primitives to image and cache to file
      try {
        const imageResult = await widgetImageRenderer.renderToFile(result.primitives, {
          width,
          height,
          format,
          scale,
        });

        // Cache stores the file path for future requests
        await widgetCache.set(ctx.params.uuid, config, styles, cacheKey, imageResult.buffer, {
          ttl: widget.refreshInterval || 60000,
          format,
        });

        const duration = Date.now() - startTime;
        logger.debug(`Widget image rendered: ${widget.name} (${width}x${height}, ${imageResult.size} bytes, ${duration}ms)`);

        // Return file path for streaming (bypasses worker IPC buffer serialization issue)
        ctx.res.setHeader('Cache-Control', `public, max-age=${Math.floor((widget.refreshInterval || 60000) / 1000)}`);
        ctx.res.setHeader('X-Widget-Cached', 'false');
        ctx.res.setHeader('X-Widget-Name', widget.name);
        ctx.res.setHeader('X-Widget-Render-Time', `${duration}ms`);
        return {
          __file: true,
          path: imageResult.filePath,
          contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        };
      } catch (error) {
        logger.error(`Widget image render failed: ${widget.name} - ${error.message}`);
        ctx.res.setHeader('Content-Type', 'application/json');
        return { success: false, error: `Image rendering failed: ${error.message}`, status: 500 };
      }
    },

    // Legacy endpoint - redirects to new image.png endpoint (for backwards compatibility)
    'GET /protocol/widget/:uuid/render [public] [stream]': async (ctx) => {
      // Build the new URL with same query params
      const queryString = Object.entries(ctx.query)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
      const newUrl = `/api/extensions/slidecast/protocol/widget/${ctx.params.uuid}/image.png${queryString ? `?${queryString}` : ''}`;

      // Return JSON with the correct URL for clients that expect JSON
      return {
        success: true,
        message: 'Use the image.png endpoint for direct image bytes',
        imageUrl: newUrl,
        deprecated: true,
      };
    },

    // Legacy static file endpoint - keep for backwards compatibility but log deprecation
    'GET /protocol/widget-image/:filename [public] [stream]': async (ctx) => {
      logger.warn(`Deprecated widget-image endpoint hit: ${ctx.params.filename}`);
      const filePath = path.join(process.env.DATA_DIR || '/app/data', 'slidecast/widget-renders', path.basename(ctx.params.filename));

      try {
        const buffer = await fs.readFile(filePath);
        const contentType = ctx.params.filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

        ctx.res.setHeader('Cache-Control', 'public, max-age=60');
        ctx.res.setHeader('X-Deprecated', 'true');
        return { __raw: true, contentType, data: buffer };
      } catch (error) {
        return { success: false, error: 'Image not found', status: 404 };
      }
    },

    // ==================== WIDGET CATEGORIES & FONTS ====================

    // Get widget categories
    'GET /widgets/meta/categories': async (ctx) => {
      // Widget categories - widgets can tag themselves with these
      const WIDGET_CATEGORIES = [
        {
          id: 'time', name: 'Time & Date', icon: '\u23F0', description: 'Clocks, dates, timers, countdowns',
        },
        {
          id: 'weather', name: 'Weather', icon: '\uD83C\uDF24\uFE0F', description: 'Weather conditions and forecasts',
        },
        {
          id: 'content', name: 'Content', icon: '\u2728', description: 'Text, quotes, and styled content',
        },
        {
          id: 'info', name: 'Information', icon: '\u2139\uFE0F', description: 'Entity states, status displays',
        },
        {
          id: 'data', name: 'Data Display', icon: '\uD83D\uDCCA', description: 'Stats, metrics, integrations',
        },
        {
          id: 'media', name: 'Media', icon: '\uD83D\uDDBC\uFE0F', description: 'Images, videos, galleries',
        },
        {
          id: 'social', name: 'Social', icon: '\uD83D\uDCAC', description: 'Social media feeds, comments',
        },
        {
          id: 'custom', name: 'Custom', icon: '\uD83D\uDD27', description: 'User-created widgets',
        },
      ];
      return { success: true, categories: WIDGET_CATEGORIES };
    },

    // Get available fonts
    'GET /widgets/meta/fonts': async (ctx) => {
      const { NATIVE_FONTS, FONT_CATEGORIES, DEFAULT_FONTS } = await import('../widgets/WidgetFonts.js');
      return {
        success: true,
        fonts: NATIVE_FONTS,
        categories: FONT_CATEGORIES,
        defaults: DEFAULT_FONTS,
      };
    },

    // ==================== WIDGET CACHE ====================

    // Get cache stats
    'GET /widgets/cache/stats': async (ctx) => {
      const stats = await widgetCache.getStats();
      return { success: true, stats };
    },

    // Clear cache
    'DELETE /widgets/cache': async (ctx) => {
      const cleared = await widgetCache.clear();
      return { success: true, cleared };
    },

    // ==================== RELAY PROTOCOL ENDPOINTS ====================

    /**
     * Get widget bundle for Relay
     * Returns everything needed to render a widget, with cache headers
     */
    'GET /protocol/widget/:uuid/bundle [public]': async (ctx) => {
      const widget = await widgetRegistry.getByUuid(ctx.params.uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      // Parse config and styles from query (base64 encoded for URL safety)
      let config = {};
      let styles = {};
      try {
        if (ctx.query.config) config = JSON.parse(Buffer.from(ctx.query.config, 'base64').toString('utf8'));
        if (ctx.query.styles) styles = JSON.parse(Buffer.from(ctx.query.styles, 'base64').toString('utf8'));
      } catch (e) {
        // Fallback to regular JSON if not base64
        if (ctx.query.config) config = JSON.parse(ctx.query.config);
        if (ctx.query.styles) styles = JSON.parse(ctx.query.styles);
      }

      const width = parseInt(ctx.query.width, 10) || widget.defaultSize.width;
      const height = parseInt(ctx.query.height, 10) || widget.defaultSize.height;
      const relayId = ctx.query.relay || null;

      // Generate cache key for this specific render
      const cacheKey = widgetCache.generateCacheKey(widget.uuid, config, styles);
      const etag = `"${cacheKey}"`;

      // Check If-None-Match for conditional requests
      if (ctx.req && ctx.req.headers && ctx.req.headers['if-none-match'] === etag) {
        return { _httpStatus: 304 };
      }

      // Calculate cache TTL based on refresh interval
      const cacheTtl = Math.max(widget.refreshInterval, 5000); // Min 5 seconds
      const cacheControl = `public, max-age=${Math.floor(cacheTtl / 1000)}`;

      // Execute widget to get primitives
      const result = await widgetRuntime.execute(widget, config, styles);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          status: 500,
          logs: result.logs,
        };
      }

      // Build response
      const response = {
        success: true,
        widget: {
          uuid: widget.uuid,
          name: widget.name,
          renderMode: widget.renderMode,
          refreshInterval: widget.refreshInterval,
          defaultSize: widget.defaultSize,
        },
        render: {
          mode: widget.renderMode,
          primitives: result.primitives,
          duration: result.duration,
        },
        cache: {
          key: cacheKey,
          etag,
          control: cacheControl,
          expiresAt: new Date(Date.now() + cacheTtl).toISOString(),
        },
      };

      // For image mode, provide the dynamic image URL
      if (widget.renderMode === 'image' || widget.renderMode === 'hybrid') {
        response.render.imageUrl = `/api/extensions/slidecast/protocol/widget/${widget.uuid}/image.png?`
          + `config=${encodeURIComponent(JSON.stringify(config))}`
          + `&styles=${encodeURIComponent(JSON.stringify(styles))}`
          + `&width=${width}&height=${height}`;
      }

      // Log relay access for analytics
      if (relayId) {
        logger.debug(`Relay ${relayId} fetched widget bundle: ${widget.name}`);
      }

      return response;
    },

    /**
     * Get all widgets needed for a cast (bulk endpoint for Relays)
     */
    'GET /protocol/cast/:castId/widgets [public]': async (ctx) => {
      const castManager = deps.api.model ? deps : null;
      // Use the api's model to get the cast since castManager comes from deps
      const cast = await api.model('slidecast_casts').findOne({ where: { uuid: ctx.params.castId } });
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      // Parse definition if it's a string
      const definition = typeof cast.definition === 'string' ? JSON.parse(cast.definition) : cast.definition;

      // Extract all widget UUIDs from cast
      const widgetUuids = new Set();
      const groups = definition?.groups || [];

      for (const group of groups) {
        for (const slide of group.slides || []) {
          for (const element of slide.elements || []) {
            if (element.type === 'widget' && element.widgetUuid) {
              widgetUuids.add(element.widgetUuid);
            }
          }
        }
      }

      // Fetch all widgets
      const widgets = [];
      for (const uuid of widgetUuids) {
        const widget = await widgetRegistry.getByUuid(uuid);
        if (widget) {
          widgets.push({
            uuid: widget.uuid,
            name: widget.name,
            renderMode: widget.renderMode,
            refreshInterval: widget.refreshInterval,
            defaultSize: widget.defaultSize,
            configSchema: widget.configSchema,
            styleSchema: widget.styleSchema,
            code: widget.code, // Relays need code for native rendering
          });
        }
      }

      return {
        success: true,
        castId: ctx.params.castId,
        widgets,
        count: widgets.length,
      };
    },

    /**
     * Relay sync endpoint - get all updates since timestamp
     */
    'GET /protocol/sync/widgets [public]': async (ctx) => {
      const since = ctx.query.since ? new Date(ctx.query.since) : new Date(0);

      // Get widgets updated since the given timestamp
      const allWidgets = await widgetRegistry.getAll({ isPublished: true });
      const updatedWidgets = allWidgets.filter((w) => new Date(w.updatedAt) > since);

      return {
        success: true,
        since: since.toISOString(),
        now: new Date().toISOString(),
        widgets: updatedWidgets.map((w) => ({
          uuid: w.uuid,
          name: w.name,
          updatedAt: w.updatedAt,
          renderMode: w.renderMode,
          refreshInterval: w.refreshInterval,
        })),
        count: updatedWidgets.length,
      };
    },

    // Run style groups migration
    'POST /widgets/migrate/style-groups': async (ctx) => {
      try {
        const { migrate } = await import('../migrations/add-style-groups.js');
        const result = await migrate(api);
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // ==========================================
    // Widget Database/Storage Routes
    // ==========================================

    /**
     * Get all storage entries for a widget
     */
    'GET /widgets/:uuid/storage': async (ctx) => {
      const model = api.model('slidecast_widget_storage');
      const entries = await model.findAll({
        where: { widget_uuid: ctx.params.uuid },
        orderBy: 'key ASC',
      });
      return { success: true, entries, count: entries.length };
    },

    /**
     * Update a storage entry
     */
    'PUT /widgets/:uuid/storage/:id': async (ctx) => {
      const model = api.model('slidecast_widget_storage');
      const entry = await model.findById(ctx.params.id);
      if (!entry || entry.widget_uuid !== ctx.params.uuid) {
        return { success: false, error: 'Storage entry not found', status: 404 };
      }

      const updates = {};
      if (ctx.body.key !== undefined) updates.key = ctx.body.key;
      if (ctx.body.value !== undefined) updates.value = ctx.body.value;
      if (ctx.body.scope !== undefined) updates.scope = ctx.body.scope;
      updates.updated_at = new Date().toISOString();

      await model.update(ctx.params.id, updates);
      const updated = await model.findById(ctx.params.id);
      return { success: true, entry: updated };
    },

    /**
     * Delete a storage entry
     */
    'DELETE /widgets/:uuid/storage/:id': async (ctx) => {
      const model = api.model('slidecast_widget_storage');
      const entry = await model.findById(ctx.params.id);
      if (!entry || entry.widget_uuid !== ctx.params.uuid) {
        return { success: false, error: 'Storage entry not found', status: 404 };
      }
      await model.delete(ctx.params.id);
      return { success: true, message: 'Storage entry deleted' };
    },

    // ============================================
    // Widget Database Tables (api.db) Routes
    // ============================================

    /**
     * Get all rows from a widget-defined table
     */
    'GET /widgets/:uuid/tables/:tableName': async (ctx) => {
      const { uuid, tableName } = ctx.params;

      // Get widget to verify it exists and has the table
      const widget = await widgetRegistry.getByUuid(uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      if (!widget.tableSchema || !widget.tableSchema[tableName]) {
        return { success: false, error: `Table '${tableName}' not defined in widget`, status: 404 };
      }

      try {
        const { default: TableManager } = await import('../widgets/TableManager.js');
        const tableManager = new TableManager(api);
        const rows = await tableManager.getTableData(uuid, tableName);
        return {
          success: true, table: tableName, rows, count: rows.length,
        };
      } catch (err) {
        return { success: false, error: err.message, status: 500 };
      }
    },

    /**
     * Clear all rows from a widget-defined table
     */
    'DELETE /widgets/:uuid/tables/:tableName': async (ctx) => {
      const { uuid, tableName } = ctx.params;

      // Get widget to verify it exists and has the table
      const widget = await widgetRegistry.getByUuid(uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      if (!widget.tableSchema || !widget.tableSchema[tableName]) {
        return { success: false, error: `Table '${tableName}' not defined in widget`, status: 404 };
      }

      try {
        const { default: TableManager } = await import('../widgets/TableManager.js');
        const tableManager = new TableManager(api);
        await tableManager.clearTable(uuid, tableName);
        return { success: true, message: `Cleared table '${tableName}'` };
      } catch (err) {
        return { success: false, error: err.message, status: 500 };
      }
    },

    // ==================== SPRITE SHEET ANIMATION ====================

    /**
     * Get animated widget as sprite sheet
     */
    'GET /protocol/widget/:uuid/sprite [public]': async (ctx) => {
      const { uuid } = ctx.params;

      // Check if sprite sheet generator is available
      if (!spriteSheetGenerator) {
        return {
          success: false,
          error: 'Sprite sheet generation not available',
          fallbackUrl: `/api/extensions/slidecast/protocol/widget/${uuid}/image.png`,
          status: 503,
        };
      }

      // Get widget
      const widget = await widgetRegistry.getByUuid(uuid);
      if (!widget) {
        return { success: false, error: 'Widget not found', status: 404 };
      }

      // Parse config and styles from query
      let config = {};
      let styles = {};

      try {
        if (ctx.query.config) config = JSON.parse(decodeURIComponent(ctx.query.config));
      } catch (e) {
        return { success: false, error: 'Invalid config JSON', status: 400 };
      }

      try {
        if (ctx.query.styles) styles = JSON.parse(decodeURIComponent(ctx.query.styles));
      } catch (e) {
        return { success: false, error: 'Invalid styles JSON', status: 400 };
      }

      // Parse size
      const size = {
        width: parseInt(ctx.query.width, 10) || 200,
        height: parseInt(ctx.query.height, 10) || 200,
      };

      // Parse options
      const options = {
        fps: Math.min(parseInt(ctx.query.fps, 10) || 12, 24),
        frameCount: Math.min(parseInt(ctx.query.frames, 10) || 12, 12),
        loopMode: ctx.query.loop || 'loop',
      };

      // Generate or retrieve sprite sheet
      const result = await spriteSheetGenerator.generate(uuid, config, styles, size, options);

      return {
        success: result.status !== 'error',
        ...result,
      };
    },

    /**
     * Serve sprite sheet PNG file
     */
    'GET /protocol/widget/:uuid/sprite/:spriteKey.png [public] [stream]': async (ctx) => {
      const { uuid, spriteKey } = ctx.params;

      if (!spriteSheetGenerator) {
        return { success: false, error: 'Sprite sheets not available', status: 503 };
      }

      const spritePath = spriteSheetGenerator.getSpriteSheetPath(spriteKey);

      if (!spriteSheetGenerator.spriteExists(spriteKey)) {
        return { success: false, error: 'Sprite sheet not found', status: 404 };
      }

      // Stream the file
      const fsp = await import('fs/promises');
      const stat = await fsp.stat(spritePath);

      return {
        __stream: true,
        path: spritePath,
        contentType: 'image/png',
        start: 0,
        end: stat.size - 1,
        fileSize: stat.size,
        chunkSize: stat.size,
        fullFile: true,
        headers: {
          'Cache-Control': 'public, max-age=86400', // 24 hour cache
        },
      };
    },

    /**
     * Get sprite sheet generation stats
     */
    'GET /widgets/sprites/stats': async (ctx) => {
      if (!spriteSheetGenerator) {
        return { success: false, error: 'Sprite sheets not available', status: 503 };
      }

      const stats = await spriteSheetGenerator.getStats();
      return { success: true, ...stats };
    },
  };
}
