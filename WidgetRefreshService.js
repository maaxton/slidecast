import crypto from 'crypto';
import logger from './utils/Logger.js';
import { UpdateTypes } from './UpdateTracker.js';
/**
 * WidgetRefreshService - Background widget refresh when screens are connected
 *
 * Content-keyed (2026-07): one micro-job per on-air widget INSTANCE, keyed by
 *     `${castId}:${slideIdx}:${elementId}:${widgetUuid}`
 * — NOT per screen. A cast's widget layer PNG is per-cast and shared across every
 * screen showing that cast (SlideImageRenderer writes renderDir/{castId}/{slide}/),
 * so N screens on one cast must produce exactly ONE data-fetch + ONE render, not N.
 * The set of screens to notify is resolved per-cast at notify time via
 * getScreensForCast(). This replaced the earlier per-(screen×cast×slide×widget)
 * fan-out + a `castRenderGuard` that tried to coalesce the N sibling renders back
 * to one — a fragile, timing-dependent band-aid (its 0.9×interval window was
 * shorter than the interval, so drifted screen jobs re-rendered). Keying on the
 * instance removes the fan-out structurally; the guard is gone.
 *
 * Lifecycle transitions (cast:started, cast:ended, cast:definition_changed,
 * screen-offline) call reconcile() which diffs desired vs current and
 * schedules/cancels accordingly. getStatus().lastRefreshed is keyed by widgetUuid
 * (legacy); per-instance last refresh is getStatus().lastRefreshedByInstance.
 */

// Warn threshold for high-cardinality instance maps (#1134 sharp edge #6).
const INSTANCE_COUNT_WARN_THRESHOLD = 200;

class WidgetRefreshService {
  constructor(api, options = {}) {
    this.api = api;
    this.screenManager = options.screenManager;
    this.castManager = options.castManager;
    this.widgetRegistry = options.widgetRegistry;
    this.widgetRuntime = options.widgetRuntime;
    // Unifies DB + extension-provided widgets behind one contract (may be absent
    // in older tests that construct the service directly).
    this.widgetResolver = options.widgetResolver || null;
    this.widgetImageRenderer = options.widgetImageRenderer;
    this.widgetCache = options.widgetCache;
    this.updateTracker = options.updateTracker;
    this.eventBus = options.eventBus || null;

    this.intervalMs = options.intervalMs || 60000; // Default: 1 minute
    this.isRunning = false;

    // ---- Per-instance micro-job tracking (#1134) ----
    // key -> { jobId, castId, slideIdx, elementId, widgetUuid, ... }
    this.instances = new Map();
    // key -> timestamp of last successful refresh (used for per-instance lastRefreshed)
    this.lastRefreshedByInstance = new Map();
    // Back-compat widgetUuid -> timestamp (legacy consumers).
    this.lastRefreshed = new Map();

    // #1201: debounce high-cardinality warning — only log on the
    // false→true transition, and reset when we drop back to ≤ threshold.
    // Prevents spamming the log once per reconcile when a large board
    // stays above 200 instances indefinitely.
    this._overThresholdWarned = false;

    // Diagnostics: last skip reason surfaced by the refresh tick, for the
    // widgets/refresh/status debug endpoint. Updated on every refresh() call
    // so operators can see why a tick produced no work (#1114).
    this.lastSkipReason = null; // null | 'no_online_screens' | 'no_active_cast_on_any_screen' | 'no_widgets_in_active_casts'
    this.lastTickAt = null;
    this.lastInstantRefreshAt = null;
    this.lastReconcileAt = null;

    // Event bus subscription handles (so stop() can cleanly unsubscribe).
    this._handlers = {
      castStarted: null,
      castEnded: null,
      screenOffline: null,
      castDefinitionChanged: null,
      widgetDefinitionChanged: null,
    };
  }

  // ---------- helpers ----------

  static instanceKey({
    castId, slideIdx, elementId, widgetUuid,
  }) {
    return `${castId}:${slideIdx}:${elementId}:${widgetUuid}`;
  }

  _shortUuid(uuid) {
    if (!uuid) return 'x';
    return String(uuid).replace(/-/g, '').slice(0, 8);
  }

  /**
   * Predicate: is there an "actively playing" slideshow on the given screen?
   *
   * A cast is considered active on a screen when the screen is online AND
   * has a non-null assigned_cast_id. This is stricter than the legacy
   * "online-only" gate — previously a screen that was online but had no
   * cast assigned could still trip refresh work during cast lookup; now
   * callers can ask explicitly (#1114).
   *
   * @param {number|string} screenId - Screen DB id OR serial
   * @returns {Promise<boolean>}
   */
  async isCastActiveOnScreen(screenId) {
    if (!this.screenManager || screenId === undefined || screenId === null) {
      return false;
    }
    try {
      const screens = await this.screenManager.getAll();
      const match = screens.find(
        (s) => s.id === screenId || s.serial === screenId,
      );
      if (!match) return false;
      return match.status === 'online' && !!match.assigned_cast_id;
    } catch (err) {
      logger.warn(`isCastActiveOnScreen lookup failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Start the background refresh service.
   *
   * Phase 2 (#1134): instead of scheduling one coarse tick, the service now
   * subscribes to lifecycle events and reconciles the set of per-instance
   * micro-jobs on each transition. An initial reconcile runs as a warm-up so
   * existing active screens/casts get their micro-jobs scheduled promptly.
   */
  start(intervalMs = null) {
    // Drain any prior schedule before starting again.
    this.stop();

    if (intervalMs) {
      this.intervalMs = intervalMs;
    }

    this.isRunning = true;

    const usingPlatformScheduler = !!(this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function');
    console.log(`[slidecast:widget-refresh] start interval=${this.intervalMs}ms viaScheduler=${usingPlatformScheduler} mode=per-instance`);

    // Wire event bus listeners for lifecycle transitions.
    if (this.eventBus && typeof this.eventBus.on === 'function') {
      this._handlers.castStarted = (payload) => {
        this.onCastStarted(payload).catch((err) => {
          logger.warn(`onCastStarted failed: ${err.message}`);
        });
      };
      this._handlers.castEnded = (payload) => {
        this._reconcile().catch((err) => logger.warn(`reconcile (cast:ended) failed: ${err.message}`));
        // Targeted cancel for this screen is handled inside _reconcile via
        // authoritative getActivelyPlayingScreens — no extra work needed.
        void payload;
      };
      this._handlers.screenOffline = (payload) => {
        this._reconcile().catch((err) => logger.warn(`reconcile (screen-offline) failed: ${err.message}`));
        void payload;
      };
      this._handlers.castDefinitionChanged = (payload) => {
        this._reconcile().catch((err) => logger.warn(`reconcile (cast:definition_changed) failed: ${err.message}`));
        void payload;
      };
      this._handlers.widgetDefinitionChanged = (payload) => {
        // #1202: widget edits (including refreshInterval) must trigger reconcile
        // so per-instance jobs are rescheduled at the new cadence.
        this._reconcile().catch((err) => logger.warn(`reconcile (widget:definition_changed) failed: ${err.message}`));
        void payload;
      };
      this.eventBus.on('cast:started', this._handlers.castStarted);
      this.eventBus.on('cast:ended', this._handlers.castEnded);
      this.eventBus.on('screen-offline', this._handlers.screenOffline);
      this.eventBus.on('cast:definition_changed', this._handlers.castDefinitionChanged);
      this.eventBus.on('widget:definition_changed', this._handlers.widgetDefinitionChanged);
    }

    // Warm-up reconcile — schedule jobs for whatever is active right now.
    // Kick it off via scheduler so it's tracked+cancellable on hot-reload.
    if (usingPlatformScheduler) {
      this.api.scheduler.schedule(
        () => this._reconcile().catch((err) => logger.warn(`initial reconcile failed: ${err.message}`)),
        { delayMs: 0, name: 'widget-refresh-reconcile-warmup' },
      );
    } else {
      setTimeout(() => {
        this._reconcile().catch((err) => logger.warn(`initial reconcile failed: ${err.message}`));
      }, 0);
    }

    logger.info(`WidgetRefreshService started (interval: ${this.intervalMs}ms, per-instance jobs)`);
  }

  /**
   * Stop the background refresh service. Safe to call multiple times and
   * before start().
   *
   * Cancels every micro-job in the instance map and unsubscribes from the
   * event bus so repeated start/stop cycles (hot-reload) don't leak handlers.
   */
  stop() {
    // Cancel every per-instance job.
    for (const [, inst] of this.instances) {
      try { this.api?.scheduler?.cancel?.(inst.jobId); } catch { /* noop */ }
    }
    this.instances.clear();
    // SL9: evict the per-instance last-refresh timestamps too, else this map
    // grew unbounded across every teardown/hot-reload and slide re-layout.
    this.lastRefreshedByInstance.clear();

    // Unsubscribe event handlers.
    if (this.eventBus) {
      const off = (ev, fn) => {
        if (!fn) return;
        try {
          if (typeof this.eventBus.off === 'function') this.eventBus.off(ev, fn);
          else if (typeof this.eventBus.removeListener === 'function') this.eventBus.removeListener(ev, fn);
        } catch { /* noop */ }
      };
      off('cast:started', this._handlers.castStarted);
      off('cast:ended', this._handlers.castEnded);
      off('screen-offline', this._handlers.screenOffline);
      off('cast:definition_changed', this._handlers.castDefinitionChanged);
      off('widget:definition_changed', this._handlers.widgetDefinitionChanged);
    }
    this._handlers = {
      castStarted: null, castEnded: null, screenOffline: null, castDefinitionChanged: null, widgetDefinitionChanged: null,
    };

    this.isRunning = false;
    logger.info('WidgetRefreshService stopped');
  }

  /**
   * Update the refresh interval. Restart reconciles all per-instance jobs at
   * the new cadence.
   */
  updateInterval(intervalMs) {
    this.intervalMs = intervalMs;
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  /**
   * Build the desired instance map from current state.
   * Returns Map<key, instanceDescriptor>.
   */
  async _computeDesiredInstances() {
    const desired = new Map();
    if (!this.screenManager) return desired;

    let activeScreens;
    try {
      activeScreens = await this.getActivelyPlayingScreens();
    } catch (err) {
      logger.warn(`_computeDesiredInstances: failed to fetch screens: ${err.message}`);
      return desired;
    }
    if (!activeScreens || activeScreens.length === 0) return desired;

    // Content-keyed: iterate the DISTINCT on-air casts, not screens. Widget work
    // (data fetch + render) is per-cast — N screens on one cast contribute exactly
    // ONE set of instances, so a cast is processed once regardless of how many
    // screens show it. This is the structural fix for the per-screen fan-out.
    const activeCastIds = [
      ...new Set(activeScreens.map((s) => s.assigned_cast_id).filter(Boolean)),
    ];

    const renderModeCache = new Map();
    const widgetDefCache = new Map();

    for (const castId of activeCastIds) {
      let cast = null;
      try { cast = await this.castManager?.getByUuid?.(castId); } catch { cast = null; }
      if (!cast || !cast.definition) continue;

      const refs = this.extractWidgetsFromDefinition(cast.definition, castId);
      for (const ref of refs) {
        // Filter natives — they're rendered on-Roku, not server-side (#1151).
        // Also capture per-widget refreshInterval (#1202) so each instance
        // can be scheduled at its own cadence.
        let renderMode = renderModeCache.get(ref.uuid);
        let widgetInterval = widgetDefCache.get(ref.uuid);
        if (renderMode === undefined) {
          let mode = 'native';
          let interval = null;
          try {
            // Resolve via the unified resolver (handles both DB and extension
            // provider widgets); fall back to the DB registry when no resolver
            // is wired (unit tests that construct the service directly).
            const resolved = this.widgetResolver
              ? await this.widgetResolver.resolve(ref.uuid)
              : await this.widgetRegistry?.getByUuid?.(ref.uuid);
            mode = (resolved && resolved.renderMode) || 'native';
            interval = (resolved && typeof resolved.refreshInterval === 'number' && resolved.refreshInterval > 0)
              ? resolved.refreshInterval
              : null;
          } catch { /* miss → treat as native */ }
          renderModeCache.set(ref.uuid, mode);
          widgetDefCache.set(ref.uuid, interval);
          renderMode = mode;
          widgetInterval = interval;
        }
        if (renderMode === 'native') continue;

        const slideIdx = ref.location?.slideIndex ?? null;
        const elementId = ref.location?.elementId ?? null;
        if (slideIdx === null || !elementId) continue;

        const descriptor = {
          castId,
          slideIdx,
          elementId,
          widgetUuid: ref.uuid,
          elementConfig: ref.config,
          elementStyles: ref.styles,
          // #1202: schedule at per-widget cadence when provided, else service default.
          intervalMs: widgetInterval || this.intervalMs,
        };
        const key = WidgetRefreshService.instanceKey(descriptor);
        // One instance per (cast, slide, element, widget). Dedupe defensively.
        if (!desired.has(key)) desired.set(key, descriptor);
      }
    }

    return desired;
  }

  /**
   * Reconcile: diff current instance map against desired — cancel stale
   * micro-jobs, schedule new ones, leave unchanged alone.
   *
   * Idempotent: calling back-to-back on the same state is a no-op. Safe to
   * call from any lifecycle handler.
   */
  async _reconcile() {
    if (!this.isRunning) return;
    this.lastReconcileAt = Date.now();

    const desired = await this._computeDesiredInstances();

    // Cancel instances that no longer exist in desired, OR whose desired
    // intervalMs differs from the currently-scheduled intervalMs (#1202).
    for (const [key, inst] of Array.from(this.instances.entries())) {
      const desiredDescriptor = desired.get(key);
      if (!desiredDescriptor) {
        try { this.api?.scheduler?.cancel?.(inst.jobId); } catch { /* noop */ }
        this.instances.delete(key);
        // SL9: an instance that's no longer desired (slide removed, cast
        // unassigned) must drop its last-refresh entry, or the map leaks.
        this.lastRefreshedByInstance.delete(key);
        continue;
      }
      const desiredInterval = desiredDescriptor.intervalMs || this.intervalMs;
      if (inst.intervalMs !== desiredInterval) {
        try { this.api?.scheduler?.cancel?.(inst.jobId); } catch { /* noop */ }
        this.instances.delete(key);
        // Fall through: will be re-scheduled in the next loop.
      }
    }

    // Schedule newly-desired instances.
    for (const [key, descriptor] of desired.entries()) {
      if (this.instances.has(key)) continue;
      this._scheduleInstance(key, descriptor);
    }

    // #1201: debounced high-cardinality warning — log once on the
    // transition above threshold, info once when we drop back below.
    if (this.instances.size > INSTANCE_COUNT_WARN_THRESHOLD) {
      if (!this._overThresholdWarned) {
        logger.warn(`WidgetRefresh: per-instance job count ${this.instances.size} exceeds threshold ${INSTANCE_COUNT_WARN_THRESHOLD}`);
        this._overThresholdWarned = true;
      }
    } else if (this._overThresholdWarned) {
      logger.info(`WidgetRefresh: per-instance job count ${this.instances.size} dropped back below threshold ${INSTANCE_COUNT_WARN_THRESHOLD}`);
      this._overThresholdWarned = false;
    }

    console.log(`[slidecast:widget-refresh] reconcile desired=${desired.size} active=${this.instances.size}`);
  }

  /**
   * Schedule a single micro-job for an instance descriptor.
   * @private
   */
  _scheduleInstance(key, descriptor) {
    // #1202: honour per-widget refreshInterval when provided, fall back to
    // the service-wide default for safety.
    const intervalMs = descriptor.intervalMs || this.intervalMs;
    if (!this.api?.scheduler?.schedule) {
      // No platform scheduler — we can't track per-instance jobs. This path
      // exists only to let tests without a scheduler still exercise reconcile
      // diffing logic; no refreshes will fire.
      this.instances.set(key, { ...descriptor, intervalMs, jobId: null });
      return;
    }
    const shortUuid = this._shortUuid(descriptor.widgetUuid);
    const shortCast = descriptor.castId ? String(descriptor.castId).slice(0, 8) : 'x';
    const name = `widget-refresh:${shortUuid}@${shortCast}:${descriptor.slideIdx}`;
    const jobId = this.api.scheduler.schedule(
      () => this._tickInstance(key).catch((err) => {
        logger.warn(`widget-refresh tick failed for ${key}: ${err.message}`);
      }),
      { intervalMs, name },
    );
    this.instances.set(key, { ...descriptor, intervalMs, jobId });
  }

  /**
   * Per-instance tick handler — refreshes the widget for this single
   * screen×slide×element instance.
   * @private
   */
  async _tickInstance(key) {
    const inst = this.instances.get(key);
    if (!inst) return;
    await this._tickDescriptor(key, inst);
  }

  /**
   * Tick a single instance descriptor. Factored out of _tickInstance so
   * hand-triggered passes (refresh / onCastStarted while the service is
   * stopped) can tick desired descriptors that were never scheduled.
   * @private
   */
  async _tickDescriptor(key, inst) {
    this.lastTickAt = Date.now();

    try {
      // Resolve via the unified contract (DB or extension provider widget).
      const resolved = this.widgetResolver
        ? await this.widgetResolver.resolve(inst.widgetUuid)
        : null;
      if (!resolved) {
        logger.warn(`Widget not found: ${inst.widgetUuid}`);
        return;
      }

      // Resolve the screens showing this cast at NOTIFY time. The data fetch +
      // render happen exactly once here (this instance is per-cast, not
      // per-screen); only the widget_refreshed notification fans out per screen.
      const screenSerials = await this._screensForCast(inst.castId);

      const contentHash = await this.refreshWidget(resolved, inst, screenSerials);
      // Only record a refresh when we actually produced a hash — a failed render
      // leaves the timestamp untouched so the next tick retries.
      if (contentHash) this.lastRefreshedByInstance.set(key, Date.now());
    } catch (err) {
      logger.warn(`_tickInstance ${key} failed: ${err.message}`);
    }
  }

  /**
   * Legacy coarse refresh — retained so external callers that hand-triggered
   * a full pass still work. Re-implements the old behaviour by running
   * reconcile + one tick per active instance.
   */
  async refresh() {
    this.lastTickAt = Date.now();
    console.log(`[slidecast:widget-refresh] legacy-refresh t=${new Date(this.lastTickAt).toISOString()}`);

    try {
      const activeScreens = await this.getActivelyPlayingScreens();
      if (activeScreens.length === 0) {
        const onlineScreens = await this.getOnlineScreens();
        this.lastSkipReason = onlineScreens.length === 0
          ? 'no_online_screens'
          : 'no_active_cast_on_any_screen';
        return;
      }

      // Make sure the instance map is up to date, then tick each one.
      // When the service is stopped, _reconcile() is a guarded no-op (it
      // must not schedule jobs after stop) — but a hand-triggered refresh
      // must still do a full pass, so tick the desired descriptors
      // directly without registering them.
      if (this.isRunning) {
        await this._reconcile();
        if (this.instances.size === 0) {
          this.lastSkipReason = 'no_widgets_in_active_casts';
          return;
        }
        this.lastSkipReason = null;

        for (const key of Array.from(this.instances.keys())) {
          await this._tickInstance(key);
        }
      } else {
        const desired = await this._computeDesiredInstances();
        if (desired.size === 0) {
          this.lastSkipReason = 'no_widgets_in_active_casts';
          return;
        }
        this.lastSkipReason = null;

        for (const [key, descriptor] of desired.entries()) {
          await this._tickDescriptor(key, descriptor);
        }
      }
    } catch (error) {
      logger.error(`WidgetRefresh error: ${error.message}`);
    }
  }

  /**
   * Get list of online screens
   */
  async getOnlineScreens() {
    if (!this.screenManager) return [];

    try {
      const screens = await this.screenManager.getAll();
      return screens.filter((s) => s.status === 'online');
    } catch (error) {
      logger.warn(`Failed to get screens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get screens currently playing a slideshow (online + assigned_cast_id).
   * This is the authoritative "slideshow actively playing" predicate used
   * to gate refresh work (#1114).
   */
  async getActivelyPlayingScreens() {
    if (!this.screenManager) return [];
    try {
      const screens = await this.screenManager.getAll();
      return screens.filter(
        (s) => s.status === 'online' && !!s.assigned_cast_id,
      );
    } catch (error) {
      logger.warn(`Failed to get actively-playing screens: ${error.message}`);
      return [];
    }
  }

  /**
   * Resolve the serials of screens currently showing a cast — the per-cast
   * notify fan-out. The refresh itself is per-instance (once per cast); this is
   * the ONLY place screen count enters. Returns [] on any error so a lookup
   * failure never aborts a refresh.
   */
  async _screensForCast(castId) {
    if (!this.screenManager?.getScreensForCast || !castId) return [];
    try {
      const screens = await this.screenManager.getScreensForCast(castId);
      return (screens || [])
        .map((s) => s.serial || s.screen_serial)
        .filter(Boolean);
    } catch (err) {
      logger.warn(`_screensForCast(${castId}) failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Event handler for cast:started. Reconciles to schedule the new
   * instances, then fires the instance ticks immediately so viewers see
   * fresh widget content right away instead of waiting for the first
   * interval boundary (#1114).
   *
   * The immediate invocation is done by calling _tickInstance directly for
   * the instances that belong to the just-started cast — not by double-
   * scheduling, which would race with the interval.
   *
   * @param {{castId: string, screenId?: number|string, screenSerial?: string}} payload
   */
  async onCastStarted(payload = {}) {
    const { castId } = payload || {};
    if (!castId) {
      logger.debug('onCastStarted: no castId in payload, skipping');
      return { refreshed: 0, reason: 'no_cast_id' };
    }

    this.lastInstantRefreshAt = Date.now();

    // Make sure micro-jobs exist for the new cast. When the service is
    // stopped, _reconcile() is a guarded no-op (must not schedule jobs
    // after stop) — fall back to the computed desired set so a direct
    // onCastStarted call still fires the instant pass.
    let candidates;
    if (this.isRunning) {
      await this._reconcile();
      candidates = this.instances;
    } else {
      candidates = await this._computeDesiredInstances();
    }

    // Instances are per-cast now. Immediately fire this cast's instances so the
    // first viewer sees fresh content, but SKIP any that refreshed within their
    // interval — so a second screen joining an already-playing cast does not
    // trigger a redundant re-fetch/re-render (the render is shared; the joining
    // screen gets the current layer via its normal boot/poll + notify).
    const now = Date.now();
    const toFire = [];
    for (const [key, inst] of candidates.entries()) {
      if (inst.castId !== castId) continue;
      const last = this.lastRefreshedByInstance.get(key) || 0;
      const interval = inst.intervalMs || this.intervalMs;
      if (now - last < interval) continue;
      toFire.push([key, inst]);
    }

    let refreshed = 0;
    for (const [key, inst] of toFire) {
      try {
        await this._tickDescriptor(key, inst);
        refreshed++;
      } catch (err) {
        logger.warn(`onCastStarted tick failed for ${key}: ${err.message}`);
      }
    }
    return { refreshed };
  }

  /**
   * Check if a specific screen is connected (for priority queue)
   */
  async isScreenConnected(screenSerial) {
    if (!this.screenManager || !screenSerial) return false;

    try {
      const screen = await this.screenManager.getBySerial(screenSerial);
      return screen && screen.status === 'online';
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract widget UUIDs from casts, aggregating locations across all casts/slides
   */
  async getWidgetsFromCasts(castIds) {
    // Map of widgetUuid -> { widgetInfo, locations: [{castId, slideIndex, elementId}] }
    const widgetMap = new Map();

    for (const castId of castIds) {
      try {
        const cast = await this.castManager.getByUuid(castId);
        if (!cast || !cast.definition) continue;

        // Extract widgets from cast definition with location info
        const castWidgets = this.extractWidgetsFromDefinition(cast.definition, castId);

        for (const widgetRef of castWidgets) {
          if (!widgetMap.has(widgetRef.uuid)) {
            // Get full widget info from registry
            const widgetInfo = await this.widgetRegistry?.getByUuid(widgetRef.uuid);
            if (widgetInfo) {
              widgetMap.set(widgetRef.uuid, {
                ...widgetInfo,
                // Include element-specific config if present
                elementConfig: widgetRef.config,
                elementStyles: widgetRef.styles,
                locations: [],
              });
            }
          }

          // Accumulate all locations for this widget (it may appear on multiple slides/casts)
          const entry = widgetMap.get(widgetRef.uuid);
          if (entry && widgetRef.location) {
            entry.locations.push(widgetRef.location);
          }
        }
      } catch (error) {
        logger.warn(`Failed to get widgets from cast ${castId}: ${error.message}`);
      }
    }

    return Array.from(widgetMap.values());
  }

  /**
   * Extract widget references from cast definition
   * @param {Object} definition - Cast definition
   * @param {string} [castId] - Cast UUID (included in location info when provided)
   * @returns {Array} Widget refs with uuid, config, styles, and location
   */
  extractWidgetsFromDefinition(definition, castId = null) {
    const widgets = [];
    let slideIndex = 0;

    // Handle groups-based structure
    if (definition.groups) {
      for (const group of definition.groups) {
        if (group.slides) {
          for (const slide of group.slides) {
            if (slide.elements) {
              for (const element of slide.elements) {
                if (element.type === 'widget' && element.widgetUuid) {
                  widgets.push({
                    uuid: element.widgetUuid,
                    config: element.widgetConfig || {},
                    styles: element.style || {},
                    location: castId ? {
                      castId,
                      slideIndex,
                      elementId: element.id,
                    } : null,
                  });
                }
              }
            }
            slideIndex++;
          }
        }
      }
    }

    // Handle flat slides structure (legacy)
    if (definition.slides) {
      for (const slide of definition.slides) {
        if (slide.elements) {
          for (const element of slide.elements) {
            if (element.type === 'widget' && element.widgetUuid) {
              widgets.push({
                uuid: element.widgetUuid,
                config: element.widgetConfig || {},
                styles: element.style || {},
                location: castId ? {
                  castId,
                  slideIndex,
                  elementId: element.id,
                } : null,
              });
            }
          }
        }
        slideIndex++;
      }
    }

    return widgets;
  }

  /**
   * Refresh a single resolved widget instance: run the unified produce()
   * contract for fresh primitives, hash them for change-detection, update the
   * cache metadata, notify the given screens, and emit widget:layer_updated so
   * the Playwright pipeline re-renders the per-cast layer PNG.
   * @param {Object} resolved - WidgetResolver contract (DB or provider widget)
   * @param {Object} inst - instance descriptor {castId, slideIdx, elementId, elementConfig, elementStyles, size}
   * @param {string[]} screenSerials - screens showing this cast (notify targets)
   * @returns {Promise<string|undefined>} the content hash, or undefined on skip/failure
   */
  async refreshWidget(resolved, inst, screenSerials = []) {
    if (!resolved || typeof resolved.produce !== 'function') return undefined;

    // Native widgets render on-Roku — never regenerate their PNGs (#1151).
    if ((resolved.renderMode || 'native') === 'native') {
      logger.debug(`Widget ${resolved.id} is native; skipping server refresh`);
      return undefined;
    }

    const config = { ...(inst.elementConfig || {}) };
    const styles = { ...(inst.elementStyles || {}) };

    let result;
    try {
      result = await resolved.produce({ config, styles, size: inst.size || resolved.defaultSize });
    } catch (err) {
      console.log(`[slidecast:widget-refresh] refreshWidget bail: produce failed ${resolved.id} err=${err.message}`);
      logger.warn(`Widget execution failed: ${resolved.name || resolved.id} (${err.message})`);
      return undefined;
    }

    // Content hash of the primitives payload — the Playwright pipeline (triggered
    // by widget:layer_updated below) is the single authoritative PNG renderer.
    const contentHash = crypto.createHash('md5')
      .update(JSON.stringify(result?.primitives || {}))
      .digest('hex');

    if (this.widgetCache) {
      await this.widgetCache.set(resolved.id, config, styles, contentHash, null, {
        ttl: resolved.refreshInterval || 60000,
        format: 'png',
      });
    }

    if (this.updateTracker && screenSerials.length > 0) {
      const update = UpdateTypes.widgetRefreshed(resolved.id, contentHash);
      for (const serial of screenSerials) {
        this.updateTracker.pushUpdate(serial, update);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit('widget:layer_updated', {
        castId: inst.castId,
        slideIndex: inst.slideIdx,
        elementId: inst.elementId,
        widgetUuid: resolved.id,
        contentHash,
      });
    }

    this.lastRefreshed.set(resolved.id, Date.now());
    console.log(`[slidecast:widget-refresh] refreshed ${resolved.name || resolved.id} hash=${contentHash.slice(0, 8)} screens=${screenSerials.length}`);
    return contentHash;
  }

  /**
   * Force refresh all widgets for a specific cast — reconcile then tick
   * every matching instance. Retains the old contract (returns count of
   * refreshed widgets) so callers don't break.
   */
  async refreshCastWidgets(castId) {
    try {
      // Ensure instance map reflects current state before firing.
      await this._reconcile();

      const keys = [];
      for (const [key, inst] of this.instances.entries()) {
        if (inst.castId === castId) keys.push(key);
      }

      let refreshed = 0;
      for (const key of keys) {
        try {
          await this._tickInstance(key);
          refreshed++;
        } catch (err) {
          logger.warn(`refreshCastWidgets: tick failed for ${key}: ${err.message}`);
        }
      }
      return { refreshed };
    } catch (error) {
      logger.error(`Failed to refresh cast widgets: ${error.message}`);
      return { refreshed: 0, error: error.message };
    }
  }

  /**
   * Look up the scheduler job id for a given (cast × slide × element × widget)
   * instance. Returns null if the instance is not currently scheduled. Used by
   * the /debug/widgets endpoint to populate per-instance job_id (#1134). Callers
   * may still pass screenSerial; it is ignored (instances are per-cast now).
   */
  getJobIdForInstance({
    castId, slideIdx, elementId, widgetUuid,
  }) {
    const key = WidgetRefreshService.instanceKey({
      castId, slideIdx, elementId, widgetUuid,
    });
    const inst = this.instances.get(key);
    return inst ? inst.jobId : null;
  }

  /**
   * Return a snapshot of the active instance map for diagnostics / tests.
   */
  listInstances() {
    return Array.from(this.instances.entries()).map(([key, inst]) => ({ key, ...inst }));
  }

  /**
   * Get status for diagnostics
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      // Legacy: widgetUuid -> timestamp
      lastRefreshed: Object.fromEntries(this.lastRefreshed),
      // Phase 2: per-instance key -> timestamp
      lastRefreshedByInstance: Object.fromEntries(this.lastRefreshedByInstance),
      instanceCount: this.instances.size,
      // Gating diagnostics (#1114) — lets the /widgets/refresh/status
      // endpoint explain why a tick produced no work, e.g. "no_active_cast_on_any_screen".
      lastTickAt: this.lastTickAt,
      lastSkipReason: this.lastSkipReason,
      lastInstantRefreshAt: this.lastInstantRefreshAt,
      lastReconcileAt: this.lastReconcileAt,
      gateMode: 'active_cast_on_screen',
    };
  }
}

export default WidgetRefreshService;
