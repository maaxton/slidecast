/**
 * Pairing Helpers - Discovery matching and device formatting for Roku pairing
 *
 * Extracted from protocol.js to share between route handlers.
 */

/**
 * Format a device_registry row into a clean device object
 */
export function formatDiscoveredDevice(device) {
  return {
    device_id: device.id,
    name: device.friendly_name || device.hostname || 'Roku Device',
    ip_address: device.ip_address,
    serial_number: device.serial_number || device.id?.replace('roku:', ''),
    model: device.model,
    manufacturer: device.manufacturer,
    mac_address: device.mac_address,
    extra_data: typeof device.extra_data === 'string'
      ? JSON.parse(device.extra_data || '{}')
      : (device.extra_data || {}),
  };
}

/**
 * Find a discovered Roku device that can be linked to this pairing request.
 *
 * The Roku app sends a ChannelClientId (unique per channel install) which is
 * DIFFERENT from the hardware serial number in discovery. So we need to match
 * by other means:
 *
 * 1. Check if ChannelClientId is already linked to a screen (returning Roku)
 * 2. Check if there's a discovered Roku not yet linked to any screen (new pairing)
 *
 * @param {string} channelClientId - The Roku ChannelClientId from the pairing request
 * @param {Object} deps - Dependencies
 * @param {Object} deps.screenManager - The screen manager instance
 * @param {Function} deps.queryFn - Query function: (table) => queryBuilder (must support .where().get())
 * @param {Object} deps.logger - Logger instance
 * @param {string} [deps.hardwareSerial] - Optional Roku hardware serial (GetDeviceUniqueId).
 *   When provided, prefer matching by hardware serial against device_registry so that
 *   a channel sideload (which rotates ChannelClientId) still recovers the paired screen
 *   without a manual code. This closes the auto-pair recovery gap from #1139.
 * @returns {{ discoveredDevice: Object|null, existingScreen: Object|null }}
 */
export async function findDiscoveredRokuForPairing(channelClientId, {
  screenManager, queryFn, logger, hardwareSerial,
}) {
  // #1671: a PENDING (unclaimed, non-dismissed) discovery candidate is a valid
  // pairing target — the app connecting is the consent, so we auto-admit it.
  // Returns a discoveredDevice-shaped object flagged `pendingCandidate` so the
  // route emits discovery:claim-device (register + screen) before issuing a token.
  async function findPendingRokuCandidate() {
    try {
      const candidates = await queryFn('discovery_candidates')
        .where('claimed_by', 'IS', null)
        .where('ignored', '=', 0)
        .get();
      const rokuCandidates = (candidates || []).filter((c) => String(c.device_type || '').toLowerCase() === 'roku');
      if (rokuCandidates.length === 0) return null;

      // Prefer a hardware-serial match against the confirmed metadata; else use
      // the most-recently-seen pending Roku (mirrors the registry "first" fallback).
      const pickSerial = (c) => {
        const raw = typeof c.raw_data === 'string' ? safeParse(c.raw_data) : (c.raw_data || {});
        return raw?.confirmed?.serial_number || raw?.serial_number || null;
      };
      // #1671 (I3): only AUTO-admit on a REAL match. When the connecting app
      // supplies a hardware serial, it must match a pending candidate's confirmed
      // serial — otherwise we'd silently admit the wrong device (the most-recently
      // seen pending Roku). On no serial match, return null so the manual 6-digit
      // code fallback handles it. Without a serial, only an UNAMBIGUOUS single
      // pending Roku is safe to admit; multiple candidates → defer to manual.
      let match = null;
      if (hardwareSerial) {
        match = rokuCandidates.find((c) => pickSerial(c) === hardwareSerial) || null;
        if (!match) {
          logger.info(`App hardware serial ${hardwareSerial} matched no pending Roku candidate — deferring to manual pairing`);
          return null;
        }
      } else if (rokuCandidates.length === 1) {
        [match] = rokuCandidates;
      } else {
        logger.info(`${rokuCandidates.length} pending Roku candidates and no hardware serial — deferring to manual pairing`);
        return null;
      }
      if (!match) return null;

      const raw = typeof match.raw_data === 'string' ? safeParse(match.raw_data) : (match.raw_data || {});
      const confirmed = raw?.confirmed || {};
      const serial = confirmed.serial_number || pickSerial(match) || hardwareSerial;
      logger.info(`Pending Roku candidate ${match.id} (${match.ip_address}) matched — auto-admitting on app connect`);
      return {
        discoveredDevice: {
          device_id: serial ? `roku:${serial}` : `roku:${match.ip_address?.replace(/\./g, '-')}`,
          name: confirmed.name || match.friendly_name || 'Roku Device',
          ip_address: match.ip_address,
          serial_number: serial,
          model: confirmed.model || null,
          manufacturer: 'Roku',
          mac_address: confirmed.mac_address || match.mac_address || null,
          extra_data: {},
          pendingCandidate: true,
          candidate_id: match.id,
        },
        existingScreen: null,
      };
    } catch (err) {
      logger.warn?.(`Pending-candidate lookup failed: ${err.message}`);
      return null;
    }
  }

  try {
    // Get all discovered Roku devices
    const discoveredDevices = await queryFn('device_registry')
      .where('device_type', '=', 'roku')
      .get();

    if (!discoveredDevices || discoveredDevices.length === 0) {
      logger.info('No registered Roku devices — checking pending candidates');
      return (await findPendingRokuCandidate()) || { discoveredDevice: null, existingScreen: null };
    }

    logger.debug(`Found ${discoveredDevices.length} discovered Roku device(s)`);

    // Get all screens to check linkage
    const allScreens = await screenManager.getAll();
    const rokuScreens = allScreens.filter((s) => s.platform === 'roku');

    // ==================== HARDWARE SERIAL MATCH (preferred — #1139) ====================
    // Hardware serial (GetDeviceUniqueId) is stable across channel sideloads. ChannelClientId
    // rotates on sideload, so a registry wipe + sideload breaks channel-client-id matching.
    // When the Roku sends its hardware serial, match it directly to device_registry so we can
    // auto-re-pair without operator intervention.
    if (hardwareSerial) {
      const deviceBySerial = discoveredDevices.find((d) => d.serial_number === hardwareSerial
        || d.id === `roku:${hardwareSerial}`
        || d.id?.replace('roku:', '') === hardwareSerial);

      if (deviceBySerial) {
        // Found the hardware. Try to find an existing screen linked to this device.
        const screenByHardware = rokuScreens.find((s) => {
          const meta = s.metadata || {};
          return (
            s.serial === hardwareSerial
            || meta.serial_number === hardwareSerial
            || meta.roku_device_id === deviceBySerial.id
          );
        });

        if (screenByHardware) {
          logger.info(`Hardware-serial match: Roku ${hardwareSerial} already has screen "${screenByHardware.name}" — auto-recovering pairing`);
          return {
            discoveredDevice: formatDiscoveredDevice(deviceBySerial),
            existingScreen: screenByHardware,
          };
        }

        // Hardware known in device_registry but no screen yet — treat as new auto-pair.
        logger.info(`Hardware-serial match: Roku ${hardwareSerial} in registry, no screen yet — auto-pair as new screen`);
        return {
          discoveredDevice: formatDiscoveredDevice(deviceBySerial),
          existingScreen: null,
        };
      }

      logger.debug(`Hardware serial ${hardwareSerial} not found in device_registry — falling back to channel-client matching`);
    }

    // First, check if this ChannelClientId is already linked to a screen
    const existingScreenByClientId = rokuScreens.find((screen) => {
      const meta = screen.metadata || {};
      return meta.channel_client_id === channelClientId;
    });

    if (existingScreenByClientId) {
      // This Roku app was already paired - find its discovery device
      const meta = existingScreenByClientId.metadata || {};
      const linkedDevice = discoveredDevices.find((d) => d.id === meta.roku_device_id
        || d.serial_number === meta.serial_number
        || d.serial_number === existingScreenByClientId.serial);

      logger.info(`ChannelClientId ${channelClientId} already linked to screen "${existingScreenByClientId.name}"`);

      return {
        discoveredDevice: linkedDevice ? formatDiscoveredDevice(linkedDevice) : null,
        existingScreen: existingScreenByClientId,
      };
    }

    // Build a map of discovered device ID -> screen (if linked)
    const deviceToScreenMap = new Map();
    for (const screen of rokuScreens) {
      const meta = screen.metadata || {};
      if (meta.roku_device_id) {
        deviceToScreenMap.set(meta.roku_device_id, screen);
      }
      // Also map by serial number
      if (screen.serial) {
        deviceToScreenMap.set(`roku:${screen.serial}`, screen);
      }
    }

    // Find discovered devices and check if they're linked to screens
    for (const device of discoveredDevices) {
      const linkedScreen = deviceToScreenMap.get(device.id);

      if (linkedScreen) {
        // This discovered device is linked to a screen - use it!
        logger.info(`Found discovered device "${device.friendly_name}" linked to screen "${linkedScreen.name}"`);
        return {
          discoveredDevice: formatDiscoveredDevice(device),
          existingScreen: linkedScreen,
        };
      }
    }

    // No discovered device is linked yet - use the first one for new pairing
    if (discoveredDevices.length > 0) {
      const device = discoveredDevices[0];
      logger.info(`Found unlinked discovered Roku: ${device.friendly_name || device.id}`);
      return {
        discoveredDevice: formatDiscoveredDevice(device),
        existingScreen: null,
      };
    }

    logger.info('No registered Roku linked — checking pending candidates');
    return (await findPendingRokuCandidate()) || { discoveredDevice: null, existingScreen: null };
  } catch (error) {
    logger.error(`Error finding discovered Roku: ${error.message}`);
    return { discoveredDevice: null, existingScreen: null };
  }
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
