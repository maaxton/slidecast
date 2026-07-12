/**
 * Widget secret "needs" — the dynamic Variables & Secrets surfacing of an EMPTY
 * widget `type:'secret'` config field (secrets one-stop-shop Wave 2, spec Part D,
 * Task 7). No manifest — a "need" comes straight from the widget's own
 * `configSchema` secret fields at cast-save.
 *
 * Three layers, each exercised against the REAL production code (never
 * re-implemented in the test):
 *
 *  1. WidgetSecretStore.registerNeed/deregisterNeed/deregisterAllNeeds — thin
 *     passthroughs onto the kernel secretsAccessor's registerIsolatedNeed/
 *     deregisterIsolatedNeed/deregisterIsolatedNeedsByOwner. Mirrors
 *     widget-secret-store.test.js's accessor-mock pattern (bypass init()'s
 *     cwd-absolute dynamic import — assign `.accessor` directly).
 *  2. routes/casts.js's cast-save intercept (stripSecretsFromDefinition, via
 *     `POST /casts` / `PUT /casts/:id`) — an EMPTY type:'secret' field
 *     registers a need; a freshly-entered value writes the secret AND
 *     deregisters the need. Mirrors slidecast-protocol-cache.test.js's
 *     createXRoutes(deps) + routes['METHOD /path'](ctx) pattern.
 *  3. WidgetRegistry.delete() — widget removal clears every need it owned.
 *     Mirrors slidecast-content-marketplace.test.js's in-memory `api.model()`
 *     + WidgetRegistry harness, exercising the real delete() teardown.
 */
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import WidgetSecretStore from 'slidecast/widgets/WidgetSecretStore.js';
import WidgetRegistry from 'slidecast/widgets/WidgetRegistry.js';
import createCastRoutes from 'slidecast/routes/casts.js';

const WIDGET_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

const SCHEMA = {
  apiKey: { type: 'secret', label: 'API Key', description: 'Weather API key' },
  city: { type: 'string' },
};

/**
 * In-memory stand-in for the kernel secretsAccessor module's named exports
 * (extends widget-secret-store.test.js's buildMockAccessor with the Task 7
 * need-registry functions).
 */
function buildMockAccessor() {
  const secrets = new Map(); // fullKey -> value
  const needs = new Map(); // fullKey -> { wid, meta }

  return {
    async setIsolatedSecret(_wid, fullKey, value) { secrets.set(fullKey, value); return true; },
    async getIsolatedSecret(_wid, fullKey) {
      if (!secrets.has(fullKey)) {
        const e = new Error(`secret not found: ${fullKey}`);
        e.code = 'E_SECRET_NOT_FOUND';
        throw e;
      }
      return secrets.get(fullKey);
    },
    async deleteIsolatedSecret(_wid, fullKey) { return secrets.delete(fullKey) ? 1 : 0; },
    async deleteIsolatedSecretsByPrefix(wid) {
      const prefix = `widget:${wid}:`;
      let removed = 0;
      for (const key of secrets.keys()) if (key.startsWith(prefix)) { secrets.delete(key); removed += 1; }
      return removed;
    },
    async listIsolatedSecrets() { return []; },
    async registerIsolatedNeed(wid, keyName, meta = {}) {
      needs.set(keyName, { wid, meta });
      return { key: keyName, owner_extension: `widget:${wid}` };
    },
    async deregisterIsolatedNeed(_wid, keyName) {
      return { deleted: needs.delete(keyName) ? 1 : 0 };
    },
    async deregisterIsolatedNeedsByOwner(wid) {
      let deleted = 0;
      for (const [key, row] of needs) {
        if (row.wid === wid) { needs.delete(key); deleted += 1; }
      }
      return { deleted };
    },
    _secrets: secrets,
    _needs: needs, // test-only escape hatch
  };
}

describe('WidgetSecretStore — need passthroughs (Task 7)', () => {
  let accessor;
  let store;

  beforeEach(() => {
    accessor = buildMockAccessor();
    store = new WidgetSecretStore();
    store.accessor = accessor; // bypass init()'s dynamic import — see widget-secret-store.test.js
  });

  it('registerNeed() delegates to the accessor with the fully-qualified key + meta', async () => {
    const key = `widget:${WIDGET_UUID}:el1:apiKey`;
    await store.registerNeed(WIDGET_UUID, key, { label: 'API Key', description: 'x' });
    expect(accessor._needs.has(key)).toBe(true);
    expect(accessor._needs.get(key)).toEqual({ wid: WIDGET_UUID, meta: { label: 'API Key', description: 'x' } });
  });

  it('deregisterNeed() removes one need by its fully-qualified key', async () => {
    const key = `widget:${WIDGET_UUID}:el1:apiKey`;
    await store.registerNeed(WIDGET_UUID, key, {});
    await store.deregisterNeed(WIDGET_UUID, key);
    expect(accessor._needs.has(key)).toBe(false);
  });

  it('deregisterAllNeeds() wipes every need owned by the widget, leaving other widgets untouched', async () => {
    await store.registerNeed(WIDGET_UUID, `widget:${WIDGET_UUID}:el1:apiKey`, {});
    await store.registerNeed(WIDGET_UUID, `widget:${WIDGET_UUID}:el2:token`, {});
    await store.registerNeed('other-wid', 'widget:other-wid:el1:apiKey', {});

    await store.deregisterAllNeeds(WIDGET_UUID);

    expect([...accessor._needs.keys()]).toEqual(['widget:other-wid:el1:apiKey']);
  });
});

describe('routes/casts.js — cast-save need registration (Task 7)', () => {
  /** Minimal in-memory slidecast_casts table (create/findOne/update — matches ctx.data usage). */
  class CastsTable {
    constructor() { this.rows = []; this.seq = 0; }

    _match(row, where) {
      return !where || Object.entries(where).every(([k, v]) => row[k] === v);
    }

    async findAll() { return this.rows.map((r) => ({ ...r })); }

    async findOne(where) {
      const r = this.rows.find((row) => this._match(row, where));
      return r ? { ...r } : null;
    }

    async create(data) {
      const row = { id: ++this.seq, ...data };
      this.rows.push(row);
      return { ...row };
    }

    async update(where, patch) {
      const r = this.rows.find((row) => this._match(row, where));
      if (!r) return 0;
      Object.assign(r, patch);
      return 1;
    }
  }

  function makeDefinition(apiKeyValue) {
    return {
      groups: [{
        id: 'g0',
        name: 'Home',
        slides: [{
          id: 's0',
          elements: [{
            id: 'el1',
            type: 'widget',
            widgetUuid: WIDGET_UUID,
            widgetConfig: { apiKey: apiKeyValue, city: 'NYC' },
          }],
        }],
      }],
    };
  }

  function makeWidgetSecretsSpy() {
    const calls = { setRaw: [], registerNeed: [], deregisterNeed: [] };
    return {
      calls,
      async setRaw(wid, key, value) { calls.setRaw.push({ wid, key, value }); },
      async registerNeed(wid, key, meta) { calls.registerNeed.push({ wid, key, meta }); },
      async deregisterNeed(wid, key) { calls.deregisterNeed.push({ wid, key }); },
    };
  }

  function makeDeps(widgetSecrets) {
    return {
      widgetRegistry: { getAll: async () => [{ uuid: WIDGET_UUID, configSchema: SCHEMA }] },
      widgetSecrets,
      logger: {
        warn: () => {}, debug: () => {}, info: () => {}, error: () => {},
      },
      previewManager: { notifyCastUpdated: () => {} },
    };
  }

  it('POST /casts with an empty type:secret field registers a need (no store write)', async () => {
    const widgetSecrets = makeWidgetSecretsSpy();
    const routes = createCastRoutes(makeDeps(widgetSecrets));
    const ctx = {
      data: { slidecast_casts: new CastsTable() },
      body: { name: 'Cast A', definition: makeDefinition('') },
    };

    const res = await routes['POST /casts'](ctx);

    expect(res.success).toBe(true);
    const key = `widget:${WIDGET_UUID}:el1:apiKey`;
    expect(widgetSecrets.calls.setRaw).toEqual([]);
    expect(widgetSecrets.calls.registerNeed).toEqual([
      { wid: WIDGET_UUID, key, meta: { label: 'API Key', description: 'Weather API key' } },
    ]);
    expect(widgetSecrets.calls.deregisterNeed).toEqual([]);
  });

  it('PUT /casts/:id filling the field writes the secret and deregisters the need', async () => {
    const widgetSecrets = makeWidgetSecretsSpy();
    const dataTable = new CastsTable();
    const now = new Date().toISOString();
    await dataTable.create({
      uuid: 'cast-1',
      name: 'Cast A',
      description: '',
      definition: JSON.stringify(makeDefinition('')),
      thumbnail: null,
      created_at: now,
      updated_at: now,
    });

    const routes = createCastRoutes(makeDeps(widgetSecrets));
    const ctx = {
      data: { slidecast_casts: dataTable },
      params: { id: 'cast-1' },
      body: { definition: makeDefinition('sk-live-123') },
    };

    const res = await routes['PUT /casts/:id'](ctx);

    expect(res.success).toBe(true);
    const key = `widget:${WIDGET_UUID}:el1:apiKey`;
    expect(widgetSecrets.calls.setRaw).toEqual([{ wid: WIDGET_UUID, key, value: 'sk-live-123' }]);
    expect(widgetSecrets.calls.deregisterNeed).toEqual([{ wid: WIDGET_UUID, key }]);
    expect(widgetSecrets.calls.registerNeed).toEqual([]);
  });

  it('a save failure in the need bridge never breaks the cast save (best-effort)', async () => {
    const widgetSecrets = makeWidgetSecretsSpy();
    widgetSecrets.registerNeed = async () => { throw new Error('kernel unavailable'); };
    const routes = createCastRoutes(makeDeps(widgetSecrets));
    const ctx = {
      data: { slidecast_casts: new CastsTable() },
      body: { name: 'Cast A', definition: makeDefinition('') },
    };

    const res = await routes['POST /casts'](ctx);

    expect(res.success).toBe(true);
  });
});

describe('WidgetRegistry.delete() — widget removal clears its needs (Task 7)', () => {
  /** Minimal in-memory table matching the api.model() surface WidgetRegistry uses. */
  class Tbl {
    constructor() { this.rows = []; this.seq = 0; }

    async findAll(opts = {}) {
      const where = opts && opts.where;
      return this.rows
        .filter((r) => !where || Object.entries(where).every(([k, v]) => r[k] === v))
        .map((r) => ({ ...r }));
    }

    async create(data) {
      const row = { id: ++this.seq, ...data };
      this.rows.push(row);
      return { ...row };
    }

    async delete(id) {
      const i = this.rows.findIndex((r) => r.id === id);
      if (i === -1) return 0;
      this.rows.splice(i, 1);
      return 1;
    }
  }

  async function makeRegistry() {
    const tables = {
      slidecast_widgets: new Tbl(),
      slidecast_widget_versions: new Tbl(),
      slidecast_widget_assets: new Tbl(),
      slidecast_widget_storage: new Tbl(),
    };
    const api = { model: (name) => tables[name] };
    const registry = new WidgetRegistry(api);
    await registry.init();
    return registry;
  }

  it('calls secretStore.deregisterAllNeeds(uuid) alongside deleteAll(uuid)', async () => {
    const registry = await makeRegistry();
    const widget = await registry.create({ uuid: WIDGET_UUID, name: 'Weather', configSchema: SCHEMA });

    const secretStoreCalls = { deleteAll: [], deregisterAllNeeds: [] };
    registry.setSecretStore({
      async deleteAll(wid) { secretStoreCalls.deleteAll.push(wid); return 2; },
      async deregisterAllNeeds(wid) { secretStoreCalls.deregisterAllNeeds.push(wid); },
    });

    const ok = await registry.delete(widget.uuid);

    expect(ok).toBe(true);
    expect(secretStoreCalls.deleteAll).toEqual([WIDGET_UUID]);
    expect(secretStoreCalls.deregisterAllNeeds).toEqual([WIDGET_UUID]);
  });

  it('a secretStore failure is caught and never blocks widget deletion', async () => {
    const registry = await makeRegistry();
    const widget = await registry.create({ uuid: WIDGET_UUID, name: 'Weather', configSchema: SCHEMA });

    registry.setSecretStore({
      async deleteAll() { return 0; },
      async deregisterAllNeeds() { throw new Error('kernel unavailable'); },
    });

    const ok = await registry.delete(widget.uuid);
    expect(ok).toBe(true);
  });
});
