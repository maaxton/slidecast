/**
 * Auto-Launch Routes - Manage auto-launch automations for screens
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 *
 * When enabled, creates an automation that launches the Waiveo app
 * when a Roku TV turns on.
 *
 * Uses ctx.services.automation.getEngine() for direct access to the
 * automation engine (SDK v2 inter-extension service pattern).
 */

import logger from '../utils/Logger.js';

export default function createAutoLaunchRoutes(deps) {
  const { screenManager, api, extensionCtx } = deps;

  // Automation alias prefix for identification
  const AUTO_LAUNCH_ALIAS_PREFIX = 'Auto-launch Waiveo on ';

  // ==================== HELPER FUNCTIONS ====================

  /**
   * Get the automation engine via SDK v2 services
   */
  async function getAutomationEngine() {
    try {
      return await extensionCtx.services.automation.getEngine();
    } catch (error) {
      logger.warn(`Failed to get automation engine: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all slidecast auto-launch automations
   * Queries the automations table directly via the automation engine
   */
  async function getAutoLaunchAutomations() {
    try {
      // Query all automations from the database (includes both enabled and disabled)
      const dbAutomations = await api.queryBuilder('automations').get();

      // Parse JSON fields and filter to our auto-launch automations
      const parsed = dbAutomations.map((a) => ({
        ...a,
        definition: typeof a.definition === 'string' ? JSON.parse(a.definition) : a.definition,
        variables: typeof a.variables === 'string' ? JSON.parse(a.variables) : a.variables,
      }));

      return parsed.filter((a) => a.variables?.screen_serial);
    } catch (error) {
      logger.warn(`Failed to fetch automations: ${error.message}`);
      return [];
    }
  }

  /**
   * Find auto-launch automation for a specific screen
   */
  async function findAutoLaunchAutomationForScreen(screenSerial) {
    const automations = await getAutoLaunchAutomations();
    return automations.find((a) => a.variables?.screen_serial === screenSerial) || null;
  }

  /**
   * Create an auto-launch automation via the automation engine
   */
  async function createAutoLaunchAutomation({
    screenSerial, screenName, rokuDeviceId, entityId, appId,
  }) {
    const engine = await getAutomationEngine();
    if (!engine) {
      throw new Error('Automation engine not available');
    }

    const automationData = {
      alias: `${AUTO_LAUNCH_ALIAS_PREFIX}${screenName}`,
      description: `Automatically launches Waiveo app when ${screenName} turns on`,
      type: 'rule',
      mode: 'single',
      enabled: true,
      definition: {
        trigger: [
          {
            platform: 'state',
            // Reference the DEVICE (integration:unique id) via the first-class
            // device_id + domain keys (docs/architecture/device-automation-standard.md
            // D1). TriggerManager resolves device_id to the device's entities via
            // deviceEntityMap, and domain scopes the match to the media_player
            // entity — integration-agnostic, and the automation editor's device
            // dropdown binds/reselects device_id directly (an entity_id here
            // matches no picker option and renders as a blank dropdown).
            device_id: rokuDeviceId,
            domain: 'media_player',
            // Explicit arrays (not scalars) so the automation engine matches
            // these literally and does NOT expand them via STATE_GROUPS. A scalar
            // `to: 'on'` semantically matches on/playing/idle/paused/buffering,
            // which caused spurious relaunches: switching to another app (playing),
            // the "Roku Dynamic Menu" overlay (playing), or the screensaver (idle)
            // all counted as "turned on" and hijacked the TV back to Waiveo.
            // We only want a genuine power-on to the Home/on state.
            from: ['off', 'standby'],
            to: ['on'],
          },
        ],
        action: [
          {
            service: 'roku_integration.launch_app',
            data: {
              device_id: rokuDeviceId,
              app_id: appId,
            },
          },
        ],
      },
      variables: {
        screen_serial: screenSerial,
        screen_name: screenName,
        roku_device_id: rokuDeviceId,
        entity_id: entityId,
        app_id: appId,
      },
    };

    const automation = await engine.createAutomation(automationData);
    return automation;
  }

  /**
   * Find the media_player entity_id for a Roku device
   * e.g., roku:X029009JC6LF -> media_player.the_hanger
   */
  async function findRokuEntityId(rokuDeviceId) {
    try {
      const entities = await api.queryBuilder('entity_registry')
        .where('device_id', '=', rokuDeviceId)
        .get();
      const mediaPlayer = entities.find((e) => e.entity_id?.startsWith('media_player.'));
      return mediaPlayer?.entity_id || null;
    } catch (error) {
      logger.warn(`Failed to find entity for device ${rokuDeviceId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve a Roku device's friendly name (e.g. "The Hanger", "Living Room").
   * Screen records carry a serial-derived placeholder ("Screen 9JC6LF"), so name
   * the auto-launch automation from the device registry instead. Returns null if
   * the device isn't found so the caller can fall back to the screen name.
   */
  async function findRokuFriendlyName(rokuDeviceId) {
    try {
      const rows = await api.queryBuilder('device_registry')
        .where('id', '=', rokuDeviceId)
        .get();
      const d = rows && rows[0];
      return (d && (d.friendly_name || d.name)) || null;
    } catch (error) {
      logger.warn(`Failed to resolve friendly name for device ${rokuDeviceId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Delete an automation via the automation engine
   */
  async function deleteAutomation(automationId) {
    const engine = await getAutomationEngine();
    if (!engine) {
      throw new Error('Automation engine not available');
    }
    await engine.deleteAutomation(automationId);
  }

  /**
   * Enable an automation via the automation engine
   */
  async function enableAutomation(automationId) {
    const engine = await getAutomationEngine();
    if (!engine) {
      throw new Error('Automation engine not available');
    }
    await engine.updateAutomation(automationId, { enabled: true });
  }

  /**
   * Upsert a setting
   */
  async function upsertSetting(ctx, key, value) {
    const existing = await ctx.data.slidecast_settings.findOne({ key });
    if (existing) {
      await ctx.data.slidecast_settings.update({ id: existing.id }, {
        value: String(value),
        updated_at: new Date().toISOString(),
      });
    } else {
      await ctx.data.slidecast_settings.create({ key, value: String(value) });
    }
  }

  // ==================== ROUTE DEFINITIONS ====================

  return {
    // ==================== AUTO-LAUNCH SETTINGS ====================

    /**
     * Get auto-launch status for all screens
     * Queries automation engine directly via SDK v2 services
     */
    'GET /auto-launch': async (ctx) => {
      try {
        // Get all screens
        const screens = await screenManager.getAll();

        // Get all slidecast auto-launch automations
        const automations = await getAutoLaunchAutomations();

        // Build status map
        const autoLaunchStatus = {};
        for (const screen of screens) {
          // Find automation by screen_serial in variables
          const automation = automations.find((a) => a.variables?.screen_serial === screen.serial);
          autoLaunchStatus[screen.serial] = {
            enabled: !!(automation?.enabled),
            automation_id: automation?.id || null,
          };
        }

        // Get system-wide default setting
        let systemDefault = false;
        try {
          const setting = await ctx.data.slidecast_settings.findOne({ key: 'auto_launch_default' });
          systemDefault = setting?.value === 'true';
        } catch (e) { /* ignore */ }

        // Get app ID setting
        let appId = 'dev';
        try {
          const setting = await ctx.data.slidecast_settings.findOne({ key: 'auto_launch_app_id' });
          if (setting?.value) appId = setting.value;
        } catch (e) { /* ignore */ }

        return {
          success: true,
          system_default: systemDefault,
          app_id: appId,
          screens: autoLaunchStatus,
        };
      } catch (error) {
        logger.error(`Failed to get auto-launch status: ${error.message}`);
        return { success: false, error: error.message };
      }
    },

    /**
     * Update system-wide auto-launch settings
     */
    'PUT /auto-launch/settings': async (ctx) => {
      try {
        const { system_default, app_id } = ctx.body;

        if (system_default !== undefined) {
          await upsertSetting(ctx, 'auto_launch_default', String(system_default));
        }

        if (app_id !== undefined) {
          await upsertSetting(ctx, 'auto_launch_app_id', app_id);
        }

        return { success: true };
      } catch (error) {
        logger.error(`Failed to update auto-launch settings: ${error.message}`);
        return { success: false, error: error.message };
      }
    },

    /**
     * Enable auto-launch for a specific screen
     * Creates an automation via the automation engine
     */
    'POST /screens/:serial/auto-launch/enable': async (ctx) => {
      try {
        const screen = await screenManager.getBySerial(ctx.params.serial);
        if (!screen) {
          return { success: false, error: 'Screen not found', status: 404 };
        }

        // Must be a discovery-linked Roku device
        if (screen.platform !== 'roku' || !screen.metadata?.roku_device_id) {
          return { success: false, error: 'Auto-launch only supported for discovery-linked Roku devices', status: 400 };
        }

        const rokuDeviceId = screen.metadata.roku_device_id;

        // Check if automation already exists (search by screen_serial in variables)
        const existing = await findAutoLaunchAutomationForScreen(screen.serial);
        if (existing) {
          // Enable if disabled
          if (!existing.enabled) {
            await enableAutomation(existing.id);
          }
          return { success: true, message: 'Auto-launch already enabled', automation_id: existing.id };
        }

        // Get app ID from settings
        let appId = 'dev';
        try {
          const setting = await ctx.data.slidecast_settings.findOne({ key: 'auto_launch_app_id' });
          if (setting?.value) appId = setting.value;
        } catch (e) { /* ignore */ }

        // Look up the media_player entity_id for this Roku device
        const entityId = await findRokuEntityId(rokuDeviceId);
        if (!entityId) {
          return { success: false, error: `No media_player entity found for device ${rokuDeviceId}. Ensure the device has been discovered and polled.`, status: 400 };
        }

        // Name the automation after the Roku's friendly name ("The Hanger",
        // "Living Room"), falling back to the screen record's name only if the
        // device can't be resolved. screen.name is a serial placeholder
        // ("Screen 9JC6LF"), which produced unreadable automation titles.
        const friendlyName = (await findRokuFriendlyName(rokuDeviceId)) || screen.name;

        // Create the automation
        const automation = await createAutoLaunchAutomation({
          screenSerial: screen.serial,
          screenName: friendlyName,
          rokuDeviceId,
          entityId,
          appId,
        });

        logger.info(`Created auto-launch automation for screen ${screen.serial}`);

        return { success: true, automation_id: automation.id, automation };
      } catch (error) {
        logger.error(`Failed to enable auto-launch: ${error.message}`);
        return { success: false, error: error.message };
      }
    },

    /**
     * Disable auto-launch for a specific screen
     * Deletes the automation via the automation engine
     */
    'POST /screens/:serial/auto-launch/disable': async (ctx) => {
      try {
        // Find automation by screen serial
        const existing = await findAutoLaunchAutomationForScreen(ctx.params.serial);
        if (!existing) {
          return { success: true, message: 'Auto-launch not enabled' };
        }

        // Delete the automation
        await deleteAutomation(existing.id);

        logger.info(`Deleted auto-launch automation for screen ${ctx.params.serial}`);

        return { success: true };
      } catch (error) {
        logger.error(`Failed to disable auto-launch: ${error.message}`);
        return { success: false, error: error.message };
      }
    },

    /**
     * Get auto-launch status for a specific screen
     */
    'GET /screens/:serial/auto-launch': async (ctx) => {
      try {
        const automation = await findAutoLaunchAutomationForScreen(ctx.params.serial);

        return {
          success: true,
          enabled: !!(automation?.enabled),
          automation_id: automation?.id || null,
          automation: automation || null,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
}
