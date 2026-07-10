/**
 * Pure decision logic for ScreenWatchdogService.
 *
 * Extracted so the Home/PowerOn recovery rule — the fix for "the TVs turn back
 * on ~60s after I power them off" (see memory roku-autolaunch-flapping-suspend)
 * — is unit-testable without ECP I/O. All the network calls (active-app query,
 * power-mode query, launch) stay in the service; these functions take the
 * already-gathered facts and return a decision, so both branches of the
 * critical standby-vs-powered-on distinction can be asserted directly.
 */

/**
 * Is the Roku sitting on the Home screen / blank (recoverable), vs running a
 * real channel the user opened (leave it alone)? The Home screen reports ECP
 * app type 'home'/'menu' (its NAME varies by firmware — "Home", "Roku", "Roku
 * Dynamic Menu"); a real channel reports type 'appl'. Older firmware with
 * nothing foregrounded yields id 'unknown'. Recover only those.
 *
 * @param {{ id: string, type: string } | null | undefined} active
 * @returns {boolean}
 */
export function isHomeScreen(active) {
  if (!active) { return false; }
  return active.type === 'home' || active.type === 'menu' || active.id === 'unknown';
}

/**
 * Decide whether to relaunch Waiveo on one screen, given the facts gathered
 * over ECP. Pure — no I/O. Mirrors ScreenWatchdogService.tick() exactly.
 *
 * @param {object} params
 * @param {{ id: string, type: string } | null} params.active - active-app result
 *   (null = unreachable / powered off — the common case for a dark screen).
 * @param {string} params.devChannelId - the sideloaded Waiveo channel id.
 * @param {boolean} [params.poweredOn] - ECP power-mode === 'PowerOn'. Only
 *   meaningful (and only queried by the caller) once the screen is on Home.
 * @returns {{ action: 'relaunch' | 'skip', reason: string }}
 */
export function decideScreenRecovery({ active, devChannelId, poweredOn }) {
  if (!active) { return { action: 'skip', reason: 'unreachable' }; }
  if (active.id === devChannelId) { return { action: 'skip', reason: 'healthy' }; }
  if (!isHomeScreen(active)) { return { action: 'skip', reason: 'foreign-app' }; }

  // On Home / blank → recover ONLY if the display is genuinely powered on. A
  // Roku TV in standby with "Fast TV Start" still answers ECP and reports its
  // active app as Home, so onHome alone cannot tell "powered on, sitting on
  // Home (recover)" from "user turned it off (leave alone)". launch/dev wakes a
  // standby TV, so without this gate the watchdog turns TVs back on every poll.
  // Require an explicit true — anything else (false/undefined) is treated as
  // standby and left alone.
  if (poweredOn !== true) { return { action: 'skip', reason: 'standby' }; }

  return { action: 'relaunch', reason: 'home-powered-on' };
}
