/**
 * WidgetLoader - Load SEED widgets from folder structure
 *
 * Seed widgets are bundled in source code and built into the Docker image.
 * They are loaded from the widgets/ folder on extension startup.
 *
 * Seed Widget Lifecycle:
 *   1. Created: Only via Docker build (from widgets/ folder)
 *   2. Updated: Via .widget ZIP upload (same as user widgets)
 *   3. Cannot be deleted (is_system = true)
 *
 * User widgets are created via Widget Factory UI or .widget import.
 *
 * Seed Widget Folder Structure:
 *   widgets/
 *     widget-name/
 *       manifest.json     (required) - Widget metadata, schemas, UUID
 *       client.js         (optional) - Client-side rendering code
 *       server.js         (optional) - Server-side data fetching
 *       template.html     (optional) - HTML template for hybrid rendering
 *       assets/           (optional) - Static assets (images, icons)
 *         icon-sun.svg
 *         background.png
 *         etc.
 *
 * .widget ZIP Format (for updates/sharing):
 *   widget-name.widget (ZIP file)
 *     manifest.json
 *     files/
 *       client.js
 *       server.js
 *       template.html
 *     assets/
 *       icon-sun.svg
 *       etc.
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from '../utils/Logger.js';

/**
 * Load a single widget from a folder
 * @param {string} widgetPath - Path to the widget folder
 * @returns {Object|null} Widget object or null if invalid
 */
export async function loadWidgetFromFolder(widgetPath) {
  const manifestPath = path.join(widgetPath, 'manifest.json');

  try {
    // Read manifest (required)
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Read code files (optional)
    const serverCode = await readFileIfExists(path.join(widgetPath, 'server.js'));
    const clientCode = await readFileIfExists(path.join(widgetPath, 'client.js'));
    const htmlTemplate = await readFileIfExists(path.join(widgetPath, 'template.html'));
    const legacyCode = await readFileIfExists(path.join(widgetPath, 'code.js'));

    // Load assets from assets/ folder
    const assets = await loadWidgetAssets(path.join(widgetPath, 'assets'));

    return {
      uuid: manifest.uuid,
      name: manifest.name,
      description: manifest.description || '',
      category: manifest.category || 'custom',
      render_mode: manifest.renderMode || 'native',
      refreshInterval: manifest.refreshInterval || 60000,
      defaultSize: manifest.defaultSize || { width: 300, height: 150 },
      configSchema: manifest.configSchema || {},
      styleSchema: manifest.styleSchema || {},
      tableSchema: manifest.tables || null,
      previewPrimitives: manifest.previewPrimitives || [],
      supportsAnimation: manifest.supportsAnimation || false,
      serverCode: serverCode || '',
      clientCode: clientCode || legacyCode || '',
      htmlTemplate: htmlTemplate || '',
      assets,
    };
  } catch (err) {
    console.error(`[WidgetLoader] Failed to load widget from ${widgetPath}: ${err.message}`);
    return null;
  }
}

/**
 * Load all widgets from a directory containing widget folders
 * @param {string} widgetsDir - Path to directory containing widget folders
 * @returns {Array} Array of widget objects
 */
export async function loadWidgetsFromDirectory(widgetsDir) {
  const widgets = [];

  if (!existsSync(widgetsDir)) {
    console.log(`[WidgetLoader] Widgets directory does not exist, skipping: ${widgetsDir}`);
    return widgets;
  }

  try {
    const entries = await fs.readdir(widgetsDir, { withFileTypes: true });
    const widgetDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const widgetName of widgetDirs) {
      const widgetPath = path.join(widgetsDir, widgetName);
      const widget = await loadWidgetFromFolder(widgetPath);

      if (widget) {
        const assetInfo = widget.assets.length > 0 ? ` (${widget.assets.length} assets)` : '';
        console.log(`[WidgetLoader] Loaded: ${widgetName}${assetInfo}`);
        widgets.push(widget);
      }
    }
  } catch (err) {
    console.error(`[WidgetLoader] Failed to list directory ${widgetsDir}: ${err.message}`);
  }

  return widgets;
}

/**
 * Load assets from a widget's assets/ folder
 * @param {string} assetsPath - Path to the assets folder
 * @returns {Array} Array of asset objects with filename, mimeType, size, data
 */
export async function loadWidgetAssets(assetsPath) {
  const assets = [];

  try {
    const entries = await fs.readdir(assetsPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());

    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
    };

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (!mimeTypes[ext]) continue; // Skip non-image files

      const filePath = path.join(assetsPath, file.name);
      const data = await fs.readFile(filePath);

      assets.push({
        filename: file.name,
        mimeType: mimeTypes[ext],
        size: data.length,
        data,
      });
    }
  } catch {
    // assets/ folder doesn't exist or is empty - that's fine
  }

  return assets;
}

/**
 * Read a file if it exists, return null otherwise
 */
async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Import assets into database for a widget
 * @param {Object} api - Extension API
 * @param {string} widgetUuid - Widget UUID
 * @param {Array} assets - Array of asset objects
 */
export async function importAssetsToDb(api, widgetUuid, assets) {
  if (!assets || assets.length === 0) return;

  const assetsModel = api.model('slidecast_widget_assets');

  // Clear existing assets for this widget
  try {
    const existingAssets = await assetsModel.findAll({ where: { widget_uuid: widgetUuid } });
    for (const asset of existingAssets) {
      await assetsModel.delete(asset.id);
    }
  } catch (err) {
    logger.warn(`[WidgetLoader] Failed to clear existing assets: ${err.message}`);
  }

  // Import new assets
  for (const asset of assets) {
    try {
      await assetsModel.create({
        widget_uuid: widgetUuid,
        filename: asset.filename,
        mime_type: asset.mimeType,
        size: asset.size,
        data: asset.data,
      });
    } catch (err) {
      logger.warn(`[WidgetLoader] Failed to import asset ${asset.filename}: ${err.message}`);
    }
  }

  logger.debug(`[WidgetLoader] Imported ${assets.length} assets for widget ${widgetUuid}`);
}
