/**
 * ContentCatalogService — the slidecast content marketplace's thin catalog client.
 *
 * A slidecast-LOCAL port of the core CatalogService (backend/src/services/
 * CatalogService.js). Extensions cannot import core backend/src modules (the
 * override-dir shadowing at /app/data/extensions/<name> makes cross-tree imports
 * fragile), so the ~fetch/TTL/semver-resolve/sha256-verify machinery is copied
 * here rather than imported. It uses the global `fetch` (slidecast already fetches
 * freely) and a small injectable settings adapter (ctx.data-backed in production).
 *
 * Differences from the core CatalogService (content is INERT DATA, reader-3):
 *  - NO imageCaps()/requiresImageDeps gate — casts/templates carry no image deps.
 *  - NO coreVersion floor — content gates (if anything) on the slidecast provider
 *    version, which is inert unless an entry explicitly declares minProviderVersion.
 *  - Index URL from env WAIVEO_CONTENT_CATALOG_URL > setting
 *    `content_catalog_index_url` > default (mirrors catalog_index_url).
 *  - Entries carry a `kind` discriminator ('cast' | 'template' | 'widget') and the
 *    declared content uuids so the route can join against installed rows.
 *
 * Responsibilities (and nothing more):
 *  - getIndex()+5-min TTL cache of the marketplace index.json.
 *  - resolveVersion() — channel/semver/exact/range selection, newest-compatible.
 *  - downloadArtifact() — download a release .zip and sha256-VERIFY the bytes
 *    BEFORE returning.
 *  - listContent() — annotate every entry (compatible/installedVersion/
 *    updateAvailable) so the copied CatalogCard renders unchanged.
 */

import { createHash } from 'crypto';
import semver from 'semver';

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/maaxton/slidecast-marketplace/main/index.json';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // ~5 min

/** Typed error with a machine-readable `.code` the pipeline can branch on. */
function catalogError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.name = 'ContentCatalogError';
  return err;
}

/** Normalise a sha256 field to bare lowercase hex ("sha256:" prefix tolerated). */
function normaliseSha(sha) {
  return String(sha).toLowerCase().replace(/^sha256:/, '').trim();
}

class ContentCatalogService {
  /**
   * @param {object} [opts]
   * @param {string}   [opts.catalogUrl]      default index URL (lowest precedence)
   * @param {number}   [opts.ttlMs]           index cache TTL
   * @param {object}   [opts.settings]        adapter with async get(key, def) — ctx.data-backed
   * @param {Function} [opts.fetch]           fetch implementation (injectable for tests)
   * @param {string}   [opts.providerVersion] running slidecast version (gates minProviderVersion)
   */
  constructor(opts = {}) {
    this.defaultCatalogUrl = opts.catalogUrl || DEFAULT_CATALOG_URL;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.settings = opts.settings || null;
    this.fetchImpl = opts.fetch || globalThis.fetch;
    this.providerVersion = opts.providerVersion || null;

    this._cache = null; // { index, fetchedAt }
  }

  // ---- catalog index fetch + cache --------------------------------------

  /** Resolve the index URL: env WAIVEO_CONTENT_CATALOG_URL > setting > default. */
  async _resolveCatalogUrl() {
    if (process.env.WAIVEO_CONTENT_CATALOG_URL) return process.env.WAIVEO_CONTENT_CATALOG_URL;
    if (this.settings && typeof this.settings.get === 'function') {
      try {
        const fromSetting = await this.settings.get('content_catalog_index_url', null);
        if (fromSetting) return fromSetting;
      } catch {
        // settings table not ready (e.g. first boot) — fall through to default
      }
    }
    return this.defaultCatalogUrl;
  }

  /**
   * Fetch (or return cached) the raw parsed `index.json`. On a fetch/parse failure a
   * still-present (even stale) cache is returned so a transient network blip doesn't
   * break the marketplace; only a cold failure throws.
   * @param {object} [opts]
   * @param {boolean} [opts.force] bypass the TTL cache
   */
  async getIndex({ force = false } = {}) {
    const now = Date.now();
    if (!force && this._cache && (now - this._cache.fetchedAt) < this.ttlMs) {
      return this._cache.index;
    }

    const url = await this._resolveCatalogUrl();
    let res;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      if (this._cache) return this._cache.index;
      throw catalogError('E_CATALOG_FETCH', `Failed to reach content catalog index at ${url}: ${err.message}`);
    }

    if (!res.ok) {
      if (this._cache) return this._cache.index;
      throw catalogError('E_CATALOG_FETCH', `Content catalog index fetch failed (${res.status}) at ${url}`);
    }

    let index;
    try {
      index = await res.json();
    } catch (err) {
      if (this._cache) return this._cache.index;
      throw catalogError('E_CATALOG_FETCH', `Content catalog index is not valid JSON: ${err.message}`);
    }

    // Accept `items` (content marketplace) or `extensions` (shape-compatible with
    // the core catalog) as the entry array.
    const entries = Array.isArray(index.items) ? index.items
      : (Array.isArray(index.extensions) ? index.extensions : null);
    if (!entries) {
      throw catalogError('E_CATALOG_FETCH', 'Content catalog index is missing an items[] array');
    }
    // Normalise onto `items` so downstream code has one field.
    index.items = entries;

    this._cache = { index, fetchedAt: now };
    return index;
  }

  /** Find a single catalog entry by id (null if not indexed). */
  async getEntry(id) {
    const index = await this.getIndex();
    return index.items.find((e) => (e.id || e.name) === id) || null;
  }

  // ---- resolution -------------------------------------------------------

  /** Candidate versions that match the spec (channel/exact/range) — no compat gate. */
  _candidatesForSpec(entry, spec) {
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    if (spec === 'latest') {
      return versions.filter((v) => (v.channel || 'stable') === 'stable');
    }
    if (spec === 'latest-prerelease' || spec === 'prerelease') {
      return versions;
    }
    if (semver.valid(spec)) {
      return versions.filter((v) => v.version === spec);
    }
    if (semver.validRange(spec)) {
      return versions.filter((v) => v.version && semver.satisfies(v.version, spec));
    }
    return [];
  }

  /**
   * Compat floor for content = the version parses, and (only if the entry declares
   * a provider floor) the running slidecast version satisfies it. Content is inert,
   * so with no minProviderVersion/providerApiRange declared everything is compatible.
   */
  _isCompatible(v, entry) {
    if (!v || !v.version || !semver.valid(v.version)) return false;
    const pv = this.providerVersion;
    if (pv && semver.valid(pv)) {
      const floor = v.minProviderVersion || entry.minProviderVersion;
      if (floor && !semver.gte(pv, floor)) return false;
      const range = v.providerApiRange || entry.providerApiRange;
      if (range && !semver.satisfies(pv, range)) return false;
    }
    return true;
  }

  /** Flatten an entry + chosen version into the artifact the download consumes. */
  _toResolvedArtifact(entry, v) {
    return {
      id: entry.id || entry.name,
      name: entry.id || entry.name,
      kind: entry.kind || 'cast',
      version: v.version,
      channel: v.channel ?? 'stable',
      tarball: v.tarball ?? null,
      size: v.size ?? null,
      sha256: v.sha256 ?? null,
    };
  }

  /**
   * Pick the NEWEST compatible version of `entry` for `spec` (pure/sync). Returns
   * a ResolvedArtifact or null.
   */
  resolveVersion(entry, spec) {
    if (!entry || !Array.isArray(entry.versions)) return null;
    const candidates = this._candidatesForSpec(entry, spec || 'latest')
      .filter((v) => this._isCompatible(v, entry));
    if (candidates.length === 0) return null;
    const chosen = [...candidates].sort((a, b) => semver.rcompare(a.version, b.version))[0];
    return this._toResolvedArtifact(entry, chosen);
  }

  /** Human-actionable reason no version matched. */
  _incompatibilityReason(entry, spec) {
    const candidates = this._candidatesForSpec(entry, spec);
    if (candidates.length === 0) {
      return `No '${spec}' release is published for '${entry.id || entry.name}'`;
    }
    const pv = this.providerVersion;
    const newest = [...candidates].sort((a, b) => semver.rcompare(a.version, b.version))[0];
    const floor = newest.minProviderVersion || entry.minProviderVersion;
    if (pv && floor && !semver.gte(pv, floor)) {
      return `'${entry.id || entry.name}' ${newest.version} needs slidecast >= ${floor} (running ${pv})`;
    }
    return `No compatible version of '${entry.id || entry.name}' found`;
  }

  /**
   * Async convenience: fetch the catalog, resolve by id, and THROW a clear reason
   * (E_NOT_FOUND / E_NO_COMPATIBLE_VERSION) if nothing resolves.
   */
  async resolve(id, { versionSpec = 'latest' } = {}) {
    const entry = await this.getEntry(id);
    if (!entry) {
      throw catalogError('E_NOT_FOUND', `Content pack '${id}' is not in the catalog`);
    }
    const resolved = this.resolveVersion(entry, versionSpec);
    if (!resolved) {
      throw catalogError('E_NO_COMPATIBLE_VERSION', this._incompatibilityReason(entry, versionSpec));
    }
    return resolved;
  }

  // ---- download + integrity ---------------------------------------------

  /**
   * Download a resolved artifact's `.zip` and VERIFY its sha256 against the
   * catalog-blessed digest BEFORE returning the bytes.
   * @param {object} resolved needs `tarball` + `sha256`
   * @returns {Promise<{buffer: Buffer, sha256: string}>}
   */
  async downloadArtifact(resolved) {
    if (!resolved || !resolved.tarball) {
      throw catalogError('E_DOWNLOAD', 'Resolved content pack has no tarball URL');
    }
    if (!resolved.sha256) {
      throw catalogError('E_INTEGRITY', `Catalog entry for '${resolved.id}' has no sha256 — refusing to install unverified bytes`);
    }

    let res;
    try {
      res = await this.fetchImpl(resolved.tarball, { headers: { Accept: 'application/octet-stream' } });
    } catch (err) {
      throw catalogError('E_DOWNLOAD', `Failed to download ${resolved.tarball}: ${err.message}`);
    }
    if (!res.ok) {
      throw catalogError('E_DOWNLOAD', `Download failed (${res.status}) for ${resolved.tarball}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const digest = createHash('sha256').update(buffer).digest('hex');
    const expected = normaliseSha(resolved.sha256);
    if (digest !== expected) {
      throw catalogError(
        'E_INTEGRITY',
        `sha256 mismatch for '${resolved.id}@${resolved.version}': expected ${expected}, got ${digest}`,
      );
    }
    return { buffer, sha256: digest };
  }

  /** Convenience alias: return only the sha256-verified bytes. */
  async download(resolved) {
    const { buffer } = await this.downloadArtifact(resolved);
    return buffer;
  }

  // ---- annotation -------------------------------------------------------

  /**
   * Every catalog entry annotated with compatibility + install/update state so the
   * copied CatalogCard renders unchanged. This service owns no DB — the route
   * supplies `installedVersions` (id -> version, from content_pack_version markers)
   * and `installedUuids` (a Set of every cast/template uuid present in the DB) and
   * this joins them.
   * @param {object} [opts]
   * @param {Object<string,string>} [opts.installedVersions] id -> installed version
   * @param {Set<string>}          [opts.installedUuids]     declared uuids present on the box
   * @param {string}               [opts.kind]               filter to one kind
   */
  async listContent({ installedVersions = {}, installedUuids = new Set(), kind = null } = {}) {
    const index = await this.getIndex();
    return index.items
      .filter((e) => !e.hidden)
      .filter((e) => !kind || (e.kind || 'cast') === kind)
      .map((e) => {
        const id = e.id || e.name;
        const resolved = this.resolveVersion(e, 'latest');
        const latestCompatible = resolved ? resolved.version : null;

        // Installed = a recorded version marker OR any declared content uuid is
        // present in the DB (covers packs installed before markers existed).
        let installedVersion = installedVersions[id] ?? null;
        if (!installedVersion) {
          const declared = [...(e.casts || []), ...(e.templates || []), ...(e.widgets || [])];
          if (declared.some((c) => c && c.uuid && installedUuids.has(c.uuid))) {
            installedVersion = 'installed';
          }
        }

        const updateAvailable = !!(
          installedVersion
          && installedVersion !== 'installed'
          && latestCompatible
          && semver.valid(installedVersion)
          && semver.gt(latestCompatible, installedVersion)
        );

        return {
          ...e,
          // CatalogCard keys selection off `name` — map it to the content id.
          name: id,
          displayName: e.displayName || e.name || id,
          compatible: !!resolved,
          incompatibleReason: resolved ? null : this._incompatibilityReason(e, 'latest'),
          latestCompatibleVersion: latestCompatible,
          installedVersion,
          updateAvailable,
        };
      });
  }

  /** Drop the index cache (e.g. after a catalog URL change). */
  clearCache() {
    this._cache = null;
  }
}

export { ContentCatalogService, catalogError };
export default ContentCatalogService;
