/**
 * Slidecast CONTENT marketplace — unit tests (pure logic, no hardware, no disk).
 *
 * Covers the load-bearing behaviours of the additive-idempotent content install:
 *  1. ContentCatalogService.downloadArtifact sha256 verify-before-return
 *     (+ bare-vs-'sha256:' normalization).
 *  2. CastManager.create honours a passed uuid (the single core gap).
 *  3. CastImporter.importStable dedups by manifest.cast.uuid — a re-install lands
 *     on the SAME row (never "Name (2)"), and the marker short-circuits unchanged.
 *  4. Media dedup: two casts sharing an asset → exactly one media row.
 *  5. Marker-guarded update: an operator edit is NOT clobbered by a same-version
 *     re-install; a changed pack DOES route through castManager.update.
 *  6. ContentInstallService: install twice → one cast row + pack-marker short-circuit.
 *  7. ContentJobService: one failing item never aborts the batch; order preserved.
 *
 * Slidecast modules are imported via the bare-specifier alias (vitest.config.js
 * resolve.alias maps `slidecast/...` → extensions/slidecast/...). Test .cast /
 * content-pack zips are built with adm-zip (a backend dep); the slidecast code
 * reads them with jszip — both are standard ZIP.
 */
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

import CastManager from 'slidecast/CastManager.js';
import CastImporter from 'slidecast/CastImporter.js';
import WidgetRegistry from 'slidecast/widgets/WidgetRegistry.js';
import { ContentCatalogService } from 'slidecast/marketplace/ContentCatalogService.js';
import { ContentInstallService } from 'slidecast/marketplace/ContentInstallService.js';
import { ContentJobService } from 'slidecast/marketplace/ContentJobService.js';
import { WidgetInstallService, computeCodeHash } from 'slidecast/marketplace/WidgetInstallService.js';

// ---- in-memory fakes ---------------------------------------------------

class InMemoryTable {
  constructor() { this.rows = []; this.seq = 0; }

  _match(row, where) {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  async findAll(opts = {}) {
    let out = this.rows.filter((r) => this._match(r, opts && opts.where));
    if (opts && opts.limit) out = out.slice(0, opts.limit);
    return out.map((r) => ({ ...r }));
  }

  async findOne(where) {
    const r = this.rows.find((row) => this._match(row, where));
    return r ? { ...r } : null;
  }

  async findById(id) {
    const r = this.rows.find((row) => row.id === id);
    return r ? { ...r } : null;
  }

  async create(data) {
    const row = { id: ++this.seq, ...data };
    this.rows.push(row);
    return { ...row };
  }

  async update(id, data) {
    const r = this.rows.find((row) => row.id === id);
    if (!r) return 0;
    Object.assign(r, data);
    return 1;
  }

  async delete(id) {
    const i = this.rows.findIndex((row) => row.id === id);
    if (i === -1) return 0;
    this.rows.splice(i, 1);
    return 1;
  }
}

function makeApi() {
  const tables = {
    slidecast_casts: new InMemoryTable(),
    slidecast_templates: new InMemoryTable(),
    slidecast_settings: new InMemoryTable(),
  };
  return { tables, model: (name) => tables[name] };
}

function makeMediaLibrary() {
  const rows = [];
  return {
    rows,
    async getByChecksum(checksum) {
      const norm = String(checksum).replace('sha256:', '');
      const m = rows.find((r) => r.checksum === norm);
      return m ? { ...m } : null;
    },
    async createFromBuffer(buffer, name, mime) {
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const uuid = `media-${rows.length + 1}`;
      const row = {
        uuid, name, mime_type: mime, checksum, file_size: buffer.length,
      };
      rows.push(row);
      return { ...row };
    },
  };
}

// getByUuid returns a system widget so validateDependencies passes; casts below
// carry no widget deps, so import() never touches it.
const fakeWidgetRegistry = {
  getByUuid: async () => ({ currentVersion: 1 }),
  import: async () => ({ uuid: 'imported-widget' }),
};

// ---- .cast / content-pack builders -------------------------------------

/**
 * Build a .cast ZIP buffer. `media` = [{ uuid, filename, content }].
 * `definitionExtra` lets a test perturb the definition to change the pack hash.
 */
function makeCastBuffer({
  uuid, name, media = [], definitionExtra = {},
}) {
  const zip = new AdmZip();
  const manifestMedia = [];
  const elements = [];
  for (const m of media) {
    const buf = Buffer.from(m.content);
    const checksum = createHash('sha256').update(buf).digest('hex');
    zip.addFile(`media/${m.filename}`, buf);
    manifestMedia.push({
      uuid: m.uuid,
      filename: m.filename,
      originalName: m.filename,
      type: 'image',
      mimeType: 'image/jpeg',
      size: buf.length,
      checksum: `sha256:${checksum}`,
    });
    elements.push({ id: `el-${m.uuid}`, type: 'image', asset_id: m.uuid });
  }
  const manifest = {
    format: 'waiveo-cast',
    formatVersion: '1.0',
    cast: { uuid, name, description: '' },
    media: manifestMedia,
    dependencies: { widgets: [] },
    options: {},
  };
  const definition = {
    settings: {},
    variables: {},
    groups: [{ id: 'home', name: 'Home', slides: [{ id: 's1', elements }] }],
    ...definitionExtra,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  zip.addFile('definition.json', Buffer.from(JSON.stringify(definition)));
  return zip.toBuffer();
}

/** Build a content pack ZIP wrapping one or more .cast buffers. */
function makeCastPack({ id, version = '1.0.0', casts }) {
  const pack = new AdmZip();
  const content = {
    id,
    name: id,
    version,
    kind: 'cast',
    casts: casts.map((c) => ({ uuid: c.uuid, name: c.name, file: `casts/${c.uuid}.cast` })),
    templates: [],
    media: [],
  };
  pack.addFile('content.json', Buffer.from(JSON.stringify(content)));
  for (const c of casts) pack.addFile(`casts/${c.uuid}.cast`, c.buffer);
  const buffer = pack.toBuffer();
  return { buffer, sha256: createHash('sha256').update(buffer).digest('hex') };
}

function makeImporter(api, mediaLibrary) {
  return new CastImporter(api, api._castManager, mediaLibrary, fakeWidgetRegistry, {});
}

async function makeCastManager(api) {
  const cm = new CastManager(api);
  await cm.init();
  api._castManager = cm;
  return cm;
}

/** ArrayBuffer view of a Buffer (fetch.arrayBuffer() shape). */
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// =======================================================================
// 1. ContentCatalogService — sha256 verify-before-return
// =======================================================================

describe('ContentCatalogService.downloadArtifact (sha256 verify-before-return)', () => {
  const INDEX_URL = 'https://example.test/content-index.json';

  function makeService(assetBody) {
    const fetchImpl = async (url) => {
      if (url === INDEX_URL) return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(assetBody) };
    };
    return new ContentCatalogService({ catalogUrl: INDEX_URL, fetch: fetchImpl });
  }

  it('returns the verified bytes when the sha256 matches', async () => {
    const body = Buffer.from('the real content pack bytes');
    const sha = createHash('sha256').update(body).digest('hex');
    const svc = makeService(body);
    const out = await svc.downloadArtifact({
      id: 'demo', version: '1.0.0', tarball: 'https://example.test/demo.zip', sha256: sha,
    });
    expect(out.sha256).toBe(sha);
    expect(Buffer.compare(out.buffer, body)).toBe(0);
  });

  it('normalizes a "sha256:"-prefixed catalog digest before comparing', async () => {
    const body = Buffer.from('the real content pack bytes');
    const sha = createHash('sha256').update(body).digest('hex');
    const svc = makeService(body);
    const out = await svc.downloadArtifact({
      id: 'demo', version: '1.0.0', tarball: 'https://example.test/demo.zip', sha256: `sha256:${sha}`,
    });
    expect(out.sha256).toBe(sha);
  });

  it('throws E_INTEGRITY when the sha256 does not match', async () => {
    const body = Buffer.from('the real content pack bytes');
    const svc = makeService(body);
    await expect(svc.downloadArtifact({
      id: 'demo', version: '1.0.0', tarball: 'https://example.test/demo.zip', sha256: 'f'.repeat(64),
    })).rejects.toMatchObject({ code: 'E_INTEGRITY' });
  });

  it('refuses to download when the catalog entry has no sha256', async () => {
    const svc = makeService(Buffer.from('x'));
    await expect(svc.downloadArtifact({
      id: 'demo', version: '1.0.0', tarball: 'https://example.test/demo.zip', sha256: null,
    })).rejects.toMatchObject({ code: 'E_INTEGRITY' });
  });

  it('resolveVersion picks the newest compatible version, resolve() throws E_NOT_FOUND', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'pack',
          kind: 'cast',
          versions: [
            {
              version: '1.0.0', channel: 'stable', tarball: 't1', sha256: 'a'.repeat(64),
            },
            {
              version: '1.2.0', channel: 'stable', tarball: 't2', sha256: 'b'.repeat(64),
            },
          ],
        }],
      }),
    });
    const svc = new ContentCatalogService({ catalogUrl: INDEX_URL, fetch: fetchImpl });
    const resolved = await svc.resolve('pack');
    expect(resolved.version).toBe('1.2.0');
    await expect(svc.resolve('nope')).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

// =======================================================================
// 2. CastManager.create honours a passed uuid
// =======================================================================

describe('CastManager.create — uuid stability', () => {
  it('honours a caller-supplied uuid', async () => {
    const api = makeApi();
    const cm = await makeCastManager(api);
    const cast = await cm.create({ uuid: 'fixed-uuid-123', name: 'X' });
    expect(cast.uuid).toBe('fixed-uuid-123');
    const looked = await cm.getByUuid('fixed-uuid-123');
    expect(looked).not.toBeNull();
    expect(looked.name).toBe('X');
  });

  it('mints a fresh uuid when none is passed', async () => {
    const api = makeApi();
    const cm = await makeCastManager(api);
    const a = await cm.create({ name: 'A' });
    const b = await cm.create({ name: 'B' });
    expect(a.uuid).toBeTruthy();
    expect(b.uuid).toBeTruthy();
    expect(a.uuid).not.toBe(b.uuid);
  });
});

// =======================================================================
// 3 + 4 + 5. CastImporter.importStable — uuid dedup, media dedup, marker guard
// =======================================================================

describe('CastImporter.importStable — additive, idempotent, non-clobbering', () => {
  let api;
  let cm;
  let media;
  let importer;

  beforeEach(async () => {
    api = makeApi();
    cm = await makeCastManager(api);
    media = makeMediaLibrary();
    importer = makeImporter(api, media);
  });

  it('dedups by manifest.cast.uuid — re-install lands on the same row (no "Name (2)")', async () => {
    const buf = makeCastBuffer({ uuid: 'cast-A', name: 'Alpha' });

    const r1 = await importer.importStable(buf);
    expect(r1.action).toBe('created');
    expect(r1.cast.uuid).toBe('cast-A');

    const r2 = await importer.importStable(buf);
    expect(r2.action).toBe('unchanged'); // marker short-circuit
    expect(r2.cast.uuid).toBe('cast-A');

    expect(api.tables.slidecast_casts.rows).toHaveLength(1);
    expect(api.tables.slidecast_casts.rows[0].name).toBe('Alpha'); // never "Alpha (2)"
    // Exactly one marker recorded.
    const markers = api.tables.slidecast_settings.rows.filter((r) => r.key === 'seed_cast_hash:cast-A');
    expect(markers).toHaveLength(1);
  });

  it('dedups media by checksum — two casts sharing an asset → one media row', async () => {
    const shared = { uuid: 'm-shared', filename: 'logo.jpg', content: 'IDENTICAL-BYTES' };
    const cast1 = makeCastBuffer({ uuid: 'cast-1', name: 'One', media: [shared] });
    const cast2 = makeCastBuffer({ uuid: 'cast-2', name: 'Two', media: [{ ...shared, uuid: 'm-other' }] });

    await importer.importStable(cast1);
    await importer.importStable(cast2);

    expect(media.rows).toHaveLength(1); // identical bytes collapse to one row
    expect(api.tables.slidecast_casts.rows).toHaveLength(2);
  });

  it('marker-guarded: an operator edit is NOT clobbered by a same-version re-install', async () => {
    const buf = makeCastBuffer({ uuid: 'cast-E', name: 'Editable' });
    const r1 = await importer.importStable(buf);

    // Operator edits the cast in the DB.
    await cm.update(r1.cast.id, { definition: { groups: [], operatorEdited: true } });

    // Re-install the SAME pack version → marker matches → unchanged → edit survives.
    const r2 = await importer.importStable(buf);
    expect(r2.action).toBe('unchanged');
    const row = await cm.getByUuid('cast-E');
    expect(row.definition.operatorEdited).toBe(true);
  });

  it('marker-guarded: a CHANGED pack routes through castManager.update', async () => {
    const v1 = makeCastBuffer({ uuid: 'cast-U', name: 'Upgradable' });
    await importer.importStable(v1);

    // Same uuid, different definition content → different pack hash.
    const v2 = makeCastBuffer({ uuid: 'cast-U', name: 'Upgradable', definitionExtra: { version: 2, marker: 'new' } });
    const r2 = await importer.importStable(v2);

    expect(r2.action).toBe('updated');
    expect(api.tables.slidecast_casts.rows).toHaveLength(1);
    const row = await cm.getByUuid('cast-U');
    expect(row.definition.marker).toBe('new');
  });
});

// =======================================================================
// 6. ContentInstallService — install twice → one row + pack short-circuit
// =======================================================================

describe('ContentInstallService.install — pack-level idempotency', () => {
  const INDEX_URL = 'https://example.test/content-index.json';
  const PACK_URL = 'https://example.test/alpha-1.0.0.zip';

  let api;
  let media;
  let installService;
  let downloadCount;

  beforeEach(async () => {
    api = makeApi();
    await makeCastManager(api);
    media = makeMediaLibrary();
    downloadCount = 0;

    const castBuf = makeCastBuffer({ uuid: 'cast-pack-A', name: 'PackAlpha' });
    const pack = makeCastPack({ id: 'alpha', version: '1.0.0', casts: [{ uuid: 'cast-pack-A', name: 'PackAlpha', buffer: castBuf }] });

    const index = {
      items: [{
        id: 'alpha',
        kind: 'cast',
        versions: [{
          version: '1.0.0', channel: 'stable', tarball: PACK_URL, sha256: pack.sha256,
        }],
      }],
    };
    const fetchImpl = async (url) => {
      if (url === INDEX_URL) return { ok: true, status: 200, json: async () => index };
      downloadCount += 1;
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(pack.buffer) };
    };

    const catalog = new ContentCatalogService({ catalogUrl: INDEX_URL, fetch: fetchImpl });
    const importer = makeImporter(api, media);
    installService = new ContentInstallService({
      catalog,
      castImporter: importer,
      templatesModel: api.model('slidecast_templates'),
      settingsModel: api.model('slidecast_settings'),
    });
  });

  it('installs once, then short-circuits the second install (no re-download, one cast row)', async () => {
    const r1 = await installService.install('cast', 'alpha');
    expect(r1.action).toBe('installed');
    expect(r1.casts).toHaveLength(1);
    expect(api.tables.slidecast_casts.rows).toHaveLength(1);
    expect(downloadCount).toBe(1);

    const r2 = await installService.install('cast', 'alpha');
    expect(r2.action).toBe('unchanged');
    expect(api.tables.slidecast_casts.rows).toHaveLength(1); // still one row
    expect(downloadCount).toBe(1); // pack-marker short-circuit → no second download

    // Pack markers recorded.
    const hashMarker = api.tables.slidecast_settings.rows.find((r) => r.key === 'content_pack_hash:alpha');
    const versionMarker = api.tables.slidecast_settings.rows.find((r) => r.key === 'content_pack_version:alpha');
    expect(hashMarker).toBeTruthy();
    expect(versionMarker.value).toBe('1.0.0');
  });
});

// =======================================================================
// 7. ContentJobService — one failure never aborts the batch
// =======================================================================

describe('ContentJobService — batch resilience', () => {
  it('one failing item does not abort the batch; order is preserved', async () => {
    const attempted = [];
    const installService = {
      async install(kind, id) {
        attempted.push(id);
        if (id === 'bad') {
          const err = new Error('boom');
          err.code = 'E_INVALID_PACK';
          throw err;
        }
        return {
          id, kind, version: '1.0.0', action: 'installed',
        };
      },
    };
    const jobService = new ContentJobService({ installService });

    const { jobId, total } = jobService.startJob([
      { kind: 'cast', id: 'a' },
      { kind: 'cast', id: 'bad' },
      { kind: 'cast', id: 'c' },
    ]);
    expect(total).toBe(3);

    const final = await jobService.whenSettled(jobId);
    expect(final.status).toBe('complete');
    expect(final.summary).toMatchObject({ installed: 2, failed: 1, total: 3 });

    // Every item was attempted in requested order — 'c' ran AFTER 'bad' failed.
    expect(attempted).toEqual(['a', 'bad', 'c']);

    const byId = Object.fromEntries(final.items.map((item) => [item.id, item]));
    expect(byId.a.phase).toBe('installed');
    expect(byId.bad.phase).toBe('failed');
    expect(byId.bad.code).toBe('E_INVALID_PACK');
    expect(byId.c.phase).toBe('installed');
  });

  it('rejects an empty batch', () => {
    const jobService = new ContentJobService({ installService: { install: async () => ({}) } });
    expect(() => jobService.startJob([])).toThrow(/non-empty/);
  });
});

// =======================================================================
// 8. WidgetInstallService — version-ledger row + first-party trust gate + codeHash
// =======================================================================

/** api backing a REAL WidgetRegistry (so createVersion actually writes a row). */
function makeWidgetApi() {
  const tables = {
    slidecast_widgets: new InMemoryTable(),
    slidecast_widget_versions: new InMemoryTable(),
    slidecast_widget_assets: new InMemoryTable(),
    slidecast_widget_storage: new InMemoryTable(),
    slidecast_settings: new InMemoryTable(),
  };
  return { tables, model: (name) => tables[name] };
}

async function makeWidgetRegistry(api) {
  const reg = new WidgetRegistry(api);
  await reg.init();
  return reg;
}

/** Build a .widget pack ZIP → { buffer, sha256 }. `files` = { 'server.js': ... }. */
function makeWidgetPack({ manifest, files = {} }) {
  const zip = new AdmZip();
  zip.addFile('widget.json', Buffer.from(JSON.stringify(manifest)));
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(`files/${name}`, Buffer.from(content));
  }
  const buffer = zip.toBuffer();
  return { buffer, sha256: createHash('sha256').update(buffer).digest('hex') };
}

/** Wire a WidgetInstallService over a catalog that serves ONE widget pack. */
function makeWidgetInstall(api, registry, id, pack) {
  const INDEX_URL = 'https://example.test/widget-index.json';
  const PACK_URL = 'https://example.test/widget-pack.zip';
  const index = {
    items: [{
      id,
      kind: 'widget',
      versions: [{
        version: '1.0.0', channel: 'stable', tarball: PACK_URL, sha256: pack.sha256,
      }],
    }],
  };
  const fetchImpl = async (url) => {
    if (url === INDEX_URL) return { ok: true, status: 200, json: async () => index };
    return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(pack.buffer) };
  };
  const catalog = new ContentCatalogService({ catalogUrl: INDEX_URL, fetch: fetchImpl });
  return new WidgetInstallService({
    catalog,
    widgetRegistry: registry,
    settingsModel: api.model('slidecast_settings'),
  });
}

describe('WidgetInstallService — import→publish writes a version row', () => {
  it('lands a slidecast_widget_versions row (proves publish/createVersion, not bare create)', async () => {
    const api = makeWidgetApi();
    const registry = await makeWidgetRegistry(api);

    // A widget with NO executing code (previewPrimitives only) — installs from
    // anyone; still exercises the full import→publish path.
    const manifest = {
      uuid: 'w-versioned-001',
      name: 'Preview Only',
      version: 1,
      kind: 'widget',
      category: 'custom',
      previewPrimitives: [{ type: 'text', content: 'hi' }],
      repo: 'anyone/community',
    };
    const pack = makeWidgetPack({ manifest });
    const svc = makeWidgetInstall(api, registry, 'preview-only', pack);

    const result = await svc.install('widget', 'preview-only');
    expect(result.action).toBe('installed');
    expect(result.widgets[0].uuid).toBe('w-versioned-001');

    // The version-ledger row exists — a bare create() would leave this empty.
    const versions = api.tables.slidecast_widget_versions.rows.filter((r) => r.widget_uuid === 'w-versioned-001');
    expect(versions.length).toBeGreaterThanOrEqual(1);

    // And the widget is published + uuid-preserved.
    const widget = await registry.getByUuid('w-versioned-001');
    expect(widget).not.toBeNull();
    expect(widget.isPublished).toBe(true);
  });
});

describe('WidgetInstallService — first-party trust gate', () => {
  it('REJECTS a community pack carrying server_code (executing code, not allowlisted)', async () => {
    const api = makeWidgetApi();
    const registry = await makeWidgetRegistry(api);

    const serverCode = 'export default { async render() { return { type: "box" }; } };';
    const manifest = {
      uuid: 'w-evil-001',
      name: 'Sketchy Widget',
      version: 1,
      kind: 'widget',
      repo: 'randomguy/evil-widgets',
      author: 'randomguy',
      // Correct codeHash so integrity PASSES → the trust gate is the sole rejecter.
      codeHash: computeCodeHash({ serverCode }),
    };
    const pack = makeWidgetPack({ manifest, files: { 'server.js': serverCode } });
    const svc = makeWidgetInstall(api, registry, 'sketchy', pack);

    await expect(svc.install('widget', 'sketchy')).rejects.toMatchObject({ code: 'E_UNTRUSTED_CODE' });
    // Nothing was written — the gate fired before WidgetRegistry.import.
    expect(api.tables.slidecast_widgets.rows).toHaveLength(0);
    expect(api.tables.slidecast_widget_versions.rows).toHaveLength(0);
  });

  it('ACCEPTS server_code from an allowlisted first-party repo', async () => {
    const api = makeWidgetApi();
    const registry = await makeWidgetRegistry(api);

    const serverCode = 'export default { async render() { return { type: "box" }; } };';
    const manifest = {
      uuid: 'w-firstparty-001',
      name: 'Official Widget',
      version: 1,
      kind: 'widget',
      repo: 'maaxton/slidecast-marketplace',
      author: 'Waiveo',
      codeHash: computeCodeHash({ serverCode }),
    };
    const pack = makeWidgetPack({ manifest, files: { 'server.js': serverCode } });
    const svc = makeWidgetInstall(api, registry, 'official', pack);

    const result = await svc.install('widget', 'official');
    expect(result.action).toBe('installed');
    const widget = await registry.getByUuid('w-firstparty-001');
    expect(widget.serverCode).toBe(serverCode);
  });
});

describe('WidgetInstallService — codeHash integrity', () => {
  it('REJECTS a pack whose code does not match the catalog-blessed codeHash', async () => {
    const api = makeWidgetApi();
    const registry = await makeWidgetRegistry(api);

    const serverCode = 'export default { async render() { return { type: "box" }; } };';
    const manifest = {
      uuid: 'w-tampered-001',
      name: 'Tampered Widget',
      version: 1,
      kind: 'widget',
      repo: 'maaxton/slidecast-marketplace', // trusted, so trust is NOT the rejecter
      codeHash: 'f'.repeat(64), // wrong on purpose
    };
    const pack = makeWidgetPack({ manifest, files: { 'server.js': serverCode } });
    const svc = makeWidgetInstall(api, registry, 'tampered', pack);

    await expect(svc.install('widget', 'tampered')).rejects.toMatchObject({ code: 'E_CODE_INTEGRITY' });
    expect(api.tables.slidecast_widgets.rows).toHaveLength(0);
  });
});
