/**
 * CastImporter - Import casts from .cast files (ZIP archives)
 *
 * Features:
 * - Validates manifest and file integrity
 * - Validates widget dependencies (errors on missing system widgets)
 * - Deduplicates media by checksum
 * - Imports custom widgets if included
 * - Remaps UUIDs in the cast definition
 * - Supports import from URL
 */

import JSZip from 'jszip';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import logger from './utils/Logger.js';

/**
 * Custom error for dependency validation failures
 */
class DependencyError extends Error {
  constructor(errors, warnings = []) {
    super(`Dependency validation failed: ${errors.join('; ')}`);
    this.name = 'DependencyError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

class CastImporter {
  constructor(api, castManager, mediaLibrary, widgetRegistry, options = {}) {
    this.api = api;
    this.castManager = castManager;
    this.mediaLibrary = mediaLibrary;
    this.widgetRegistry = widgetRegistry;
    this.dataDir = options.dataDir || '/app/data';
    this.renderDir = path.join(this.dataDir, 'slidecast', 'slide-renders');
    // #1199: emit cast:definition_changed after import so WidgetRefreshService
    // (#1134) can reconcile per-instance micro-jobs for widgets added via
    // seed-import and zip-import paths. Optional — constructor callers that
    // don't pass an event bus simply skip the notification (e.g. tests).
    this.eventBus = options.eventBus || null;
  }

  /**
   * Emit cast:definition_changed for a freshly-imported cast so downstream
   * reconcilers (WidgetRefreshService) wake up. Emits unconditionally on
   * successful import — over-reconcile is cheap (reconcile is idempotent)
   * and we can't easily tell whether the definition meaningfully diverged
   * from whatever existed (seed-import creates, zip-import may create or
   * update, and in both cases widgets-inside-slides are the whole point).
   */
  _emitDefinitionChanged(cast) {
    if (!this.eventBus || !cast) return;
    try {
      this.eventBus.emit('cast:definition_changed', {
        castId: cast.uuid,
        castDbId: cast.id,
      });
    } catch { /* event bus failures must not break imports */ }
  }

  /**
   * Import a cast from a .cast ZIP buffer
   * @param {Buffer} zipBuffer - ZIP file buffer
   * @param {Object} options - Import options
   * @param {boolean} options.force - Create new cast even if name exists
   * @param {string} options.newName - Override cast name
   * @param {boolean} options.importWidgets - Import custom widgets (default: true)
   * @param {boolean} options.importCache - Import pre-rendered cache (default: true)
   * @returns {Object} Imported cast
   */
  async import(zipBuffer, options = {}) {
    const {
      force = false,
      newName = null,
      importWidgets = true,
      importCache = true,
    } = options;

    logger.info('Starting cast import...');

    // Extract ZIP
    const zip = await JSZip.loadAsync(zipBuffer);

    // Read manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid .cast file: missing manifest.json');
    }
    const manifest = JSON.parse(await manifestFile.async('string'));

    // Validate manifest format
    this.validateManifest(manifest);

    // Validate dependencies (will throw DependencyError if missing required widgets)
    const depResult = await this.validateDependencies(manifest, zip, { importWidgets });

    // Read definition
    const definitionFile = zip.file('definition.json');
    if (!definitionFile) {
      throw new Error('Invalid .cast file: missing definition.json');
    }
    let definition = JSON.parse(await definitionFile.async('string'));

    // Import media (with deduplication)
    const mediaMap = await this.importMedia(manifest, zip);

    // Import custom widgets if included and user wants them
    const widgetMap = importWidgets
      ? await this.importWidgets(manifest, zip)
      : {};

    // Remap UUIDs in definition
    definition = this.remapUuids(definition, mediaMap, widgetMap);

    // Check if cast with same name exists
    const existingCasts = await this.castManager.getAll();
    const castName = newName || manifest.cast.name;
    const existingCast = existingCasts.find((c) => c.name === castName);

    let cast;
    if (existingCast && !force) {
      // Create with unique name
      const uniqueName = this.generateUniqueName(castName, existingCasts.map((c) => c.name));
      cast = await this.castManager.create({
        name: uniqueName,
        description: manifest.cast.description || '',
        definition,
      });
      logger.info(`Cast imported with unique name: ${uniqueName}`);
    } else if (existingCast && force) {
      // Update existing cast
      cast = await this.castManager.update(existingCast.id, {
        description: manifest.cast.description || '',
        definition,
      });
      logger.info(`Cast updated: ${castName}`);
    } else {
      // Create new cast
      cast = await this.castManager.create({
        name: castName,
        description: manifest.cast.description || '',
        definition,
      });
      logger.info(`Cast imported: ${castName}`);
    }

    // Import cache if included and user wants it
    let cacheImported = 0;
    if (importCache && manifest.options?.cacheIncluded) {
      cacheImported = await this.importCache(cast.uuid, manifest, zip);
    }

    // #1199: notify WidgetRefreshService so it reconciles per-instance
    // micro-jobs for any widgets inside this cast. Without this, widgets
    // added via seed-import or zip-import never get scheduled until the
    // next cast lifecycle event (cast:started / screen-online / etc.).
    this._emitDefinitionChanged(cast);

    return {
      cast,
      mediaImported: Object.keys(mediaMap).filter((k) => mediaMap[k] !== k).length,
      mediaReused: Object.keys(mediaMap).filter((k) => mediaMap[k] === k).length,
      widgetsImported: Object.keys(widgetMap).length,
      cacheImported,
      warnings: depResult.warnings,
    };
  }

  /**
   * STABLE-install a cast from a .cast ZIP buffer — the additive-idempotent path
   * used by the content marketplace (ContentInstallService).
   *
   * Unlike import() (which dedups by NAME and always mints a fresh uuid), this:
   *  - dedups by manifest.cast.uuid via castManager.getByUuid() so a re-install
   *    lands on the SAME row (never "Name (2)");
   *  - passes the packaged uuid into create() so cast uuids stay globally stable;
   *  - is marker-guarded: a per-cast content hash is recorded in slidecast_settings
   *    (`seed_cast_hash:<castUuid>`). marker==hash → SKIP (preserve operator edits,
   *    the widget BUG-2 contract); changed → route through castManager.update
   *    (which emits cast:definition_changed + invalidates the row cache).
   *
   * importMedia (sha256 dedup) + remapUuids + importWidgets are reused UNCHANGED.
   *
   * @param {Buffer} zipBuffer - .cast ZIP buffer
   * @param {Object} [options]
   * @param {boolean} [options.importWidgets=true]
   * @param {boolean} [options.importCache=true]
   * @returns {Object} { cast, action: 'created'|'updated'|'unchanged', ... }
   */
  async importStable(zipBuffer, options = {}) {
    const { importWidgets = true, importCache = true } = options;

    const zip = await JSZip.loadAsync(zipBuffer);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid .cast file: missing manifest.json');
    }
    const manifest = JSON.parse(await manifestFile.async('string'));
    this.validateManifest(manifest);

    if (!manifest.cast || !manifest.cast.uuid) {
      throw new Error('Invalid .cast file: stable install requires manifest.cast.uuid');
    }

    const depResult = await this.validateDependencies(manifest, zip, { importWidgets });

    const definitionFile = zip.file('definition.json');
    if (!definitionFile) {
      throw new Error('Invalid .cast file: missing definition.json');
    }
    const rawDefinitionStr = await definitionFile.async('string');
    let definition = JSON.parse(rawDefinitionStr);

    // Package identity hash — computed over the RAW (un-remapped) definition plus
    // the manifest's sorted, normalized media checksums. This is stable across
    // boxes AND re-installs (media uuids get remapped per-box, so hashing the
    // remapped definition would be box-dependent). Casts carry no runtime-tunable
    // top-level fields to exclude (unlike a widget's refresh_interval).
    const packHash = this._computeCastHash(rawDefinitionStr, manifest);

    // Import media (sha256 dedup) + custom widgets, then remap uuids in-definition.
    const mediaMap = await this.importMedia(manifest, zip);
    const widgetMap = importWidgets ? await this.importWidgets(manifest, zip) : {};
    definition = this.remapUuids(definition, mediaMap, widgetMap);

    const castUuid = manifest.cast.uuid;
    const settingsModel = this.api.model('slidecast_settings');
    const markerKey = `seed_cast_hash:${castUuid}`;

    const existing = await this.castManager.getByUuid(castUuid);

    let cast;
    let action;
    if (!existing) {
      // ---- CREATE (uuid preserved) ----
      cast = await this.castManager.create({
        uuid: castUuid,
        name: manifest.cast.name,
        description: manifest.cast.description || '',
        definition,
      });
      await this._setCastMarker(settingsModel, markerKey, packHash);
      action = 'created';
      logger.info(`Cast installed (stable): ${cast.name} [${castUuid}]`);
    } else {
      const recorded = await this._getCastMarker(settingsModel, markerKey);
      if (recorded && recorded === packHash) {
        // Idempotent: this exact pack version is already applied. Do NOT clobber
        // any operator edit made since (the seed-idempotency contract).
        cast = existing;
        action = 'unchanged';
        logger.debug(`Cast unchanged (marker matches): ${existing.name} [${castUuid}]`);
      } else {
        // The pack content genuinely changed (or the marker was never recorded).
        cast = await this.castManager.update(existing.id, {
          name: manifest.cast.name,
          description: manifest.cast.description || '',
          definition,
        });
        await this._setCastMarker(settingsModel, markerKey, packHash);
        action = 'updated';
        logger.info(`Cast updated (stable): ${cast.name} [${castUuid}]`);
      }
    }

    let cacheImported = 0;
    if (action !== 'unchanged') {
      if (importCache && manifest.options?.cacheIncluded) {
        cacheImported = await this.importCache(cast.uuid, manifest, zip);
      }
      // #1199: wake WidgetRefreshService for widgets inside the (re)installed cast.
      this._emitDefinitionChanged(cast);
    }

    return {
      cast,
      action,
      mediaImported: Object.keys(mediaMap).filter((k) => mediaMap[k] !== k).length,
      mediaReused: Object.keys(mediaMap).filter((k) => mediaMap[k] === k).length,
      widgetsImported: Object.keys(widgetMap).length,
      cacheImported,
      warnings: depResult.warnings,
    };
  }

  /**
   * Stable package-identity hash: sha256 over the raw definition.json bytes plus
   * the manifest's sorted, normalized media checksums (bare hex — normalizing the
   * bare-vs-'sha256:'-prefixed mismatch so it matches the stored DB form).
   * @private
   */
  _computeCastHash(rawDefinitionStr, manifest) {
    const checksums = (Array.isArray(manifest.media) ? manifest.media : [])
      .map((m) => (m && m.checksum ? String(m.checksum).replace(/^sha256:/, '') : ''))
      .filter(Boolean)
      .sort();
    const payload = `${rawDefinitionStr}\n${checksums.join(',')}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /** Read the recorded per-cast content-hash marker (or null). @private */
  async _getCastMarker(settingsModel, key) {
    if (!settingsModel) return null;
    try {
      const rows = await settingsModel.findAll({ where: { key } });
      return rows && rows.length > 0 ? rows[0].value : null;
    } catch {
      return null;
    }
  }

  /** Record (create or update) the per-cast content-hash marker. @private */
  async _setCastMarker(settingsModel, key, hash) {
    if (!settingsModel) return;
    try {
      const rows = await settingsModel.findAll({ where: { key } });
      if (rows && rows.length > 0) {
        await settingsModel.update(rows[0].id, { value: hash, updated_at: new Date().toISOString() });
      } else {
        await settingsModel.create({ key, value: hash });
      }
    } catch (err) {
      logger.warn(`Could not record cast marker for ${key}: ${err.message}`);
    }
  }

  /**
   * Import a cast from a URL
   * @param {string} url - URL to .cast file
   * @param {Object} options - Import options
   * @returns {Object} Imported cast
   */
  async importFromUrl(url, options = {}) {
    logger.info(`Importing cast from URL: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download .cast file: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return this.import(buffer, options);
  }

  /**
   * Validate manifest format
   * @param {Object} manifest - Parsed manifest
   */
  validateManifest(manifest) {
    if (!manifest.format || manifest.format !== 'waiveo-cast') {
      throw new Error('Invalid manifest: not a waiveo-cast format');
    }

    if (!manifest.cast || !manifest.cast.name) {
      throw new Error('Invalid manifest: missing cast name');
    }

    // Version compatibility check
    const version = manifest.formatVersion || '1.0';
    if (!['1.0', '1.1'].includes(version)) {
      throw new Error(`Unsupported format version: ${version}`);
    }
  }

  /**
   * Validate widget dependencies
   * @param {Object} manifest - Parsed manifest
   * @param {JSZip} zip - ZIP archive for checking included widgets
   * @param {Object} options - Validation options
   * @returns {Object} { warnings: string[] }
   */
  async validateDependencies(manifest, zip, options = {}) {
    const { importWidgets = true } = options;
    const errors = [];
    const warnings = [];

    if (!manifest.dependencies?.widgets) {
      return { warnings };
    }

    for (const dep of manifest.dependencies.widgets) {
      const existing = await this.widgetRegistry.getByUuid(dep.uuid);

      if (dep.isSystem) {
        // System widget - must exist on target system
        if (!existing) {
          errors.push(
            `Required system widget "${dep.name}" (${dep.uuid}) not found. `
            + 'Please update your Waiveo installation.',
          );
        }
      } else if (dep.included) {
        // Custom widget, should be in the .cast file
        const widgetFolder = zip.folder(`widgets/${dep.uuid}`);
        const widgetJson = zip.file(`widgets/${dep.uuid}/widget.json`);

        if (!widgetJson) {
          errors.push(
            `Custom widget "${dep.name}" marked as included but not found in .cast file.`,
          );
        }
      } else if (!existing) {
        // Custom widget, should exist on target system
        errors.push(
          `Required custom widget "${dep.name}" (${dep.uuid}) not found `
          + 'and not included in .cast file.',
        );
      }

      // Version warning (informational only)
      if (existing && dep.version && existing.currentVersion < dep.version) {
        warnings.push(
          `Widget "${dep.name}" is version ${existing.currentVersion} but `
          + `cast was created with version ${dep.version}.`,
        );
      }
    }

    if (errors.length > 0) {
      throw new DependencyError(errors, warnings);
    }

    return { warnings };
  }

  /**
   * Import media from the .cast file
   * @param {Object} manifest - Parsed manifest
   * @param {JSZip} zip - ZIP archive
   * @returns {Object} Map of old UUID -> new UUID
   */
  async importMedia(manifest, zip) {
    const uuidMap = {}; // oldUuid -> newUuid

    if (!manifest.media || manifest.media.length === 0) {
      return uuidMap;
    }

    for (const item of manifest.media) {
      const mediaFile = zip.file(`media/${item.filename}`);

      if (!mediaFile) {
        logger.warn(`Media file not found in archive: ${item.filename}`);
        continue;
      }

      const buffer = await mediaFile.async('nodebuffer');

      // Verify file integrity
      if (buffer.length !== item.size) {
        throw new Error(
          `Size mismatch for ${item.filename}: `
          + `expected ${item.size}, got ${buffer.length}`,
        );
      }

      // Calculate and verify checksum
      const calculatedChecksum = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;

      // Normalize the expected checksum format
      const expectedChecksum = item.checksum.startsWith('sha256:')
        ? item.checksum
        : `sha256:${item.checksum}`;

      if (calculatedChecksum !== expectedChecksum) {
        throw new Error(
          `Checksum mismatch for ${item.filename}: `
          + 'file may be corrupted',
        );
      }

      // Check for existing media with same checksum (deduplication)
      const existing = await this.mediaLibrary.getByChecksum(expectedChecksum.replace('sha256:', ''));

      if (existing) {
        // Reuse existing media
        uuidMap[item.uuid] = existing.uuid;
        logger.debug(`Media reused (checksum match): ${item.filename}`);
      } else {
        // Import new media
        const newMedia = await this.mediaLibrary.createFromBuffer(
          buffer,
          item.originalName || item.filename,
          item.mimeType,
        );
        uuidMap[item.uuid] = newMedia.uuid;
        logger.debug(`Media imported: ${item.filename}`);
      }
    }

    return uuidMap;
  }

  /**
   * Import custom widgets from the .cast file
   * @param {Object} manifest - Parsed manifest
   * @param {JSZip} zip - ZIP archive
   * @returns {Object} Map of old UUID -> new UUID
   */
  async importWidgets(manifest, zip) {
    const uuidMap = {}; // oldUuid -> newUuid

    if (!manifest.dependencies?.widgets) {
      return uuidMap;
    }

    const includedWidgets = manifest.dependencies.widgets.filter((w) => w.included);

    for (const widgetDep of includedWidgets) {
      const widgetJsonFile = zip.file(`widgets/${widgetDep.uuid}/widget.json`);

      if (!widgetJsonFile) {
        logger.warn(`Widget not found in archive: ${widgetDep.uuid}`);
        continue;
      }

      try {
        const widgetManifest = JSON.parse(await widgetJsonFile.async('string'));

        // Gather widget files
        const files = {};
        const possibleFiles = ['server.js', 'client.js', 'template.html', 'code.js'];

        for (const filename of possibleFiles) {
          const file = zip.file(`widgets/${widgetDep.uuid}/${filename}`);
          if (file) {
            files[filename] = await file.async('string');
          }
        }

        // Gather assets
        const assets = [];
        const assetsFolder = zip.folder(`widgets/${widgetDep.uuid}/assets`);
        if (assetsFolder) {
          const assetFiles = Object.keys(zip.files).filter(
            (f) => f.startsWith(`widgets/${widgetDep.uuid}/assets/`) && !f.endsWith('/'),
          );

          for (const assetPath of assetFiles) {
            const assetFile = zip.file(assetPath);
            if (assetFile) {
              const filename = assetPath.split('/').pop();
              const data = await assetFile.async('nodebuffer');
              assets.push({
                filename,
                data,
                mimeType: this.getMimeType(filename),
                size: data.length,
              });
            }
          }
        }

        // Import widget (WidgetRegistry.import handles existing widget updates)
        const importedWidget = await this.widgetRegistry.import({
          manifest: widgetManifest,
          files,
          assets,
          dbData: null, // Don't import DB data from cast imports
        });

        // Widget UUID is preserved by WidgetRegistry.import
        uuidMap[widgetDep.uuid] = importedWidget.uuid;
        logger.info(`Widget imported: ${widgetDep.name}`);
      } catch (err) {
        logger.error(`Failed to import widget ${widgetDep.name}: ${err.message}`);
      }
    }

    return uuidMap;
  }

  /**
   * Remap UUIDs in cast definition
   * @param {Object} definition - Cast definition
   * @param {Object} mediaMap - Media UUID mapping
   * @param {Object} widgetMap - Widget UUID mapping
   * @returns {Object} Updated definition
   */
  remapUuids(definition, mediaMap, widgetMap) {
    // Deep clone to avoid modifying original
    const newDef = JSON.parse(JSON.stringify(definition));

    // Helper to remap elements
    const remapElements = (elements) => {
      if (!elements) return;

      for (const el of elements) {
        // Remap media UUID
        if (el.asset_id && mediaMap[el.asset_id]) {
          el.asset_id = mediaMap[el.asset_id];
        }

        // Remap widget UUID (only if it changed, which shouldn't happen often)
        if (el.type === 'widget' && el.widgetUuid && widgetMap[el.widgetUuid]) {
          el.widgetUuid = widgetMap[el.widgetUuid];
        }

        // Check for background images in style
        if (el.style?.backgroundImage && mediaMap) {
          for (const [oldUuid, newUuid] of Object.entries(mediaMap)) {
            if (el.style.backgroundImage.includes(oldUuid)) {
              el.style.backgroundImage = el.style.backgroundImage.replace(oldUuid, newUuid);
            }
          }
        }
      }
    };

    // Remap in groups (new format)
    if (newDef.groups) {
      for (const group of newDef.groups) {
        if (group.slides) {
          for (const slide of group.slides) {
            remapElements(slide.elements);
          }
        }
      }
    }

    // Remap in slides (legacy format)
    if (newDef.slides) {
      for (const slide of newDef.slides) {
        remapElements(slide.elements);
      }
    }

    return newDef;
  }

  /**
   * Generate a unique name for the cast
   * @param {string} baseName - Original name
   * @param {string[]} existingNames - List of existing cast names
   * @returns {string} Unique name
   */
  generateUniqueName(baseName, existingNames) {
    let name = baseName;
    let counter = 1;

    while (existingNames.includes(name)) {
      counter++;
      name = `${baseName} (${counter})`;
    }

    return name;
  }

  /**
   * Get MIME type from filename
   * @param {string} filename - Filename
   * @returns {string} MIME type
   */
  getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      js: 'application/javascript',
      json: 'application/json',
      html: 'text/html',
      css: 'text/css',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Import pre-rendered cache from .cast file
   * @param {string} castUuid - New cast UUID
   * @param {Object} manifest - Parsed manifest
   * @param {JSZip} zip - ZIP archive
   * @returns {number} Number of slides imported
   */
  async importCache(castUuid, manifest, zip) {
    if (!manifest.cache || !manifest.cache.slides) {
      return 0;
    }

    const cacheDir = path.join(this.renderDir, castUuid);

    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    let imported = 0;

    for (const slideInfo of manifest.cache.slides) {
      const slideDir = path.join(cacheDir, String(slideInfo.index));

      // Ensure slide directory exists
      if (!existsSync(slideDir)) {
        mkdirSync(slideDir, { recursive: true });
      }

      // Import all files for this slide
      for (const filename of slideInfo.files) {
        const filePath = `cache/${slideInfo.index}/${filename}`;
        const file = zip.file(filePath);

        if (file) {
          try {
            const buffer = await file.async('nodebuffer');
            await fs.writeFile(path.join(slideDir, filename), buffer);
          } catch (err) {
            logger.warn(`Failed to import cache file ${filePath}: ${err.message}`);
          }
        }
      }

      imported++;
    }

    logger.info(`Imported cache: ${imported} slides`);
    return imported;
  }
}

export { DependencyError };
export default CastImporter;
