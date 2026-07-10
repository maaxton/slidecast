/**
 * Marketplace Routes — the content marketplace's read + batch-install surface.
 * V2 route factory: returns a route definition map for ctx.registerRoutes().
 *
 *   GET  /marketplace/catalog            → every content entry, annotated with
 *                                          compatibility + install/update state,
 *                                          joined against installed casts/templates
 *                                          by uuid. Optional ?kind= filter.
 *   GET  /marketplace/catalog/:kind/:id  → a single entry with its version list.
 *   POST /marketplace/jobs               → start a batch install → 202 { jobId, total }.
 *   GET  /marketplace/jobs/:jobId        → poll a batch's live progress.
 *
 * The platform's authenticateToken already gates slidecast routes. The /jobs
 * routes are declared BEFORE the /catalog/:kind/:id route (the B1 route-ordering
 * lesson) so a /:param route can never swallow them.
 */

/** Map a catalog/install error code onto an HTTP status. */
function statusForError(err) {
  switch (err && err.code) {
    case 'E_NOT_FOUND':
      return 404;
    case 'E_NO_ITEMS':
    case 'E_INVALID_PACK':
    case 'E_WRONG_PIPELINE':
      return 400;
    case 'E_CATALOG_FETCH':
    case 'E_DOWNLOAD':
    case 'E_INTEGRITY':
      return 502;
    default:
      return 500;
  }
}

/**
 * Build the install-state join the catalog annotation needs (the catalog service
 * owns no DB): a map id → installed version (from `content_pack_version:` markers)
 * and a Set of every cast/template uuid present on this box.
 */
async function buildInstalledState(ctx) {
  const installedVersions = {};
  const installedUuids = new Set();

  try {
    const settings = await ctx.data.slidecast_settings.findAll();
    for (const row of settings || []) {
      // content_pack_version: (casts/templates) and widget_pack_version: (widgets)
      // both map a pack id → its installed version.
      if (row.key && row.key.startsWith('content_pack_version:')) {
        installedVersions[row.key.slice('content_pack_version:'.length)] = row.value;
      } else if (row.key && row.key.startsWith('widget_pack_version:')) {
        installedVersions[row.key.slice('widget_pack_version:'.length)] = row.value;
      }
    }
  } catch { /* settings table not ready — thinner map */ }

  try {
    const casts = await ctx.data.slidecast_casts.findAll();
    for (const c of casts || []) if (c.uuid) installedUuids.add(c.uuid);
  } catch { /* casts table not ready */ }

  try {
    const templates = await ctx.data.slidecast_templates.findAll();
    for (const t of templates || []) if (t.uuid) installedUuids.add(t.uuid);
  } catch { /* templates table not ready */ }

  try {
    const widgets = await ctx.data.slidecast_widgets.findAll();
    for (const w of widgets || []) if (w.uuid) installedUuids.add(w.uuid);
  } catch { /* widgets table not ready */ }

  return { installedVersions, installedUuids };
}

/** Normalise the POST body into a [{ kind, id, versionSpec }] list. */
function normaliseItems(body) {
  const out = [];
  if (Array.isArray(body.items)) {
    for (const it of body.items) {
      if (it && it.id) out.push({ kind: it.kind || 'cast', id: it.id, versionSpec: it.versionSpec || it.version || 'latest' });
    }
    return out;
  }
  // Symmetry alt: { kind, ids: [...], versions: { id: spec } }
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const versions = body.versions || {};
  const kind = body.kind || 'cast';
  for (const id of ids) {
    if (id) out.push({ kind, id, versionSpec: versions[id] || 'latest' });
  }
  return out;
}

export default function createMarketplaceRoutes(deps) {
  // contentInstallService is driven through contentJobService (batch engine), so
  // the route factory only needs the catalog (read) + job (write) services.
  const { contentCatalogService, contentJobService } = deps;

  return {
    // ---- batch jobs (declared BEFORE any /:param route) ----

    'POST /marketplace/jobs': async (ctx) => {
      try {
        const items = normaliseItems(ctx.body || {});
        if (items.length === 0) {
          return { success: false, error: 'items[] is required', status: 400 };
        }
        const { jobId, total } = contentJobService.startJob(items);
        return {
          success: true, jobId, total, status: 202,
        };
      } catch (err) {
        return {
          success: false, error: err.message, code: err.code, status: statusForError(err),
        };
      }
    },

    'GET /marketplace/jobs/:jobId': async (ctx) => {
      const progress = contentJobService.getJob(ctx.params.jobId);
      if (!progress) {
        return { success: false, error: `No content job '${ctx.params.jobId}'`, status: 404 };
      }
      return { success: true, ...progress };
    },

    // ---- catalog read surface ----

    'GET /marketplace/catalog': async (ctx) => {
      try {
        const kind = ctx.query && ctx.query.kind ? ctx.query.kind : null;
        const { installedVersions, installedUuids } = await buildInstalledState(ctx);
        const items = await contentCatalogService.listContent({ installedVersions, installedUuids, kind });
        return { success: true, items };
      } catch (err) {
        return {
          success: false, error: err.message, code: err.code, status: statusForError(err),
        };
      }
    },

    'GET /marketplace/catalog/:kind/:id': async (ctx) => {
      try {
        const entry = await contentCatalogService.getEntry(ctx.params.id);
        if (!entry || (entry.kind || 'cast') !== ctx.params.kind) {
          return { success: false, error: `Content pack '${ctx.params.id}' is not in the catalog`, status: 404 };
        }
        const resolvedLatest = contentCatalogService.resolveVersion(entry, 'latest');
        const versions = (Array.isArray(entry.versions) ? entry.versions : []).map((v) => ({
          ...v,
          compatible: !!contentCatalogService.resolveVersion(entry, v.version),
        }));
        const { installedVersions } = await buildInstalledState(ctx);
        return {
          success: true,
          entry: {
            ...entry,
            versions,
            compatible: !!resolvedLatest,
            latestCompatibleVersion: resolvedLatest ? resolvedLatest.version : null,
            installedVersion: installedVersions[entry.id || entry.name] ?? null,
          },
        };
      } catch (err) {
        return {
          success: false, error: err.message, code: err.code, status: statusForError(err),
        };
      }
    },
  };
}
