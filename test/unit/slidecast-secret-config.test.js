/**
 * Unit tests for slidecast's secret-config pure helpers (secrets one-stop-shop
 * Wave 2, spec Part D, Task 6). These back the `type:'secret'` Studio field:
 *   - findSecretFields    — which config-schema fields are secret-typed
 *   - stripSecretsForSave — move entered plaintext into the store, leave {$secret} refs
 *   - resolveSecretRefs   — swap {$secret} refs for live decrypted values at render
 *
 * The `slidecast/` bare specifier is aliased to extensions/slidecast/ by
 * backend/vitest.config.js (import/no-relative-packages convention).
 */
import {
  describe, it, expect, vi,
} from 'vitest';
import {
  findSecretFields, stripSecretsForSave, resolveSecretRefs,
} from 'slidecast/widgets/secretConfig.js';

describe('secretConfig — findSecretFields', () => {
  it('returns the keys of every field typed "secret"', () => {
    const schema = {
      apiKey: { type: 'secret', label: 'API Key' },
      token: { type: 'secret' },
      city: { type: 'string' },
      units: { type: 'select', options: [] },
      _tabs: [{ id: 'x' }],
    };
    expect(findSecretFields(schema).sort()).toEqual(['apiKey', 'token']);
  });

  it('returns [] for a null / empty / secret-less schema', () => {
    expect(findSecretFields(null)).toEqual([]);
    expect(findSecretFields(undefined)).toEqual([]);
    expect(findSecretFields({})).toEqual([]);
    expect(findSecretFields({ a: { type: 'string' } })).toEqual([]);
  });
});

describe('secretConfig — stripSecretsForSave', () => {
  const schema = {
    apiKey: { type: 'secret' },
    token: { type: 'secret' },
    city: { type: 'string' },
  };

  it('strips entered plaintext to element-scoped refs and emits store writes', () => {
    const { config, writes } = stripSecretsForSave({
      schema,
      config: { apiKey: 'sk-123', token: 'tok-abc', city: 'NYC' },
      wid: 'w1',
      elementId: 'el7',
    });
    expect(config.apiKey).toEqual({ $secret: 'widget:w1:el7:apiKey' });
    expect(config.token).toEqual({ $secret: 'widget:w1:el7:token' });
    expect(config.city).toBe('NYC'); // non-secret field untouched
    expect(writes).toEqual([
      { key: 'widget:w1:el7:apiKey', value: 'sk-123' },
      { key: 'widget:w1:el7:token', value: 'tok-abc' },
    ]);
    // VALUE-NEVER-LEAKS: no plaintext survives into the persisted config.
    expect(JSON.stringify(config)).not.toContain('sk-123');
    expect(JSON.stringify(config)).not.toContain('tok-abc');
  });

  it('is idempotent — already-stripped {$secret} refs pass through with no writes', () => {
    const input = { apiKey: { $secret: 'widget:w1:el7:apiKey' }, city: 'LA' };
    const { config, writes } = stripSecretsForSave({
      schema, config: input, wid: 'w1', elementId: 'el7',
    });
    expect(config.apiKey).toEqual({ $secret: 'widget:w1:el7:apiKey' });
    expect(writes).toEqual([]);
  });

  it('passes a shared-pick ref {$secret:"shared:<name>"} through untouched', () => {
    const input = { apiKey: { $secret: 'shared:weather_key' } };
    const { config, writes } = stripSecretsForSave({
      schema, config: input, wid: 'w1', elementId: 'el7',
    });
    expect(config.apiKey).toEqual({ $secret: 'shared:weather_key' });
    expect(writes).toEqual([]);
  });

  it('leaves empty / undefined secret fields untouched (no writes)', () => {
    const { config, writes } = stripSecretsForSave({
      schema, config: { apiKey: '', city: 'LA' }, wid: 'w1', elementId: 'el7',
    });
    expect(config.apiKey).toBe('');
    expect(config.city).toBe('LA');
    expect(writes).toEqual([]);
  });

  it('does not mutate the input config object', () => {
    const input = { apiKey: 'sk-1' };
    stripSecretsForSave({
      schema, config: input, wid: 'w1', elementId: 'el7',
    });
    expect(input.apiKey).toBe('sk-1');
  });
});

describe('secretConfig — resolveSecretRefs', () => {
  it('resolves widget-prefixed refs as themselves', async () => {
    const getter = vi.fn(async (k) => (k === 'widget:w1:el7:apiKey' ? 'sk-live' : null));
    const out = await resolveSecretRefs(
      { apiKey: { $secret: 'widget:w1:el7:apiKey' }, city: 'NYC' },
      getter,
    );
    expect(out.apiKey).toBe('sk-live');
    expect(out.city).toBe('NYC');
    expect(getter).toHaveBeenCalledWith('widget:w1:el7:apiKey');
  });

  it('strips the "shared:" prefix before the getter lookup', async () => {
    const getter = vi.fn(async (k) => (k === 'weather_key' ? 'shared-live' : null));
    const out = await resolveSecretRefs({ apiKey: { $secret: 'shared:weather_key' } }, getter);
    expect(out.apiKey).toBe('shared-live');
    expect(getter).toHaveBeenCalledWith('weather_key');
  });

  it('resolves an unresolvable ref (getter returns null) to null and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await resolveSecretRefs({ apiKey: { $secret: 'widget:w1:el7:missing' } }, async () => null);
    expect(out.apiKey).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resolves to null and warns when the getter throws (E_SECRET_NOT_FOUND)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await resolveSecretRefs({ apiKey: { $secret: 'shared:nope' } }, async () => {
      const e = new Error('secret not found');
      e.code = 'E_SECRET_NOT_FOUND';
      throw e;
    });
    expect(out.apiKey).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves non-secret config values untouched', async () => {
    const out = await resolveSecretRefs({ city: 'NYC', n: 5, b: true }, async () => 'x');
    expect(out).toEqual({ city: 'NYC', n: 5, b: true });
  });

  it('returns a non-object config unchanged', async () => {
    expect(await resolveSecretRefs(null, async () => 'x')).toBeNull();
    expect(await resolveSecretRefs(undefined, async () => 'x')).toBeUndefined();
  });
});
