import crypto from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import JSZip from 'jszip';
import {
  formatCast, resolveCast, createDefaultDefinition, generateUuid,
} from '../utils/castUtils.js';
import { findSecretFields, stripSecretsForSave } from '../widgets/secretConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Lazily reach the kernel GrantStore (secrets one-stop-shop Task 6) to auto-record
 * a widget's read-grant for a shared secret picked in the Studio. An extension
 * cannot static-import core `backend/src/...`, so — exactly like WidgetSecretStore
 * reaches the kernel secretsAccessor — we import GrantStore by a cwd-absolute path
 * (process.cwd() is always the backend dir) and instantiate it against the same
 * core `extension_grants` table (default core queryFn). Memoized per module load.
 */
let _grantStorePromise = null;
function getGrantStore() {
  if (!_grantStorePromise) {
    _grantStorePromise = (async () => {
      const abs = join(process.cwd(), 'src', 'sdk', 'isolation', 'GrantStore.js');
      const mod = await import(pathToFileURL(abs).href);
      const GrantStoreClass = mod.GrantStore || mod.default;
      return new GrantStoreClass();
    })();
  }
  return _grantStorePromise;
}

/**
 * Load seed cast names from the seed-casts directory at module load time.
 * Uses the same manifest.cast.name lookup that the seed importer uses,
 * so the check is reliable even if filenames differ from cast names.
 * Returns a Set of lowercase cast names for O(1) lookup.
 */
async function loadSeedCastNames() {
  const seedDir = resolve(__dirname, '../seed-casts');
  const names = new Set();
  let files;
  try {
    files = readdirSync(seedDir).filter((f) => f.endsWith('.cast'));
  } catch {
    return names; // seed-casts dir missing — no seeds to protect
  }
  for (const file of files) {
    try {
      const buf = readFileSync(resolve(seedDir, file));
      const zip = await JSZip.loadAsync(buf);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) continue;
      const manifest = JSON.parse(await manifestFile.async('string'));
      const name = manifest.cast?.name || manifest.name;
      if (name) names.add(name.toLowerCase());
    } catch {
      // skip unreadable files
    }
  }
  return names;
}

// Eagerly load seed names once at module startup (Promise, resolved before first request)
const seedCastNamesPromise = loadSeedCastNames();

/**
 * Casts Routes - CRUD operations for slidecast presentations
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */
export default function createCastRoutes(deps) {
  const {
    previewManager, widgetRegistry, widgetRuntime, slideImageRenderer, renderTracker, logger, eventBus, widgetSecrets,
  } = deps;

  /**
   * Cast-save secret intercept (secrets one-stop-shop Task 6). Walks the cast
   * definition and, for every widget element, moves any secret-typed config
   * value OUT of the definition and INTO the encrypted system store, leaving only
   * `{$secret}` references behind — so the persisted definition NEVER contains a
   * plaintext secret. Two modes per secret field:
   *   - a raw entered string → stored under `widget:<wid>:<elementId>:<field>`,
   *     replaced with `{$secret:'widget:<wid>:<elementId>:<field>'}`;
   *   - a Studio picker marker `{$secretSharedPick:'<name>'}` → converted to
   *     `{$secret:'shared:<name>'}` (no store write — the value already lives in
   *     the shared keyring) AND the widget's read-grant for `<name>` is recorded.
   * Mutates + returns `definition` (same object). Throws if a store write fails —
   * failing the save is correct: better than persisting plaintext.
   */
  async function stripSecretsFromDefinition(definition) {
    if (!definition || typeof definition !== 'object' || !widgetRegistry) return definition;

    let widgetsByUuid = null;
    const ensureWidgets = async () => {
      if (widgetsByUuid) return widgetsByUuid;
      widgetsByUuid = new Map();
      try {
        for (const w of await widgetRegistry.getAll()) widgetsByUuid.set(w.uuid, w);
      } catch (err) {
        logger.warn(`Secret intercept: failed to load widget registry: ${err.message}`);
      }
      return widgetsByUuid;
    };

    const sharedGrantsByWid = new Map(); // wid -> Set(shared secret names)

    const walkElements = async (elements) => {
      for (const element of elements || []) {
        if (element.type !== 'widget' || !element.widgetUuid) continue;
        const map = await ensureWidgets();
        const widget = map.get(element.widgetUuid);
        const schema = widget && widget.configSchema;
        const secretFields = findSecretFields(schema);
        if (secretFields.length === 0) continue;

        const wid = element.widgetUuid;
        const elementId = element.id;
        const config = { ...(element.widgetConfig || {}) };

        // 1) Convert Studio picker markers → shared refs + collect read-grants.
        for (const field of secretFields) {
          const val = config[field];
          if (val && typeof val === 'object' && typeof val.$secretSharedPick === 'string') {
            const name = val.$secretSharedPick;
            config[field] = { $secret: `shared:${name}` };
            if (!sharedGrantsByWid.has(wid)) sharedGrantsByWid.set(wid, new Set());
            sharedGrantsByWid.get(wid).add(name);
          }
        }

        // 2) Strip entered plaintext → store writes + widget-scoped refs.
        const { config: stripped, writes } = stripSecretsForSave({
          schema, config, wid, elementId,
        });
        for (const { key, value } of writes) {
          if (!widgetSecrets) {
            throw new Error('widget secret store unavailable — cannot store secret config');
          }
          await widgetSecrets.setRaw(wid, key, value);
        }

        // 2b) Register/deregister a "need" per secret field (secrets one-stop-shop
        // Task 7) — the Variables & Secrets page surfaces an EMPTY widget secret
        // field as "needed" until a value exists. Best-effort: a failure here must
        // NEVER break the cast save.
        if (widgetSecrets) {
          for (const field of secretFields) {
            const needKey = `widget:${wid}:${elementId}:${field}`;
            try {
              const wasWritten = writes.some((w) => w.key === needKey);
              const origVal = element.widgetConfig ? element.widgetConfig[field] : undefined;
              const isSharedPick = !!origVal && typeof origVal === 'object'
                && typeof origVal.$secretSharedPick === 'string';
              const isEmpty = !wasWritten && !isSharedPick
                && (origVal === null || origVal === undefined || origVal === '');
              if (isEmpty) {
                await widgetSecrets.registerNeed(wid, needKey, {
                  label: (schema[field] && schema[field].label) || field,
                  description: schema[field] && schema[field].description,
                });
              } else {
                // Filled (freshly entered, a shared pick, or an unchanged
                // {$secret} ref from a prior save) — clear any stale need.
                await widgetSecrets.deregisterNeed(wid, needKey);
              }
            } catch (err) {
              logger.warn(`Secret intercept: failed to update need for widget ${wid} field ${field}: ${err.message}`);
            }
          }
        }

        element.widgetConfig = stripped;
      }
    };

    for (const group of definition.groups || []) {
      for (const slide of group.slides || []) await walkElements(slide.elements);
    }
    // Tolerate a flat top-level slides[] shape too.
    for (const slide of definition.slides || []) await walkElements(slide.elements);

    // 3) Auto-record shared read-grants (merge — never clobber existing grants).
    if (sharedGrantsByWid.size > 0) {
      try {
        const grantStore = await getGrantStore();
        for (const [wid, names] of sharedGrantsByWid) {
          const grantName = `widget:${wid}`;
          const existing = await grantStore.getGrantedGrants(grantName);
          const merged = {
            ...existing,
            secrets: Array.from(new Set([...(existing.secrets || []), ...names])),
          };
          await grantStore.setGrantedGrants(grantName, merged, 'studio-auto');
        }
      } catch (err) {
        logger.warn(`Secret intercept: failed to record shared read-grant: ${err.message}`);
      }
    }

    return definition;
  }

  /**
   * Generate a hash for a slide definition (for change detection)
   * Includes all properties that affect rendering
   */
  function generateSlideHash(slide, variables = {}) {
    // Create a normalized object with all rendering-relevant properties
    const hashData = {
      background: slide.background,
      elements: (slide.elements || []).map((el) => ({
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        opacity: el.opacity,
        style: el.style,
        // Type-specific properties
        ...(el.type === 'text' && {
          text: el.text, font: el.font, fontSize: el.fontSize, fontWeight: el.fontWeight, color: el.color, textAlign: el.textAlign,
        }),
        ...(el.type === 'image' && { src: el.src, fit: el.fit, borderRadius: el.borderRadius }),
        ...(el.type === 'video' && { src: el.src, fit: el.fit }),
        ...(el.type === 'shape' && {
          shape: el.shape, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, cornerRadius: el.cornerRadius,
        }),
        ...(el.type === 'widget' && { widgetUuid: el.widgetUuid, widgetConfig: el.widgetConfig, widgetStyles: el.widgetStyles }),
        ...(el.type === 'qr' && { qrData: el.qrData, qrColor: el.qrColor, qrBackground: el.qrBackground }),
      })),
      // Include variables that might affect widget output
      variables,
    };

    const json = JSON.stringify(hashData);
    return crypto.createHash('md5').update(json).digest('hex');
  }

  /**
   * Queue background pre-rendering for CHANGED slides only
   * Compares slide hashes with cached metadata to skip unchanged slides
   */
  async function queueCastPreRender(cast, forceAll = false) {
    if (!slideImageRenderer || !cast?.definition) {
      return { queued: 0, skipped: 0 };
    }

    // Flatten slides from groups
    const slides = [];
    for (const group of (cast.definition.groups || [])) {
      for (const slide of (group.slides || [])) {
        slides.push({ ...slide, groupId: group.id, groupName: group.name });
      }
    }

    if (slides.length === 0) {
      return { queued: 0, skipped: 0 };
    }

    const castId = cast.uuid;
    const variables = cast.definition.variables || {};
    let queued = 0;
    let skipped = 0;

    // Check each slide for changes
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideIndex = i;

      // Generate hash for current slide definition
      const currentHash = generateSlideHash(slide, variables);

      // Check cached metadata for previous hash
      let needsRender = forceAll;
      if (!forceAll) {
        try {
          const metadata = await slideImageRenderer.getSlideMetadata(castId, slideIndex);
          if (!metadata || !metadata.slideHash) {
            // No cached version exists
            needsRender = true;
          } else if (metadata.slideHash !== currentHash) {
            // Slide has changed
            needsRender = true;
            logger.debug(`Slide ${slideIndex} changed: hash ${metadata.slideHash?.slice(0, 8)} -> ${currentHash.slice(0, 8)}`);
          }
          // else: hashes match, skip this slide
        } catch (err) {
          // Error reading metadata, assume needs render
          needsRender = true;
        }
      }

      if (!needsRender) {
        skipped++;
        continue;
      }

      queued++;

      // Store hash with render job so it can be saved in metadata
      const doRender = () => {
        if (renderTracker) {
          renderTracker.startRender(castId, slideIndex);
        }
        (async () => {
          try {
            await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { slideHash: currentHash });
            if (renderTracker) {
              renderTracker.completeRender(castId, slideIndex);
            }
            logger.debug(`Pre-render complete: cast=${castId} slide=${slideIndex}`);
          } catch (err) {
            logger.warn(`Pre-render failed: ${castId}/${slideIndex} - ${err.message}`);
            if (renderTracker) {
              renderTracker.failRender(castId, slideIndex, err);
            }
          }
        })();
      };

      if (renderTracker) {
        // Queue at low priority (active screens jump ahead)
        if (renderTracker.canStartRender()) {
          doRender();
        } else {
          renderTracker.queueRender(castId, slideIndex, doRender, false); // Not priority
        }
      } else {
        // Fallback: use legacy blocking render (shouldn't happen in production)
        slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { slideHash: currentHash }).catch((err) => {
          logger.warn(`Pre-render failed: ${castId}/${slideIndex} - ${err.message}`);
        });
      }
    }

    if (queued > 0 || skipped > 0) {
      logger.info(`Pre-render: cast=${cast.uuid} queued=${queued} skipped=${skipped} (unchanged)`);
    }

    return { queued, skipped };
  }

  /**
   * Refresh all widget primitives in a cast definition
   * This ensures widgets display correctly when a cast is loaded
   */
  async function refreshWidgetPrimitives(definition) {
    if (!definition?.groups || !widgetRegistry || !widgetRuntime) {
      return definition;
    }

    let refreshed = 0;
    let failed = 0;

    // Fetch all widgets once outside the loop (was previously called per-widget)
    let allWidgets;
    try {
      allWidgets = await widgetRegistry.getAll();
    } catch (err) {
      logger.warn(`Failed to fetch widget registry: ${err.message}`);
      return definition;
    }

    // Overall timeout to prevent hanging — 15 seconds max for all widgets
    const REFRESH_TIMEOUT = 15000;

    const refreshPromise = (async () => {
      for (const group of definition.groups) {
        for (const slide of group.slides || []) {
          for (const element of slide.elements || []) {
            if (element.type === 'widget' && element.widgetUuid) {
              try {
                let widget = allWidgets.find((w) => w.uuid === element.widgetUuid);

                // Fallback to name matching if UUID not found
                if (!widget) {
                  const widgetName = element.name || element.widgetName;
                  widget = allWidgets.find((w) => w.name === widgetName
                    || w.name.toLowerCase().replace(/\s+/g, '-') === widgetName?.toLowerCase().replace(/\s+/g, '-'));
                }

                if (widget) {
                  const config = element.widgetConfig || element.config || {};
                  const styles = element.widgetStyles || element.styles || element.style || {};

                  logger.debug(`Refreshing widget: ${element.name} (uuid: ${element.widgetUuid}) with config: ${JSON.stringify(config).slice(0, 100)}`);

                  const result = await widgetRuntime.execute(
                    widget,
                    config,
                    styles,
                    element.id,
                  );

                  if (result.success && result.primitives) {
                    element._widgetPrimitives = result.primitives;
                    refreshed++;
                    logger.debug(`Widget ${element.name} refreshed: ${result.primitives.length} primitives`);
                  } else if (!result.success) {
                    logger.warn(`Widget ${element.name} execute failed: ${result.error}`);
                    failed++;
                  }
                } else {
                  logger.warn(`Widget not found in registry: ${element.name} (uuid: ${element.widgetUuid})`);
                  failed++;
                }
              } catch (err) {
                logger.warn(`Failed to refresh widget ${element.name}: ${err.message}`);
                failed++;
              }
            }
          }
        }
      }
    })();

    try {
      await Promise.race([
        refreshPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), REFRESH_TIMEOUT)),
      ]);
    } catch (err) {
      if (err.message === 'timeout') {
        logger.warn(`Widget primitives refresh timed out after ${REFRESH_TIMEOUT}ms (${refreshed} refreshed, ${failed} failed before timeout)`);
      } else {
        logger.warn(`Widget primitives refresh error: ${err.message}`);
      }
    }

    logger.info(`Widget primitives refresh: ${refreshed} refreshed, ${failed} failed`);

    return definition;
  }

  // ==================== ROUTE DEFINITIONS ====================

  return {
    // ==================== CASTS ====================

    // List all casts
    'GET /casts': async (ctx) => {
      const rows = await ctx.data.slidecast_casts.findAll();
      const casts = rows.map(formatCast);
      return { success: true, casts };
    },

    // Get single cast (supports both database ID and UUID)
    'GET /casts/:id': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      // Refresh widget primitives on load (unless skipRefresh=true)
      if (ctx.query?.skipRefresh !== 'true') {
        cast.definition = await refreshWidgetPrimitives(cast.definition);
      }

      return { success: true, cast };
    },

    // Create cast
    'POST /casts': async (ctx) => {
      const { body } = ctx;
      const now = new Date().toISOString();
      // Strip secret-typed widget config into the encrypted store BEFORE persist
      // (Task 6) — the stored definition holds only {$secret} references.
      const definition = await stripSecretsFromDefinition(body.definition || createDefaultDefinition());
      const row = await ctx.data.slidecast_casts.create({
        uuid: generateUuid(),
        name: body.name || 'Untitled Cast',
        description: body.description || '',
        definition: JSON.stringify(definition),
        thumbnail: body.thumbnail || null,
        created_at: now,
        updated_at: now,
      });
      const cast = formatCast(row);

      // Queue pre-render for Roku (non-blocking, uses render queue)
      queueCastPreRender(cast);

      return { success: true, cast };
    },

    // Update cast (supports both database ID and UUID)
    'PUT /casts/:id': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const { body } = ctx;
      const updateData = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.definition !== undefined) {
        // Strip secret-typed widget config into the encrypted store BEFORE
        // persist (Task 6) — stored definition holds only {$secret} references.
        const definition = await stripSecretsFromDefinition(body.definition);
        updateData.definition = JSON.stringify(definition);
      }
      if (body.thumbnail !== undefined) updateData.thumbnail = body.thumbnail;
      updateData.updated_at = new Date().toISOString();

      await ctx.data.slidecast_casts.update({ id: cast.id }, updateData);

      // Re-fetch the updated cast
      const updated = await resolveCast(ctx, ctx.params.id);

      // Notify screens showing this cast
      previewManager.notifyCastUpdated(updated.uuid);

      // Emit cast:definition_changed so WidgetRefreshService (#1134) can
      // reconcile per-instance micro-jobs when widgets are added or removed
      // from the cast.
      if (eventBus && body.definition !== undefined) {
        try {
          eventBus.emit('cast:definition_changed', {
            castId: updated.uuid,
            castDbId: updated.id,
          });
        } catch { /* event bus failures must not break updates */ }
      }

      // Queue pre-render for Roku (non-blocking, uses render queue)
      queueCastPreRender(updated);

      return { success: true, cast: updated };
    },

    // Delete all casts (for cleanup/reset)
    'DELETE /casts': async (ctx) => {
      const rows = await ctx.data.slidecast_casts.findAll();
      let deleted = 0;
      for (const row of rows) {
        await ctx.data.slidecast_casts.delete({ id: row.id });
        deleted++;
      }
      return { success: true, deleted, message: `Deleted ${deleted} cast(s)` };
    },

    // Delete cast (supports both database ID and UUID)
    'DELETE /casts/:id': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      // Protect seed casts — they cannot be deleted, only cloned
      const seedNames = await seedCastNamesPromise;
      if (seedNames.has(cast.name.toLowerCase())) {
        return {
          success: false,
          error: 'Seed casts cannot be deleted. Clone the cast first.',
          status: 403,
        };
      }

      await ctx.data.slidecast_casts.delete({ id: cast.id });

      // Clean up rendered PNGs
      if (slideImageRenderer && cast.uuid) {
        slideImageRenderer.deleteCastRenders(cast.uuid).catch((err) => {
          logger.warn(`Failed to delete cast renders: ${err.message}`);
        });
      }

      return { success: true };
    },

    // Duplicate cast (supports both database ID and UUID)
    'POST /casts/:id/duplicate': async (ctx) => {
      const existing = await resolveCast(ctx, ctx.params.id);
      if (!existing) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const now = new Date().toISOString();
      const row = await ctx.data.slidecast_casts.create({
        uuid: generateUuid(),
        name: `${existing.name} (copy)`,
        description: existing.description || '',
        definition: JSON.stringify(existing.definition),
        thumbnail: existing.thumbnail || null,
        created_at: now,
        updated_at: now,
      });
      const cast = formatCast(row);
      return { success: true, cast };
    },

    // ==================== CACHE MANAGEMENT ====================

    // Get cache status for a cast (shows which slides are cached/stale/not cached)
    'GET /casts/:id/cache-status': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      if (!slideImageRenderer) {
        return { success: false, error: 'Renderer not available', status: 500 };
      }

      // Count total slides
      let totalSlides = 0;
      for (const group of (cast.definition?.groups || [])) {
        totalSlides += (group.slides || []).length;
      }

      // Get per-cast render status from tracker
      let castRenderStatus = {
        activeCount: 0, queuedCount: 0, activeSlides: [], queuedSlides: [],
      };
      if (renderTracker) {
        castRenderStatus = renderTracker.getCastStatus(cast.uuid);
      }

      const cacheStatus = await slideImageRenderer.getCastCacheStatus(
        cast.uuid,
        totalSlides,
        cast.updated_at,
      );

      return {
        success: true,
        ...cacheStatus,
        activeRenders: castRenderStatus.activeCount,
        queuedRenders: castRenderStatus.queuedCount,
        renderingSlides: castRenderStatus.activeSlides,
        queuedSlides: castRenderStatus.queuedSlides,
      };
    },

    // Trigger cache rendering for slides (batch or specific)
    'POST /casts/:id/cache': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      if (!slideImageRenderer) {
        return { success: false, error: 'Renderer not available', status: 500 };
      }

      const { slides: slideIndices, force = false, priority = false } = ctx.body || {};

      // Flatten slides from groups
      const slides = [];
      for (const group of (cast.definition?.groups || [])) {
        for (const slide of (group.slides || [])) {
          slides.push({ ...slide, groupId: group.id, groupName: group.name });
        }
      }

      if (slides.length === 0) {
        return { success: true, queued: 0, message: 'No slides to cache' };
      }

      // Determine which slides to render
      let targetIndices = slideIndices;
      if (!targetIndices || targetIndices.length === 0) {
        // Render all slides
        targetIndices = slides.map((_, i) => i);
      }

      // Filter to valid indices
      targetIndices = targetIndices.filter((i) => i >= 0 && i < slides.length);

      let queued = 0;
      let skipped = 0;
      const variables = cast.definition?.variables || {};
      const castId = cast.uuid;

      for (const slideIndex of targetIndices) {
        const slide = slides[slideIndex];

        // Check if already rendering
        if (renderTracker && renderTracker.isRendering(castId, slideIndex)) {
          skipped++;
          continue;
        }

        // Check if already cached and not force
        if (!force) {
          const metadata = await slideImageRenderer.getSlideLayerMetadata(castId, slideIndex);
          if (metadata) {
            const renderTime = new Date(metadata.generatedAt || 0).getTime();
            const updateTime = new Date(cast.updated_at || 0).getTime();
            if (updateTime <= renderTime) {
              // Extra validation: ensure non-native layers actually produced PNG files
              const hasNonNativeLayers = (metadata.layers || []).some((l) => l.native === false);
              let cacheValid = true;

              if (hasNonNativeLayers) {
                // Check renderStats — rendered=0 with non-native layers means Playwright failed
                if ((metadata.renderStats?.rendered ?? 0) === 0 && metadata.renderStats?.skipped === 0) {
                  logger.warn(`Cache skip aborted for cast=${castId} slide=${slideIndex}: renderStats.rendered=0 with non-native layers`);
                  cacheValid = false;
                }

                // Check at least one PNG exists in the slide dir
                if (cacheValid) {
                  const slideDir = slideImageRenderer.getSlideDir(castId, slideIndex);
                  let hasPng = false;
                  try {
                    if (existsSync(slideDir)) {
                      hasPng = readdirSync(slideDir).some((f) => f.endsWith('.png'));
                    }
                  } catch { /* ignore */ }
                  if (!hasPng) {
                    logger.warn(`Cache skip aborted for cast=${castId} slide=${slideIndex}: no PNG files in cache dir`);
                    cacheValid = false;
                  }
                }
              }

              if (cacheValid) {
                skipped++;
                continue;
              }
            }
          }
        }

        // Define the render function
        const doRender = () => {
          (async () => {
            try {
              await slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { force });
              if (renderTracker) {
                renderTracker.completeRender(castId, slideIndex);
              }
              logger.debug(`Cache render complete: cast=${castId} slide=${slideIndex}`);
            } catch (err) {
              logger.warn(`Cache render failed: ${castId}/${slideIndex} - ${err.message}`);
              if (renderTracker) {
                renderTracker.failRender(castId, slideIndex, err);
              }
            }
          })();

          if (renderTracker) {
            renderTracker.startRender(castId, slideIndex);
          }
        };

        if (renderTracker) {
          if (renderTracker.canStartRender()) {
            doRender();
            queued++;
          } else {
            const wasQueued = renderTracker.queueRender(castId, slideIndex, doRender, priority);
            if (wasQueued) queued++;
            else skipped++;
          }
        } else {
          // Fallback: direct render
          slideImageRenderer.renderSlide(castId, slideIndex, slide, variables, { force }).catch((err) => {
            logger.warn(`Cache render failed: ${castId}/${slideIndex} - ${err.message}`);
          });
          queued++;
        }
      }

      return {
        success: true,
        queued,
        skipped,
        total: targetIndices.length,
        message: queued > 0
          ? `Queued ${queued} slide(s) for rendering${skipped > 0 ? `, ${skipped} skipped` : ''}`
          : `All ${skipped} slide(s) already cached or rendering`,
      };
    },

    // Clear cache for a cast (invalidate all rendered slides)
    'DELETE /casts/:id/cache': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      if (!slideImageRenderer) {
        return { success: false, error: 'Renderer not available', status: 500 };
      }

      await slideImageRenderer.clearCastRenders(cast.uuid);

      return { success: true, message: 'Cache cleared' };
    },

    // Cancel pending cache renders for a cast (active renders will complete)
    'POST /casts/:id/cache/cancel': async (ctx) => {
      const cast = await resolveCast(ctx, ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      if (!renderTracker) {
        return { success: false, error: 'Render tracker not available', status: 500 };
      }

      const cancelled = renderTracker.cancelForCast(cast.uuid);

      return {
        success: true,
        cancelled,
        message: cancelled > 0
          ? `Cancelled ${cancelled} pending render(s)`
          : 'No pending renders to cancel',
      };
    },

    // Cancel ALL pending cache renders (global)
    'POST /cache/cancel-all': async (ctx) => {
      if (!renderTracker) {
        return { success: false, error: 'Render tracker not available', status: 500 };
      }

      const cancelled = renderTracker.cancelAll();

      return {
        success: true,
        cancelled,
        message: cancelled > 0
          ? `Cancelled ${cancelled} pending render(s)`
          : 'No pending renders to cancel',
      };
    },
  };
}
