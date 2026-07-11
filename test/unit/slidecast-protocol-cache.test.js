import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
// Bare specifier resolved to extensions/slidecast/ by vitest.config.js resolve.alias.
import createProtocolRoutes from 'slidecast/routes/protocol.js';

// Proves the per-(castId,castVersion) memoization of buildWidgetVersionsMap behind
// GET /protocol/cast-version: every screen polls this every ~10s and it recomputes
// the identical per-cast widget-versions map (parse layers.json + stat layer PNGs).
// It must be cached, invalidated by a castVersion bump AND by widget:layer_updated.

const CAST_ID = 'cast-A';
const CAST_VERSION_ROUTE = 'GET /protocol/cast-version [public]';

function makeCast(updatedAt) {
  return {
    uuid: CAST_ID,
    name: 'Test Cast',
    updated_at: updatedAt,
    definition: {
      groups: [{
        id: 'g0',
        name: 'g0',
        slides: [{ id: 's0', elements: [{ type: 'widget', id: 'el1', widgetUuid: 'w1' }] }],
      }],
    },
  };
}

describe('cast-version buildWidgetVersionsMap memoization', () => {
  let tmpDir;
  let slideDir;
  let metaCalls;
  let currentCast;
  let eventBus;
  let routes;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protocache-'));
    slideDir = path.join(tmpDir, CAST_ID, '0');
    await fs.mkdir(slideDir, { recursive: true });
    await fs.writeFile(path.join(slideDir, 'layer-0.png'), 'png-bytes');

    metaCalls = 0;
    currentCast = makeCast('2026-01-01T00:00:00.000Z');
    eventBus = new EventEmitter();

    const slideImageRenderer = {
      getSlideDir: () => slideDir,
      getSlideLayerMetadata: async () => {
        metaCalls += 1;
        return { layers: [{ id: 'el1', file: 'layer-0.png' }] };
      },
    };

    routes = createProtocolRoutes({
      castManager: { getByUuid: async () => currentCast },
      pairingManager: {
        validateToken: async () => ({ valid: true, assigned_cast: CAST_ID, device_serial: 'sc1' }),
      },
      screenManager: { heartbeat: async () => {}, getScreensForCast: async () => [] },
      slideImageRenderer,
      eventBus,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const poll = () => routes[CAST_VERSION_ROUTE]({ query: { token: 't' } });

  it('recomputes once per cast version, then serves the cache', async () => {
    const r1 = await poll();
    expect(r1.success).toBe(true);
    expect(r1.widget_versions.w1).toBeGreaterThan(0);
    expect(metaCalls).toBe(1);

    // Second poll, same cast version → memoized, no recompute.
    await poll();
    expect(metaCalls).toBe(1);
  });

  it('invalidates when castVersion bumps (cast edited)', async () => {
    await poll();
    expect(metaCalls).toBe(1);

    currentCast = makeCast('2026-02-02T00:00:00.000Z'); // new updated_at → new version
    await poll();
    expect(metaCalls).toBe(2);
  });

  it('invalidates on widget:layer_updated for the cast (re-render bumps layer mtime)', async () => {
    await poll();
    expect(metaCalls).toBe(1);

    eventBus.emit('widget:layer_updated', { castId: CAST_ID });
    await poll();
    expect(metaCalls).toBe(2);

    // An event for a different cast must NOT invalidate this cast's entry.
    eventBus.emit('widget:layer_updated', { castId: 'other-cast' });
    await poll();
    expect(metaCalls).toBe(2);
  });
});
