/**
 * Cast utility functions — pure business logic extracted from CastManager.
 * No class, no state, no database access. Testable in isolation.
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

/**
 * Migrate legacy cast definition (flat slides[]) to groups[] structure.
 * Idempotent — if already has groups, returns as-is.
 */
export function migrateToGroups(definition) {
  if (!definition) return definition;
  if (definition.groups) return definition;

  if (definition.slides) {
    return {
      settings: {
        resolution: definition.settings?.resolution || { width: 1920, height: 1080 },
        transition: definition.settings?.transition || { type: 'fade', duration: 500 },
        backgroundColor: definition.settings?.backgroundColor || '#000000',
      },
      variables: definition.variables || {},
      groups: [{
        id: 'home',
        name: 'Home',
        isDefault: true,
        loop: definition.settings?.loop !== false,
        defaultDuration: definition.settings?.defaultDuration || 10000,
        slides: definition.slides,
      }],
    };
  }

  return definition;
}

/**
 * Format a raw database row into the cast API response shape.
 * Parses JSON definition, applies migration, computes slideCount.
 */
export function formatCast(cast) {
  let definition = typeof cast.definition === 'string'
    ? JSON.parse(cast.definition)
    : cast.definition;

  definition = migrateToGroups(definition);

  return {
    id: cast.id,
    uuid: cast.uuid,
    name: cast.name,
    description: cast.description,
    definition,
    thumbnail: cast.thumbnail,
    created_at: cast.created_at,
    updated_at: cast.updated_at,
    slideCount: getSlideCount(definition),
  };
}

/**
 * Count total slides across all groups in a definition.
 */
export function getSlideCount(definition) {
  if (!definition) return 0;
  const def = typeof definition === 'string' ? JSON.parse(definition) : definition;

  if (def.groups) {
    return def.groups.reduce((total, group) => total + (group.slides?.length || 0), 0);
  }
  return def.slides ? def.slides.length : 0;
}

/**
 * Resolve a cast by ID (numeric) or UUID (contains dashes).
 * Uses ctx.data for direct database queries.
 */
export async function resolveCast(ctx, id) {
  const isUuid = id.includes('-');
  const row = isUuid
    ? await ctx.data.slidecast_casts.findOne({ uuid: id })
    : await ctx.data.slidecast_casts.findOne({ id: parseInt(id, 10) });
  return row ? formatCast(row) : null;
}

/**
 * Build the default definition for a new cast.
 */
export function createDefaultDefinition() {
  return {
    settings: {
      resolution: { width: 1920, height: 1080 },
      transition: { type: 'fade', duration: 500 },
      backgroundColor: '#000000',
    },
    variables: {},
    groups: [{
      id: 'home',
      name: 'Home',
      isDefault: true,
      loop: true,
      defaultDuration: 10000,
      slides: [{
        id: 'slide-1',
        name: 'Slide 1',
        duration: 10000,
        backgroundColor: '#000000',
        elements: [{
          id: 'background-1',
          type: 'background',
          name: 'Background',
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          zIndex: 0,
          style: { backgroundColor: '#1a1a2e' },
        }],
      }],
    }],
  };
}

/**
 * Generate a new UUID.
 */
export function generateUuid() {
  return uuidv4();
}

/**
 * Generate an MD5 hash of a slide definition for change detection.
 */
export function generateSlideHash(slide, variables = {}) {
  const hashInput = JSON.stringify({
    background: slide.background || slide.backgroundColor,
    elements: (slide.elements || []).map((el) => ({
      type: el.type,
      position: el.position,
      size: el.size,
      style: el.style,
      content: el.content,
      asset_id: el.asset_id,
      widgetUuid: el.widgetUuid,
      widgetConfig: el.widgetConfig,
      widgetStyles: el.widgetStyles,
      config: el.config,
    })),
    variables,
  });
  return crypto.createHash('md5').update(hashInput).digest('hex');
}
