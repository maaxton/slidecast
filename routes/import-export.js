/**
 * Cast Import/Export Routes
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 *
 * Endpoints:
 * - GET /casts/:id/export - Download cast as .cast file
 * - POST /casts/import - Import cast from uploaded .cast file (use [upload] modifier)
 * - POST /casts/import-url - Import cast from URL
 * - GET /casts/:id/export/preview - Export preview (manifest without files)
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from '../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createImportExportRoutes(deps) {
  const {
    castManager, mediaLibrary, widgetRegistry, dataDir, eventBus,
  } = deps;

  // Lazy-load exporter/importer with cache-busting for hot-reload support
  async function loadExporter() {
    const timestamp = Date.now();
    const exporterPath = `${pathToFileURL(path.join(__dirname, '..', 'CastExporter.js')).href}?t=${timestamp}`;
    const { default: CastExporter } = await import(exporterPath);
    return new CastExporter(null, castManager, mediaLibrary, widgetRegistry, { dataDir });
  }

  async function loadImporter() {
    const timestamp = Date.now();
    const importerPath = `${pathToFileURL(path.join(__dirname, '..', 'CastImporter.js')).href}?t=${timestamp}`;
    const { default: CastImporter } = await import(importerPath);
    // #1199: pass eventBus so imports emit cast:definition_changed and
    // WidgetRefreshService reconciles widgets added via zip-import.
    return new CastImporter(null, castManager, mediaLibrary, widgetRegistry, { dataDir, eventBus });
  }

  return {
    // ==================== EXPORT ====================

    /**
     * Export cast as .cast file
     * GET /casts/:id/export
     *
     * Query params:
     * - includeMedia: boolean (default: true)
     * - includeCustomWidgets: boolean (default: true)
     * - includeCache: boolean (default: false)
     */
    'GET /casts/:id/export [stream]': async (ctx) => {
      try {
        const exporter = await loadExporter();

        const options = {
          includeMedia: ctx.query.includeMedia !== 'false',
          includeCustomWidgets: ctx.query.includeCustomWidgets !== 'false',
          includeCache: ctx.query.includeCache === 'true',
        };

        const zipBuffer = await exporter.export(ctx.params.id, options);

        // Get cast name for filename
        const isUuid = ctx.params.id.includes('-');
        const cast = isUuid
          ? await castManager.getByUuid(ctx.params.id)
          : await castManager.getById(ctx.params.id);

        const safeName = (cast?.name || 'cast')
          .replace(/[^a-zA-Z0-9-_]/g, '-')
          .toLowerCase();
        const filename = `${safeName}.cast`;

        // Write to temp file to avoid worker IPC serialization corruption
        const tempPath = `/tmp/cast-export-${Date.now()}-${Math.random().toString(36).slice(2)}.cast`;
        await fs.writeFile(tempPath, zipBuffer);

        logger.info(`Export: wrote ${zipBuffer.length} bytes to ${tempPath}`);

        // Use __file pattern to stream from disk (avoids binary corruption in worker IPC)
        return {
          __file: true,
          path: tempPath,
          contentType: 'application/zip',
          contentLength: zipBuffer.length,
          filename,
          attachment: true, // Force download instead of inline display
          deleteAfter: true, // Clean up temp file after download
        };
      } catch (error) {
        logger.error(`Export failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
          status: error.message.includes('not found') ? 404 : 500,
        };
      }
    },

    // ==================== IMPORT ====================

    /**
     * Import cast from uploaded .cast file
     * POST /casts/import
     *
     * Uses [upload] modifier - extensionRouter handles multer, passes ctx.file
     *
     * Body (multipart form):
     * - file: .cast file
     * - force: boolean (default: false) - Update existing cast if name matches
     * - newName: string (optional) - Override cast name
     * - importWidgets: boolean (default: true) - Import custom widgets
     * - importCache: boolean (default: true) - Import pre-rendered cache
     */
    'POST /casts/import [upload]': async (ctx) => {
      if (!ctx.file) {
        return {
          success: false,
          error: 'No file uploaded',
          status: 400,
        };
      }

      // Validate file extension
      const ext = path.extname(ctx.file.originalname).toLowerCase();
      if (ext !== '.cast' && ext !== '.zip') {
        return {
          success: false,
          error: 'Only .cast files are allowed',
          status: 400,
        };
      }

      try {
        const importer = await loadImporter();

        // Read uploaded file from memory (multer uses memoryStorage — no disk path)
        const zipBuffer = Buffer.isBuffer(ctx.file.buffer)
          ? ctx.file.buffer
          : Buffer.from(ctx.file.buffer);

        const options = {
          force: ctx.body?.force === 'true' || ctx.body?.force === true,
          newName: ctx.body?.newName || null,
          importWidgets: ctx.body?.importWidgets !== 'false',
          importCache: ctx.body?.importCache !== 'false',
        };

        const result = await importer.import(zipBuffer, options);

        return {
          success: true,
          cast: result.cast,
          stats: {
            mediaImported: result.mediaImported,
            mediaReused: result.mediaReused,
            widgetsImported: result.widgetsImported,
            cacheImported: result.cacheImported || 0,
          },
          warnings: result.warnings,
        };
      } catch (error) {
        logger.error(`Import failed: ${error.message}`);

        // Handle dependency errors specially
        if (error.name === 'DependencyError') {
          return {
            success: false,
            error: 'Missing dependencies',
            details: error.errors,
            warnings: error.warnings,
            status: 422,
          };
        }

        return {
          success: false,
          error: error.message,
          status: 500,
        };
      }
    },

    /**
     * Import cast from URL
     * POST /casts/import-url
     *
     * Body:
     * - url: string - URL to .cast file
     * - force: boolean (default: false)
     * - newName: string (optional)
     * - importWidgets: boolean (default: true)
     * - importCache: boolean (default: true)
     */
    'POST /casts/import-url': async (ctx) => {
      if (!ctx.body?.url) {
        return { success: false, error: 'URL is required', status: 400 };
      }

      try {
        const importer = await loadImporter();

        const options = {
          force: ctx.body.force === true,
          newName: ctx.body.newName || null,
          importWidgets: ctx.body.importWidgets !== false,
          importCache: ctx.body.importCache !== false,
        };

        const result = await importer.importFromUrl(ctx.body.url, options);

        return {
          success: true,
          cast: result.cast,
          stats: {
            mediaImported: result.mediaImported,
            mediaReused: result.mediaReused,
            widgetsImported: result.widgetsImported,
            cacheImported: result.cacheImported || 0,
          },
          warnings: result.warnings,
        };
      } catch (error) {
        logger.error(`Import from URL failed: ${error.message}`);

        // Handle dependency errors specially
        if (error.name === 'DependencyError') {
          return {
            success: false,
            error: 'Missing dependencies',
            details: error.errors,
            warnings: error.warnings,
            status: 422,
          };
        }

        return {
          success: false,
          error: error.message,
          status: 500,
        };
      }
    },

    /**
     * Get export preview (manifest without actual files)
     * GET /casts/:id/export/preview
     *
     * Returns what would be exported without creating the ZIP
     */
    'GET /casts/:id/export/preview': async (ctx) => {
      try {
        const exporter = await loadExporter();

        // Get the cast
        const isUuid = ctx.params.id.includes('-');
        const cast = isUuid
          ? await castManager.getByUuid(ctx.params.id)
          : await castManager.getById(ctx.params.id);

        if (!cast) {
          return { success: false, error: 'Cast not found', status: 404 };
        }

        // Parse definition
        const definition = typeof cast.definition === 'string'
          ? JSON.parse(cast.definition)
          : cast.definition;

        // Gather references
        const mediaRefs = await exporter.gatherMedia(definition);
        const widgetRefs = await exporter.gatherWidgets(definition);
        const cacheInfo = await exporter.gatherCache(cast.uuid);

        // Calculate estimated sizes
        const mediaSize = mediaRefs.reduce((sum, m) => sum + (m.size || 0), 0);
        const cacheSize = cacheInfo?.totalSize || 0;
        const estimatedSizeBase = mediaSize + 10000; // Base: media + ~10KB for manifest/definition
        const estimatedSizeWithCache = estimatedSizeBase + cacheSize;

        return {
          success: true,
          preview: {
            cast: {
              name: cast.name,
              uuid: cast.uuid,
            },
            media: mediaRefs.map((m) => ({
              filename: m.filename,
              type: m.type,
              size: m.size,
            })),
            widgets: widgetRefs.map((w) => ({
              name: w.name,
              isSystem: w.isSystem,
              willBeIncluded: !w.isSystem,
            })),
            cache: cacheInfo ? {
              slidesCount: cacheInfo.slides.length,
              totalSize: cacheInfo.totalSize,
              totalSizeFormatted: formatBytes(cacheInfo.totalSize),
            } : null,
            estimatedSize: estimatedSizeBase,
            estimatedSizeFormatted: formatBytes(estimatedSizeBase),
            estimatedSizeWithCache,
            estimatedSizeWithCacheFormatted: formatBytes(estimatedSizeWithCache),
          },
        };
      } catch (error) {
        logger.error(`Export preview failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
          status: 500,
        };
      }
    },
  };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
