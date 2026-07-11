import { describe, it, expect } from 'vitest';
// Bare specifier resolved to extensions/slidecast/ by vitest.config.js resolve.alias
// (ESLint import/no-relative-packages forbids relative imports across the package boundary).
import { isHomeScreen, decideScreenRecovery } from 'slidecast/watchdogDecision.js';

const DEV = 'dev';

describe('isHomeScreen', () => {
  it('treats ECP type home/menu as Home', () => {
    expect(isHomeScreen({ id: 'x', type: 'home' })).toBe(true);
    expect(isHomeScreen({ id: 'x', type: 'menu' })).toBe(true);
  });
  it('treats id "unknown" (older firmware, nothing foregrounded) as Home', () => {
    expect(isHomeScreen({ id: 'unknown', type: 'unknown' })).toBe(true);
  });
  it('treats a real channel (type appl) as NOT Home', () => {
    expect(isHomeScreen({ id: '12', type: 'appl' })).toBe(false);
  });
  it('treats null/undefined as NOT Home', () => {
    expect(isHomeScreen(null)).toBe(false);
    expect(isHomeScreen(undefined)).toBe(false);
  });
});

describe('decideScreenRecovery', () => {
  it('skips an unreachable / powered-off screen (active null)', () => {
    expect(decideScreenRecovery({ active: null, devChannelId: DEV, poweredOn: true }))
      .toEqual({ action: 'skip', reason: 'unreachable' });
  });

  it('skips a healthy screen already running Waiveo', () => {
    expect(decideScreenRecovery({ active: { id: DEV, type: 'appl' }, devChannelId: DEV, poweredOn: true }))
      .toEqual({ action: 'skip', reason: 'healthy' });
  });

  it('leaves a real foreground app (user opened Netflix) alone', () => {
    expect(decideScreenRecovery({ active: { id: '12', type: 'appl' }, devChannelId: DEV, poweredOn: true }))
      .toEqual({ action: 'skip', reason: 'foreign-app' });
  });

  it('relaunches a powered-on screen sitting on Home', () => {
    expect(decideScreenRecovery({ active: { id: 'unknown', type: 'home' }, devChannelId: DEV, poweredOn: true }))
      .toEqual({ action: 'relaunch', reason: 'home-powered-on' });
  });

  // The crown-jewel regression guard: a standby TV (Fast TV Start still answers
  // ECP as Home) must NOT be woken — this is the "TVs turn back on after I power
  // them off" bug.
  it('does NOT wake a standby TV that reports Home but is powered off', () => {
    expect(decideScreenRecovery({ active: { id: 'unknown', type: 'home' }, devChannelId: DEV, poweredOn: false }))
      .toEqual({ action: 'skip', reason: 'standby' });
  });

  it('treats missing power info as standby (fails safe — never wakes)', () => {
    expect(decideScreenRecovery({ active: { id: 'unknown', type: 'home' }, devChannelId: DEV }))
      .toEqual({ action: 'skip', reason: 'standby' });
  });
});
