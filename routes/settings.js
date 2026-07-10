/**
 * Settings Routes - System settings, disk space, and SSDP discovery
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */

import logger from '../utils/Logger.js';

export default function createSettingsRoutes(deps) {
  const {
    ssdpDiscovery, renderTracker, slideImageRenderer, getRenderStatus,
  } = deps;

  return {
    // ==================== RENDER STATUS ====================

    // Get rendering info (architecture, mode)
    'GET /render/info': async () => {
      const status = getRenderStatus ? getRenderStatus() : null;
      return {
        success: true,
        render: status || {
          mode: 'software',
          description: 'Using software rendering (SwiftShader)',
          arch: process.arch,
          isARM: process.arch === 'arm64' || process.arch === 'arm',
        },
      };
    },

    // Restart browser (frees memory after many renders)
    'POST /render/restart': async () => {
      if (!slideImageRenderer) {
        return {
          success: false,
          error: 'Renderer not available',
        };
      }

      try {
        await slideImageRenderer.restartBrowser();
        return {
          success: true,
          message: 'Browser restarted',
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    // ==================== SSDP DISCOVERY ====================

    // Get SSDP discovery status
    'GET /ssdp/status': async () => {
      if (ssdpDiscovery) {
        return {
          success: true,
          ssdp: ssdpDiscovery.getStatus(),
        };
      }
      return {
        success: true,
        ssdp: {
          running: false,
          reason: 'SSDP Discovery not initialized',
        },
      };
    },

    // Restart SSDP discovery (useful after settings change)
    'POST /ssdp/restart': async () => {
      if (ssdpDiscovery) {
        ssdpDiscovery.stop();
        ssdpDiscovery.start();
        return {
          success: true,
          message: 'SSDP Discovery restarted',
          ssdp: ssdpDiscovery.getStatus(),
        };
      }
      return {
        success: false,
        error: 'SSDP Discovery not initialized',
      };
    },

    // ==================== SETTINGS ====================

    // Get disk space info
    'GET /disk-space': async () => {
      try {
        const { execSync } = await import('child_process');
        // Get disk space for the data directory (where media is stored)
        const dataDir = process.env.DATA_DIR || '/app/data';
        const dfOutput = execSync(`df -B1 ${dataDir} 2>/dev/null || df -B1 / 2>/dev/null`).toString();
        const lines = dfOutput.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const total = parseInt(parts[1], 10) || 0;
          const used = parseInt(parts[2], 10) || 0;
          const available = parseInt(parts[3], 10) || 0;
          return {
            success: true,
            diskSpace: {
              total,
              used,
              available,
              recommended: Math.floor(available * 0.8), // 80% of available
            },
          };
        }
      } catch (error) {
        logger.warn(`Failed to get disk space: ${error.message}`);
      }
      // Fallback - assume 100GB available
      return {
        success: true,
        diskSpace: {
          total: 107374182400,
          used: 0,
          available: 107374182400,
          recommended: 85899345920, // 80GB
        },
      };
    },

    // Get all settings
    'GET /settings': async (ctx) => {
      const settingsList = await ctx.data.slidecast_settings.findAll();
      const settings = {};
      for (const s of settingsList) {
        settings[s.key] = s.value;
      }
      return { success: true, settings };
    },

    // Update settings
    'PUT /settings': async (ctx) => {
      const { body } = ctx;
      for (const [key, value] of Object.entries(body)) {
        const existing = await ctx.data.slidecast_settings.findAll({ where: { key } });
        if (existing && existing.length > 0) {
          await ctx.data.slidecast_settings.update({ id: existing[0].id }, {
            value: String(value),
            updated_at: new Date().toISOString(),
          });
        } else {
          await ctx.data.slidecast_settings.create({
            key,
            value: String(value),
          });
        }
      }

      // Update logger log level immediately if changed
      if (body.log_level !== undefined) {
        logger.setLogLevel(body.log_level);
      }

      // Update RenderTracker config if render settings changed
      if (renderTracker) {
        const configUpdate = {};
        if (body.render_max_concurrent !== undefined) {
          configUpdate.maxConcurrent = parseInt(body.render_max_concurrent, 10) || 1;
        }
        if (body.render_stale_timeout !== undefined) {
          configUpdate.staleTimeoutMs = (parseInt(body.render_stale_timeout, 10) || 300) * 1000;
        }
        if (Object.keys(configUpdate).length > 0) {
          renderTracker.updateConfig(configUpdate);
          logger.info(`RenderTracker updated from settings: ${JSON.stringify(configUpdate)}`);
        }
      }

      return { success: true };
    },
  };
}
