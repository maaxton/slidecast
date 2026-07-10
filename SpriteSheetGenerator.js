/**
 * SpriteSheetGenerator - Generate animated widget sprite sheets
 *
 * Creates sprite sheets from animated widgets for efficient Roku playback.
 * Instead of swapping individual images, Roku can animate by moving sprite sheet position.
 *
 * Pi-safe constraints:
 * - Max 12 frames (configurable)
 * - 12fps default (configurable)
 * - Max 2048x2048 sprite sheet
 * - Idle-only generation (when no renders in progress)
 * - Always provides static fallback
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import logger from './utils/Logger.js';

class SpriteSheetGenerator {
  constructor(api, options = {}) {
    this.api = api;

    // Dependencies (injected)
    this.widgetRegistry = options.widgetRegistry;
    this.widgetRuntime = options.widgetRuntime;
    this.widgetImageRenderer = options.widgetImageRenderer;
    this.widgetCache = options.widgetCache;
    this.renderTracker = options.renderTracker;

    // Settings (Pi-safe defaults)
    this.maxFrames = options.maxFrames || 12;
    this.defaultFps = options.defaultFps || 12;
    this.maxSheetSize = options.maxSheetSize || 2048;
    this.idleOnly = options.idleOnly !== false; // Default true
    this.cacheDays = options.cacheDays || 30;

    // Storage directory
    this.dataDir = options.dataDir || '/app/data';
    this.spriteDir = path.join(this.dataDir, 'slidecast', 'widget-sprites');

    // Generation queue
    this.generating = new Map(); // widgetKey -> Promise
  }

  async init() {
    // Ensure sprite directory exists
    if (!existsSync(this.spriteDir)) {
      mkdirSync(this.spriteDir, { recursive: true });
    }
    logger.info(`SpriteSheetGenerator initialized - max ${this.maxFrames} frames at ${this.defaultFps}fps`);
  }

  /**
   * Generate a sprite key for caching
   */
  getSpriteKey(widgetUuid, config, styles, size) {
    const data = JSON.stringify({
      widgetUuid, config, styles, size,
    });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Get sprite sheet metadata if cached
   * @returns {Object|null} Sprite metadata or null if not cached
   */
  async getCachedSprite(widgetUuid, config, styles, size) {
    const spriteKey = this.getSpriteKey(widgetUuid, config, styles, size);
    const metadataPath = path.join(this.spriteDir, `${spriteKey}.json`);
    const sheetPath = path.join(this.spriteDir, `${spriteKey}.png`);

    try {
      // Check if both files exist
      if (!existsSync(metadataPath) || !existsSync(sheetPath)) {
        return null;
      }

      // Load and validate metadata
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataJson);

      // Check if expired
      const expiresAt = new Date(metadata.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        // Expired - delete and return null
        await this.deleteCachedSprite(spriteKey);
        return null;
      }

      return metadata;
    } catch (e) {
      return null;
    }
  }

  /**
   * Delete cached sprite
   */
  async deleteCachedSprite(spriteKey) {
    try {
      await fs.unlink(path.join(this.spriteDir, `${spriteKey}.json`)).catch(() => {});
      await fs.unlink(path.join(this.spriteDir, `${spriteKey}.png`)).catch(() => {});
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Check if we can generate now (idle-only mode)
   */
  canGenerate() {
    if (!this.idleOnly) return true;

    // Check if any renders are in progress
    if (this.renderTracker && !this.renderTracker.canStartRender()) {
      return false;
    }

    return true;
  }

  /**
   * Generate a sprite sheet for an animated widget
   * @param {string} widgetUuid - Widget UUID
   * @param {Object} config - Widget configuration
   * @param {Object} styles - Widget styles
   * @param {Object} size - { width, height } for each frame
   * @param {Object} options - { fps, frameCount, loopMode }
   * @returns {Object} Sprite metadata
   */
  async generate(widgetUuid, config, styles, size, options = {}) {
    const spriteKey = this.getSpriteKey(widgetUuid, config, styles, size);

    // Check if already generating
    if (this.generating.has(spriteKey)) {
      return this.generating.get(spriteKey);
    }

    // Check cache first
    const cached = await this.getCachedSprite(widgetUuid, config, styles, size);
    if (cached) {
      return cached;
    }

    // Check if we can generate now
    if (!this.canGenerate()) {
      return {
        type: 'sprite',
        status: 'busy',
        reason: 'Server busy with renders',
        fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
        retryAfter: 10,
      };
    }

    // Start generation
    const generatePromise = this._doGenerate(widgetUuid, config, styles, size, options, spriteKey);
    this.generating.set(spriteKey, generatePromise);

    try {
      const result = await generatePromise;
      return result;
    } finally {
      this.generating.delete(spriteKey);
    }
  }

  /**
   * Internal generation method
   */
  async _doGenerate(widgetUuid, config, styles, size, options, spriteKey) {
    const frameCount = Math.min(options.frameCount || this.maxFrames, this.maxFrames);
    const fps = options.fps || this.defaultFps;
    const loopMode = options.loopMode || 'loop';

    const frameWidth = size.width || 200;
    const frameHeight = size.height || 200;

    // Calculate sprite sheet layout (horizontal strip)
    // If too wide, use multiple rows
    let cols = frameCount;
    let rows = 1;

    if (frameWidth * frameCount > this.maxSheetSize) {
      cols = Math.floor(this.maxSheetSize / frameWidth);
      rows = Math.ceil(frameCount / cols);
    }

    const sheetWidth = Math.min(frameWidth * cols, this.maxSheetSize);
    const sheetHeight = frameHeight * rows;

    // Validate dimensions
    if (sheetWidth > this.maxSheetSize || sheetHeight > this.maxSheetSize) {
      return {
        type: 'sprite',
        status: 'error',
        error: `Sprite sheet too large: ${sheetWidth}x${sheetHeight} exceeds ${this.maxSheetSize}x${this.maxSheetSize}`,
        fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
      };
    }

    logger.info(`Generating sprite: ${widgetUuid} - ${frameCount} frames at ${frameWidth}x${frameHeight}`);

    try {
      // Get widget definition
      const widget = await this.widgetRegistry.getByUuid(widgetUuid);
      if (!widget) {
        return {
          type: 'sprite',
          status: 'error',
          error: 'Widget not found',
          fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
        };
      }

      // Lazy load Sharp
      const sharp = (await import('sharp')).default;

      // Render each frame with animation context
      const frameBuffers = [];
      const frameOffsets = [];

      for (let frame = 0; frame < frameCount; frame++) {
        const progress = frame / frameCount;
        const timeMs = (frame / fps) * 1000;

        // Create animation context
        const animationContext = {
          frame,
          frameCount,
          progress,
          time: timeMs,
        };

        // Execute widget with animation context
        const renderResult = await this.widgetRuntime.execute(
          widget,
          config,
          styles,
          `sprite-${spriteKey}-${frame}`,
          { animation: animationContext },
        );

        if (!renderResult.success || !renderResult.primitives) {
          logger.warn(`Frame ${frame} render failed: ${renderResult.error}`);
          continue;
        }

        // Render primitives to PNG
        const frameBuffer = await this.widgetImageRenderer.renderToImage(
          renderResult.primitives,
          { width: frameWidth, height: frameHeight },
          'png',
        );

        if (frameBuffer) {
          frameBuffers.push(frameBuffer);

          // Calculate position in sprite sheet
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          frameOffsets.push([col * frameWidth, row * frameHeight]);
        }
      }

      if (frameBuffers.length === 0) {
        return {
          type: 'sprite',
          status: 'error',
          error: 'No frames rendered successfully',
          fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
        };
      }

      // Composite all frames into sprite sheet
      const compositeOperations = frameBuffers.map((buffer, i) => ({
        input: buffer,
        left: frameOffsets[i][0],
        top: frameOffsets[i][1],
      }));

      const spriteBuffer = await sharp({
        create: {
          width: sheetWidth,
          height: sheetHeight,
          channels: 4,
          background: {
            r: 0, g: 0, b: 0, alpha: 0,
          },
        },
      })
        .composite(compositeOperations)
        .png()
        .toBuffer();

      // Save sprite sheet
      const sheetPath = path.join(this.spriteDir, `${spriteKey}.png`);
      await fs.writeFile(sheetPath, spriteBuffer);

      // Build metadata
      const metadata = {
        type: 'sprite',
        status: 'ready',
        spriteKey,
        sheetUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/sprite/${spriteKey}.png`,
        fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
        frameWidth,
        frameHeight,
        frameCount: frameBuffers.length,
        fps,
        cols,
        rows,
        sheetWidth,
        sheetHeight,
        frameOffsets,
        loopMode,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.cacheDays * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Save metadata
      const metadataPath = path.join(this.spriteDir, `${spriteKey}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      logger.info(`Sprite generated: ${widgetUuid} - ${frameBuffers.length} frames, ${sheetWidth}x${sheetHeight}`);

      return metadata;
    } catch (error) {
      logger.error(`Sprite generation failed: ${error.message}`);
      return {
        type: 'sprite',
        status: 'error',
        error: error.message,
        fallbackUrl: `/api/extensions/slidecast/protocol/widget/${widgetUuid}/image.png`,
      };
    }
  }

  /**
   * Get sprite sheet PNG file path
   */
  getSpriteSheetPath(spriteKey) {
    return path.join(this.spriteDir, `${spriteKey}.png`);
  }

  /**
   * Check if sprite sheet file exists
   */
  spriteExists(spriteKey) {
    return existsSync(this.getSpriteSheetPath(spriteKey));
  }

  /**
   * Cleanup old sprite sheets
   */
  async cleanup() {
    try {
      const files = await fs.readdir(this.spriteDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const metadataPath = path.join(this.spriteDir, file);
          const metadataJson = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataJson);

          const expiresAt = new Date(metadata.expiresAt).getTime();
          if (now > expiresAt) {
            const spriteKey = file.replace('.json', '');
            await this.deleteCachedSprite(spriteKey);
            cleaned++;
          }
        } catch (e) {
          // Skip invalid files
        }
      }

      if (cleaned > 0) {
        logger.info(`Sprite cleanup: removed ${cleaned} expired sprites`);
      }

      return { cleaned };
    } catch (error) {
      logger.error(`Sprite cleanup error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get stats for diagnostics
   */
  async getStats() {
    try {
      const files = await fs.readdir(this.spriteDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const pngFiles = files.filter((f) => f.endsWith('.png'));

      let totalSize = 0;
      for (const file of pngFiles) {
        const stat = await fs.stat(path.join(this.spriteDir, file));
        totalSize += stat.size;
      }

      return {
        spriteCount: jsonFiles.length,
        generating: this.generating.size,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        maxFrames: this.maxFrames,
        defaultFps: this.defaultFps,
        idleOnly: this.idleOnly,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

export default SpriteSheetGenerator;
