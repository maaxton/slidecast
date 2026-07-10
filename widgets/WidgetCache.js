/**
 * WidgetCache - Intelligent caching system for rendered widgets
 * Caches rendered images and invalidates based on data changes
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import logger from '../utils/Logger.js';

class WidgetCache {
  constructor(api) {
    this.api = api;
    this.cacheDir = `${process.env.DATA_DIR || '/app/data'}/slidecast/widget-cache`;
    this.model = null;
    this.maxCacheSize = 500 * 1024 * 1024; // 500MB max cache
    this.defaultTtl = 3600000; // 1 hour default TTL
    // Recurring cleanup handles (minor: cleanup previously ran ONCE at init,
    // so expired entries accumulated for the process lifetime).
    this._cleanupJobId = null;
    this._cleanupInterval = null;
  }

  async init() {
    this.model = this.api.model('slidecast_widget_cache');

    // Create cache directory
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.warn(`Failed to create widget cache directory: ${error.message}`);
    }

    // Clean up expired entries on init...
    await this.cleanupExpired();

    // ...then keep pruning on a recurring schedule. Prefer the platform
    // scheduler (tracked + cancelled on reload); fall back to setInterval.
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._cleanupJobId = this.api.scheduler.schedule(
        () => this.cleanupExpired().catch((e) => logger.warn(`WidgetCache cleanup failed: ${e.message}`)),
        { intervalMs: 600000, name: 'widget-cache-cleanup' }, // every 10 min
      );
    } else {
      this._cleanupInterval = setInterval(
        () => this.cleanupExpired().catch((e) => logger.warn(`WidgetCache cleanup failed: ${e.message}`)),
        600000,
      );
      if (this._cleanupInterval.unref) { this._cleanupInterval.unref(); }
    }

    logger.info('WidgetCache initialized');
  }

  /**
   * Stop the recurring cleanup (called from the extension's onDestroy).
   */
  stop() {
    if (this._cleanupJobId !== null) {
      try { this.api?.scheduler?.cancel?.(this._cleanupJobId); } catch { /* noop */ }
      this._cleanupJobId = null;
    }
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Generate cache key from widget and config
   */
  generateCacheKey(widgetUuid, config, styles, dataHash = '') {
    const keyData = JSON.stringify({
      widget: widgetUuid,
      config,
      styles,
      data: dataHash,
    });

    return crypto.createHash('sha256').update(keyData).digest('hex');
  }

  /**
   * Get cached render if exists and valid
   */
  async get(widgetUuid, config, styles, dataHash = '') {
    const cacheKey = this.generateCacheKey(widgetUuid, config, styles, dataHash);

    try {
      const entries = await this.model.findAll({ where: { cache_key: cacheKey } });

      if (!entries || entries.length === 0) {
        return null;
      }

      const entry = entries[0];

      // Check if expired
      if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        await this.delete(cacheKey);
        return null;
      }

      // Check if file exists
      try {
        await fs.access(entry.file_path);
      } catch {
        await this.delete(cacheKey);
        return null;
      }

      // Read and return cached file
      const buffer = await fs.readFile(entry.file_path);

      return {
        buffer,
        cacheKey,
        filePath: entry.file_path,
        createdAt: entry.created_at,
        expiresAt: entry.expires_at,
      };
    } catch (error) {
      logger.warn(`Cache get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Store rendered widget in cache
   */
  async set(widgetUuid, config, styles, dataHash, buffer, options = {}) {
    const cacheKey = this.generateCacheKey(widgetUuid, config, styles, dataHash);
    const ttl = options.ttl || this.defaultTtl;
    const format = options.format || 'png';

    // Metadata-only mode (#1150/#1151): when buffer is null, the caller (e.g.
    // WidgetRefreshService) is recording an intent-to-refresh for version
    // tracking only — the actual PNG is produced by the Playwright slide
    // layer pipeline via the widget:layer_updated event, not by this cache.
    // In that case:
    //   - do NOT hash a null buffer (crypto.update(null) throws TypeError,
    //     which previously killed the whole refresh silently),
    //   - do NOT write a file (there's no buffer to write),
    //   - use the provided dataHash as the content_hash so Roku update
    //     detection still has a stable version token.
    const metadataOnly = buffer == null;
    const contentHash = metadataOnly
      ? (dataHash || '')
      : crypto.createHash('md5').update(buffer).digest('hex');

    // Generate filename
    const filename = `${cacheKey.substring(0, 16)}.${format}`;
    const filePath = path.join(this.cacheDir, filename);

    try {
      // Write file (only when we have actual bytes — metadata-only refreshes
      // rely on the Playwright slide-layer pipeline to produce the PNG).
      if (!metadataOnly) {
        await fs.writeFile(filePath, buffer);
      }

      // Calculate expiration
      const expiresAt = new Date(Date.now() + ttl).toISOString();

      // Remove existing entry if exists
      const existing = await this.model.findAll({ where: { cache_key: cacheKey } });
      if (existing && existing.length > 0) {
        await this.model.delete(existing[0].id);
      }

      // Create cache entry with content hash for version detection
      await this.model.create({
        cache_key: cacheKey,
        widget_uuid: widgetUuid,
        config_hash: crypto.createHash('md5').update(JSON.stringify(config)).digest('hex'),
        styles_hash: crypto.createHash('md5').update(JSON.stringify(styles)).digest('hex'),
        data_hash: dataHash,
        content_hash: contentHash, // Hash of actual rendered image for Roku version detection
        file_path: filePath,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      });

      // Check cache size and cleanup if needed
      await this.enforceMaxSize();

      return {
        cacheKey,
        filePath,
        contentHash,
        expiresAt,
      };
    } catch (error) {
      logger.error(`Cache set error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete cache entry
   */
  async delete(cacheKey) {
    try {
      const entries = await this.model.findAll({ where: { cache_key: cacheKey } });

      if (entries && entries.length > 0) {
        const entry = entries[0];

        // Delete file
        try {
          await fs.unlink(entry.file_path);
        } catch {
          // File may not exist
        }

        // Delete database entry
        await this.model.delete(entry.id);
      }

      return true;
    } catch (error) {
      logger.warn(`Cache delete error: ${error.message}`);
      return false;
    }
  }

  /**
   * Invalidate all cache entries for a widget
   */
  async invalidateWidget(widgetUuid) {
    try {
      const entries = await this.model.findAll({ where: { widget_uuid: widgetUuid } });

      let deleted = 0;
      for (const entry of entries) {
        try {
          await fs.unlink(entry.file_path);
        } catch {
          // File may not exist
        }
        await this.model.delete(entry.id);
        deleted++;
      }

      logger.info(`Invalidated ${deleted} cache entries for widget ${widgetUuid}`);
      return deleted;
    } catch (error) {
      logger.warn(`Cache invalidate error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpired() {
    try {
      const entries = await this.model.findAll();
      const now = new Date();
      let cleaned = 0;

      for (const entry of entries) {
        if (entry.expires_at && new Date(entry.expires_at) < now) {
          try {
            await fs.unlink(entry.file_path);
          } catch {
            // File may not exist
          }
          await this.model.delete(entry.id);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired cache entries`);
      }

      return cleaned;
    } catch (error) {
      logger.warn(`Cache cleanup error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Enforce maximum cache size (LRU eviction)
   */
  async enforceMaxSize() {
    try {
      // Get total cache size
      const entries = await this.model.findAll({ orderBy: 'created_at ASC' });
      let totalSize = 0;

      for (const entry of entries) {
        try {
          const stats = await fs.stat(entry.file_path);
          totalSize += stats.size;
        } catch {
          // File may not exist
        }
      }

      // If over max size, delete oldest entries
      if (totalSize > this.maxCacheSize) {
        let deletedSize = 0;
        const targetSize = this.maxCacheSize * 0.8; // Target 80% of max

        for (const entry of entries) {
          if (totalSize - deletedSize <= targetSize) {
            break;
          }

          try {
            const stats = await fs.stat(entry.file_path);
            deletedSize += stats.size;
            await fs.unlink(entry.file_path);
          } catch {
            // File may not exist
          }
          await this.model.delete(entry.id);
        }

        logger.info(`Cache eviction: removed ${Math.round(deletedSize / 1024)}KB`);
      }
    } catch (error) {
      logger.warn(`Cache size enforcement error: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    try {
      const entries = await this.model.findAll();
      let totalSize = 0;
      let validCount = 0;
      let expiredCount = 0;
      const now = new Date();

      for (const entry of entries) {
        try {
          const stats = await fs.stat(entry.file_path);
          totalSize += stats.size;

          if (entry.expires_at && new Date(entry.expires_at) < now) {
            expiredCount++;
          } else {
            validCount++;
          }
        } catch {
          expiredCount++;
        }
      }

      return {
        totalEntries: entries.length,
        validEntries: validCount,
        expiredEntries: expiredCount,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        maxSizeMB: Math.round(this.maxCacheSize / 1024 / 1024),
        usagePercent: Math.round(totalSize / this.maxCacheSize * 100),
      };
    } catch (error) {
      return {
        error: error.message,
      };
    }
  }

  /**
   * Clear entire cache
   */
  async clear() {
    try {
      const entries = await this.model.findAll();

      for (const entry of entries) {
        try {
          await fs.unlink(entry.file_path);
        } catch {
          // File may not exist
        }
        await this.model.delete(entry.id);
      }

      logger.info(`Cleared all cache entries (${entries.length})`);
      return entries.length;
    } catch (error) {
      logger.error(`Cache clear error: ${error.message}`);
      return 0;
    }
  }
}

export default WidgetCache;
