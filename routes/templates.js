/**
 * Templates Routes - CRUD operations for cast templates
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 */
import { v4 as uuidv4 } from 'uuid';

export default function createTemplateRoutes(deps) {
  const { castManager } = deps;

  return {
    // ==================== TEMPLATES ====================

    // List templates
    'GET /templates': async (ctx) => {
      const templates = await ctx.data.slidecast_templates.findAll();
      return { success: true, templates };
    },

    // Create cast from template
    'POST /templates/:id/use': async (ctx) => {
      const template = await ctx.data.slidecast_templates.findOne({ id: ctx.params.id });
      if (!template) {
        return { success: false, error: 'Template not found', status: 404 };
      }

      const definition = typeof template.definition === 'string'
        ? JSON.parse(template.definition)
        : template.definition;

      const cast = await castManager.create({
        name: ctx.body.name || `${template.name} Copy`,
        description: template.description,
        definition: definition.cast || definition,
      });

      return { success: true, cast };
    },

    // Export cast as template
    'POST /casts/:id/export-template': async (ctx) => {
      const cast = await castManager.getById(ctx.params.id);
      if (!cast) {
        return { success: false, error: 'Cast not found', status: 404 };
      }

      const template = await ctx.data.slidecast_templates.create({
        uuid: uuidv4(),
        name: ctx.body.name || cast.name,
        description: ctx.body.description || cast.description,
        author: ctx.body.author || 'User',
        definition: cast.definition,
        thumbnail: cast.thumbnail,
        is_builtin: false,
      });

      return { success: true, template };
    },

    // Create new template directly
    'POST /templates': async (ctx) => {
      const {
        name, description, definition, thumbnail, author,
      } = ctx.body;

      if (!name || !definition) {
        return { success: false, error: 'Name and definition are required', status: 400 };
      }

      const template = await ctx.data.slidecast_templates.create({
        uuid: uuidv4(),
        name,
        description: description || '',
        author: author || 'User',
        definition: typeof definition === 'string' ? definition : JSON.stringify(definition),
        thumbnail: thumbnail || null,
        is_builtin: false,
      });

      return { success: true, template };
    },

    // Update template
    'PUT /templates/:id': async (ctx) => {
      const template = await ctx.data.slidecast_templates.findOne({ id: ctx.params.id });
      if (!template) {
        return { success: false, error: 'Template not found', status: 404 };
      }

      const updates = {};
      if (ctx.body.name !== undefined) updates.name = ctx.body.name;
      if (ctx.body.description !== undefined) updates.description = ctx.body.description;
      if (ctx.body.definition !== undefined) {
        updates.definition = typeof ctx.body.definition === 'string'
          ? ctx.body.definition
          : JSON.stringify(ctx.body.definition);
      }
      if (ctx.body.thumbnail !== undefined) updates.thumbnail = ctx.body.thumbnail;
      if (ctx.body.author !== undefined) updates.author = ctx.body.author;

      await ctx.data.slidecast_templates.update({ id: ctx.params.id }, updates);
      const updated = await ctx.data.slidecast_templates.findOne({ id: ctx.params.id });

      return { success: true, template: updated };
    },

    // Delete template
    'DELETE /templates/:id': async (ctx) => {
      const template = await ctx.data.slidecast_templates.findOne({ id: ctx.params.id });
      if (!template) {
        return { success: false, error: 'Template not found', status: 404 };
      }
      if (template.is_builtin) {
        return { success: false, error: 'Cannot delete built-in templates', status: 403 };
      }
      await ctx.data.slidecast_templates.delete({ id: ctx.params.id });
      return { success: true };
    },
  };
}
