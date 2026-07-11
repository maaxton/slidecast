/**
 * WidgetSecretStore — slidecast's in-core widget-secret adapter over the ONE
 * kernel/system secret store (secrets one-stop-shop Wave 2, spec Part D, Task 5).
 *
 * Moved here from the monorepo (marketplace v2 Phase 4 core extraction). The
 * real system<->slidecast wiring — a secret set through this adapter actually
 * landing encrypted in `system_secrets`, owned by `widget:<wid>`, and readable
 * back out through the kernel's real `secretsAccessor` singleton — is proven
 * end-to-end by the monorepo's `backend/test/integration/system-extension.test.js`
 * ("system extension — slidecast widget-secret consolidation"), which boots the
 * real backend + DB. This repo has no DB and no kernel — it can't reach that
 * singleton at all, so THIS test proves the slidecast-side unit contract only:
 * WidgetSecretStore maps a bare per-widget key to the kernel's
 * `widget:<wid>:<keyName>` namespace and delegates every operation through the
 * ONE injected accessor (never touches storage directly), and that
 * deleteAll()/teardown wipes a widget's whole namespace via the accessor's
 * prefix-delete.
 *
 * WidgetSecretStore.init() normally resolves the kernel accessor itself via a
 * cwd-absolute dynamic import (see the file's header comment) — there's no
 * constructor-injection seam. For this unit test we skip init() and assign a
 * mock accessor directly to the `.accessor` field (exactly the shape init()
 * would have assigned: the secretsAccessor module's own named exports —
 * getIsolatedSecret/setIsolatedSecret/deleteIsolatedSecret/
 * deleteIsolatedSecretsByPrefix/listIsolatedSecrets — verified against
 * backend/src/sdk/isolation/secretsAccessor.js in the monorepo).
 */
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import WidgetSecretStore from 'slidecast/widgets/WidgetSecretStore.js';

/** In-memory stand-in for the kernel secretsAccessor module's named exports. */
function buildMockAccessor() {
  const rows = new Map(); // fullKey -> { value, created_at }

  return {
    async setIsolatedSecret(_wid, fullKey, value) {
      rows.set(fullKey, { value, created_at: rows.get(fullKey)?.created_at ?? Date.now() });
      return true;
    },
    async getIsolatedSecret(_wid, fullKey) {
      if (!rows.has(fullKey)) {
        const err = new Error(`secret not found: ${fullKey}`);
        err.code = 'E_SECRET_NOT_FOUND';
        throw err;
      }
      return rows.get(fullKey).value;
    },
    async deleteIsolatedSecret(_wid, fullKey) {
      const existed = rows.delete(fullKey);
      return existed ? 1 : 0;
    },
    async deleteIsolatedSecretsByPrefix(wid) {
      const prefix = `widget:${wid}:`;
      let removed = 0;
      for (const key of rows.keys()) {
        if (key.startsWith(prefix)) { rows.delete(key); removed += 1; }
      }
      return removed;
    },
    async listIsolatedSecrets(wid) {
      const prefix = `widget:${wid}:`;
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, row]) => ({ key, created_at: row.created_at }));
    },
    _rows: rows, // test-only escape hatch to assert on raw storage
  };
}

const WID = 'aaaaaaaa-1111-2222-3333-444444444444';
const WID2 = 'bbbbbbbb-5555-6666-7777-888888888888';

describe('WidgetSecretStore', () => {
  let accessor;
  let store;

  beforeEach(() => {
    accessor = buildMockAccessor();
    store = new WidgetSecretStore();
    store.accessor = accessor; // bypass init()'s dynamic import — see file header
  });

  describe('set() / getDecrypted() — namespacing + single-accessor delegation', () => {
    it('set() writes through the accessor under widget:<wid>:<keyName>', async () => {
      await store.set(WID, 'API_KEY', 'route-secret-value');
      expect(accessor._rows.has(`widget:${WID}:API_KEY`)).toBe(true);
      expect(accessor._rows.get(`widget:${WID}:API_KEY`).value).toBe('route-secret-value');
    });

    it('getDecrypted() reads back the value it just set through the same accessor', async () => {
      await store.set(WID, 'API_KEY', 'route-secret-value');
      expect(await store.getDecrypted(WID, 'API_KEY')).toBe('route-secret-value');
    });

    it('getDecrypted() returns null (not throw) for a missing key', async () => {
      expect(await store.getDecrypted(WID, 'NOPE')).toBeNull();
    });

    it('two widgets never collide — each owns its own widget:<wid>: namespace', async () => {
      await store.set(WID, 'API_KEY', 'wid1-value');
      await store.set(WID2, 'API_KEY', 'wid2-value');
      expect(await store.getDecrypted(WID, 'API_KEY')).toBe('wid1-value');
      expect(await store.getDecrypted(WID2, 'API_KEY')).toBe('wid2-value');
    });
  });

  describe('list() — bare key names only, never values', () => {
    it('returns bare keyName entries with hasValue:true and no "value" field', async () => {
      await store.set(WID, 'API_KEY', 'v1');
      await store.set(WID, 'SECOND', 'v2');

      const listed = await store.list(WID);
      expect(listed.map((s) => s.keyName).sort()).toEqual(['API_KEY', 'SECOND']);
      expect(listed.every((s) => !('value' in s) && s.hasValue === true)).toBe(true);
    });

    it('does not leak another widget\'s keys', async () => {
      await store.set(WID, 'API_KEY', 'v1');
      await store.set(WID2, 'OTHER', 'v2');
      expect((await store.list(WID)).map((s) => s.keyName)).toEqual(['API_KEY']);
    });
  });

  describe('delete() — removes one key through the accessor', () => {
    it('delete() removes one key; getDecrypted then returns null', async () => {
      await store.set(WID, 'SECOND', 'v2');
      expect(await store.delete(WID, 'SECOND')).toBe(true);
      expect(await store.getDecrypted(WID, 'SECOND')).toBeNull();
    });

    it('delete() of a key that does not exist returns false', async () => {
      expect(await store.delete(WID, 'GHOST')).toBe(false);
    });
  });

  describe('deleteAll() — widget-removal teardown wipes the whole widget:<wid>: namespace', () => {
    it('wipes every key for the widget, leaving other widgets untouched', async () => {
      await store.set(WID, 'API_KEY', 'v1');
      await store.set(WID, 'THIRD', 'v3');
      await store.set(WID2, 'KEEPME', 'keep');

      const removed = await store.deleteAll(WID);
      expect(removed).toBeGreaterThanOrEqual(2); // at least API_KEY + THIRD

      expect(await store.list(WID)).toEqual([]);
      // the other widget's namespace is untouched by this widget's teardown
      expect(await store.list(WID2)).toEqual([{
        keyName: 'KEEPME', createdAt: accessor._rows.get(`widget:${WID2}:KEEPME`).created_at, hasValue: true,
      }]);
    });
  });
});
