/**
 * resolveQueryFn — resolve the SQL query function from ctx.platform.
 *
 * T8 #1693: the legacy silent fallback to /app/backend/src/db/index.js has been
 * removed. The function now throws immediately with a clear message if queryFn
 * is absent, making misconfiguration visible at extension init time rather than
 * at the first query.
 *
 * @param {object} ctx — extension context (ctx.platform.queryFn must be set)
 * @returns {Function} the queryFn from ctx.platform
 * @throws {Error} if ctx.platform.queryFn is not provided
 */
export function resolveQueryFn(ctx) {
  if (!ctx.platform?.queryFn) {
    throw new Error(
      'resolveQueryFn: ctx.platform.queryFn is required but was not provided. '
      + 'Ensure the ExtensionLoader is initialised with a queryFn option (T8 #1693).',
    );
  }
  return ctx.platform.queryFn;
}
