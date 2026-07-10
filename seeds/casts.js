/**
 * Cast Seeds - Demo casts that ship with Slidecast
 *
 * Seed casts are:
 *   - Created ONLY on first run (if no casts exist with same name)
 *   - NOT automatically updated (user may have modified them)
 *   - Can be deleted by users
 *
 * This seeder loads .cast files from /extensions/core/slidecast/seed-casts/
 * and imports them on extension startup if they don't already exist.
 *
 * Media Repair:
 *   On subsequent runs, the seeder checks media files for existing casts.
 *   If any media file is missing from disk or is 0 bytes, it re-extracts
 *   the file from the .cast zip and writes it to the path in the DB record.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import JSZip from 'jszip';
import crypto from 'crypto';
import logger from '../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to seed cast files
const SEED_CASTS_DIR = path.resolve(__dirname, '../seed-casts');

/**
 * Extract cast name from .cast file's manifest
 * @param {Buffer} zipBuffer - The .cast file buffer
 * @returns {Promise<string|null>} - The cast name from manifest, or null if not found
 */
async function extractCastName(zipBuffer) {
  try {
    const zip = await JSZip.loadAsync(zipBuffer);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return null;

    const manifestJson = await manifestFile.async('string');
    const manifest = JSON.parse(manifestJson);
    // Cast name is inside manifest.cast.name (not manifest.name)
    return manifest.cast?.name || manifest.name || null;
  } catch {
    return null;
  }
}

/**
 * Repair missing or 0-byte media files for an existing cast.
 *
 * For each media item listed in the .cast manifest:
 *   1. Look up the DB record by checksum.
 *   2. If the DB record exists and the file on disk is missing or empty,
 *      re-extract the buffer from the zip and write it to the path already
 *      stored in the DB record (no new DB record is created).
 *   3. If the DB record does not exist at all, the media was never imported —
 *      log a warning and skip (this shouldn't happen for seeded casts).
 *
 * @param {string} castName - Human-readable name for logging
 * @param {Buffer} zipBuffer - The .cast file contents
 * @param {Object} mediaLibrary - MediaLibrary instance
 * @returns {Promise<number>} Number of files repaired
 */
async function repairMedia(castName, zipBuffer, mediaLibrary) {
  let repaired = 0;

  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    console.warn(`[Cast Seeds] repairMedia: failed to load zip for "${castName}": ${err.message}`);
    return 0;
  }

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) return 0;

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string'));
  } catch {
    return 0;
  }

  if (!manifest.media || manifest.media.length === 0) return 0;

  for (const item of manifest.media) {
    try {
      // Normalize checksum
      const checksum = item.checksum
        ? item.checksum.replace('sha256:', '')
        : null;

      if (!checksum) continue;

      // Find DB record by checksum
      const dbRecord = await mediaLibrary.getByChecksum(checksum);
      if (!dbRecord) {
        console.warn(`[Cast Seeds] repairMedia: no DB record for media "${item.filename}" in cast "${castName}" — skipping`);
        continue;
      }

      // Check disk file
      const filePath = dbRecord.file_path;
      let needsRepair = false;
      try {
        const stat = await fs.stat(filePath);
        if (stat.size === 0) needsRepair = true;
      } catch {
        needsRepair = true; // file does not exist
      }

      if (!needsRepair) continue;

      // Extract buffer from zip
      const mediaFile = zip.file(`media/${item.filename}`);
      if (!mediaFile) {
        console.warn(`[Cast Seeds] repairMedia: "${item.filename}" not found in zip for cast "${castName}"`);
        continue;
      }

      const buffer = await mediaFile.async('nodebuffer');

      // Verify integrity before writing
      const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualChecksum !== checksum) {
        console.warn(`[Cast Seeds] repairMedia: checksum mismatch for "${item.filename}" in cast "${castName}" — skipping`);
        continue;
      }

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write to the existing DB path
      await fs.writeFile(filePath, buffer);
      repaired++;
      console.log(`[Cast Seeds] Repaired media file: ${path.basename(filePath)} (${buffer.length} bytes) for cast "${castName}"`);
    } catch (err) {
      console.warn(`[Cast Seeds] repairMedia: error processing "${item.filename}" for cast "${castName}": ${err.message}`);
    }
  }

  if (repaired > 0) {
    console.log(`[Cast Seeds] Repaired ${repaired} media file(s) for cast "${castName}"`);
  }

  return repaired;
}

/**
 * Seed demo casts into the database
 * Only creates casts that don't already exist (by name from manifest)
 */
export async function seedCasts(api, managers) {
  const {
    castManager, mediaLibrary, widgetRegistry, eventBus,
  } = managers;
  const log = (msg) => logger.debug(`[Cast Seeds] ${msg}`);

  // Always log seed directory location for debugging
  console.log(`[Cast Seeds] Looking for seed casts at: ${SEED_CASTS_DIR}`);

  // Check if seed-casts directory exists
  try {
    await fs.access(SEED_CASTS_DIR);
    console.log('[Cast Seeds] Found seed-casts directory');
  } catch (accessErr) {
    console.log(`[Cast Seeds] Directory not found: ${accessErr.message}`);
    return { created: 0, skipped: 0, errors: 0 };
  }

  // Get list of .cast files
  let castFiles;
  try {
    const files = await fs.readdir(SEED_CASTS_DIR);
    castFiles = files.filter((f) => f.endsWith('.cast'));
  } catch (error) {
    log(`Failed to read seed-casts directory: ${error.message}`, 'error');
    return { created: 0, skipped: 0, errors: 1 };
  }

  if (castFiles.length === 0) {
    log('No .cast files found in seed-casts directory', 'debug');
    return { created: 0, skipped: 0, errors: 0 };
  }

  console.log(`[Cast Seeds] Found ${castFiles.length} .cast files: ${castFiles.join(', ')}`);

  // Get existing cast names to check for duplicates
  const existingCasts = await castManager.getAll();
  const existingNames = new Set(existingCasts.map((c) => c.name.toLowerCase()));
  console.log(`[Cast Seeds] Existing casts in DB: ${existingCasts.length} (${Array.from(existingNames).join(', ') || 'none'})`);

  // Load CastImporter dynamically with cache-busting
  const timestamp = Date.now();
  const importerPath = `${pathToFileURL(path.join(__dirname, '..', 'CastImporter.js')).href}?t=${timestamp}`;
  const { default: CastImporter } = await import(importerPath);
  // #1199: pass eventBus so seed-imports emit cast:definition_changed and
  // WidgetRefreshService reconciles widgets inside newly-seeded casts.
  const importer = new CastImporter(api, castManager, mediaLibrary, widgetRegistry, { eventBus: eventBus || null });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of castFiles) {
    try {
      // Read the .cast file
      const castPath = path.join(SEED_CASTS_DIR, filename);
      const zipBuffer = await fs.readFile(castPath);

      // Extract actual cast name from manifest (not from filename)
      const castName = await extractCastName(zipBuffer);
      if (!castName) {
        log(`Skipped ${filename}: Could not read manifest name`, 'warn');
        errors++;
        continue;
      }

      // Check if cast already exists (case-insensitive by manifest name)
      if (existingNames.has(castName.toLowerCase())) {
        log(`Skipped (already exists): ${castName}`, 'debug');
        skipped++;
        // Even for existing casts, check if media files are intact on disk.
        // On first boot the DB records may have been created but files left
        // as 0-byte stubs. Re-extract any missing or empty files from the zip.
        await repairMedia(castName, zipBuffer, mediaLibrary);
        continue;
      }

      // Import the cast
      const result = await importer.import(zipBuffer, { force: false });

      created++;
      log(`Created: ${result.cast.name} (${result.mediaImported} media files)`);

      // Add to existing names so we don't try to import duplicates in same run
      existingNames.add(result.cast.name.toLowerCase());
    } catch (error) {
      errors++;
      console.error(`[Cast Seeds] Failed to import ${filename}: ${error.message}`);
    }
  }

  // Always log summary
  console.log(`[Cast Seeds] Complete: ${created} created, ${skipped} skipped, ${errors} errors`);

  return { created, skipped, errors };
}
