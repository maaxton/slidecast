import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../utils/Logger.js';

/**
 * WidgetSecretStore — slidecast's in-core widget-secret adapter over the ONE
 * kernel/system secret store (secrets one-stop-shop Wave 2, spec Part D, Task 5).
 *
 * This REPLACES the deleted parallel store (widgets/WidgetSecrets.js + the
 * `slidecast_widget_secrets` table + its own AES key in
 * `slidecast_settings.widget_encryption_key`). Every widget secret now lives in
 * `system_secrets`, encrypted under the ONE host key (WAIVEO_SECRETS_KEY),
 * owned by `widget:<wid>`, and every write/delete is audited by the system
 * extension — one store, one key, one audit trail.
 *
 * How it reaches the store: the isolated widget broker path already routes
 * `ctx.secrets.*` through the kernel `secretsAccessor` singleton (which the
 * `system` extension registers at init). Slidecast's IN-CORE WidgetRuntime path
 * (WidgetAPI.createSecretsApi + the /widgets/:uuid/secrets routes) is NOT
 * brokered, so it needs the same singleton DIRECTLY. An extension cannot
 * static-import core `backend/src/...` (as a hot-deploy override, the relative
 * path doesn't resolve), so — exactly like extensions/system/services/coreBridge.js
 * — we load the accessor by an ABSOLUTE path from process.cwd() (always the
 * backend dir). The canonical (token-free) file URL guarantees this is the SAME
 * module instance the system extension registered its accessor on, so
 * getIsolatedSecret/setIsolatedSecret/... here hit the live store.
 *
 * Key mapping: the in-core surface keys by a bare `keyName` (no element
 * context). Kernel keys live under the widget's own namespace prefix, so a bare
 * key maps to `widget:<wid>:<keyName>`. deleteAll wipes the whole
 * `widget:<wid>:` prefix, so it also catches Task 6's element-scoped
 * `widget:<wid>:<elementId>:<field>` keys.
 */

const WIDGET_PREFIX = (wid) => `widget:${wid}:`;

class WidgetSecretStore {
  constructor() {
    this.accessor = null;
  }

  async init() {
    // Resolve the ONE canonical kernel accessor module (shared singleton) — same
    // resolution the system extension's coreBridge uses, so the accessor the
    // system extension registered is visible here.
    const abs = path.join(process.cwd(), 'src', 'sdk', 'isolation', 'secretsAccessor.js');
    this.accessor = await import(pathToFileURL(abs).href);
    logger.info('WidgetSecretStore initialized (kernel/system secret store)');
  }

  _require() {
    if (!this.accessor) throw new Error('WidgetSecretStore not initialized — call init() first');
    return this.accessor;
  }

  /** Map a bare per-widget key to its kernel own-namespace key. */
  _key(wid, keyName) {
    return `${WIDGET_PREFIX(wid)}${keyName}`;
  }

  /**
   * Set (upsert) a secret for a widget. Stored encrypted under the system
   * master key, owned by `widget:<wid>`, and audited by the system extension.
   */
  async set(widgetUuid, keyName, value) {
    await this._require().setIsolatedSecret(widgetUuid, this._key(widgetUuid, keyName), value);
    logger.debug(`Secret '${keyName}' set for widget ${widgetUuid}`);
    return true;
  }

  /** Get a decrypted secret value, or null if it does not exist. */
  async getDecrypted(widgetUuid, keyName) {
    try {
      return await this._require().getIsolatedSecret(widgetUuid, this._key(widgetUuid, keyName));
    } catch (error) {
      if (error && error.code === 'E_SECRET_NOT_FOUND') return null;
      logger.error(`Failed to read secret '${keyName}' for widget ${widgetUuid}: ${error.message}`);
      return null;
    }
  }

  /** List secret KEY NAMES for a widget (never values). */
  async list(widgetUuid) {
    const rows = await this._require().listIsolatedSecrets(widgetUuid);
    const prefix = WIDGET_PREFIX(widgetUuid);
    return rows.map((r) => ({
      keyName: r.key.startsWith(prefix) ? r.key.slice(prefix.length) : r.key,
      createdAt: r.created_at ?? null,
      hasValue: true,
    }));
  }

  /** Delete one secret. Returns true if a row was removed. */
  async delete(widgetUuid, keyName) {
    const removed = await this._require().deleteIsolatedSecret(widgetUuid, this._key(widgetUuid, keyName));
    const ok = Number(removed) > 0;
    if (ok) logger.debug(`Secret '${keyName}' deleted for widget ${widgetUuid}`);
    return ok;
  }

  /**
   * Delete EVERY secret in a widget's `widget:<wid>:` namespace — the
   * widget-removal teardown (WidgetRegistry.deleteWidget). Returns rows removed.
   */
  async deleteAll(widgetUuid) {
    return this._require().deleteIsolatedSecretsByPrefix(widgetUuid);
  }

  /**
   * Write an ALREADY-fully-qualified kernel key (e.g. the element-scoped
   * `widget:<wid>:<elementId>:<field>` produced by the Task 6 cast-save
   * intercept) — no bare-key `widget:<wid>:` mapping is applied. The broker's
   * own-prefix rule is satisfied because the key already starts with the
   * widget's own namespace.
   */
  async setRaw(widgetUuid, fullKey, value) {
    await this._require().setIsolatedSecret(widgetUuid, fullKey, value);
    logger.debug(`Secret key '${fullKey}' set for widget ${widgetUuid}`);
    return true;
  }

  /**
   * Resolve an EXACT key (owner-agnostic get) — the Task 6 render-time secret
   * reference resolution. `fullKey` is either a widget-own
   * `widget:<wid>:<elementId>:<field>` key or a bare shared-secret name
   * (the `shared:` prefix is stripped by resolveSecretRefs before this call).
   * Returns the plaintext value, or throws (E_SECRET_NOT_FOUND when absent).
   */
  async getRaw(widgetUuid, fullKey) {
    return this._require().getIsolatedSecret(widgetUuid, fullKey);
  }
}

export default WidgetSecretStore;
