/**
 * secretConfig — pure, dependency-free helpers for slidecast's `type:'secret'`
 * widget config field (secrets one-stop-shop Wave 2, spec Part D, Task 6). No
 * side effects and no imports, so they unit-test in isolation and stay safe
 * across hot-reload (stateless).
 *
 * Lifecycle of a secret-typed config value:
 *   1. The Studio field puts EITHER a raw string (freshly typed) OR a picker
 *      marker `{ $secretSharedPick: '<name>' }` into element.widgetConfig[field].
 *   2. At cast-save, the intercept (routes/casts.js) converts each picker marker
 *      to a shared reference `{ $secret: 'shared:<name>' }` (and records the
 *      widget's read-grant), then calls `stripSecretsForSave`, which moves any
 *      raw entered string into the encrypted system store and replaces it with a
 *      reference `{ $secret: 'widget:<wid>:<elementId>:<field>' }`. The persisted
 *      cast definition therefore NEVER contains a plaintext secret — only refs.
 *   3. At widget render (WidgetRuntime.execute), `resolveSecretRefs` swaps each
 *      `{ $secret }` reference for the live decrypted value via a getter backed
 *      by the kernel secret accessor.
 */

/** True when a value is a stored secret REFERENCE (`{ $secret: '<key>' }`). */
function isSecretRef(val) {
  return !!val && typeof val === 'object' && !Array.isArray(val) && typeof val.$secret === 'string';
}

/**
 * List the config-schema field keys whose type is `secret`.
 * @param {object} configSchema — flat `{ fieldKey: { type, ... } }` map.
 * @returns {string[]}
 */
export function findSecretFields(configSchema) {
  if (!configSchema || typeof configSchema !== 'object') return [];
  const out = [];
  for (const [key, field] of Object.entries(configSchema)) {
    if (field && typeof field === 'object' && field.type === 'secret') out.push(key);
  }
  return out;
}

/**
 * Strip freshly-entered plaintext out of a widget instance's config, returning a
 * NEW config (never mutates the input) plus the list of store writes to perform.
 *
 * For each secret-typed field:
 *   - a NON-EMPTY plaintext STRING → emit a write keyed
 *     `widget:<wid>:<elementId>:<field>` and replace the value with that
 *     `{ $secret }` reference;
 *   - an existing `{ $secret }` reference (entered-then-saved, or a
 *     picker-converted `shared:<name>` ref) → passes through untouched (idempotent);
 *   - empty / undefined / any non-string value → untouched, no write.
 *
 * @param {{schema: object, config: object, wid: string, elementId: string}} args
 * @returns {{config: object, writes: Array<{key: string, value: string}>}}
 */
export function stripSecretsForSave({
  schema, config, wid, elementId,
}) {
  const source = (config && typeof config === 'object') ? config : {};
  const out = { ...source };
  const writes = [];
  for (const field of findSecretFields(schema)) {
    const val = source[field];
    if (isSecretRef(val)) continue; // already a reference — idempotent passthrough
    if (typeof val === 'string' && val !== '') {
      const key = `widget:${wid}:${elementId}:${field}`;
      writes.push({ key, value: val });
      out[field] = { $secret: key };
    }
    // empty string / undefined / null / non-string → leave as-is, no write
  }
  return { config: out, writes };
}

/**
 * Replace every `{ $secret: '<ref>' }` value in a config with its live decrypted
 * value, returning a NEW config. For a `shared:<name>` reference the `shared:`
 * prefix is stripped before the getter lookup (the kernel accessor `get` is
 * owner-agnostic, so a shared key resolves by its bare name and a
 * `widget:<wid>:...` key resolves as itself). An unresolvable reference — the
 * getter returns null/undefined OR throws — resolves to `null` and logs a warn.
 *
 * @param {object} config
 * @param {(key: string) => (Promise<string>|string)} getSecretFn
 * @returns {Promise<object>}
 */
export async function resolveSecretRefs(config, getSecretFn) {
  if (!config || typeof config !== 'object') return config;
  const out = Array.isArray(config) ? [...config] : { ...config };
  for (const [key, val] of Object.entries(config)) {
    if (!isSecretRef(val)) continue;
    const ref = val.$secret;
    const lookupKey = ref.startsWith('shared:') ? ref.slice('shared:'.length) : ref;
    let resolved = null;
    try {
      resolved = await getSecretFn(lookupKey);
    } catch {
      resolved = null;
    }
    if (resolved == null) {
      console.warn(`[slidecast:secretConfig] unresolvable secret reference for "${key}": ${ref}`);
      out[key] = null;
    } else {
      out[key] = resolved;
    }
  }
  return out;
}
