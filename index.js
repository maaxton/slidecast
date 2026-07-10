/**
 * Slidecast Extension -- SDK v2
 *
 * Digital signage system: create slideshows and cast them to TV screens.
 * The most complex extension in the platform -- uses channels, hooks, events,
 * init/destroy, [public] [upload] [stream] route modifiers.
 *
 * Architecture:
 * - Route handlers live in routes/*.js (protocol, screens, casts, media, widgets, etc.)
 * - Manager classes (CastManager, ScreenManager, SlideImageRenderer, etc.) are
 *   initialized in init() and stored on ctx.state
 * - Protocol routes are [public] (called by Roku hardware, no auth)
 * - Media/cast uploads use [upload] modifier
 * - Image/asset serving routes use [stream] modifier
 * - Screen WebSocket connections use channels
 * - Device discovery events use hooks
 * - Automation triggers/actions declared via events + automations
 *
 * Key conversions from v1:
 * - registerModel() -> data section (13 tables)
 * - registerRoute() / registerUploadRoute() -> routes section with modifiers
 * - api.globalEventBus listeners -> hooks section
 * - api.fireTrigger() -> ctx.emit() with declared events
 * - api.broadcast() -> ctx.broadcast()
 * - api.registerAction() -> automations.actions
 * - navigation.json -> nav section
 * - automation.json -> automations section
 * - WebSocket screen connection -> channels.screen
 * - init() / onDisable() -> init() / destroy() lifecycle
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

// ============================================
// Slidecast API adapter
// ============================================
// Clean, explicit adapter that gives manager classes and route modules
// exactly what they need from the v2 ctx. Follows the same pattern as
// createEngineApi (automation) and createDiscoveryApi (device-discovery).
//
// Managers receive this as `api` in their constructors. They use:
//   api.model(name)      — CRUD on database tables
//   api.queryBuilder(t)  — chainable SQL queries (select, where, join, raw, etc.)
//   api.broadcast(e, d)  — WebSocket events to frontend
//   api.fireTrigger(k,d) — automation trigger emission
//   api.globalEventBus   — platform event bus for cross-extension subscriptions
//   api.log(msg, level)  — structured logging
//   api.config           — extension config store
//
// Route modules receive this via register(api, managers). They additionally use:
//   api.registerRoute()       — no-op (routes are declarative in v2)
//   api.registerUploadRoute() — no-op (routes are declarative in v2)

// resolveQueryFn lives in its own file so tests can import it without pulling
// in slidecast's heavy npm dependencies (uuid, sharp, playwright…).
// HOT-RELOAD CONTRACT: loaded via top-level-await dynamic import with the
// loader's ?t= cache-bust token — a static `import './resolveQueryFn.js'`
// would pin the FIRST-loaded copy forever (Node's ESM cache is keyed by URL,
// and the loader only busts index.js; see importExtensionSubmodules below).
// ctx isn't available at module scope, so the token comes from the ?t= the
// loader put on OUR OWN url; Date.now() covers direct imports (tests).
const RELOAD_TOKEN = new URL(import.meta.url).searchParams.get('t') ?? Date.now();
const subModule = (rel) => `${new URL(rel, import.meta.url).href}?t=${RELOAD_TOKEN}`;
const { resolveQueryFn } = await import(subModule('./resolveQueryFn.js'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Sub-module loading (Hot-Reload Safe — task #886)
// ============================================
// Node ESM static `import` declarations resolve to bare file:// URLs at parse
// time and are then served from the ESM cache for the lifetime of the
// process — there is no public API to invalidate them. That means a static
// `import CastManager from './CastManager.js'` here would forever return the
// version of the module that was loaded the first time the extension started,
// and `deploy-cli.sh extension slidecast` would silently keep running old code
// even after a successful upload + reload.
//
// To make hot-reload actually swap in the new sub-module bytes, every internal
// sub-module is loaded *dynamically* inside init() with a `?t=<reloadToken>`
// query string. The loader bumps the token on every (re)load, so each load
// gets a fresh ESM module instance from disk. Third-party deps (uuid, path,
// fs, url) stay as static imports — they are not the hot-reload target and
// don't change between reloads.
//
// See backend/src/sdk/ExtensionLoader.js#_reloadCounter and ContextFactory.js
// for the producer side.
async function importExtensionSubmodules(ctx) {
  const t = ctx.reloadToken ?? Date.now();
  const url = (rel) => `${pathToFileURL(path.join(__dirname, rel)).href}?t=${t}`;

  const [
    loggerMod,
    CastManagerMod, ScreenManagerMod, MediaLibraryMod, PreviewManagerMod, PairingManagerMod,
    WidgetRegistryMod, WidgetRuntimeMod, WidgetImageRendererMod, WidgetCacheMod,
    WidgetSecretStoreMod, WidgetEventStoreMod, WidgetResolverMod,
    SlideImageRendererMod, RenderBridgeMod, VideoProcessorMod, SSDPDiscoveryMod,
    RenderTrackerMod, WidgetRefreshServiceMod, ScreenWatchdogServiceMod, UpdateTrackerMod, SpriteSheetGeneratorMod,
    castsMod, protocolMod, settingsMod, templatesMod, autoLaunchMod,
    previewMod, importExportMod, mediaMod, screensMod, widgetsMod, marketplaceMod,
    CastImporterMod, ContentCatalogServiceMod, ContentInstallServiceMod, ContentJobServiceMod,
    WidgetInstallServiceMod,
  ] = await Promise.all([
    import(url('utils/Logger.js')),
    import(url('CastManager.js')),
    import(url('ScreenManager.js')),
    import(url('MediaLibrary.js')),
    import(url('PreviewManager.js')),
    import(url('PairingManager.js')),
    import(url('widgets/WidgetRegistry.js')),
    import(url('widgets/WidgetRuntime.js')),
    import(url('widgets/WidgetImageRenderer.js')),
    import(url('widgets/WidgetCache.js')),
    import(url('widgets/WidgetSecretStore.js')),
    import(url('widgets/WidgetEventStore.js')),
    import(url('widgets/WidgetResolver.js')),
    import(url('SlideImageRenderer.js')),
    import(url('RenderBridge.js')),
    import(url('VideoProcessor.js')),
    import(url('SSDPDiscovery.js')),
    import(url('RenderTracker.js')),
    import(url('WidgetRefreshService.js')),
    import(url('ScreenWatchdogService.js')),
    import(url('UpdateTracker.js')),
    import(url('SpriteSheetGenerator.js')),
    import(url('routes/casts.js')),
    import(url('routes/protocol.js')),
    import(url('routes/settings.js')),
    import(url('routes/templates.js')),
    import(url('routes/autoLaunch.js')),
    import(url('routes/preview.js')),
    import(url('routes/import-export.js')),
    import(url('routes/media.js')),
    import(url('routes/screens.js')),
    import(url('routes/widgets.js')),
    import(url('routes/marketplace.js')),
    import(url('CastImporter.js')),
    import(url('marketplace/ContentCatalogService.js')),
    import(url('marketplace/ContentInstallService.js')),
    import(url('marketplace/ContentJobService.js')),
    import(url('marketplace/WidgetInstallService.js')),
  ]);

  return {
    logger: loggerMod.default,
    CastManager: CastManagerMod.default,
    ScreenManager: ScreenManagerMod.default,
    MediaLibrary: MediaLibraryMod.default,
    PreviewManager: PreviewManagerMod.default,
    PairingManager: PairingManagerMod.default,
    WidgetRegistry: WidgetRegistryMod.default,
    WidgetRuntime: WidgetRuntimeMod.default,
    WidgetImageRenderer: WidgetImageRendererMod.default,
    WidgetCache: WidgetCacheMod.default,
    WidgetSecretStore: WidgetSecretStoreMod.default,
    WidgetEventStore: WidgetEventStoreMod.default,
    WidgetResolver: WidgetResolverMod.default,
    SlideImageRenderer: SlideImageRendererMod.default,
    getGpuStatus: SlideImageRendererMod.getGpuStatus,
    RenderBridge: RenderBridgeMod.default,
    VideoProcessor: VideoProcessorMod.default,
    SSDPDiscovery: SSDPDiscoveryMod.default,
    RenderTracker: RenderTrackerMod.default,
    WidgetRefreshService: WidgetRefreshServiceMod.default,
    ScreenWatchdogService: ScreenWatchdogServiceMod.default,
    UpdateTracker: UpdateTrackerMod.default,
    UpdateTypes: UpdateTrackerMod.UpdateTypes,
    SpriteSheetGenerator: SpriteSheetGeneratorMod.default,
    createCastRoutes: castsMod.default,
    createProtocolRoutes: protocolMod.default,
    createSettingsRoutes: settingsMod.default,
    createTemplateRoutes: templatesMod.default,
    createAutoLaunchRoutes: autoLaunchMod.default,
    createPreviewRoutes: previewMod.default,
    createImportExportRoutes: importExportMod.default,
    createMediaRoutes: mediaMod.default,
    createScreenRoutes: screensMod.default,
    createWidgetRoutes: widgetsMod.default,
    createMarketplaceRoutes: marketplaceMod.default,
    CastImporter: CastImporterMod.default,
    ContentCatalogService: ContentCatalogServiceMod.default,
    ContentInstallService: ContentInstallServiceMod.default,
    ContentJobService: ContentJobServiceMod.default,
    WidgetInstallService: WidgetInstallServiceMod.default,
  };
}

// ============================================
// Default settings
// ============================================
const DEFAULT_SETTINGS = {
  media_max_file_size: 52428800,
  media_max_total_storage: 1073741824,
  default_slide_duration: 10000,
  default_transition: 'fade',
  default_transition_duration: 500,
  pairing_enabled: 'true',
  require_pairing_approval: 'true',
  default_cast_id: '',
  auto_assign_default_cast: 'false',
  screen_offline_threshold: '300',
  allow_anonymous_preview: 'false',
  debug_mode_enabled: 'false',
  auto_create_screens_from_discovery: 'true',
  link_discovery_devices: 'true',
  ssdp_discovery_enabled: 'true',
  render_max_concurrent: '4',
  render_widget_refresh_interval: '60',
  render_stale_timeout: '300',
  render_cleanup_age_days: '7',
  updates_poll_timeout: '30000',
  updates_retention_minutes: '5',
  sprite_enabled: 'true',
  sprite_max_frames: '12',
  sprite_default_fps: '12',
  sprite_idle_only: 'true',
  sprite_max_concurrent: '1',
  sprite_max_size: '2048',
  sprite_cache_days: '30',
};

// ============================================
// Helper: load built-in templates
// ============================================
async function loadBuiltInTemplates(ctx) {
  const templatesDir = path.join(__dirname, 'templates');
  try {
    const files = await fs.readdir(templatesDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(templatesDir, file), 'utf8');
        const template = JSON.parse(content);
        const existing = await ctx.data.slidecast_templates.findAll({
          where: { name: template.name, is_builtin: 1 },
        });
        if (!existing || existing.length === 0) {
          await ctx.data.slidecast_templates.create({
            uuid: uuidv4(),
            name: template.name,
            description: template.description || '',
            author: template.author || 'Waiveo',
            definition: template,
            thumbnail: template.thumbnail || null,
            is_builtin: true,
          });
        } else {
          const existingTemplate = existing[0];
          const needsUpdate = existingTemplate.thumbnail !== template.thumbnail
            || existingTemplate.description !== (template.description || '');
          if (needsUpdate) {
            await ctx.data.slidecast_templates.update(
              { id: existingTemplate.id },
              {
                thumbnail: template.thumbnail || null,
                description: template.description || '',
                definition: template,
              },
            );
          }
        }
      } catch (error) {
        ctx.log(`Failed to load template ${file}: ${error.message}`, 'warn');
      }
    }
  } catch {
    // Templates directory may not exist yet
  }
}

// ============================================
// Helper: auto-cache casts missing render cache
// ============================================
async function autoCacheMissingCasts(ctx) {
  const { castManager, slideImageRenderer, renderTracker } = ctx.state;
  if (!castManager || !slideImageRenderer || !renderTracker) return;

  const allCasts = await castManager.getAll();
  if (!allCasts || allCasts.length === 0) return;

  let totalQueued = 0;
  let castsQueued = 0;

  for (const cast of allCasts) {
    try {
      const fullCast = await castManager.getByUuid(cast.uuid);
      if (!fullCast?.definition) continue;

      const slides = [];
      for (const group of fullCast.definition.groups || []) {
        for (const slide of group.slides || []) {
          slides.push(slide);
        }
      }
      if (slides.length === 0) continue;

      const cacheStatus = await slideImageRenderer.getCastCacheStatus(fullCast.uuid, slides.length);
      if (!cacheStatus.isFullyCached) {
        for (let i = 0; i < slides.length; i++) {
          const metadata = await slideImageRenderer.getSlideMetadata(fullCast.uuid, i).catch(() => null);
          if (metadata && metadata.layers && metadata.layers.length > 0) continue;

          const castIdForRender = fullCast.uuid;
          const slideIdx = i;
          const slideRef = slides[i];
          const vars = fullCast.definition.variables || {};
          const doRender = () => {
            renderTracker.startRender(castIdForRender, slideIdx);
            (async () => {
              try {
                await slideImageRenderer.renderSlide(castIdForRender, slideIdx, slideRef, vars);
                renderTracker.completeRender(castIdForRender, slideIdx);
              } catch (err) {
                ctx.log(`Auto-cache render failed: ${castIdForRender}/${slideIdx}: ${err.message}`, 'error');
                renderTracker.failRender(castIdForRender, slideIdx, err);
              }
            })();
          };
          renderTracker.queueRender(castIdForRender, slideIdx, doRender);
          totalQueued++;
        }
        castsQueued++;
      }
    } catch (err) {
      ctx.log(`Auto-cache error for cast ${cast.name}: ${err.message}`, 'error');
    }
  }

  if (totalQueued > 0) {
    ctx.log(`Auto-cache: Queued ${totalQueued} slides from ${castsQueued} casts`);
  }
}

// ============================================
// Helper: fetch Roku device details
// ============================================
async function fetchRokuDeviceDetails(deviceId, ip, ctx) {
  const fallback = {
    device_id: deviceId,
    ip_address: ip,
    name: `Roku ${deviceId.split('-').pop() || 'Device'}`,
    serial_number: deviceId.replace('roku-', ''),
    model: 'Unknown',
  };

  try {
    // Prefer inter-extension service call (no HTTP, no port assumptions)
    if (ctx.services?.['roku-integration']?.getDevice) {
      const device = await ctx.services['roku-integration'].getDevice({ deviceId });
      return device || fallback;
    }

    // Fallback: HTTP with correct port
    const port = process.env.BACKEND_PORT || 3001;
    const response = await fetch(
      `http://localhost:${port}/api/extensions/roku-integration/devices/${encodeURIComponent(deviceId)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.device) return data.device;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ============================================
// Helper: handle Roku device discovered -> create/update screen
// ============================================
async function handleRokuDeviceDiscovered(rokuDevice, ctx) {
  if (!rokuDevice) return;

  const { screenManager, pairingManager } = ctx.state;

  // Check if auto-creation is enabled
  try {
    const autoCreateSetting = await ctx.data.slidecast_settings.findOne({ key: 'auto_create_screens_from_discovery' });
    if (autoCreateSetting && autoCreateSetting.value === 'false') return;
  } catch {
    // Default to enabled
  }

  const serial = rokuDevice.serial_number || rokuDevice.device_id;
  if (!serial) return;

  const deviceName = rokuDevice.name || rokuDevice.friendly_name || `Roku ${serial.slice(-6)}`;
  const deviceModel = rokuDevice.model || 'Roku';

  // Check if screen already exists
  let existing = await screenManager.getBySerial(serial);
  if (!existing) {
    const allScreens = await screenManager.getAll();
    existing = allScreens.find((s) => {
      const meta = s.metadata || {};
      return meta.roku_device_id === rokuDevice.device_id;
    });
  }

  if (existing) {
    // Update existing screen with discovery data
    const updatedMetadata = {
      ...(existing.metadata || {}),
      roku_device_id: rokuDevice.device_id,
      discovery_linked: true,
      last_discovered: new Date().toISOString(),
      ip_address: rokuDevice.ip_address,
      serial_number: rokuDevice.serial_number,
      discovery_name: deviceName,
      discovery_model: deviceModel,
    };
    await screenManager.update(existing.serial, {
      name: deviceName,
      ip_address: rokuDevice.ip_address,
      metadata: updatedMetadata,
    });
    ctx.broadcast('slidecast:screen-updated', {
      screen: await screenManager.getBySerial(existing.serial),
      rokuDevice,
      discovery_linked: true,
    });
    return;
  }

  // Create new screen
  const screen = await screenManager.register({
    serial,
    name: deviceName,
    platform: 'roku',
    model: deviceModel,
    metadata: {
      roku_device_id: rokuDevice.device_id,
      ip_address: rokuDevice.ip_address,
      discovery_linked: true,
      auto_created: true,
      discovery_name: deviceName,
      serial_number: rokuDevice.serial_number,
      mac_address: rokuDevice.mac_address,
    },
  });

  ctx.broadcast('slidecast:screen-auto-created', { screen, rokuDevice, is_new: true });

  // Emit automation event
  ctx.emit('screen_discovered', {
    screen_id: serial,
    screen_name: screen.name,
    roku_device_id: rokuDevice.device_id,
    ip_address: rokuDevice.ip_address,
    model: deviceModel,
  });

  // Auto-assign default cast for new screens
  try {
    const [autoAssignSetting, defaultCastSetting] = await Promise.all([
      ctx.data.slidecast_settings.findOne({ key: 'auto_assign_default_cast' }),
      ctx.data.slidecast_settings.findOne({ key: 'default_cast_id' }),
    ]);
    if (autoAssignSetting?.value === 'true' && defaultCastSetting?.value) {
      const cast = await ctx.data.slidecast_casts.findOne({ uuid: defaultCastSetting.value });
      if (cast) {
        await screenManager.assignCast(serial, defaultCastSetting.value);
        ctx.broadcast('slidecast:screen-cast-assigned', {
          screen_serial: serial,
          cast_id: defaultCastSetting.value,
          cast_name: cast.name,
          auto_assigned: true,
        });
      }
    }
  } catch (err) {
    ctx.log(`Failed to auto-assign default cast: ${err.message}`, 'warn');
  }
}

// ============================================
// Helper: real-time Roku claim subscription (#1669)
// ============================================
// Slidecast only auto-created screens at the one-shot startup check
// (checkExistingRokuDevices, ~5s after boot). Rokus claimed at runtime (passive
// mDNS/SSDP discovery completes seconds later) never got a screen. We subscribe
// to the platform `discovery:claim-device` event and run the existing,
// idempotent screen-creation path so a screen appears the moment a Roku is
// claimed. The startup check is kept (catches Rokus claimed while Slidecast was
// down). register() dedupes by serial, so both paths are safe to run.
//
// Returns the bound handler so the caller can unsubscribe on teardown/reload
// (mirrors WidgetRefreshService.stop() hygiene). Exported for unit testing.
function subscribeToRokuClaims(ctx, eventBus) {
  if (!eventBus || typeof eventBus.on !== 'function') return null;

  const handler = (claim) => {
    // Run async work in an IIFE and stash the in-flight promise on ctx.state so
    // callers/tests can await completion (EventEmitter ignores handler returns).
    const inFlight = (async () => {
      try {
        if (!claim) return;
        const isRoku = claim.metadata?.deviceType === 'roku'
          || (typeof claim.deviceId === 'string' && claim.deviceId.startsWith('roku:'));
        if (!isRoku) return;

        const rokuDevice = await fetchRokuDeviceDetails(claim.deviceId, claim.candidate?.ip, ctx);
        await handleRokuDeviceDiscovered(rokuDevice, ctx);
      } catch (err) {
        // Never throw out of the event handler — log and skip.
        ctx.log(`Roku claim handler error: ${err.message}`, 'warn');
      }
    })();
    ctx.state._rokuClaimInFlight = inFlight;
    return inFlight;
  };

  eventBus.on('discovery:claim-device', handler);
  return handler;
}

// ============================================
// Helper: static file serving
// ============================================
async function serveStaticFile(ctx) {
  const { filename } = ctx.params;
  const sanitizedFilename = path.basename(filename);
  const filePath = path.join(__dirname, 'static', sanitizedFilename);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(sanitizedFilename).toLowerCase();
    const contentType = ext === '.css' ? 'text/css' : 'text/plain';
    ctx.res.setHeader('Content-Type', contentType);
    ctx.res.setHeader('Cache-Control', 'public, max-age=3600');
    return ctx.res.send(content);
  } catch {
    return { success: false, error: 'File not found', status: 404 };
  }
}

// ============================================
// SDK v2 Extension Definition
// ============================================

export default {
  // === Identity ===
  name: 'slidecast',
  // version intentionally omitted — package.json is the authoritative source.
  description: 'Digital signage system - create slideshows and cast to TV screens',
  provides: ['slidecast', 'digital-signage'],

  // === npm dependencies ===
  dependencies: {
    uuid: '^9.0.0',
    qrcode: '^1.5.3',
    multer: '^2.0.0',
    'mime-types': '^2.1.35',
    satori: '^0.10.14',
    sharp: '^0.33.2',
    jszip: '^3.10.1',
    playwright: '^1.40.0',
  },

  // === Navigation ===
  nav: [
    {
      label: 'Slidecast', icon: 'M8.25 4.5l7.5 7.5-7.5 7.5', path: '/ext/slidecast', order: 70,
    },
    {
      label: 'Screens', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', path: '/ext/slidecast/screens', order: 71,
    },
    {
      label: 'Media', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', path: '/ext/slidecast/media', order: 72,
    },
    {
      label: 'Widgets', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z', path: '/ext/slidecast/widgets', order: 73,
    },
  ],

  // === Database tables ===
  data: {
    slidecast_casts: {
      table: 'slidecast_casts', // use v1 table name (no prefix)
      fields: {
        uuid: 'string:required',
        name: 'string:required',
        description: 'string',
        definition: 'json:required',
        thumbnail: 'string',
      },
    },
    slidecast_screens: {
      table: 'slidecast_screens', // use v1 table name (no prefix)
      fields: {
        serial: 'string:required',
        name: 'string',
        platform: 'string',
        model: 'string',
        ip_address: 'string',
        assigned_cast_id: 'string',
        tags: 'json',
        status: 'string:default(offline)',
        last_seen_at: 'datetime',
        app_last_heartbeat: 'datetime',
        metadata: 'json',
        watchdog_enabled: 'integer:default(1)',
      },
    },
    slidecast_media: {
      table: 'slidecast_media', // use v1 table name (no prefix)
      fields: {
        uuid: 'string:required',
        name: 'string:required',
        type: 'string:required',
        mime_type: 'string',
        file_path: 'string:required',
        file_size: 'integer',
        checksum: 'string',
        width: 'integer',
        height: 'integer',
        duration: 'integer',
        thumbnail: 'string',
      },
    },
    slidecast_settings: {
      table: 'slidecast_settings', // use v1 table name (no prefix)
      fields: {
        key: 'string:required',
        value: 'string:required',
      },
    },
    slidecast_templates: {
      table: 'slidecast_templates', // use v1 table name (no prefix)
      fields: {
        uuid: 'string:required',
        name: 'string:required',
        description: 'string',
        author: 'string',
        definition: 'json:required',
        thumbnail: 'string',
        is_builtin: 'boolean:default(false)',
      },
    },
    slidecast_widgets: {
      table: 'slidecast_widgets', // use v1 table name (no prefix)
      fields: {
        uuid: 'string:required',
        name: 'string:required',
        description: 'string',
        category: 'string:default(custom)',
        render_mode: 'string:default(native)',
        server_code: 'text',
        html_template: 'text',
        client_code: 'text',
        code: 'text',
        config_schema: 'json',
        style_schema: 'json',
        default_size: 'json',
        table_schema: 'json',
        preview_primitives: 'json',
        refresh_interval: 'integer:default(60000)',
        supports_animation: 'boolean:default(false)',
        is_system: 'boolean:default(false)',
        is_published: 'boolean:default(false)',
        thumbnail: 'string',
        current_version: 'integer:default(1)',
      },
    },
    slidecast_widget_assets: {
      table: 'slidecast_widget_assets', // use v1 table name (no prefix)
      fields: {
        widget_uuid: 'string:required',
        filename: 'string:required',
        mime_type: 'string:required',
        size: 'integer',
        data: 'text',
      },
    },
    slidecast_widget_versions: {
      table: 'slidecast_widget_versions', // use v1 table name (no prefix)
      fields: {
        widget_uuid: 'string:required',
        version: 'integer:required',
        code: 'text',
        server_code: 'text',
        client_code: 'text',
        html_template: 'text',
        config_schema: 'json',
        style_schema: 'json',
        table_schema: 'json',
        db_snapshot: 'json',
        assets_snapshot: 'json',
      },
    },
    // slidecast_widget_secrets DELETED (secrets one-stop-shop Wave 2, Task 5):
    // widget secrets now live in the ONE system store (system_secrets, owner
    // `widget:<wid>`, one host key, audited) reached via WidgetSecretStore.
    // Pre-launch: no migration. The loader never DROPs tables, so a stale
    // slidecast_widget_secrets table on an existing dev box is inert.
    slidecast_widget_cache: {
      table: 'slidecast_widget_cache', // use v1 table name (no prefix)
      fields: {
        cache_key: 'string:required',
        widget_uuid: 'string:required',
        config_hash: 'string',
        styles_hash: 'string',
        data_hash: 'string',
        content_hash: 'string',
        file_path: 'string:required',
        expires_at: 'datetime',
      },
    },
    slidecast_widget_storage: {
      table: 'slidecast_widget_storage', // use v1 table name (no prefix)
      fields: {
        widget_uuid: 'string:required',
        instance_id: 'string',
        scope: 'string:default(instance)',
        key: 'string:required',
        value: 'json',
      },
    },
    slidecast_widget_events: {
      table: 'slidecast_widget_events', // use v1 table name (no prefix)
      fields: {
        event_type: 'string:required',
        source: 'string',
        entity_id: 'string',
        data: 'json',
      },
    },
    slidecast_pairing_codes: {
      table: 'slidecast_pairing_codes', // use v1 table name (no prefix)
      fields: {
        code: 'string:required',
        device_serial: 'string:required',
        device_info: 'json',
        status: 'string:default(pending)',
        paired_by_user_id: 'integer',
        expires_at: 'datetime:required',
      },
    },
    slidecast_device_tokens: {
      table: 'slidecast_device_tokens', // use v1 table name (no prefix)
      fields: {
        device_serial: 'string:required',
        token: 'string:required',
        token_hash: 'string:required',
        device_info: 'json',
        paired_by_user_id: 'integer',
        last_used_at: 'datetime',
        revoked: 'boolean:default(false)',
        revoked_at: 'datetime',
      },
    },

    // Versioned, append-only imperative migrations (spec §5.1). Ordering is by
    // ARRAY POSITION (versioned by migration count via extensions.schema_version);
    // `to` documents the release that introduced the entry. NEVER reorder or
    // remove a past entry — only append.
    migrations: [
      {
        // supports_animation backfill: mark the built-in animated seed widgets so
        // Roku fetches their sprite sheets. A genuine data transform (a targeted
        // UPDATE) the additive column-diff cannot express — the `supports_animation`
        // column itself is declared in slidecast_widgets.fields (created by
        // TableMigrator, which runs before this). Idempotent (UPDATE by uuid).
        to: '1.0.0',
        up: async (db) => {
          const animatedWidgetUuids = [
            'seed-widget-pulse-effect',
            'seed-widget-weather-sun',
            'seed-widget-weather-rain',
            'seed-widget-scrolling-ticker',
            'seed-widget-countdown-flip',
          ];
          for (const uuid of animatedWidgetUuids) {
            await db.run(
              'UPDATE slidecast_widgets SET supports_animation = 1 WHERE uuid = ?',
              [uuid],
            );
          }
        },
      },
    ],
  },

  // === Custom events (automation triggers + cross-extension pub/sub) ===
  events: {
    screen_connected: {
      label: 'Screen came online',
      data: {
        screen_id: 'string',
        screen_name: 'string',
        serial: 'string',
        platform: 'string',
      },
    },
    screen_disconnected: {
      label: 'Screen went offline',
      data: {
        screen_id: 'string',
        screen_name: 'string',
        serial: 'string',
      },
    },
    ping_received: {
      label: 'Ping received',
      data: {
        screen_id: 'string',
        screen_name: 'string',
        ping_name: 'string',
        cast_id: 'string',
        slide_id: 'string',
      },
    },
    slide_changed: {
      label: 'Slide changed',
      data: {
        screen_id: 'string',
        cast_id: 'string',
        slide_index: 'string',
        slide_name: 'string',
      },
    },
    screen_discovered: {
      label: 'Screen auto-created from Roku discovery',
      data: {
        screen_id: 'string',
        screen_name: 'string',
        roku_device_id: 'string',
        ip_address: 'string',
        model: 'string',
      },
    },
  },

  // === Automation integration ===
  automations: {
    actions: {
      play_cast: {
        label: 'Play cast on screen',
        fields: {
          screen_id: { type: 'device', label: 'Screen', required: true },
          cast_id: {
            type: 'select', label: 'Cast', required: true, source: '/api/extensions/slidecast/casts',
          },
        },
        fn: async (ctx, params) => {
          const { screenManager, previewManager } = ctx.state;
          const { screen_id, cast_id } = params;
          const screen = await screenManager.assignCast(screen_id, cast_id);
          if (screen) previewManager.notifyScreenTune(screen_id, cast_id);
          return { success: !!screen };
        },
      },
      play_cast_all: {
        label: 'Play cast on all screens',
        fields: {
          cast_id: {
            type: 'select', label: 'Cast', required: true, source: '/api/extensions/slidecast/casts',
          },
        },
        fn: async (ctx, params) => {
          const { screenManager, previewManager } = ctx.state;
          const { cast_id } = params;
          const screens = await screenManager.getAll();
          for (const screen of screens) {
            await screenManager.assignCast(screen.serial, cast_id);
            previewManager.notifyScreenTune(screen.serial, cast_id);
          }
          return { success: true, count: screens.length };
        },
      },
      play_cast_tagged: {
        label: 'Play cast on tagged screens',
        fields: {
          tag: { type: 'string', label: 'Tag', required: true },
          cast_id: {
            type: 'select', label: 'Cast', required: true, source: '/api/extensions/slidecast/casts',
          },
        },
        fn: async (ctx, params) => {
          const { screenManager, previewManager } = ctx.state;
          const { tag, cast_id } = params;
          const count = await screenManager.assignCastToTag(tag, cast_id);
          const screens = await screenManager.getByTag(tag);
          for (const screen of screens) {
            previewManager.notifyScreenTune(screen.serial, cast_id);
          }
          return { success: true, count };
        },
      },
      jump_to_slide: {
        label: 'Jump to slide',
        fields: {
          screen_id: { type: 'device', label: 'Screen', required: true },
          slide_index: { type: 'number', label: 'Slide Index', required: true },
        },
        fn: async (ctx, params) => {
          // SL8: deliver via the live long-poll update channel (screen_command),
          // not the dead WS `screen` channel PreviewManager used (never connected).
          const { updateTracker, UpdateTypes } = ctx.state;
          updateTracker.pushUpdate(
            params.screen_id,
            UpdateTypes.screenCommand('jump_to_slide', { slide_index: params.slide_index }),
          );
          return { success: true };
        },
      },
      show_alert: {
        label: 'Show alert overlay',
        fields: {
          screen_id: { type: 'device', label: 'Screen (blank = all)' },
          message: { type: 'string', label: 'Alert Message', required: true },
          style: {
            type: 'select',
            label: 'Style',
            required: true,
            options: [
              { value: 'info', label: 'Info (Blue)' },
              { value: 'warning', label: 'Warning (Yellow)' },
              { value: 'emergency', label: 'Emergency (Red)' },
            ],
          },
          duration: { type: 'number', label: 'Duration (sec, 0=manual dismiss)', default: 10 },
        },
        fn: async (ctx, params) => {
          // SL8: live long-poll channel. Blank screen_id → 'all' (broadcast to
          // every screen with an active update queue).
          const { updateTracker, UpdateTypes } = ctx.state;
          const command = UpdateTypes.screenCommand('show_alert', {
            message: params.message,
            style: params.style || 'info',
            // `?? 10` (not `|| 10`) so an explicit duration: 0 — "show until
            // dismiss_alert" — is preserved instead of defaulting to 10s.
            duration: params.duration ?? 10,
          });
          updateTracker.pushUpdate(params.screen_id || 'all', command);
          return { success: true };
        },
      },
      dismiss_alert: {
        label: 'Dismiss alert',
        fields: {
          screen_id: { type: 'device', label: 'Screen (blank = all)' },
        },
        fn: async (ctx, params) => {
          // SL8: live long-poll channel.
          const { updateTracker, UpdateTypes } = ctx.state;
          updateTracker.pushUpdate(
            params.screen_id || 'all',
            UpdateTypes.screenCommand('dismiss_alert'),
          );
          return { success: true };
        },
      },
      refresh_widget: {
        label: 'Refresh widget',
        fields: {
          screen_id: { type: 'device', label: 'Screen (blank = all)' },
          widget_uuid: {
            type: 'select', label: 'Widget', required: true, source: '/api/extensions/slidecast/widgets',
          },
        },
        fn: async (ctx, params) => {
          // SL8: live long-poll channel.
          const { updateTracker, UpdateTypes } = ctx.state;
          updateTracker.pushUpdate(
            params.screen_id || 'all',
            UpdateTypes.screenCommand('refresh_widget', { widget_uuid: params.widget_uuid }),
          );
          return { success: true };
        },
      },
    },
  },

  // === WebSocket channels ===
  // NOTE: this channel is currently unimplemented end-to-end, not just here.
  // 1) previewManager.handleScreenConnect/handleScreenMessage/handleScreenDisconnect
  //    never existed — PreviewManager only exposes registerConnection(serial, ws) /
  //    removeConnection(serial), which nothing in this codebase calls either.
  // 2) There is no transport wired to this channel at all: the platform's WS
  //    upgrade handler (backend/src/utils/websocket.js) only accepts `/ws` and
  //    never dispatches to ChannelManager.handleConnection for extension
  //    channels, so this onConnect/onMessage/onDisconnect can never fire.
  // 3) No client (Roku or Studio frontend) connects to a per-extension
  //    "screen" channel anywhere in the codebase.
  // Push-to-screen (tune/alert/jump-to-slide) actually happens over the
  // long-poll /protocol/updates route (see routes/protocol.js), not this
  // channel. Fixing real-time WS push would need platform-level wiring in
  // backend/src (out of scope here) plus a real client. Left as a documented
  // no-op rather than inventing handlers/serial-identification that don't
  // exist anywhere else in the system.
  channels: {
    screen: {
      onConnect: async (ctx, socket) => {
        ctx.log('Screen WebSocket connected (channel has no real transport wiring — see NOTE above)', 'debug');
      },
      onMessage: async (ctx, socket, message) => {
        // Unimplemented — see NOTE above.
      },
      onDisconnect: async (ctx, socket) => {
        // Unimplemented — see NOTE above.
      },
    },
  },

  // === React to platform events ===
  hooks: {
    // Auto-create screens when Roku devices are discovered
    'device:added': async (ctx, data) => {
      try {
        if (data.deviceType === 'roku') {
          ctx.log(`Received device:added event for Roku: ${data.deviceId}`);
          const rokuDevice = await fetchRokuDeviceDetails(data.deviceId, data.ip, ctx);
          if (rokuDevice) {
            await handleRokuDeviceDiscovered(rokuDevice, ctx);
          }
        }
      } catch (error) {
        ctx.log(`Error handling device:added for Roku: ${error.message}`, 'error');
      }
    },
  },

  // === HTTP Routes ===
  // All route modules are registered dynamically via ctx.registerRoutes() in init().
  // See routes/*.js for the v2 route factory functions:
  //   casts.js, screens.js, media.js, widgets.js, protocol.js, settings.js,
  //   templates.js, preview.js, import-export.js, autoLaunch.js
  // Only the static file route remains here (not part of any route module).
  routes: {
    'GET /static/:filename [public] [stream]': serveStaticFile,
  },

  // === Services (inter-extension API) ===
  services: {
    getCastManager: async (ctx) => ctx.state.castManager,
    getScreenManager: async (ctx) => ctx.state.screenManager,
    getMediaLibrary: async (ctx) => ctx.state.mediaLibrary,
    getPreviewManager: async (ctx) => ctx.state.previewManager,
  },

  // === Lifecycle: initialization ===
  init: async (ctx) => {
    ctx.log(`Slidecast initializing... (reloadToken=${ctx.reloadToken ?? 'n/a'})`);

    // Hot-reload safe: re-import every internal sub-module on each init() so
    // deploy-cli's uploaded code actually takes effect. See the comment block
    // at the top of this file and task #886. Keeps every manager class, route
    // factory, and helper in lockstep with what's on disk.
    const {
      logger,
      CastManager, ScreenManager, MediaLibrary, PreviewManager, PairingManager,
      WidgetRegistry, WidgetRuntime, WidgetImageRenderer, WidgetCache,
      WidgetSecretStore, WidgetEventStore, WidgetResolver,
      SlideImageRenderer, getGpuStatus, RenderBridge, VideoProcessor, SSDPDiscovery,
      RenderTracker, WidgetRefreshService, ScreenWatchdogService, UpdateTracker, UpdateTypes, SpriteSheetGenerator,
      createCastRoutes, createProtocolRoutes, createSettingsRoutes, createTemplateRoutes,
      createAutoLaunchRoutes, createPreviewRoutes, createImportExportRoutes,
      createMediaRoutes, createScreenRoutes, createWidgetRoutes, createMarketplaceRoutes,
      CastImporter, ContentCatalogService, ContentInstallService, ContentJobService,
      WidgetInstallService,
    } = await importExtensionSubmodules(ctx);

    // Create media storage directory
    const mediaDir = `${process.env.DATA_DIR || '/app/data'}/slidecast/media`;
    try {
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.mkdir(path.join(mediaDir, 'images'), { recursive: true });
      await fs.mkdir(path.join(mediaDir, 'videos'), { recursive: true });
      await fs.mkdir(path.join(mediaDir, 'thumbnails'), { recursive: true });
    } catch {
      // May already exist
    }

    // Initialize default settings.
    //
    // Policy (task #1163):
    //   - Fresh DB (row absent): insert the current DEFAULT_SETTINGS value.
    //   - Existing row: do NOT overwrite operator-set values — we MUST NOT
    //     downgrade a pool size an operator tuned up (e.g. 8 on a beefy host).
    //   - Exception: render_max_concurrent legacy-bump. Historically the
    //     shipped default was '1', which starved the render pool on fresh
    //     deploys. The ship default is now '4'. Upgrade ONLY the exact legacy
    //     value '1' -> '4'; any other existing value is operator-set and
    //     preserved. See task #1163.
    const LEGACY_BUMPS = {
      // key: { from: string, to: string }
      render_max_concurrent: { from: '1', to: '4' },
    };
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      try {
        const existing = await ctx.data.slidecast_settings.findAll({ where: { key } });
        if (!existing || existing.length === 0) {
          await ctx.data.slidecast_settings.create({ key, value: String(value) });
        } else {
          const bump = LEGACY_BUMPS[key];
          const row = existing[0];
          if (bump && row && String(row.value) === bump.from) {
            try {
              // Use the same update path as the settings route: findAll+update by id.
              await ctx.data.slidecast_settings.update(row.id, {
                value: bump.to,
                updated_at: new Date().toISOString(),
              });
              ctx.log(
                `Bumped legacy slidecast_settings.${key} from "${bump.from}" to "${bump.to}" (task #1163)`,
                'info',
              );
            } catch (updateErr) {
              ctx.log(
                `Failed to bump legacy ${key}: ${updateErr.message}`,
                'warn',
              );
            }
          }
        }
      } catch {
        // Ignore individual setting failures
      }
    }

    // Initialize logger with a compatibility shim for the api-style interface
    // Existing managers use logger.init(api); logger.info/error/warn/debug
    // We provide a lightweight wrapper that delegates to ctx.log
    const loggerApi = {
      log: (msg, level) => ctx.log(msg, level),
      model: (name) => ctx.data[name],
      queryBuilder: (name) => ctx.data.query(name),
    };
    logger.init(loggerApi);

    // ---- Initialize all managers ----
    // Managers expect an `api` object with model(), queryBuilder(), broadcast(), etc.
    // createSlidecastApi provides a clean, explicit adapter that delegates to ctx.
    const api = createSlidecastApi(ctx);

    const castManager = new CastManager(api);
    const screenManager = new ScreenManager(api, { eventBus: api.globalEventBus || null });
    const mediaLibrary = new MediaLibrary(api);
    const previewManager = new PreviewManager(api, screenManager);
    const pairingManager = new PairingManager(api);

    await castManager.init();
    await screenManager.init();
    await mediaLibrary.init();
    await previewManager.init();
    await pairingManager.initialize();

    // Widget managers
    const widgetRegistry = new WidgetRegistry(api);
    const widgetRuntime = new WidgetRuntime(api);
    const widgetImageRenderer = new WidgetImageRenderer(api);
    const widgetCache = new WidgetCache(api);
    const widgetSecrets = new WidgetSecretStore();
    const widgetEventStore = new WidgetEventStore(api);

    await widgetRegistry.init();
    await widgetRuntime.init();
    await widgetImageRenderer.init();
    await widgetCache.init();
    ctx.onDestroy(async () => widgetCache.stop()); // minor: stop recurring cache cleanup on unload
    await widgetSecrets.init();
    await widgetEventStore.init();

    // WidgetResolver unifies DB (user-code) widgets and extension-provided widget
    // types behind one contract. Extension widgets come from the platform
    // WidgetProviderRegistry on ctx.platform (may be absent on an older platform).
    const widgetResolver = new WidgetResolver({
      widgetRegistry,
      widgetRuntime,
      widgetProviderRegistry: (ctx.platform && ctx.platform.widgetProviderRegistry) || null,
    });

    // Read render_max_concurrent up-front so the bridge + worker pool are
    // sized from the DB setting rather than the hardcoded env default (#1152, #1167).
    // Silent catch removed — a failed DB read used to hide itself and leave the
    // bridge sized by env/default; now we surface the error so ops can see why
    // the pool isn't the expected size.
    let initialRenderMaxConcurrent = 4;
    let poolSizeSource = 'default';
    try {
      const mc = await ctx.data.slidecast_settings.findOne({ key: 'render_max_concurrent' });
      if (mc) {
        const parsed = parseInt(mc.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          initialRenderMaxConcurrent = parsed;
          poolSizeSource = 'setting render_max_concurrent';
        } else {
          ctx.log(`render_max_concurrent setting value is not a positive integer ("${mc.value}") — using default=4`, 'warn');
        }
      }
    } catch (err) {
      ctx.log(`Failed to read render_max_concurrent setting: ${err.message} — using default=4`, 'warn');
    }
    ctx.log(`render-worker pool size=${initialRenderMaxConcurrent} (from ${poolSizeSource})`, 'info');

    // Render bridge (child-process IPC to render-worker)
    const renderBridge = new RenderBridge({
      maxConcurrent: initialRenderMaxConcurrent,
      logger: {
        info: (m) => ctx.log(m, 'info'),
        warn: (m) => ctx.log(m, 'warn'),
        error: (m) => ctx.log(m, 'error'),
        debug: (m) => ctx.log(m, 'debug'),
      },
    });

    // Slide image renderer (Playwright + Sharp for Roku pre-rendering)
    const slideImageRenderer = new SlideImageRenderer(api, {
      dataDir: process.env.DATA_DIR || '/app/data',
      baseUrl: `http://127.0.0.1:${process.env.WEB_PORT || 5173}`,
      castManager,
      widgetRuntime,
      widgetRegistry,
      widgetImageRenderer,
      bridge: renderBridge,
    });
    await slideImageRenderer.init();

    try {
      await renderBridge.start();
      ctx.log('Render worker ready — Chromium hot', 'info');
    } catch (err) {
      ctx.log(`Render worker failed to start: ${err.message} — rendering degraded`, 'error');
      if (ctx.reportDegraded) ctx.reportDegraded('Render worker failed to start');
    }

    // Surface a post-boot crash-loop (too many respawns) as extension health,
    // not just a log line — nothing else was subscribed to this event.
    if (ctx.reportDegraded) {
      renderBridge.on('degraded', () => {
        ctx.reportDegraded('Render worker crash-looped and is now degraded');
      });
    }

    // Shut down the render-worker child process on hot-reload or unload so
    // the old Chromium instance is not left as a zombie process.
    ctx.onDestroy(async () => {
      ctx.log('Shutting down render worker (destroy lifecycle)', 'info');
      await renderBridge.shutdown();
    });

    // Video processor
    const videoProcessor = new VideoProcessor(api, mediaLibrary);
    await videoProcessor.init();

    // Read render settings from DB
    let renderMaxConcurrent = 1;
    let renderWidgetRefreshInterval = 60;
    let renderCleanupAgeDays = 7;
    try {
      const [mc, ri, ca] = await Promise.all([
        ctx.data.slidecast_settings.findOne({ key: 'render_max_concurrent' }),
        ctx.data.slidecast_settings.findOne({ key: 'render_widget_refresh_interval' }),
        ctx.data.slidecast_settings.findOne({ key: 'render_cleanup_age_days' }),
      ]);
      if (mc) renderMaxConcurrent = parseInt(mc.value, 10) || 1;
      if (ri) renderWidgetRefreshInterval = parseInt(ri.value, 10) || 60;
      if (ca) renderCleanupAgeDays = parseInt(ca.value, 10) || 7;
    } catch { /* defaults */ }

    // RenderTracker for non-blocking slide rendering
    const renderTracker = new RenderTracker(api, {
      maxConcurrent: renderMaxConcurrent,
      staleTimeoutMs: 5 * 60 * 1000,
    });

    // Ensure the cleanup interval is cleared on hot-reload or unload
    ctx.onDestroy(async () => {
      renderTracker.destroy();
    });

    // UpdateTracker for long-polling (constructed before WidgetRefreshService so it can be passed in)
    let updatesPollTimeout = 30000;
    let updatesRetentionMinutes = 5;
    try {
      const pt = await ctx.data.slidecast_settings.findOne({ key: 'updates_poll_timeout' });
      const rm = await ctx.data.slidecast_settings.findOne({ key: 'updates_retention_minutes' });
      if (pt) updatesPollTimeout = parseInt(pt.value, 10) || 30000;
      if (rm) updatesRetentionMinutes = parseInt(rm.value, 10) || 5;
    } catch { /* defaults */ }

    const updateTracker = new UpdateTracker(api, {
      pollTimeout: updatesPollTimeout,
      retentionMinutes: updatesRetentionMinutes,
    });
    await updateTracker.init();
    // SL7: without this, hot-deploy/reload leaked the cleanup timer and
    // stranded every in-flight long-poll client (they hung to their timeout).
    ctx.onDestroy(async () => updateTracker.shutdown());

    // WidgetRefreshService for background widget rendering
    const widgetRefreshService = new WidgetRefreshService(api, {
      screenManager,
      castManager,
      widgetRegistry,
      widgetRuntime,
      widgetResolver,
      widgetImageRenderer,
      widgetCache,
      updateTracker,
      eventBus: api.globalEventBus || null,
      intervalMs: renderWidgetRefreshInterval * 1000,
    });
    widgetRefreshService.start();
    ctx.onDestroy(async () => widgetRefreshService.stop());

    // ScreenWatchdogService: sideloaded Roku channels don't auto-launch on
    // power-on, so a power-cycled screen boots to Home and stays blank. This
    // relaunches (via ECP) any screen that has dropped off Waiveo — power-cycle
    // OR a transient crash — so the fleet self-heals without anyone noticing.
    const screenWatchdog = new ScreenWatchdogService(api, {
      screenManager,
      intervalMs: 60000,
    });
    screenWatchdog.start();
    ctx.onDestroy(async () => screenWatchdog.stop());

    // SpriteSheetGenerator for animated widgets
    let spriteMaxFrames = 12; let spriteDefaultFps = 12; let spriteIdleOnly = true; let
      spriteCacheDays = 30;
    try {
      const [mf, df, io, cd] = await Promise.all([
        ctx.data.slidecast_settings.findOne({ key: 'sprite_max_frames' }),
        ctx.data.slidecast_settings.findOne({ key: 'sprite_default_fps' }),
        ctx.data.slidecast_settings.findOne({ key: 'sprite_idle_only' }),
        ctx.data.slidecast_settings.findOne({ key: 'sprite_cache_days' }),
      ]);
      if (mf) spriteMaxFrames = parseInt(mf.value, 10) || 12;
      if (df) spriteDefaultFps = parseInt(df.value, 10) || 12;
      if (io) spriteIdleOnly = io.value === 'true';
      if (cd) spriteCacheDays = parseInt(cd.value, 10) || 30;
    } catch { /* defaults */ }

    const spriteSheetGenerator = new SpriteSheetGenerator(api, {
      widgetRegistry,
      widgetRuntime,
      widgetImageRenderer,
      widgetCache,
      renderTracker,
      maxFrames: spriteMaxFrames,
      defaultFps: spriteDefaultFps,
      idleOnly: spriteIdleOnly,
      cacheDays: spriteCacheDays,
      dataDir: process.env.DATA_DIR || '/app/data',
    });
    await spriteSheetGenerator.init();

    // Schedule daily render cleanup at ~3am
    const cleanupTimer = scheduleRenderCleanup(slideImageRenderer, renderCleanupAgeDays, ctx);
    // Defensive: scheduler-backed jobs are already drained by shutdownPrimitives(),
    // but the legacy raw-timer fallback (no ctx.scheduler wired) isn't — cancel()
    // covers both cases.
    ctx.onDestroy(async () => cleanupTimer.cancel());

    // SSDP Discovery for Roku auto-configuration
    let ssdpDiscovery = null;
    try {
      let ssdpEnabled = true;
      try {
        const ssdpSetting = await ctx.data.slidecast_settings.findOne({ key: 'ssdp_discovery_enabled' });
        if (ssdpSetting && ssdpSetting.value === 'false') ssdpEnabled = false;
      } catch { /* default enabled */ }

      if (ssdpEnabled) {
        const serverPort = parseInt(process.env.FRONTEND_PORT || '80', 10);
        ssdpDiscovery = new SSDPDiscovery(api, { serverPort });
        ssdpDiscovery.start();
        ctx.onDestroy(async () => ssdpDiscovery.stop());
      }
    } catch (error) {
      ctx.log(`Failed to start SSDP Discovery: ${error.message}`, 'warn');
    }

    // Wire up cross-references
    widgetRegistry.setImageRenderer(widgetImageRenderer);
    widgetRegistry.setRuntime(widgetRuntime);
    widgetRegistry.setSecretStore(widgetSecrets); // widget-removal secret teardown (Task 5)
    widgetRuntime.setEventStore(widgetEventStore);
    widgetRuntime.setSecrets(widgetSecrets);

    // Subscribe widget event store to global events if available
    if (api.globalEventBus) {
      widgetEventStore.subscribeToGlobalEvents(api.globalEventBus);
    }

    // Wire up widget refresh -> slide layer re-render pipeline.
    // Pass {updateTracker, screenManager} so the listener can push
    // slide_rendered updates to Roku after a layer refresh (#1150).
    if (api.globalEventBus && typeof slideImageRenderer.setupEventListeners === 'function') {
      slideImageRenderer.setupEventListeners(api.globalEventBus, {
        updateTracker,
        screenManager,
      });
      // Detach on unload/reload so the process-global bus listener doesn't outlive
      // this extension instance (idempotent setup already caps it at one; this makes
      // a clean unload leave zero).
      if (typeof slideImageRenderer.teardownEventListeners === 'function') {
        ctx.onDestroy(() => slideImageRenderer.teardownEventListeners());
      }
    }

    // Store all managers on ctx.state
    ctx.state.castManager = castManager;
    ctx.state.screenManager = screenManager;
    ctx.state.mediaLibrary = mediaLibrary;
    ctx.state.previewManager = previewManager;
    ctx.state.pairingManager = pairingManager;
    ctx.state.widgetRegistry = widgetRegistry;
    ctx.state.widgetRuntime = widgetRuntime;
    ctx.state.widgetResolver = widgetResolver;
    ctx.state.widgetImageRenderer = widgetImageRenderer;
    ctx.state.widgetCache = widgetCache;
    ctx.state.widgetSecrets = widgetSecrets;
    ctx.state.widgetEventStore = widgetEventStore;
    ctx.state.slideImageRenderer = slideImageRenderer;
    ctx.state.renderBridge = renderBridge;
    ctx.state.videoProcessor = videoProcessor;
    ctx.state.renderTracker = renderTracker;
    ctx.state.widgetRefreshService = widgetRefreshService;
    ctx.state.updateTracker = updateTracker;
    ctx.state.UpdateTypes = UpdateTypes; // SL8: used by jump_to_slide/alert/refresh actions
    ctx.state.spriteSheetGenerator = spriteSheetGenerator;
    ctx.state.ssdpDiscovery = ssdpDiscovery;
    ctx.state.dataDir = process.env.DATA_DIR || '/app/data';
    ctx.state.cleanupTimer = cleanupTimer;
    ctx.state.api = api;

    // Register cast routes via v2 RouteManager
    const castRoutes = createCastRoutes({
      previewManager,
      widgetRegistry,
      widgetRuntime,
      slideImageRenderer,
      renderTracker,
      logger,
      eventBus: api.globalEventBus || null,
      widgetSecrets, // Task 6: cast-save secret intercept writes to the system store
    });
    ctx.registerRoutes(castRoutes);

    // Register protocol routes via v2 RouteManager
    const protocolRoutes = createProtocolRoutes({
      api,
      castManager,
      screenManager,
      mediaLibrary,
      pairingManager,
      slideImageRenderer,
      renderTracker,
      widgetCache,
      widgetRefreshService,
      widgetRegistry,
      widgetRuntime,
      widgetResolver,
      updateTracker,
      // #poll-memo: forward the bus so protocol routes can invalidate the cached
      // widget-versions map on widget:layer_updated (re-render bumps layer mtime).
      eventBus: api.globalEventBus || null,
    });
    ctx.registerRoutes(protocolRoutes);

    // Register settings routes via v2 RouteManager
    const settingsRoutes = createSettingsRoutes({
      ssdpDiscovery,
      renderTracker,
      slideImageRenderer,
      getRenderStatus: () => getGpuStatus(renderBridge),
    });
    ctx.registerRoutes(settingsRoutes);

    // Register template routes via v2 RouteManager
    const templateRoutes = createTemplateRoutes({
      castManager,
    });
    ctx.registerRoutes(templateRoutes);

    // Register auto-launch routes via v2 RouteManager
    // Pass extensionCtx so autoLaunch can use ctx.services.automation.getEngine()
    const autoLaunchRoutes = createAutoLaunchRoutes({
      screenManager,
      api,
      extensionCtx: ctx,
    });
    ctx.registerRoutes(autoLaunchRoutes);

    // Register preview routes via v2 RouteManager
    const previewRoutes = createPreviewRoutes({
      previewManager,
    });
    ctx.registerRoutes(previewRoutes);

    // Register import/export routes via v2 RouteManager
    const importExportRoutes = createImportExportRoutes({
      castManager,
      mediaLibrary,
      widgetRegistry,
      dataDir: process.env.DATA_DIR || '/app/data',
      // #1199: forward eventBus so zip-import emits cast:definition_changed
      eventBus: api.globalEventBus || null,
    });
    ctx.registerRoutes(importExportRoutes);

    // Register media routes via v2 RouteManager
    const mediaRoutes = createMediaRoutes({
      mediaLibrary,
      videoProcessor,
    });
    ctx.registerRoutes(mediaRoutes);

    // Register screen routes via v2 RouteManager
    const screenRoutes = createScreenRoutes({
      screenManager,
      previewManager,
      extensionCtx: ctx,
    });
    ctx.registerRoutes(screenRoutes);

    // Register widget routes via v2 RouteManager
    const widgetRoutes = createWidgetRoutes({
      widgetRegistry,
      widgetRuntime,
      widgetResolver,
      widgetProviderRegistry: (ctx.platform && ctx.platform.widgetProviderRegistry) || null,
      widgetImageRenderer,
      widgetCache,
      widgetSecrets,
      widgetEventStore,
      spriteSheetGenerator,
      api,
      logger,
      eventBus: api.globalEventBus || null,
    });
    ctx.registerRoutes(widgetRoutes);

    // ---- Content marketplace (Task 4/B3, Stage 1: casts + templates) ----
    // Slidecast-LOCAL ports of the B1 catalog/install/job machinery (extensions
    // cannot import core backend/src). ONE catalog service; the install layer is
    // the deliberate split — ContentInstallService handles INERT data only
    // (widgets, which execute code, get a separate trust-gated service in Phase 2).
    const marketplaceSettings = {
      get: async (key, def = null) => {
        try {
          const row = await ctx.data.slidecast_settings.findOne({ key });
          return row ? row.value : def;
        } catch {
          return def;
        }
      },
    };
    const contentCatalogService = new ContentCatalogService({ settings: marketplaceSettings });
    // A dedicated CastImporter for the marketplace (owns the stable-install path).
    const marketplaceCastImporter = new CastImporter(api, castManager, mediaLibrary, widgetRegistry, {
      dataDir: process.env.DATA_DIR || '/app/data',
      eventBus: api.globalEventBus || null,
    });
    const contentInstallService = new ContentInstallService({
      catalog: contentCatalogService,
      castImporter: marketplaceCastImporter,
      templatesModel: api.model('slidecast_templates'),
      settingsModel: api.model('slidecast_settings'),
      broadcast: (event, data) => ctx.broadcast(event, data),
    });
    // Widgets EXECUTE code, so they get a SEPARATE, trust-gated install service
    // (the deliberate security split) — same shared catalog, different apply target
    // (WidgetRegistry.import→publish, which writes the version ledger row).
    const widgetInstallService = new WidgetInstallService({
      catalog: contentCatalogService,
      widgetRegistry,
      settingsModel: api.model('slidecast_settings'),
      broadcast: (event, data) => ctx.broadcast(event, data),
    });
    // One batch engine; dispatch each item to the right install service by kind.
    const marketplaceInstallDispatcher = {
      install: (kind, id, versionSpec, opts) => (kind === 'widget'
        ? widgetInstallService.install(kind, id, versionSpec, opts)
        : contentInstallService.install(kind, id, versionSpec, opts)),
    };
    const contentJobService = new ContentJobService({
      installService: marketplaceInstallDispatcher,
      broadcast: (event, data) => ctx.broadcast(event, data),
    });
    ctx.state.contentCatalogService = contentCatalogService;
    ctx.state.contentInstallService = contentInstallService;
    ctx.state.widgetInstallService = widgetInstallService;
    ctx.state.contentJobService = contentJobService;

    const marketplaceRoutes = createMarketplaceRoutes({
      contentCatalogService,
      contentInstallService,
      contentJobService,
    });
    ctx.registerRoutes(marketplaceRoutes);

    // Register render bridge status/control routes
    ctx.registerRoutes({
      'GET /render/status': async () => ({
        success: true,
        ...renderBridge.getHealth(),
        queue: renderBridge.getQueueDepth(),
      }),
      'POST /render/restart': async () => {
        await renderBridge.restartBrowser();
        return { success: true, message: 'Browser restart requested' };
      },
    });

    // Register automation data source routes
    // These provide dropdown options for the automation builder (automation.json field sources)
    ctx.registerRoutes({
      'GET /automation/screens': async (routeCtx) => {
        const screens = await screenManager.getAll();
        return {
          items: screens.map((screen) => ({
            value: screen.serial,
            label: screen.name || screen.serial,
          })),
        };
      },
      'GET /automation/casts': async (routeCtx) => {
        const casts = await routeCtx.data.slidecast_casts.findAll({ orderBy: { name: 'ASC' } });
        return {
          items: casts.map((cast) => ({
            value: String(cast.id),
            label: cast.name,
          })),
        };
      },
    });

    // Run migrations
    await runMigrations(api, ctx);

    // Seed widgets and casts
    await runSeeds(api, ctx);

    // Load built-in templates
    await loadBuiltInTemplates(ctx);

    // Real-time Roku claim subscription (#1669) — auto-create a screen the
    // moment a Roku is claimed at runtime, not only at the startup check below.
    if (api.globalEventBus) {
      const rokuClaimBus = api.globalEventBus;
      const rokuClaimHandler = subscribeToRokuClaims(ctx, rokuClaimBus);
      ctx.state._rokuClaimEventBus = rokuClaimBus;
      ctx.state._rokuClaimHandler = rokuClaimHandler;
      if (rokuClaimHandler) {
        ctx.onDestroy(async () => {
          try {
            if (typeof rokuClaimBus.off === 'function') rokuClaimBus.off('discovery:claim-device', rokuClaimHandler);
            else if (typeof rokuClaimBus.removeListener === 'function') rokuClaimBus.removeListener('discovery:claim-device', rokuClaimHandler);
          } catch { /* noop */ }
          ctx.state._rokuClaimHandler = null;
          ctx.state._rokuClaimEventBus = null;
        });
      }
    }

    // Check for existing Roku devices + auto-cache missing casts (both
    // delayed, both use ctx.setTimeout — NOT raw setTimeout — so the timers
    // are auto-tracked and cleared by ContextFactory.shutdownPrimitives() on
    // unload/hot-reload. A raw setTimeout here previously fired against a
    // torn-down ctx.data (closed DB) after unload — SQLITE_MISUSE noise, and
    // the same class of risk as the Roku Task-thread leak: orphaned work
    // surviving teardown.
    scheduleStartupJobs(ctx, renderBridge);

    // Verify critical subsystems at startup — log errors prominently but don't crash
    try { await widgetImageRenderer.loadDependencies(); } catch (e) {
      ctx.log(`WARNING: Widget rendering unavailable: ${e.message}`, 'error');
      ctx.reportDegraded(`Widget rendering unavailable: ${e.message}`);
    }

    // Playwright is now managed by the render worker child process (RenderBridge).
    // No need to pre-load it on the main thread.

    const ffmpegAvailable = await videoProcessor.checkFfmpeg();
    if (!ffmpegAvailable) {
      ctx.log('WARNING: ffmpeg not available — video processing disabled', 'error');
      ctx.reportDegraded('ffmpeg not available — video processing disabled');
    }

    ctx.log('Slidecast initialized');
  },
};

/**
 * Chainable query builder for slidecast modules.
 *
 * The DataLayer's built-in QueryBuilder only supports where/orderBy/limit/offset/get.
 * Slidecast modules (migrations, WidgetAPI, TableManager) also need:
 *   select, selectRaw, join, leftJoin, first, update, delete, insert, raw
 *
 * This builder provides the full interface. It mirrors the platform's
 * extensions/QueryBuilder.js API without importing it directly.
 */
class SlidecastQueryBuilder {
  constructor(tableName, queryFn) {
    this._table = tableName;
    this._queryFn = queryFn;
    this._select = ['*'];
    this._where = [];
    this._whereParams = [];
    this._joins = [];
    this._orderBy = [];
    this._limit = null;
    this._offset = null;
  }

  select(...fields) { this._select = fields; return this; }

  selectRaw(expression) {
    if (this._select[0] === '*') { this._select = [expression]; } else { this._select.push(expression); }
    return this;
  }

  where(field, operator, value) {
    if (value === undefined) { value = operator; operator = '='; }
    if (value === null) {
      this._where.push(`${field} IS NULL`);
    } else {
      this._where.push(`${field} ${operator} ?`);
      this._whereParams.push(value);
    }
    return this;
  }

  join(table, condition) { this._joins.push(`JOIN ${table} ON ${condition}`); return this; }

  leftJoin(table, condition) { this._joins.push(`LEFT JOIN ${table} ON ${condition}`); return this; }

  orderBy(field, direction = 'ASC') { this._orderBy.push(`${field} ${direction.toUpperCase()}`); return this; }

  limit(count) { this._limit = count; return this; }

  offset(count) { this._offset = count; return this; }

  _toSQL() {
    let sql = `SELECT ${this._select.join(', ')} FROM ${this._table}`;
    if (this._joins.length > 0) sql += ` ${this._joins.join(' ')}`;
    if (this._where.length > 0) sql += ` WHERE ${this._where.join(' AND ')}`;
    if (this._orderBy.length > 0) sql += ` ORDER BY ${this._orderBy.join(', ')}`;
    if (this._limit !== null) sql += ' LIMIT ?';
    if (this._offset !== null) sql += ' OFFSET ?';
    return sql;
  }

  _buildParams() {
    const params = [...this._whereParams];
    if (this._limit !== null) params.push(this._limit);
    if (this._offset !== null) params.push(this._offset);
    return params;
  }

  async get() {
    const result = await this._queryFn(this._toSQL(), this._buildParams());
    return result.rows || [];
  }

  async first() {
    this._limit = 1;
    const results = await this.get();
    return results[0] || null;
  }

  async insert(data) {
    const fields = Object.keys(data);
    const values = Object.values(data).map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
    const sql = `INSERT INTO ${this._table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
    const result = await this._queryFn(sql, values);
    return result.insertId || result.lastInsertRowid || 0;
  }

  async update(data) {
    const fields = Object.keys(data);
    const values = Object.values(data).map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
    let sql = `UPDATE ${this._table} SET ${fields.map((f) => `${f} = ?`).join(', ')}`;
    if (this._where.length > 0) sql += ` WHERE ${this._where.join(' AND ')}`;
    const params = [...values, ...this._whereParams];
    const result = await this._queryFn(sql, params);
    return result.rowCount || 0;
  }

  async delete() {
    let sql = `DELETE FROM ${this._table}`;
    if (this._where.length > 0) sql += ` WHERE ${this._where.join(' AND ')}`;
    const result = await this._queryFn(sql, this._whereParams);
    return result.rowCount || 0;
  }

  async raw(sql, params = []) {
    const result = await this._queryFn(sql, params);
    return result.rows || [];
  }
}

/**
 * Create the slidecast API adapter.
 *
 * This is NOT a v1 shim -- it is an explicit, minimal interface that exposes
 * only what the manager classes and route modules actually need from ctx.
 */
function createSlidecastApi(ctx) {
  const platform = ctx.platform || {};
  const queryFn = resolveQueryFn(ctx);

  // Cache for model wrappers
  const modelCache = {};

  /**
   * Wrap a v2 TableProxy to provide the model interface managers expect.
   *
   * Managers use: findAll, findOne, findById, findWhere, create, update(id, data),
   * delete(id), count, createTable.
   *
   * v2 TableProxy provides: findAll({where}), findOne(where), create(data),
   * update(where, data), delete(where), count.
   */
  function wrapModel(name) {
    if (modelCache[name]) return modelCache[name];

    const tableProxy = ctx.data[name];
    if (!tableProxy) {
      // Stub for tables not in the data section (e.g., widget-created dynamic tables)
      modelCache[name] = {
        findAll: async () => [],
        findById: async () => null,
        findWhere: async () => [],
        findOne: async () => null,
        create: async () => ({}),
        update: async () => 0,
        delete: async () => 0,
        count: async () => 0,
        createTable: async () => {},
      };
      return modelCache[name];
    }

    const wrapper = {
      findAll: (options) => tableProxy.findAll(options),
      findOne: (where) => tableProxy.findOne(where),
      create: (data) => tableProxy.create(data),
      count: (where) => tableProxy.count(where),
      findById: (id) => tableProxy.findOne({ id }),
      findWhere: (conditions) => tableProxy.findAll({ where: conditions }),
      update: (id, data) => tableProxy.update({ id }, data),
      delete: (id) => tableProxy.delete({ id }),
      createTable: async () => {}, // no-op, v2 manages tables via data section
    };

    modelCache[name] = wrapper;
    return wrapper;
  }

  return {
    // Logging
    log: (msg, level) => ctx.log(msg, level || 'info'),

    // Database — model pattern for manager classes
    model: (name) => wrapModel(name),
    registerModel: () => {}, // no-op, tables declared in data section

    // Database — chainable query builder for complex queries
    queryBuilder: (table) => new SlidecastQueryBuilder(table, queryFn),

    // Route registration — no-op, routes are declarative in v2
    registerRoute: () => {},
    registerUploadRoute: () => {},

    // Broadcasting — WebSocket events to connected frontends
    broadcast: (eventOrData, data) => {
      if (typeof eventOrData === 'string') {
        ctx.broadcast(eventOrData, data);
      } else {
        ctx.broadcast(eventOrData.type || 'message', eventOrData);
      }
    },

    // Platform event bus — managers subscribe to cross-extension events
    globalEventBus: platform.globalEventBus || null,

    // Automation triggers
    fireTrigger: (name, data) => ctx.emit(name, data),

    // Action registration — no-op. Automation actions are declared in the
    // `automations.actions` block of the default export and consumed
    // declaratively by the SDK ExtensionLoader (Step 10.5), which registers
    // each into the platform ActionRegistry so the automation engine can
    // dispatch `slidecast.<action>` (e.g. slidecast.show_alert). Nothing to do
    // imperatively here.
    registerAction: () => {},

    // Device tagging — protocol.js tags Roku devices with slidecast screen info
    tagDevice: (deviceId, tags) => {
      if (ctx.services?.['device-discovery']?.tagDevice) {
        return ctx.services['device-discovery'].tagDevice({ deviceId, tags });
      }
    },

    // Config store
    config: ctx.config,

    // Platform scheduler (#936) — managers schedule recurring jobs through ctx
    // so timers are cancelled cleanly on hot-reload via shutdownPrimitives().
    scheduler: ctx.scheduler,
  };
}

// All route modules are now registered natively via ctx.registerRoutes() in init().
// The v1 route handler adapter infrastructure (initRouteHandlers, loadRouteModules,
// capturing APIs, and proxy objects) has been fully removed.

// ============================================
// Schedule daily render cleanup (#1032, Wave 4 of #1024)
// ============================================
// Computes the delay until the next 3am, schedules a one-shot bootstrap job
// via ctx.scheduler. When that fires, runs the cleanup and schedules the
// recurring 24h job — also via ctx.scheduler — so both timers are tracked
// and cancellable on hot-reload via shutdownPrimitives() / scheduler.shutdown().
//
// Returns an object with cancel() so the legacy state.cleanupTimer slot can
// still be drained by the existing shutdown handler. Falls back to raw timers
// only when the host did not wire ctx.scheduler (legacy test fixtures).
function scheduleRenderCleanup(slideImageRenderer, cleanupAgeDays, ctx) {
  const now = new Date();
  const next3am = new Date(now);
  next3am.setHours(3, 0, 0, 0);
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1);

  const msUntil3am = next3am - now;
  ctx.log(`Render cleanup scheduled in ${Math.round(msUntil3am / 60000)} minutes`);

  const runCleanup = async () => {
    try {
      const result = await slideImageRenderer.cleanupOldRenders(cleanupAgeDays);
      ctx.log(`Daily render cleanup: ${result.cleaned} old renders removed`);
    } catch (err) {
      ctx.log(`Daily render cleanup failed: ${err.message}`, 'error');
    }
  };

  const hasScheduler = ctx && ctx.scheduler && typeof ctx.scheduler.schedule === 'function';

  if (hasScheduler) {
    const handle = { bootstrapJobId: null, dailyJobId: null };
    handle.bootstrapJobId = ctx.scheduler.schedule(async () => {
      handle.bootstrapJobId = null; // one-shot has self-removed at this point
      await runCleanup();
      handle.dailyJobId = ctx.scheduler.schedule(runCleanup, {
        intervalMs: 24 * 60 * 60 * 1000,
        name: 'render-cleanup-daily',
      });
    }, { delayMs: msUntil3am, name: 'render-cleanup-bootstrap' });

    return {
      cancel: () => {
        if (handle.bootstrapJobId !== null) {
          try { ctx.scheduler.cancel(handle.bootstrapJobId); } catch { /* noop */ }
          handle.bootstrapJobId = null;
        }
        if (handle.dailyJobId !== null) {
          try { ctx.scheduler.cancel(handle.dailyJobId); } catch { /* noop */ }
          handle.dailyJobId = null;
        }
      },
      _handle: handle, // exposed for tests
    };
  }

  // Legacy fallback (no scheduler wired) — preserves old behavior for tests.
  let intervalHandle = null;
  const timeoutHandle = setTimeout(async () => {
    await runCleanup();
    intervalHandle = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, msUntil3am);
  return {
    cancel: () => {
      clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}

// ============================================
// Run migrations
// ============================================
async function runMigrations(api, ctx) {
  // Force update system widgets
  try {
    const { migrate: forceUpdate } = await import('./migrations/force-update-widgets.js');
    const forceResult = await forceUpdate(api);
    if (forceResult.deleted > 0) {
      ctx.log(`Force update: deleted ${forceResult.deleted} widgets for recreation`);
    }
  } catch { /* ignore if already run */ }

  // Widget tabs migration
  try {
    const { migrate } = await import('./migrations/add-widget-tabs.js');
    const result = await migrate(api);
    if (result.updatedCount > 0) {
      ctx.log(`Widget tabs migration: ${result.updatedCount} widgets updated`);
    }
  } catch (error) {
    ctx.log(`Widget tabs migration error: ${error.message}`, 'error');
  }

  // NOTE: the supports_animation backfill moved to the versioned
  // `data.migrations` list (spec §5.1) — it now runs once via the MigrationRunner
  // high-water mark instead of on every init(). The column itself is declared in
  // slidecast_widgets.fields (created by TableMigrator).

  // App last heartbeat migration
  try {
    const { migrate: migrateHeartbeat } = await import('./migrations/add-app-last-heartbeat.js');
    await migrateHeartbeat(api);
  } catch (error) {
    ctx.log(`app_last_heartbeat migration error: ${error.message}`, 'error');
  }
}

// ============================================
// Run seeds
// ============================================
async function runSeeds(api, ctx) {
  // Seed widgets
  try {
    // Cache-bust the seeds module so hot-reloads pick up changes to seed files.
    const seedsUrl = `${pathToFileURL(path.join(__dirname, 'seeds/index.js')).href}?t=${Date.now()}`;
    const { seedWidgets } = await import(seedsUrl);
    // Pass widgetRegistry so a genuine seed-content change propagates via
    // registry.update (clearCache/invalidate/re-render), never a blind
    // overwrite of runtime/user edits (BUG-2 seed-idempotency fix).
    const seedResult = await seedWidgets(api, { widgetRegistry: ctx.state.widgetRegistry });
    if (seedResult.created > 0 || seedResult.updated > 0) {
      ctx.log(`Widget sync: ${seedResult.created} created, ${seedResult.updated || 0} updated`);
    }
  } catch (error) {
    ctx.log(`Widget seeding error: ${error.message}`, 'error');
  }

  // Seed demo casts
  try {
    const castsUrl = `${pathToFileURL(path.join(__dirname, 'seeds/casts.js')).href}?t=${Date.now()}`;
    const { seedCasts } = await import(castsUrl);
    const castSeedResult = await seedCasts(api, {
      castManager: ctx.state.castManager,
      mediaLibrary: ctx.state.mediaLibrary,
      widgetRegistry: ctx.state.widgetRegistry,
      // #1199: so seed-imports wake up WidgetRefreshService via cast:definition_changed
      eventBus: api.globalEventBus || null,
    });
    ctx.log(`Cast seeding: ${castSeedResult.created} created, ${castSeedResult.skipped} skipped, ${castSeedResult.errors} errors`);
  } catch (error) {
    ctx.log(`Cast seeding error: ${error.message}`, 'error');
  }
}

// ============================================
// Check for existing Roku devices on startup
// ============================================
async function checkExistingRokuDevices(ctx) {
  ctx.log('Checking for existing Roku devices to auto-create screens...');
  try {
    const rokuDevices = await ctx.data.query('device_registry')
      .where('device_type', '=', 'roku')
      .get();

    if (rokuDevices && rokuDevices.length > 0) {
      ctx.log(`Found ${rokuDevices.length} existing Roku device(s)`);
      const { screenManager } = ctx.state;

      for (const device of rokuDevices) {
        const existingScreens = await screenManager.getAll();
        const hasScreen = existingScreens.some((s) => s.metadata?.roku_device_id === device.id
          || s.serial === device.serial_number);

        if (!hasScreen) {
          ctx.log(`Creating screen for existing Roku: ${device.friendly_name || device.id}`);
          await handleRokuDeviceDiscovered({
            device_id: device.id,
            name: device.friendly_name || device.hostname || 'Roku Device',
            ip_address: device.ip_address,
            serial_number: device.serial_number || device.id?.replace('roku:', ''),
            model: device.model,
          }, ctx);
        }
      }
    }
  } catch (error) {
    ctx.log(`Error checking existing Roku devices: ${error.message}`, 'warn');
  }
}

// ============================================
// Schedule delayed startup jobs (teardown-safe)
// ============================================
/**
 * Schedules the two delayed background jobs slidecast runs shortly after
 * boot: an existing-Roku-device sweep (catches Rokus claimed while slidecast
 * was restarting) and an auto-cache pass for casts missing rendered images.
 *
 * Both use `ctx.setTimeout` — NOT the raw global `setTimeout` — so
 * ContextFactory auto-tracks the handles and clears them in
 * `shutdownPrimitives()` on unload/hot-reload. Previously these used raw
 * `setTimeout`, so an unload/reload inside the 5s/10s window left the timer
 * armed; it later fired against a torn-down `ctx.data` (closed DB), producing
 * SQLITE_MISUSE noise and, worse, running work against already-unloaded
 * state — the same class of bug as the Roku Task-thread leak (orphaned work
 * surviving teardown).
 *
 * `checkRoku`/`autoCache` are injectable (default to the real
 * checkExistingRokuDevices/autoCacheMissingCasts) purely so tests can assert
 * teardown behavior without booting the full extension.
 *
 * @param {object} ctx - Extension context (must provide ctx.setTimeout/ctx.log)
 * @param {{ isReady: () => boolean }} renderBridge - Render worker bridge
 * @param {{ checkRoku?: Function, autoCache?: Function }} [deps]
 */
function scheduleStartupJobs(ctx, renderBridge, deps = {}) {
  const checkRoku = deps.checkRoku || checkExistingRokuDevices;
  const autoCache = deps.autoCache || autoCacheMissingCasts;

  // Check for existing Roku devices (delayed) — kept so Rokus claimed while
  // Slidecast was restarting still get a screen (register() dedupes by serial).
  ctx.setTimeout(async () => {
    try {
      await checkRoku(ctx);
    } catch (error) {
      ctx.log(`Error checking existing Roku devices: ${error.message}`, 'warn');
    }
  }, 5000);

  // Auto-cache missing cast renders (delayed)
  ctx.setTimeout(async () => {
    try {
      if (!renderBridge.isReady()) {
        ctx.log('Skipping auto-cache — render worker not ready', 'warn');
        return;
      }
      await autoCache(ctx);
    } catch (err) {
      ctx.log(`Auto-cache error: ${err.message}`, 'error');
    }
  }, 10000);
}

// Named exports for testing (#1032 regression test imports scheduleRenderCleanup).
// subscribeToRokuClaims is exported for the #1669 event-driven auto-screen test.
// scheduleStartupJobs is exported so teardown behavior (ctx.setTimeout tracking) can
// be unit-tested without booting the full extension.
export { scheduleRenderCleanup, subscribeToRokuClaims, scheduleStartupJobs };
// resolveQueryFn is in its own file (./resolveQueryFn.js) — import directly for testing.
