/**
 * CastExporter - Export casts as .cast files (ZIP archives)
 *
 * Export format:
 * mycast.cast (ZIP)
 * ├── manifest.json       - Metadata, media list, widget dependencies
 * ├── definition.json     - Cast definition with original UUIDs
 * ├── media/              - Media files with original names
 * │   ├── tech-background.jpg
 * │   └── corporate-video.mp4
 * ├── widgets/            - Custom widgets (optional)
 * │   └── my-custom-widget/
 * │       ├── widget.json
 * │       └── ...
 * └── cache/              - Pre-rendered slide layers (optional)
 *     └── 0/
 *         ├── layers.json
 *         ├── layer-0.png
 *         └── ...
 */

import JSZip from 'jszip';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import crypto from 'crypto';
import logger from './utils/Logger.js';

class CastExporter {
  constructor(api, castManager, mediaLibrary, widgetRegistry, options = {}) {
    this.api = api;
    this.castManager = castManager;
    this.mediaLibrary = mediaLibrary;
    this.widgetRegistry = widgetRegistry;
    this.dataDir = options.dataDir || '/app/data';
    this.renderDir = path.join(this.dataDir, 'slidecast', 'slide-renders');
  }

  /**
   * Export a cast as a .cast ZIP file
   * @param {string|number} castId - Cast ID or UUID
   * @param {Object} options - Export options
   * @param {boolean} options.includeMedia - Include media files (default: true)
   * @param {boolean} options.includeCustomWidgets - Include custom widget definitions (default: true)
   * @param {boolean} options.includeCache - Include pre-rendered slide cache (default: false)
   * @returns {Buffer} ZIP file buffer
   */
  async export(castId, options = {}) {
    const { includeMedia = true, includeCustomWidgets = true, includeCache = false } = options;

    // Get the cast
    const cast = typeof castId === 'string' && castId.includes('-')
      ? await this.castManager.getByUuid(castId)
      : await this.castManager.getById(castId);

    if (!cast) {
      throw new Error(`Cast not found: ${castId}`);
    }

    logger.info(`Exporting cast: ${cast.name}`);

    // Parse definition
    const definition = typeof cast.definition === 'string'
      ? JSON.parse(cast.definition)
      : cast.definition;

    // Gather media
    const mediaRefs = await this.gatherMedia(definition);

    // Gather widgets
    const widgetRefs = await this.gatherWidgets(definition);

    // Gather cache info if requested
    const cacheInfo = includeCache ? await this.gatherCache(cast.uuid) : null;

    // Create manifest
    const manifest = await this.createManifest(cast, mediaRefs, widgetRefs, cacheInfo, {
      includeMedia,
      includeCustomWidgets,
      includeCache,
    });

    // Create ZIP archive
    const zipBuffer = await this.createZipArchive(cast, definition, mediaRefs, widgetRefs, cacheInfo, manifest, {
      includeMedia,
      includeCustomWidgets,
      includeCache,
    });

    logger.info(`Export complete: ${cast.name} (${(zipBuffer.length / 1024).toFixed(1)} KB)`);

    return zipBuffer;
  }

  /**
   * Gather all media references from a cast definition
   * @param {Object} definition - Cast definition
   * @returns {Array} Media reference objects with uuid, details, and file info
   */
  async gatherMedia(definition) {
    const mediaUuids = new Set();

    // Helper to extract from elements
    const extractFromElements = (elements) => {
      if (!elements) return;
      for (const el of elements) {
        if (el.asset_id) {
          mediaUuids.add(el.asset_id);
        }
        // Check for background images in style
        if (el.style?.backgroundImage) {
          const match = el.style.backgroundImage.match(/asset\/([a-f0-9-]+)/);
          if (match) mediaUuids.add(match[1]);
        }
      }
    };

    // Extract from groups (new format)
    if (definition.groups) {
      for (const group of definition.groups) {
        if (group.slides) {
          for (const slide of group.slides) {
            extractFromElements(slide.elements);
          }
        }
      }
    }

    // Extract from slides (legacy format)
    if (definition.slides) {
      for (const slide of definition.slides) {
        extractFromElements(slide.elements);
      }
    }

    // Get full media details
    const mediaRefs = [];
    for (const uuid of mediaUuids) {
      const media = await this.mediaLibrary.getById(uuid);
      if (media) {
        // Calculate checksum if not present
        let { checksum } = media;
        if (!checksum && media.file_path) {
          try {
            const buffer = await fs.readFile(media.file_path);
            checksum = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
          } catch (err) {
            logger.warn(`Failed to read media file: ${err.message}`);
          }
        } else if (checksum && !checksum.startsWith('sha256:')) {
          checksum = `sha256:${checksum}`;
        }

        // Determine filename: use name if it has extension, otherwise add extension from file_path
        let filename = media.name || `${media.uuid}${path.extname(media.file_path || '')}`;
        // If filename doesn't have extension but file_path does, add it
        if (!path.extname(filename) && media.file_path && path.extname(media.file_path)) {
          filename += path.extname(media.file_path);
        }

        mediaRefs.push({
          uuid: media.uuid,
          filename,
          originalName: media.name,
          type: media.type,
          mimeType: media.mime_type,
          size: media.file_size,
          checksum,
          filePath: media.file_path,
        });
      } else {
        logger.warn(`Media not found: ${uuid}`);
      }
    }

    return mediaRefs;
  }

  /**
   * Gather all widget references from a cast definition
   * @param {Object} definition - Cast definition
   * @returns {Array} Widget reference objects
   */
  async gatherWidgets(definition) {
    const widgetUuids = new Set();

    // Helper to extract from elements
    const extractFromElements = (elements) => {
      if (!elements) return;
      for (const el of elements) {
        if (el.type === 'widget' && el.widgetUuid) {
          widgetUuids.add(el.widgetUuid);
        }
      }
    };

    // Extract from groups (new format)
    if (definition.groups) {
      for (const group of definition.groups) {
        if (group.slides) {
          for (const slide of group.slides) {
            extractFromElements(slide.elements);
          }
        }
      }
    }

    // Extract from slides (legacy format)
    if (definition.slides) {
      for (const slide of definition.slides) {
        extractFromElements(slide.elements);
      }
    }

    // Get full widget details
    const widgetRefs = [];
    for (const uuid of widgetUuids) {
      const widget = await this.widgetRegistry.getByUuid(uuid);
      if (widget) {
        widgetRefs.push({
          uuid: widget.uuid,
          name: widget.name,
          isSystem: widget.isSystem,
          category: widget.category,
          version: widget.currentVersion || 1,
        });
      } else {
        logger.warn(`Widget not found: ${uuid}`);
      }
    }

    return widgetRefs;
  }

  /**
   * Gather cache (pre-rendered slide layers) for export
   * @param {string} castUuid - Cast UUID
   * @returns {Object|null} Cache info with slide data
   */
  async gatherCache(castUuid) {
    const cacheDir = path.join(this.renderDir, castUuid);

    if (!existsSync(cacheDir)) {
      logger.debug(`No cache found for cast ${castUuid}`);
      return null;
    }

    const slides = [];
    let totalSize = 0;

    try {
      const slideDirs = readdirSync(cacheDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

      for (const slideDir of slideDirs) {
        const slideIndex = parseInt(slideDir, 10);
        const slidePath = path.join(cacheDir, slideDir);
        const metadataPath = path.join(slidePath, 'layers.json');

        if (!existsSync(metadataPath)) {
          continue;
        }

        // Read metadata
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

        // Get all files in this slide directory
        const files = readdirSync(slidePath);
        const slideFiles = [];

        for (const file of files) {
          const filePath = path.join(slidePath, file);
          const stat = await fs.stat(filePath);
          slideFiles.push({
            filename: file,
            size: stat.size,
          });
          totalSize += stat.size;
        }

        slides.push({
          index: slideIndex,
          files: slideFiles,
          metadata,
        });
      }

      logger.info(`Cache gathered: ${slides.length} slides, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

      return {
        slides,
        totalSize,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.warn(`Failed to gather cache: ${err.message}`);
      return null;
    }
  }

  /**
   * Create the manifest.json for the export
   * @param {Object} cast - Cast object
   * @param {Array} mediaRefs - Media references
   * @param {Array} widgetRefs - Widget references
   * @param {Object|null} cacheInfo - Cache info
   * @param {Object} options - Export options
   * @returns {Object} Manifest object
   */
  async createManifest(cast, mediaRefs, widgetRefs, cacheInfo, options) {
    const { includeMedia, includeCustomWidgets, includeCache } = options;

    // Build media manifest entries
    const mediaManifest = mediaRefs.map((m) => ({
      uuid: m.uuid,
      filename: m.filename,
      originalName: m.originalName,
      type: m.type,
      mimeType: m.mimeType,
      size: m.size,
      checksum: m.checksum,
    }));

    // Build widget dependencies
    const widgetDeps = widgetRefs.map((w) => ({
      uuid: w.uuid,
      name: w.name,
      isSystem: w.isSystem,
      version: w.version,
      // Only include custom widgets if option is enabled
      included: !w.isSystem && includeCustomWidgets,
    }));

    // Build cache info
    const cacheManifest = includeCache && cacheInfo ? {
      slides: cacheInfo.slides.map((s) => ({
        index: s.index,
        files: s.files.map((f) => f.filename),
        generatedAt: s.metadata?.generatedAt,
      })),
      totalSize: cacheInfo.totalSize,
    } : null;

    return {
      format: 'waiveo-cast',
      formatVersion: '1.1', // Bump version for cache support
      exportedAt: new Date().toISOString(),
      cast: {
        name: cast.name,
        uuid: cast.uuid,
        description: cast.description || '',
      },
      media: includeMedia ? mediaManifest : [],
      dependencies: {
        widgets: widgetDeps,
      },
      cache: cacheManifest,
      options: {
        mediaIncluded: includeMedia,
        customWidgetsIncluded: includeCustomWidgets,
        cacheIncluded: includeCache && cacheInfo !== null,
      },
    };
  }

  /**
   * Create the ZIP archive
   * @param {Object} cast - Cast object
   * @param {Object} definition - Parsed cast definition
   * @param {Array} mediaRefs - Media references
   * @param {Array} widgetRefs - Widget references
   * @param {Object|null} cacheInfo - Cache info
   * @param {Object} manifest - Manifest object
   * @param {Object} options - Export options
   * @returns {Buffer} ZIP file buffer
   */
  async createZipArchive(cast, definition, mediaRefs, widgetRefs, cacheInfo, manifest, options) {
    const { includeMedia, includeCustomWidgets, includeCache } = options;
    const zip = new JSZip();

    // Add manifest.json
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Add definition.json (the actual cast definition)
    zip.file('definition.json', JSON.stringify(definition, null, 2));

    // Add media files
    if (includeMedia && mediaRefs.length > 0) {
      const mediaFolder = zip.folder('media');

      for (const media of mediaRefs) {
        if (media.filePath) {
          try {
            const buffer = await fs.readFile(media.filePath);
            mediaFolder.file(media.filename, buffer);
          } catch (err) {
            logger.warn(`Failed to include media ${media.filename}: ${err.message}`);
          }
        }
      }
    }

    // Add custom widgets
    if (includeCustomWidgets) {
      const customWidgets = widgetRefs.filter((w) => !w.isSystem);

      if (customWidgets.length > 0) {
        const widgetsFolder = zip.folder('widgets');

        for (const widgetRef of customWidgets) {
          try {
            const widgetData = await this.widgetRegistry.export(widgetRef.uuid, {
              includeDbData: false, // Don't include DB data in cast exports
            });

            if (widgetData) {
              const widgetFolder = widgetsFolder.folder(widgetRef.uuid);

              // Add widget.json (manifest)
              widgetFolder.file('widget.json', JSON.stringify(widgetData.manifest, null, 2));

              // Add code files
              for (const [filename, content] of Object.entries(widgetData.files)) {
                if (content) {
                  widgetFolder.file(filename, content);
                }
              }

              // Add assets
              if (widgetData.assets) {
                const assetsFolder = widgetFolder.folder('assets');
                for (const asset of widgetData.assets) {
                  if (asset.data) {
                    assetsFolder.file(asset.filename, asset.data);
                  }
                }
              }
            }
          } catch (err) {
            logger.warn(`Failed to export widget ${widgetRef.name}: ${err.message}`);
          }
        }
      }
    }

    // Add cache (pre-rendered slides)
    if (includeCache && cacheInfo && cacheInfo.slides.length > 0) {
      const cacheFolder = zip.folder('cache');
      const cacheDir = path.join(this.renderDir, cast.uuid);

      for (const slide of cacheInfo.slides) {
        const slideFolder = cacheFolder.folder(String(slide.index));
        const slidePath = path.join(cacheDir, String(slide.index));

        for (const file of slide.files) {
          try {
            const buffer = await fs.readFile(path.join(slidePath, file.filename));
            slideFolder.file(file.filename, buffer);
          } catch (err) {
            logger.warn(`Failed to include cache file ${file.filename}: ${err.message}`);
          }
        }
      }

      logger.debug(`Added cache: ${cacheInfo.slides.length} slides`);
    }

    // Generate ZIP buffer
    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }
}

export default CastExporter;
