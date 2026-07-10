/**
 * Widget Seeds - Core widgets that ship with Slidecast
 *
 * Seed widgets are:
 *   - Created ONLY via Docker build (from seeds/widgets/ folder)
 *   - Updated via .widget ZIP upload (same as user widgets)
 *   - Cannot be deleted (is_system = true)
 *
 * Seed widgets are defined as .js files in seeds/widgets/ that export
 * a plain config object (uuid, name, description, category, schemas, clientCode, etc.).
 * This seeder imports those files directly and reconciles them into the database.
 *
 * Idempotency contract (BUG-2 fix — platform seed-idempotency reference):
 *   Seeding is CREATE-ONLY for rows that already exist. It NEVER blindly
 *   overwrites an existing widget's code/schema on every init. A re-write only
 *   happens when the seed's OWN content genuinely changed — detected by hashing
 *   the seed-derived content and comparing against a recorded per-widget marker
 *   (stored in slidecast_settings as `seed_widget_hash:<uuid>`). When a re-write
 *   IS warranted it is routed through widgetRegistry.update (NOT a raw
 *   model.update) so clearCache + invalidate + re-render fire. This preserves
 *   runtime/user edits across benign re-seeds while still propagating genuine
 *   seed changes.
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/Logger.js';
import { importAssetsToDb } from '../widgets/WidgetLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to seed widget .js files
const SEED_WIDGETS_DIR = path.resolve(__dirname, 'widgets');

// Settings key prefix for the per-widget seed content-hash marker.
const SEED_HASH_PREFIX = 'seed_widget_hash:';

/**
 * Load all seed widget definitions from seeds/widgets/*.js
 * Each file must export a default object with the widget config.
 */
async function loadSeedWidgets() {
  const widgets = [];
  let entries;
  try {
    entries = await fs.readdir(SEED_WIDGETS_DIR, { withFileTypes: true });
  } catch (err) {
    logger.warn(`[Widget Seeds] Could not read seeds/widgets/ directory: ${err.message}`);
    return widgets;
  }

  const jsFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.js'));

  for (const file of jsFiles) {
    const filePath = path.join(SEED_WIDGETS_DIR, file.name);
    try {
      // Cache-bust the import so hot-reloads pick up file changes.
      // Without this, Node.js ESM cache returns the old module after a deploy.
      const fileUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
      const mod = await import(fileUrl);
      const def = mod.default;
      if (def && def.name) {
        widgets.push(def);
      } else {
        logger.warn(`[Widget Seeds] Skipping ${file.name}: no default export or missing name`);
      }
    } catch (err) {
      logger.warn(`[Widget Seeds] Failed to import ${file.name}: ${err.message}`);
    }
  }

  return widgets;
}

/**
 * Stable content hash of the seed-derived content. `refresh_interval` is
 * excluded on purpose: it is a runtime-tunable field operators override in the
 * DB, so it must NOT participate in "did the seed change?" detection (task
 * #1177). Object key order is deterministic (built from a literal), so
 * JSON.stringify is a stable serialization.
 */
function computeSeedHash(widgetData) {
  const { refresh_interval: _seedRefreshInterval, ...seedContent } = widgetData;
  return crypto.createHash('sha256').update(JSON.stringify(seedContent)).digest('hex');
}

/** Read the recorded seed-content hash marker for a widget UUID (or null). */
async function getSeedMarker(settingsModel, uuid) {
  if (!settingsModel) return null;
  try {
    const rows = await settingsModel.findAll({ where: { key: `${SEED_HASH_PREFIX}${uuid}` } });
    return rows && rows.length > 0 ? rows[0].value : null;
  } catch (err) {
    logger.warn(`[Widget Seeds] Could not read seed marker for ${uuid}: ${err.message}`);
    return null;
  }
}

/** Record (create or update) the seed-content hash marker for a widget UUID. */
async function setSeedMarker(settingsModel, uuid, hash) {
  if (!settingsModel) return;
  try {
    const key = `${SEED_HASH_PREFIX}${uuid}`;
    const rows = await settingsModel.findAll({ where: { key } });
    if (rows && rows.length > 0) {
      await settingsModel.update(rows[0].id, { value: hash, updated_at: new Date().toISOString() });
    } else {
      await settingsModel.create({ key, value: hash });
    }
  } catch (err) {
    logger.warn(`[Widget Seeds] Could not record seed marker for ${uuid}: ${err.message}`);
  }
}

/**
 * Seed core widgets into the database.
 *
 * @param {Object} api - Extension API (api.model('...'))
 * @param {Object} [options]
 * @param {Object} [options.widgetRegistry] - WidgetRegistry instance. Required to
 *   propagate a genuine seed change (routes through registry.update so
 *   clearCache/invalidate/re-render fire). Without it, existing rows are left
 *   untouched — the seeder NEVER blind-overwrites.
 */
export async function seedWidgets(api, options = {}) {
  const { widgetRegistry = null } = options;
  const model = api.model('slidecast_widgets');
  const settingsModel = api.model('slidecast_settings');
  const log = (msg) => logger.debug(`[Widget Seeds] ${msg}`);

  log('Syncing seed widgets from seeds/widgets/*.js...');

  // Load widget definitions directly from .js files
  const SEED_WIDGETS = await loadSeedWidgets();

  if (SEED_WIDGETS.length === 0) {
    log('No widgets found in widgets/ folder', 'warn');
    return { created: 0, updated: 0, unchanged: 0 };
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const widget of SEED_WIDGETS) {
    try {
      // Prepare widget data (DB row shape)
      const widgetData = {
        name: widget.name,
        description: widget.description,
        category: widget.category,
        render_mode: widget.render_mode || 'native',
        code: widget.clientCode || '',
        client_code: widget.clientCode || '',
        server_code: widget.serverCode || '',
        html_template: widget.htmlTemplate || '',
        config_schema: JSON.stringify(widget.configSchema || {}),
        style_schema: JSON.stringify(widget.styleSchema || {}),
        table_schema: widget.tableSchema ? JSON.stringify(widget.tableSchema) : null,
        default_size: JSON.stringify(widget.defaultSize || { width: 300, height: 150 }),
        preview_primitives: JSON.stringify(widget.previewPrimitives || []),
        refresh_interval: widget.refreshInterval || 60000,
        is_system: true,
        is_published: true,
      };

      // Content hash of the seed itself (excludes runtime-tunable refresh_interval).
      const seedHash = computeSeedHash(widgetData);

      // Use hardcoded UUID from widget definition or generate one
      const targetUuid = widget.uuid || uuidv4();

      // Check if widget exists by UUID first (preferred), then by name
      const existingByUuid = widget.uuid ? await model.findAll({ where: { uuid: widget.uuid } }) : [];
      const existingByName = existingByUuid.length === 0 ? await model.findAll({ where: { name: widget.name } }) : [];
      const existing = existingByUuid.length > 0 ? existingByUuid : existingByName;

      // UUID we key the seed marker / tables / assets on.
      const resolvedUuid = existing.length > 0 ? existing[0].uuid : targetUuid;

      log(`Checking ${widget.name}: uuid=${widget.uuid}, found=${existing.length}`, 'debug');

      if (existing.length === 0) {
        // ---- CREATE (create-only path) ----
        await model.create({
          ...widgetData,
          uuid: targetUuid,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        await setSeedMarker(settingsModel, targetUuid, seedHash);
        created++;
        log(`Created: ${widget.name}`);
      } else {
        const existingWidget = existing[0];
        log(`Found existing ${widget.name}: id=${existingWidget.id}, is_system=${existingWidget.is_system}`, 'debug');

        if (!existingWidget.is_system) {
          // A user-owned (de-systemed) widget — never touched by the seeder.
          log(`Skipped (user-modified): ${widget.name}`, 'debug');
        } else {
          const recordedHash = await getSeedMarker(settingsModel, existingWidget.uuid);

          if (recordedHash && recordedHash === seedHash) {
            // Idempotent: this exact seed version is already applied. Do NOT
            // clobber any runtime/user edit made since (BUG-2 fix).
            unchanged++;
            log(`Unchanged (seed matches marker): ${widget.name}`, 'debug');
          } else if (widgetRegistry) {
            // The seed's own content genuinely changed (or the marker was never
            // recorded on this row). Route through widgetRegistry.update so
            // clearCache + invalidate + re-render fire — NOT a raw model.update.
            // refreshInterval is intentionally omitted so an operator's DB
            // override survives (task #1177). Schemas are passed as objects
            // (registry.update serializes them; passing the stringified DB form
            // would double-encode).
            try {
              await widgetRegistry.update(existingWidget.uuid, {
                name: widget.name,
                description: widget.description,
                category: widget.category,
                renderMode: widget.render_mode || 'native',
                code: widget.clientCode || '',
                clientCode: widget.clientCode || '',
                serverCode: widget.serverCode || '',
                htmlTemplate: widget.htmlTemplate || '',
                configSchema: widget.configSchema || {},
                styleSchema: widget.styleSchema || {},
                tableSchema: widget.tableSchema || null,
                defaultSize: widget.defaultSize || { width: 300, height: 150 },
              });
              await setSeedMarker(settingsModel, existingWidget.uuid, seedHash);
              updated++;
              log(`Updated via registry (seed content changed): ${widget.name} (preserved DB refresh_interval=${existingWidget.refresh_interval})`);
            } catch (updateErr) {
              log(`Failed to update ${widget.name}: ${updateErr.message}`, 'error');
            }
          } else {
            // No registry available and the seed changed — do NOT blind-overwrite.
            // Record the marker so we don't loop on this every init; the change
            // will propagate the next time seeding runs with a registry.
            log(`Skipped re-write (no widgetRegistry) for changed seed: ${widget.name}`, 'warn');
          }
        }
      }

      // Create tables for widgets with tableSchema
      if (widget.tableSchema && Object.keys(widget.tableSchema).length > 0) {
        try {
          const { default: TableManager } = await import('../widgets/TableManager.js');
          const tableManager = new TableManager(api);
          await tableManager.createTablesForWidget(resolvedUuid, widget.tableSchema);
          log(`Created tables for: ${widget.name}`, 'debug');
        } catch (err) {
          log(`Failed to create tables for ${widget.name}: ${err.message}`, 'warn');
        }
      }

      // Import assets from widget's assets/ folder
      if (widget.assets && widget.assets.length > 0) {
        await importAssetsToDb(api, resolvedUuid, widget.assets);
        log(`Imported ${widget.assets.length} assets for: ${widget.name}`, 'debug');
      }
    } catch (error) {
      log(`Failed to process ${widget.name}: ${error.message}`, 'error');
    }
  }

  log(`Sync complete: ${created} created, ${updated} updated, ${unchanged} unchanged`);
  return { created, updated, unchanged };
}
