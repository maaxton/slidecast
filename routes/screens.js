import logger from '../utils/Logger.js';

/**
 * Screens Routes - CRUD operations for connected TV screens
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */

// Roku ECP (External Control Protocol) port
const ROKU_ECP_PORT = 8060;

/**
 * Enrich screens with data from their source integration
 * - Roku devices: fetch from roku-integration
 * - Fire devices: fetch from fire-integration (future)
 * - Apple devices: fetch from apple-integration (future)
 *
 * Exported for unit testing — see backend/src/__tests__/extensions/slidecast/screens-enrich.test.js
 */
export async function enrichScreensWithSourceData(screens, extensionCtx) {
  if (!extensionCtx) return screens;

  // Find screens that need enrichment from roku-integration
  const rokuScreens = screens.filter((s) => s.platform === 'roku' && s.metadata?.roku_device_id);

  if (rokuScreens.length === 0) {
    return screens;
  }

  // Fetch device data from roku-integration via SDK v2 services
  let rokuDevices = [];
  try {
    const rokuService = extensionCtx.services?.['roku-integration'];
    if (rokuService?.getDevices) {
      rokuDevices = await rokuService.getDevices() || [];
    }
  } catch (error) {
    logger.warn(`Failed to fetch roku-integration devices: ${error.message}`);
  }

  // Create lookup map by device_id
  const rokuDeviceMap = new Map();
  for (const device of rokuDevices) {
    rokuDeviceMap.set(device.device_id || device.id, device);
  }

  // Get offline threshold (default 60 seconds for app heartbeat)
  const appOfflineThresholdMs = 60000;
  const now = Date.now();

  // Enrich screens with source data and app_connected status
  return screens.map((screen) => {
    // Calculate if Waiveo app is connected (based on app heartbeat)
    let appConnected = false;
    if (screen.app_last_heartbeat) {
      const lastHeartbeat = new Date(screen.app_last_heartbeat).getTime();
      appConnected = (now - lastHeartbeat) < appOfflineThresholdMs;
    }

    if (screen.platform === 'roku' && screen.metadata?.roku_device_id) {
      const sourceDevice = rokuDeviceMap.get(screen.metadata.roku_device_id);
      if (sourceDevice) {
        // Device status from discovery (is the Roku on?)
        const deviceOnline = !!sourceDevice.online;
        return {
          ...screen,
          // Device is online (from discovery)
          device_online: deviceOnline,
          // Waiveo app is connected (from heartbeat)
          app_connected: appConnected,
          // Combined status: app connected means "online" for our purposes
          status: appConnected ? 'online' : 'offline',
          // Use source integration's last_seen_at (from network polling)
          last_seen_at: sourceDevice.last_seen_at || screen.last_seen_at,
          // Include full source device info for UI
          source_device: {
            integration: 'roku-integration',
            device_id: sourceDevice.device_id || sourceDevice.id,
            name: sourceDevice.name,
            ip_address: sourceDevice.ip_address,
            status: deviceOnline ? 'online' : 'offline',
            online: sourceDevice.online,
            last_seen_at: sourceDevice.last_seen_at,
            model: sourceDevice.model,
            manufacturer: sourceDevice.manufacturer,
            serial_number: sourceDevice.serial_number,
            firmware_version: sourceDevice.firmware_version,
            power_mode: sourceDevice.power_mode,
            // Normalized media_player entity state from roku-integration:
            //   'on'      = device on, no foreground app
            //   'idle'    = device on, screensaver active
            //   'playing' = device on, foreground app running (e.g. Waiveo)
            //   'off'     = device standby/off
            power_state: sourceDevice.power_state || null,
            // Currently-active foreground app
            // (drives the Playing/Idle indicator on the Screens page)
            active_app: sourceDevice.active_app || null,
            active_app_id: sourceDevice.active_app_id || null,
            app_type: sourceDevice.app_type || null,
            metadata: sourceDevice.metadata,
          },
        };
      }
    }
    return {
      ...screen,
      app_connected: appConnected,
      device_online: screen.status === 'online',
      status: appConnected ? 'online' : 'offline',
    };
  });
}

/**
 * Helper to get Roku IP from screen metadata
 */
function getRokuIp(screen) {
  return screen.metadata?.ip_address;
}

export default function createScreenRoutes(deps) {
  const { screenManager, previewManager, extensionCtx } = deps;

  return {
    // ==================== SCREENS ====================

    // List all screens (enriched with source integration data)
    'GET /screens': async (ctx) => {
      const screens = await screenManager.getAll();
      const enrichedScreens = await enrichScreensWithSourceData(screens, extensionCtx);
      return { success: true, screens: enrichedScreens };
    },

    // Get single screen (enriched with source integration data)
    'GET /screens/:serial': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }
      const [enrichedScreen] = await enrichScreensWithSourceData([screen], extensionCtx);
      return { success: true, screen: enrichedScreen };
    },

    // Update screen
    'PUT /screens/:serial': async (ctx) => {
      const screen = await screenManager.update(ctx.params.serial, ctx.body);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }
      return { success: true, screen };
    },

    // Delete screen
    'DELETE /screens/:serial': async (ctx) => {
      const success = await screenManager.delete(ctx.params.serial);
      if (!success) {
        return { success: false, error: 'Screen not found', status: 404 };
      }
      return { success: true };
    },

    // Assign cast to screen
    'POST /screens/:serial/assign': async (ctx) => {
      const { cast_id } = ctx.body;
      const screen = await screenManager.assignCast(ctx.params.serial, cast_id);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      // Notify the screen via WebSocket
      previewManager.notifyScreenTune(ctx.params.serial, cast_id);

      return { success: true, screen };
    },

    // Assign cast to all screens with tag
    'POST /screens/assign-tag': async (ctx) => {
      const { tag, cast_id } = ctx.body;
      const count = await screenManager.assignCastToTag(tag, cast_id);

      // Notify all affected screens
      const screens = await screenManager.getByTag(tag);
      for (const screen of screens) {
        previewManager.notifyScreenTune(screen.serial, cast_id);
      }

      return { success: true, count };
    },

    // Get all tags
    'GET /tags': async (ctx) => {
      const tags = await screenManager.getAllTags();
      return { success: true, tags };
    },

    // ==================== ROKU DEVICE LINKING ====================

    // Manually link a screen to a Roku device (for when auto-discovery doesn't work)
    'POST /screens/:serial/roku/link': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const { roku_device_id, ip_address } = ctx.body;
      if (!roku_device_id) {
        return { success: false, error: 'roku_device_id is required', status: 400 };
      }

      // Update screen metadata to link to Roku device
      const updatedMetadata = {
        ...(screen.metadata || {}),
        roku_device_id,
        ip_address: ip_address || screen.metadata?.ip_address,
        discovery_linked: true,
        linked_at: new Date().toISOString(),
      };

      const updated = await screenManager.update(ctx.params.serial, {
        metadata: updatedMetadata,
      });

      return { success: true, screen: updated, message: `Screen linked to Roku device ${roku_device_id}` };
    },

    // Unlink a screen from its Roku device
    'POST /screens/:serial/roku/unlink': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      // Remove Roku-specific metadata
      const updatedMetadata = { ...(screen.metadata || {}) };
      delete updatedMetadata.roku_device_id;
      delete updatedMetadata.discovery_linked;
      delete updatedMetadata.linked_at;

      const updated = await screenManager.update(ctx.params.serial, {
        metadata: updatedMetadata,
      });

      return { success: true, screen: updated, message: 'Screen unlinked from Roku device' };
    },

    // ==================== ROKU DEVICE CONTROL ====================
    // These routes control linked Roku devices using direct ECP (External Control Protocol)
    // Port 8060 is the Roku ECP port

    // Launch app on screen's linked Roku device
    // Passes serverUrl as an ECP launch param so the Roku app knows the server address
    'POST /screens/:serial/roku/launch/:appId': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device (no IP address)', status: 400 };
      }

      try {
        // Derive the server URL from the incoming request so the Roku app can reach us
        const proto = ctx.req?.protocol || 'http';
        const host = ctx.req?.get?.('host') || ctx.req?.headers?.host || '';
        const serverUrl = host ? `${proto}://${host}` : '';
        const queryParams = serverUrl ? `?serverUrl=${encodeURIComponent(serverUrl)}` : '';

        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/launch/${encodeURIComponent(ctx.params.appId)}${queryParams}`, {
          method: 'POST',
          timeout: 5000,
        });

        return { success: response.ok, message: `Launched app ${ctx.params.appId}` };
      } catch (error) {
        return { success: false, error: `Failed to launch app: ${error.message}`, status: 500 };
      }
    },

    // Power on screen's linked Roku device
    'POST /screens/:serial/roku/power/on': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device', status: 400 };
      }

      try {
        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/keypress/PowerOn`, {
          method: 'POST',
          timeout: 5000,
        });

        return { success: response.ok, message: 'Powered on' };
      } catch (error) {
        return { success: false, error: `Failed to power on: ${error.message}`, status: 500 };
      }
    },

    // Power off screen's linked Roku device
    'POST /screens/:serial/roku/power/off': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device', status: 400 };
      }

      try {
        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/keypress/PowerOff`, {
          method: 'POST',
          timeout: 5000,
        });

        return { success: response.ok, message: 'Powered off' };
      } catch (error) {
        return { success: false, error: `Failed to power off: ${error.message}`, status: 500 };
      }
    },

    // Send keypress to screen's linked Roku device
    'POST /screens/:serial/roku/keypress/:key': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device', status: 400 };
      }

      try {
        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/keypress/${encodeURIComponent(ctx.params.key)}`, {
          method: 'POST',
          timeout: 5000,
        });

        return { success: response.ok, message: `Sent keypress ${ctx.params.key}` };
      } catch (error) {
        return { success: false, error: `Failed to send keypress: ${error.message}`, status: 500 };
      }
    },

    // Get installed apps on screen's linked Roku device
    'GET /screens/:serial/roku/apps': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device', status: 400 };
      }

      try {
        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/query/apps`, {
          method: 'GET',
          timeout: 5000,
        });

        if (!response.ok) {
          return { success: false, error: 'Failed to get apps', apps: [] };
        }

        const xmlText = await response.text();
        // Parse XML apps list - simple regex extraction
        const apps = [];
        const appRegex = /<app id="([^"]+)"[^>]*>([^<]+)<\/app>/g;
        let match;
        while ((match = appRegex.exec(xmlText)) !== null) {
          apps.push({ id: match[1], name: match[2] });
        }

        return { success: true, apps };
      } catch (error) {
        return { success: false, error: `Failed to get apps: ${error.message}`, apps: [] };
      }
    },

    // Get Roku device info for a screen
    'GET /screens/:serial/roku/info': async (ctx) => {
      const screen = await screenManager.getBySerial(ctx.params.serial);
      if (!screen) {
        return { success: false, error: 'Screen not found', status: 404 };
      }

      const rokuIp = getRokuIp(screen);
      if (!rokuIp) {
        return { success: false, error: 'Screen not linked to a Roku device', status: 400 };
      }

      try {
        const response = await fetch(`http://${rokuIp}:${ROKU_ECP_PORT}/query/device-info`, {
          method: 'GET',
          timeout: 5000,
        });

        if (!response.ok) {
          return { success: false, error: 'Failed to get device info', info: null };
        }

        const xmlText = await response.text();
        // Parse simple XML fields
        const getField = (name) => {
          const match = xmlText.match(new RegExp(`<${name}>([^<]*)</${name}>`));
          return match ? match[1] : null;
        };

        const info = {
          friendlyDeviceName: getField('friendly-device-name') || getField('user-device-name'),
          modelName: getField('model-name'),
          modelNumber: getField('model-number'),
          serialNumber: getField('serial-number'),
          softwareVersion: getField('software-version'),
          powerMode: getField('power-mode'),
        };

        return {
          success: true,
          info,
          discovery_linked: true,
          roku_device_id: screen.metadata?.roku_device_id,
          ip_address: rokuIp,
        };
      } catch (error) {
        return { success: false, error: `Failed to get device info: ${error.message}`, info: null };
      }
    },
  };
}
