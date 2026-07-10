/**
 * Preview Routes - Preview control operations
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */
export default function createPreviewRoutes(deps) {
  const { previewManager } = deps;

  return {
    // ==================== PREVIEW ====================

    // Start preview on screen
    'POST /preview/start': async (ctx) => {
      const { serial, cast } = ctx.body;
      previewManager.startPreview(serial, cast);
      return { success: true };
    },

    // Update preview
    'POST /preview/update': async (ctx) => {
      const { serial, cast } = ctx.body;
      previewManager.updatePreview(serial, cast);
      return { success: true };
    },

    // Stop preview
    'POST /preview/stop': async (ctx) => {
      const { serial } = ctx.body;
      previewManager.stopPreview(serial);
      return { success: true };
    },
  };
}
