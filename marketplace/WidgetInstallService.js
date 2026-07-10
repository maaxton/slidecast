/**
 * WidgetInstallService — the apply core for WIDGET packs.
 *
 * SECURITY BOUNDARY (this is why it is a SEPARATE service from
 * ContentInstallService, not a `kind` branch inside it): widgets EXECUTE code.
 * A widget's server_code is compiled with `new AsyncFunction(...)` and runs IN
 * THE CORE BACKEND PROCESS with core privileges and secrets — at import (the
 * onInstall lifecycle hook), at publish (thumbnail render) and at every render.
 * client_code / legacy code likewise run in-core to produce render primitives.
 * Casts + templates are inert data; widgets are code. They must never share an
 * install path.
 *
 * Phase-2 trust posture (FIRST-PARTY ONLY):
 *  - A pack that carries any EXECUTING code (server.js / client.js / code.js —
 *    NOT template.html, which is inert markup) is REJECTED unless its declared
 *    source (repo/author/org) is on the allowlist
 *    (`slidecast_widget_allowlist`, default = the official maaxton widget repo +
 *    Waiveo). Community server_code stays blocked until the isolation host adopts
 *    widget-hosting (task #10 / Phase 3).
 *  - A pack whose executing fields are all empty (configSchema/styleSchema/
 *    previewPrimitives/htmlTemplate/assets only) may install from anyone.
 *  - A `codeHash` (sha256 over the concatenated code files, stamped by
 *    build-widget-catalog.mjs) is verified for INTEGRITY on every install — the
 *    downloaded code must match what the catalog blessed. This is integrity, not
 *    authenticity; signing (authenticity) arrives with Phase 3.
 *
 * Apply pipeline: resolve → download → sha256-verify (zip) → unzip → parse
 * widget.json + files/ + assets/ → codeHash-verify → TRUST GATE →
 * WidgetRegistry.import({manifest,files,assets}) (UUID-preserving: create() if
 * new, createVersion()+update() if existing) → WidgetRegistry.publish(uuid).
 *
 * CRITICAL: the install MUST reach publish()/createVersion(). A bare create()
 * writes is_published:false and NO slidecast_widget_versions row; the version
 * ledger row is written only by createVersion() on the publish / import-existing
 * path. So this service always calls publish() after import().
 */

import JSZip from 'jszip';
import crypto from 'crypto';
import logger from '../utils/Logger.js';

/** Typed error with a machine-readable `.code`. */
function widgetInstallError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.name = 'WidgetInstallError';
  return err;
}

const PACK_HASH_PREFIX = 'widget_pack_hash:';
const PACK_VERSION_PREFIX = 'widget_pack_version:';
const CODE_HASH_PREFIX = 'widget_code_hash:';
const ALLOWLIST_KEY = 'slidecast_widget_allowlist';

// Default trust allowlist: the official first-party widget sources. Overridable
// via the `slidecast_widget_allowlist` setting (JSON array or comma list).
const DEFAULT_ALLOWLIST = ['maaxton', 'maaxton/slidecast-marketplace', 'Waiveo'];

/** Normalise a sha256 field to bare lowercase hex ("sha256:" prefix tolerated). */
function normaliseSha(sha) {
  return String(sha).toLowerCase().replace(/^sha256:/, '').trim();
}

/**
 * Canonical integrity hash over a widget's code files. MUST stay byte-identical
 * to computeCodeHash() in scripts/catalog/build-widget-catalog.mjs — the catalog
 * stamps widget.json.codeHash with it and this service re-computes + compares.
 * Order-fixed and null-safe; each file is length-labelled so a byte can't migrate
 * between files without changing the hash.
 */
function computeCodeHash(fields = {}) {
  const parts = [
    `server.js\n${fields.serverCode || ''}`,
    `client.js\n${fields.clientCode || ''}`,
    `template.html\n${fields.htmlTemplate || ''}`,
    `code.js\n${fields.code || ''}`,
  ];
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** Best-effort mime from a filename extension (asset import metadata only). */
function mimeForFilename(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    json: 'application/json',
    mp3: 'audio/mpeg',
  };
  return map[ext] || 'application/octet-stream';
}

class WidgetInstallService {
  /**
   * @param {object} deps
   * @param {object}   deps.catalog        ContentCatalogService (resolve/download/verify) — SHARED
   * @param {object}   deps.widgetRegistry WidgetRegistry (import/publish target)
   * @param {object}   deps.settingsModel  api.model('slidecast_settings') wrapper (markers + allowlist)
   * @param {Function} [deps.broadcast]    WS broadcaster (event, data)
   * @param {string[]} [deps.allowlist]    static trust allowlist override
   */
  constructor(deps = {}) {
    this.catalog = deps.catalog;
    this.widgetRegistry = deps.widgetRegistry;
    this.settingsModel = deps.settingsModel;
    this.broadcast = deps.broadcast || (() => {});
    this.staticAllowlist = Array.isArray(deps.allowlist) ? deps.allowlist : null;

    // Per-id install mutex (chained-promise; only needs ordering).
    this._locks = new Map();
  }

  /** Serialize all mutating ops for one widget pack id. */
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
   * Install (or re-install) a widget pack.
   * @param {string} kind      'widget' (accepted for symmetry with the content pipeline)
   * @param {string} id        widget pack id
   * @param {string} [versionSpec='latest']
   * @param {object} [opts]
   * @param {boolean} [opts.force] re-apply even if the pack sha is unchanged
   * @returns {Promise<object>} { id, kind:'widget', version, action, widgets }
   */
  async install(kind, id, versionSpec = 'latest', opts = {}) {
    return this._withLock(id, () => this._installLocked(id, versionSpec, opts));
  }

  /** @private */
  async _installLocked(id, versionSpec, { force = false } = {}) {
    // 1. Resolve the newest compatible version.
    const resolved = await this.catalog.resolve(id, { versionSpec });

    // 2. Pack-level idempotency short-circuit (skip before downloading a byte).
    const packMarkerKey = `${PACK_HASH_PREFIX}${id}`;
    if (!force) {
      const recorded = await this._getMarker(packMarkerKey);
      if (recorded && recorded === resolved.sha256) {
        return {
          id, kind: 'widget', version: resolved.version, action: 'unchanged', widgets: [],
        };
      }
    }

    // 3. Download + sha256-verify the pack bytes BEFORE unzip.
    const { buffer, sha256 } = await this.catalog.downloadArtifact(resolved);

    // 4. Unzip + read the widget manifest (widget.json).
    const zip = await JSZip.loadAsync(buffer);
    const manifestFile = zip.file('widget.json');
    if (!manifestFile) {
      throw widgetInstallError('E_INVALID_PACK', `Widget pack '${id}' is missing widget.json`);
    }
    const pack = JSON.parse(await manifestFile.async('string'));
    if (!pack.uuid) {
      throw widgetInstallError('E_INVALID_PACK', `Widget pack '${id}' widget.json has no uuid`);
    }
    if (pack.kind && pack.kind !== 'widget') {
      // A cast/template pack must not reach the code-executing pipeline.
      throw widgetInstallError('E_WRONG_PIPELINE', `Pack '${id}' is '${pack.kind}', not a widget — install it via ContentInstallService`);
    }

    // 5. Read code files.
    const files = {};
    for (const [packPath, key] of [
      ['files/server.js', 'server.js'],
      ['files/client.js', 'client.js'],
      ['files/template.html', 'template.html'],
      ['files/code.js', 'code.js'],
    ]) {
      const f = zip.file(packPath);
      if (f) files[key] = await f.async('string');
    }
    const codeFields = {
      serverCode: files['server.js'] || '',
      clientCode: files['client.js'] || '',
      htmlTemplate: files['template.html'] || '',
      code: files['code.js'] || '',
    };

    // 6. Integrity: the downloaded code must match the catalog-blessed codeHash.
    if (pack.codeHash) {
      const computed = computeCodeHash(codeFields);
      const expected = normaliseSha(pack.codeHash);
      if (computed !== expected) {
        throw widgetInstallError(
          'E_CODE_INTEGRITY',
          `widget code hash mismatch for '${id}@${resolved.version}': expected ${expected}, got ${computed}`,
        );
      }
    }

    // 7. TRUST GATE — reject executing code from a non-allowlisted source.
    // htmlTemplate is inert markup and does NOT count as executing code.
    const executes = !!(codeFields.serverCode.trim() || codeFields.clientCode.trim() || codeFields.code.trim());
    if (executes && !(await this._isTrusted(pack))) {
      const src = pack.repo || pack.author || 'unknown source';
      throw widgetInstallError(
        'E_UNTRUSTED_CODE',
        `Widget '${id}' ships executing code from an untrusted source (${src}). `
        + 'Community widget code runs in-core with secrets and is blocked until the isolation host adopts widget-hosting. '
        + `Add '${src}' to ${ALLOWLIST_KEY} only if you fully trust it.`,
      );
    }

    // 8. Read assets (siblings of the code — go into slidecast_widget_assets).
    const assets = [];
    const assetJobs = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      if (!relativePath.startsWith('assets/')) return;
      const filename = relativePath.slice('assets/'.length);
      if (!filename) return;
      assetJobs.push(file.async('nodebuffer').then((data) => {
        assets.push({
          filename, mimeType: mimeForFilename(filename), size: data.length, data,
        });
      }));
    });
    await Promise.all(assetJobs);

    // 9. Import (UUID-preserving) → THEN publish (writes the version ledger row).
    const importFiles = {};
    if (files['server.js']) importFiles['server.js'] = files['server.js'];
    if (files['client.js']) importFiles['client.js'] = files['client.js'];
    if (files['template.html']) importFiles['template.html'] = files['template.html'];
    if (files['code.js']) importFiles['code.js'] = files['code.js'];

    const manifest = {
      uuid: pack.uuid,
      name: pack.name || 'Untitled Widget',
      version: pack.version || 1,
      description: pack.description || '',
      category: pack.category || 'custom',
      renderMode: pack.renderMode,
      refreshInterval: pack.refreshInterval,
      defaultSize: pack.defaultSize,
      configSchema: pack.configSchema,
      styleSchema: pack.styleSchema,
      previewPrimitives: pack.previewPrimitives || null,
      tables: pack.tables || pack.tableSchema || null,
    };

    const imported = await this.widgetRegistry.import({ manifest, files: importFiles, assets });
    const uuid = (imported && imported.uuid) || pack.uuid;

    // CRITICAL: publish() runs createVersion() → a slidecast_widget_versions row.
    // A bare create() (the import new-widget path) leaves is_published:false and
    // writes no version row; publish() is what makes the widget usable + versioned.
    await this.widgetRegistry.publish(uuid);

    // 10. Record markers (pack short-circuit + annotation version + code integrity).
    await this._setMarker(packMarkerKey, sha256);
    await this._setMarker(`${PACK_VERSION_PREFIX}${id}`, resolved.version);
    await this._setMarker(`${CODE_HASH_PREFIX}${uuid}`, computeCodeHash(codeFields));

    try {
      this.broadcast('widget:installed', { id, uuid, version: resolved.version });
    } catch { /* WS optional */ }

    return {
      id,
      kind: 'widget',
      version: resolved.version,
      action: 'installed',
      widgets: [{ uuid, name: manifest.name }],
    };
  }

  // ---- trust -------------------------------------------------------------

  /** The effective trust allowlist (static override > setting > default). */
  async _getAllowlist() {
    if (this.staticAllowlist) return this.staticAllowlist;
    const raw = await this._getMarker(ALLOWLIST_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not JSON — treat as a comma-separated list.
        return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return DEFAULT_ALLOWLIST;
  }

  /**
   * A pack is trusted if its declared repo, author, or org is on the allowlist.
   * This is an INTERIM integrity anchor, not cryptographic authenticity (Phase 3).
   * @private
   */
  async _isTrusted(pack) {
    const allow = (await this._getAllowlist()).filter(Boolean);
    const repo = String(pack.repo || '').trim();
    const author = String(pack.author || '').trim();
    const org = repo.includes('/') ? repo.split('/')[0] : repo;
    return allow.some((a) => a === repo || a === author || a === org || (repo && repo.startsWith(`${a}/`)));
  }

  // ---- settings markers --------------------------------------------------

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
      logger.warn(`Could not record widget marker for ${key}: ${err.message}`);
    }
  }
}

export { WidgetInstallService, widgetInstallError, computeCodeHash };
export default WidgetInstallService;
