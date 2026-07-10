import logger from './utils/Logger.js';
import { isHomeScreen, decideScreenRecovery } from './watchdogDecision.js';

const ROKU_ECP_PORT = 8060;

/**
 * ScreenWatchdogService — keeps signage screens on the Waiveo channel.
 *
 * Sideloaded Roku channels do NOT auto-launch when the Roku powers on: the
 * device boots to the Home screen and sits there. So any screen that gets
 * power-cycled (a power blip, a manual off/on, a nightly auto-off) — or that
 * drops to Home for any other reason (e.g. a transient crash) — goes blank and
 * STAYS blank until someone relaunches the app by hand. That is the root cause
 * of "the TV just won't load Waiveo."
 *
 * This watchdog polls every known screen over ECP. If a reachable screen is NOT
 * running the Waiveo dev channel, it relaunches it via `launch/dev`. The box
 * already reaches every screen (it serves their casts and we relaunch by hand
 * the same way), so recovery is automatic within one poll interval and no
 * person has to notice. A per-screen cooldown prevents a relaunch loop while a
 * screen is still coming up, and unreachable screens (genuinely powered off)
 * are simply skipped until they come back.
 */
class ScreenWatchdogService {
  constructor(api, options = {}) {
    this.api = api;
    this.screenManager = options.screenManager || null;

    this.enabled = options.enabled !== false;
    this.intervalMs = options.intervalMs || 60000; // poll cadence (1 min)
    this.initialDelayMs = options.initialDelayMs || 20000; // first pass after boot
    this.ecpTimeoutMs = options.ecpTimeoutMs || 4000; // per ECP request
    this.relaunchCooldownMs = options.relaunchCooldownMs || 120000; // don't re-fire within 2 min
    this.devChannelId = options.devChannelId || 'dev'; // sideloaded Waiveo channel id

    this._timer = null;
    this._initialTimer = null;
    this._running = false;
    this._lastRelaunch = new Map(); // serial -> timestamp of last relaunch
  }

  start() {
    if (!this.enabled) {
      logger.info('[screen-watchdog] disabled');
      return;
    }
    if (this._timer) return;
    logger.info(
      `[screen-watchdog] started — poll ${Math.round(this.intervalMs / 1000)}s, `
      + `relaunch cooldown ${Math.round(this.relaunchCooldownMs / 1000)}s`,
    );
    this._timer = setInterval(() => {
      this.tick().catch((e) => logger.warn(`[screen-watchdog] tick failed: ${e && e.message}`));
    }, this.intervalMs);
    if (this._timer.unref) this._timer.unref();

    // First pass shortly after boot — but delayed so freshly-powered screens
    // get a moment to come up on their own before we kick them.
    this._initialTimer = setTimeout(() => {
      this.tick().catch((e) => logger.warn(`[screen-watchdog] initial tick failed: ${e && e.message}`));
    }, this.initialDelayMs);
    if (this._initialTimer.unref) this._initialTimer.unref();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._initialTimer) { clearTimeout(this._initialTimer); this._initialTimer = null; }
  }

  async tick() {
    if (this._running) return; // never let ticks overlap
    this._running = true;
    try {
      if (!(await this._isGloballyEnabled())) return; // global kill switch (screen_watchdog_enabled)
      const screens = await this._getScreens();
      const now = Date.now();
      let relaunched = 0;
      for (const s of screens) {
        if (!s || !s.ip_address) continue; // no IP (ghost record / never discovered)
        // Per-screen opt-out. NULL/undefined (column absent on old rows, or a
        // raw row read before migration added it) means enabled — only an
        // explicit 0/false disables recovery for this screen.
        if (s.watchdog_enabled === 0 || s.watchdog_enabled === '0' || s.watchdog_enabled === false) continue;
        const last = this._lastRelaunch.get(s.serial) || 0;
        if (now - last < this.relaunchCooldownMs) continue; // recently kicked — give it time to come up

        // The recovery rule (Home + genuinely PowerOn) lives in the pure
        // decideScreenRecovery() so both branches are unit-tested. Here we only
        // gather the ECP facts it needs, skipping the extra power-mode call for
        // screens we would never recover anyway (unreachable / already healthy /
        // a real foreground app the user opened — e.g. Netflix, YouTube).
        const active = await this._activeApp(s.ip_address);
        if (active === null) continue; // off / unreachable — nothing to do
        if (active.id === this.devChannelId) continue; // Waiveo is running — healthy
        if (!isHomeScreen(active)) continue; // a real app is foreground — leave it be

        // On Home / blank → only now query power-mode, then let the pure decision
        // gate standby (Fast TV Start answers ECP as Home even while off; relaunch
        // would wake it — the flapping bug).
        const poweredOn = await this._isPoweredOn(s.ip_address);
        const decision = decideScreenRecovery({ active, devChannelId: this.devChannelId, poweredOn });
        if (decision.action !== 'relaunch') continue; // standby/off — do NOT wake it

        // Reachable, powered on, and sitting on Home / blank → relaunch Waiveo.
        const ok = await this._launchDev(s.ip_address);
        if (ok) {
          this._lastRelaunch.set(s.serial, now);
          relaunched++;
          logger.info(
            `[screen-watchdog] relaunched Waiveo on "${s.name}" (${s.ip_address}) — was on app "${active.id}"`,
          );
        } else {
          logger.warn(`[screen-watchdog] relaunch failed for "${s.name}" (${s.ip_address})`);
        }
      }
      if (relaunched > 0) logger.info(`[screen-watchdog] recovered ${relaunched} screen(s)`);
    } finally {
      this._running = false;
    }
  }

  /**
   * Read the global `screen_watchdog_enabled` slidecast_settings toggle at
   * tick time (no restart needed to flip it). Absent row / unreadable
   * settings table = enabled (matches the per-screen default-on behavior and
   * fails open so a settings glitch never silently disables recovery).
   */
  async _isGloballyEnabled() {
    try {
      const rows = await this.api.model('slidecast_settings').findAll({ where: { key: 'screen_watchdog_enabled' } });
      if (rows && rows.length > 0) return rows[0].value !== 'false';
      return true;
    } catch (_) {
      return true;
    }
  }

  /**
   * Is the Roku's display genuinely powered on? Reads ECP power-mode. Only
   * 'PowerOn' means the display is on; Ready / DisplayOff / Suspend / Headless /
   * PowerOff are standby sub-modes (the TV is off but may still answer ECP under
   * Fast TV Start). Unreachable → treat as off. Prevents the watchdog from
   * waking a TV the user turned off.
   */
  async _isPoweredOn(ip) {
    try {
      const res = await fetch(`http://${ip}:${ROKU_ECP_PORT}/query/device-info`, {
        signal: AbortSignal.timeout(this.ecpTimeoutMs),
      });
      if (!res.ok) return false;
      const xml = await res.text();
      const m = xml.match(/<power-mode>([^<]*)<\/power-mode>/i);
      const mode = (m ? m[1] : '').trim().toLowerCase();
      return mode === 'poweron';
    } catch (_) {
      return false;
    }
  }

  async _getScreens() {
    if (this.screenManager && typeof this.screenManager.getAll === 'function') {
      return this.screenManager.getAll();
    }
    const rows = await this.api.model('slidecast_screens').findAll();
    return rows || [];
  }

  /**
   * Query the Roku's active app over ECP. Returns { id, name, type } or null if
   * the device is unreachable / off (the common case for a powered-down screen).
   * `type` is the ECP app type ('home'/'menu' for the Home screen, 'appl' for a
   * channel) — the reliable Home discriminator, since the Home screen's NAME
   * varies by firmware.
   */
  async _activeApp(ip) {
    try {
      const res = await fetch(`http://${ip}:${ROKU_ECP_PORT}/query/active-app`, {
        signal: AbortSignal.timeout(this.ecpTimeoutMs),
      });
      if (!res.ok) return null;
      const xml = await res.text();
      const m = xml.match(/<app\s+([^>]*)>([^<]*)<\/app>/);
      if (m) {
        const attrs = m[1];
        const id = (attrs.match(/id="([^"]*)"/) || [])[1] || 'unknown';
        const type = (attrs.match(/type="([^"]*)"/) || [])[1] || 'app';
        return { id, name: m[2], type };
      }
      // No attributed <app> (e.g. bare screensaver / older-firmware Home) → treat
      // as Home/blank so the watchdog still recovers it.
      return { id: 'unknown', name: '', type: 'unknown' };
    } catch (_) {
      return null; // timeout / connection refused / DNS — treat as off/unreachable
    }
  }

  async _launchDev(ip) {
    try {
      const res = await fetch(`http://${ip}:${ROKU_ECP_PORT}/launch/${this.devChannelId}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.ecpTimeoutMs),
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }
}

export default ScreenWatchdogService;
