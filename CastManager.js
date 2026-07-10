/**
 * CastManager - Manages slidecast presentations
 */

import { v4 as uuidv4 } from 'uuid';

class CastManager {
  constructor(api) {
    this.api = api;
    this.model = null;
    // Short-TTL memo cache of raw cast rows keyed by uuid. getByUuid runs on
    // nearly every protocol request (the Roku polls cast-version per screen every
    // ~10s), and the old implementation did findAll() with NO WHERE — loading
    // every cast row + its definition blob and linear-scanning in JS, N screens ×
    // poll cadence. The WHERE-scoped query below already fixes the O(all casts)
    // cost; this cache additionally collapses the near-simultaneous polls from
    // the screens on one cast into a single DB read. Cache the RAW row (not the
    // formatted cast) so formatCast() still runs per call — returned objects stay
    // independent (no mutation leak). The 5s TTL bounds staleness from ANY write
    // path (incl. the studio save in routes/casts.js, which writes the model
    // directly and only emits cast:definition_changed); _invalidate() makes the
    // CastManager-owned mutation paths instant.
    this._rowByUuid = new Map(); // uuid -> { row, at }
    this._rowTtlMs = 5000;
  }

  async init() {
    this.model = this.api.model('slidecast_casts');
  }

  /** Drop a cast from the row cache (call on any mutation). */
  _invalidate(uuid) {
    if (uuid) this._rowByUuid.delete(uuid);
  }

  /**
   * Get all casts
   */
  async getAll() {
    const casts = await this.model.findAll();
    return casts.map((cast) => this.formatCast(cast));
  }

  /**
   * Get cast by database ID
   */
  async getById(id) {
    const cast = await this.model.findById(id);
    return cast ? this.formatCast(cast) : null;
  }

  /**
   * Get cast by UUID
   */
  async getByUuid(uuid) {
    if (!uuid) return null;
    const cached = this._rowByUuid.get(uuid);
    if (cached && (Date.now() - cached.at) < this._rowTtlMs) {
      return this.formatCast(cached.row);
    }
    const results = await this.model.findAll({ where: { uuid }, limit: 1 });
    const row = results && results.length > 0 ? results[0] : null;
    if (row) {
      // Bound the cache defensively — cast counts are small, but never grow
      // unbounded on a long-uptime appliance.
      if (this._rowByUuid.size > 256) {
        this._rowByUuid.delete(this._rowByUuid.keys().next().value);
      }
      this._rowByUuid.set(uuid, { row, at: Date.now() });
    } else {
      this._rowByUuid.delete(uuid);
    }
    return row ? this.formatCast(row) : null;
  }

  /**
   * Create a new cast
   */
  async create(data) {
    // Honor a caller-supplied uuid (fallback to a fresh one). Marketplace/content
    // installs pass the packaged cast uuid so a re-install lands on the same row
    // instead of minting "Name (2)" — the single core gap the additive-idempotent
    // model needs. Studio/duplicate paths pass no uuid and get a fresh one.
    const uuid = data.uuid || uuidv4();
    const now = new Date().toISOString();

    // Default definition structure - uses groups-based architecture
    const defaultDefinition = {
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

    const definition = data.definition || defaultDefinition;

    // Model API create returns the full record
    const cast = await this.model.create({
      uuid,
      name: data.name || 'Untitled Cast',
      description: data.description || '',
      definition,
      thumbnail: data.thumbnail || null,
      created_at: now,
      updated_at: now,
    });

    return this.formatCast(cast);
  }

  /**
   * Update a cast
   */
  async update(id, data) {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.definition !== undefined) updateData.definition = data.definition;
    if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail;

    await this.model.update(id, updateData);
    this._invalidate(existing.uuid);
    return this.getById(id);
  }

  /**
   * Delete a cast
   */
  async delete(id) {
    const existing = await this.getById(id);
    if (!existing) return false;

    await this.model.delete(id);
    this._invalidate(existing.uuid);
    return true;
  }

  /**
   * Duplicate a cast
   */
  async duplicate(id) {
    const original = await this.getById(id);
    if (!original) return null;

    return this.create({
      name: `${original.name} (Copy)`,
      description: original.description,
      definition: original.definition,
      thumbnail: original.thumbnail,
    });
  }

  /**
   * Format cast for response
   */
  formatCast(cast) {
    let definition = typeof cast.definition === 'string'
      ? JSON.parse(cast.definition)
      : cast.definition;

    // Migrate legacy slides[] format to groups[] format
    definition = CastManager.migrateToGroups(definition);

    return {
      id: cast.id,
      uuid: cast.uuid,
      name: cast.name,
      description: cast.description,
      definition,
      thumbnail: cast.thumbnail,
      created_at: cast.created_at,
      updated_at: cast.updated_at,
      // Computed fields
      slideCount: this.getSlideCount(definition),
    };
  }

  /**
   * Get slide count from definition (counts across all groups)
   */
  getSlideCount(definition) {
    if (!definition) return 0;
    const def = typeof definition === 'string' ? JSON.parse(definition) : definition;

    // New groups-based structure
    if (def.groups) {
      return def.groups.reduce((total, group) => total + (group.slides?.length || 0), 0);
    }

    // Legacy slides array (backward compatibility)
    return def.slides ? def.slides.length : 0;
  }

  /**
   * Migrate legacy cast definition to groups structure
   * Called when loading a cast with old slides[] format
   */
  static migrateToGroups(definition) {
    if (!definition) return definition;

    // Already has groups - no migration needed
    if (definition.groups) return definition;

    // Has legacy slides array - migrate to groups
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
}

export default CastManager;
