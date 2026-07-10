/**
 * ContentInstallService — the apply core for INERT content packs (casts +
 * templates). Mirrors the SHAPE of the core ExtensionInstallService (per-id
 * mutex, resolve → download → verify → apply → marker) but drops everything that
 * only makes sense for a loaded, running extension: NO updateFromZip, NO
 * DependencyInstaller/npm step, NO health window, NO auto-rollback-to-LKG. Content
 * apply is simply: download → sha256-verify → unzip → UPSERT into the slidecast
 * data model, additive + idempotent + non-clobbering.
 *
 * SECURITY BOUNDARY: this service handles ONLY inert data (cast + template
 * definitions). Widgets — which execute code at import/publish — go through the
 * separate, trust-gated WidgetInstallService (Phase 2). Never route a widget pack
 * through here.
 *
 * Idempotency:
 *  - PACK level: a `content_pack_hash:<id>` marker records the installed artifact
 *    sha256. A re-install of the SAME sha short-circuits (no re-download, no
 *    re-apply) unless force=true.
 *  - CAST level: CastImporter.importStable owns a per-cast `seed_cast_hash:<uuid>`
 *    marker so an operator edit survives a same-version re-install.
 *  - TEMPLATE level: a per-template `content_template_hash:<uuid>` marker here does
 *    the same for templates.
 */

import JSZip from 'jszip';
import crypto from 'crypto';
import logger from '../utils/Logger.js';

/** Typed error with a machine-readable `.code`. */
function installError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.name = 'ContentInstallError';
  return err;
}

const PACK_HASH_PREFIX = 'content_pack_hash:';
const PACK_VERSION_PREFIX = 'content_pack_version:';
const TEMPLATE_HASH_PREFIX = 'content_template_hash:';

class ContentInstallService {
  /**
   * @param {object} deps
   * @param {object}   deps.catalog        ContentCatalogService (resolve/download/verify)
   * @param {object}   deps.castImporter   CastImporter instance (owns importStable)
   * @param {object}   deps.templatesModel api.model('slidecast_templates') wrapper
   * @param {object}   deps.settingsModel  api.model('slidecast_settings') wrapper
   * @param {Function} [deps.broadcast]    WS broadcaster (event, data)
   */
  constructor(deps = {}) {
    this.catalog = deps.catalog;
    this.castImporter = deps.castImporter;
    this.templatesModel = deps.templatesModel;
    this.settingsModel = deps.settingsModel;
    this.broadcast = deps.broadcast || (() => {});

    // Per-id install mutex (chained-promise; only needs ordering).
    this._locks = new Map();
  }

  /** Serialize all mutating ops for one content id. */
  async _withLock(id, fn) {
    const prev = this._locks.get(id) || Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    this._locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this._locks.get(id) === run) this._locks.delete(id);
    }
  }

  /**
   * Install (or re-install) a content pack.
   * @param {string} kind      'cast' | 'template'
   * @param {string} id        content pack id
   * @param {string} [versionSpec='latest']
   * @param {object} [opts]
   * @param {boolean} [opts.force] re-apply even if the pack sha is unchanged
   * @returns {Promise<object>} { id, kind, version, action, casts, templates }
   */
  async install(kind, id, versionSpec = 'latest', opts = {}) {
    return this._withLock(id, () => this._installLocked(kind, id, versionSpec, opts));
  }

  /** @private */
  async _installLocked(kind, id, versionSpec, { force = false } = {}) {
    // 1. Resolve the newest compatible version (throws E_NOT_FOUND /
    //    E_NO_COMPATIBLE_VERSION with a human reason).
    const resolved = await this.catalog.resolve(id, { versionSpec });

    // 2. Pack-level idempotency short-circuit — the resolved sha comes from the
    //    (blessed) index entry, so we can skip before downloading a byte.
    const packMarkerKey = `${PACK_HASH_PREFIX}${id}`;
    if (!force) {
      const recorded = await this._getMarker(packMarkerKey);
      if (recorded && recorded === resolved.sha256) {
        return {
          id, kind: resolved.kind, version: resolved.version, action: 'unchanged', casts: [], templates: [],
        };
      }
    }

    // 3. Download + sha256-verify the pack bytes BEFORE unzip.
    const { buffer, sha256 } = await this.catalog.downloadArtifact(resolved);

    // 4. Unzip + read the pack manifest (content.json).
    const zip = await JSZip.loadAsync(buffer);
    const contentFile = zip.file('content.json');
    if (!contentFile) {
      throw installError('E_INVALID_PACK', `Content pack '${id}' is missing content.json`);
    }
    const content = JSON.parse(await contentFile.async('string'));
    const packKind = content.kind || resolved.kind || kind;

    if (packKind === 'widget') {
      // Widgets execute code — they must not pass through the inert-data pipeline.
      throw installError('E_WRONG_PIPELINE', `Pack '${id}' is a widget — install it via the widget marketplace, not ContentInstallService`);
    }

    // 5. Apply per kind.
    const applied = { casts: [], templates: [] };
    if (packKind === 'cast') {
      for (const castEntry of (Array.isArray(content.casts) ? content.casts : [])) {
        const castBytes = await this._readPackFile(zip, castEntry.file);
        const result = await this.castImporter.importStable(castBytes);
        applied.casts.push({ uuid: result.cast.uuid, name: result.cast.name, action: result.action });
      }
    } else if (packKind === 'template') {
      for (const tplEntry of (Array.isArray(content.templates) ? content.templates : [])) {
        const applyResult = await this._applyTemplate(zip, tplEntry);
        applied.templates.push(applyResult);
      }
    } else {
      throw installError('E_INVALID_PACK', `Unsupported content kind '${packKind}' for pack '${id}'`);
    }

    // 6. Record pack markers (idempotency short-circuit + annotation version).
    await this._setMarker(packMarkerKey, sha256);
    await this._setMarker(`${PACK_VERSION_PREFIX}${id}`, resolved.version);

    try {
      this.broadcast('content:installed', { id, kind: packKind, version: resolved.version });
    } catch { /* WS optional */ }

    return {
      id, kind: packKind, version: resolved.version, action: 'installed', ...applied,
    };
  }

  /**
   * Upsert one template by uuid, marker-guarded so an operator edit survives a
   * same-version re-install (mirrors the cast contract). @private
   */
  async _applyTemplate(zip, tplEntry) {
    const raw = await this._readPackFileString(zip, tplEntry.file);
    const definition = JSON.parse(raw);
    const uuid = tplEntry.uuid || definition.uuid;
    if (!uuid) {
      throw installError('E_INVALID_PACK', 'Template pack entry is missing a uuid');
    }
    const name = tplEntry.name || definition.name || 'Untitled Template';
    const tplHash = crypto.createHash('sha256').update(raw).digest('hex');
    const markerKey = `${TEMPLATE_HASH_PREFIX}${uuid}`;

    const existing = await this.templatesModel.findAll({ where: { uuid } });

    if (!existing || existing.length === 0) {
      await this.templatesModel.create({
        uuid,
        name,
        description: definition.description || '',
        author: definition.author || 'Waiveo',
        definition,
        thumbnail: definition.thumbnail || null,
        is_builtin: false,
      });
      await this._setMarker(markerKey, tplHash);
      return { uuid, name, action: 'created' };
    }

    const recorded = await this._getMarker(markerKey);
    if (recorded && recorded === tplHash) {
      return { uuid, name, action: 'unchanged' };
    }
    await this.templatesModel.update(existing[0].id, {
      name,
      description: definition.description || '',
      author: definition.author || 'Waiveo',
      definition,
      thumbnail: definition.thumbnail || null,
    });
    await this._setMarker(markerKey, tplHash);
    return { uuid, name, action: 'updated' };
  }

  /** Read a pack-internal file as a Buffer (throws if absent). @private */
  async _readPackFile(zip, filePath) {
    const file = filePath ? zip.file(filePath) : null;
    if (!file) {
      throw installError('E_INVALID_PACK', `Content pack is missing bundled file '${filePath}'`);
    }
    return file.async('nodebuffer');
  }

  /** Read a pack-internal file as a string (throws if absent). @private */
  async _readPackFileString(zip, filePath) {
    const file = filePath ? zip.file(filePath) : null;
    if (!file) {
      throw installError('E_INVALID_PACK', `Content pack is missing bundled file '${filePath}'`);
    }
    return file.async('string');
  }

  // ---- settings markers -------------------------------------------------

  /** @private */
  async _getMarker(key) {
    if (!this.settingsModel) return null;
    try {
      const rows = await this.settingsModel.findAll({ where: { key } });
      return rows && rows.length > 0 ? rows[0].value : null;
    } catch {
      return null;
    }
  }

  /** @private */
  async _setMarker(key, value) {
    if (!this.settingsModel) return;
    try {
      const rows = await this.settingsModel.findAll({ where: { key } });
      if (rows && rows.length > 0) {
        await this.settingsModel.update(rows[0].id, { value: String(value), updated_at: new Date().toISOString() });
      } else {
        await this.settingsModel.create({ key, value: String(value) });
      }
    } catch (err) {
      logger.warn(`Could not record content marker for ${key}: ${err.message}`);
    }
  }
}

export { ContentInstallService, installError };
export default ContentInstallService;
