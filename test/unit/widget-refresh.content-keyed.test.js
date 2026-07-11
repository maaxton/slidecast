import { describe, it, expect } from 'vitest';
// Bare specifier resolved by vitest.config.js resolve.alias (extensions/slidecast).
import WidgetRefreshService from 'slidecast/WidgetRefreshService.js';

// A cast with ONE non-native (server-rendered) widget placed on slide 0, plus a
// native widget that must be filtered out (native widgets render on-Roku).
function makeCastDefinition() {
  return {
    groups: [{
      id: 'home',
      slides: [{
        id: 's0',
        elements: [
          {
            type: 'widget', id: 'el-weather', widgetUuid: 'w-weather', widgetConfig: { zip: '30513' },
          },
          {
            type: 'widget', id: 'el-clock', widgetUuid: 'w-clock', widgetConfig: {},
          },
          { type: 'text', id: 'el-text' },
        ],
      }],
    }],
  };
}

function makeService({ screens }) {
  const castManager = {
    getByUuid: async (uuid) => (uuid === 'cast-A' ? { uuid: 'cast-A', definition: makeCastDefinition() } : null),
  };
  const widgetRegistry = {
    getByUuid: async (uuid) => {
      if (uuid === 'w-weather') return { renderMode: 'hybrid', refreshInterval: 300000 };
      if (uuid === 'w-clock') return { renderMode: 'native', refreshInterval: 1000 };
      return null;
    },
  };
  const screenManager = {
    getAll: async () => screens,
    getScreensForCast: async (castId) => screens.filter((s) => s.assigned_cast_id === castId),
  };
  return new WidgetRefreshService({}, { screenManager, castManager, widgetRegistry });
}

describe('WidgetRefreshService — content-keyed (per-instance, not per-screen)', () => {
  it('collapses N screens on one cast to ONE instance per (cast, slide, element, widget)', async () => {
    // Seven screens, all online, all showing cast-A.
    const screens = Array.from({ length: 7 }, (_, i) => ({
      serial: `SN${i}`, status: 'online', assigned_cast_id: 'cast-A',
    }));
    const svc = makeService({ screens });

    const desired = await svc._computeDesiredInstances();

    // Exactly one instance — the weather widget on slide 0. NOT seven (one per
    // screen), and the native clock widget is filtered out.
    expect(desired.size).toBe(1);
    const [key, inst] = [...desired.entries()][0];
    expect(key).toBe('cast-A:0:el-weather:w-weather'); // no screen serial in the key
    expect(inst.widgetUuid).toBe('w-weather');
    expect(inst.castId).toBe('cast-A');
    expect(inst.screenSerial).toBeUndefined();
    expect(inst.intervalMs).toBe(300000); // per-widget cadence honored
  });

  it('resolves the per-cast notify fan-out to every screen showing the cast', async () => {
    const screens = [
      { serial: 'SN0', status: 'online', assigned_cast_id: 'cast-A' },
      { serial: 'SN1', status: 'online', assigned_cast_id: 'cast-A' },
      { serial: 'SN2', status: 'online', assigned_cast_id: 'cast-B' },
    ];
    const svc = makeService({ screens });

    const serials = await svc._screensForCast('cast-A');
    expect(serials.sort()).toEqual(['SN0', 'SN1']); // only cast-A's screens, not cast-B's
  });

  it('instanceKey is independent of screen', () => {
    const a = WidgetRefreshService.instanceKey({
      castId: 'c', slideIdx: 2, elementId: 'e', widgetUuid: 'w',
    });
    expect(a).toBe('c:2:e:w');
  });
});
