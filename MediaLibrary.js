/**
 * MediaLibrary - Manages media assets (images, videos)
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import logger from './utils/Logger.js';

const MEDIA_DIR = `${process.env.DATA_DIR || '/app/data'}/slidecast/media`;

class MediaLibrary {
  constructor(api) {
    this.api = api;
    this.model = null;
  }

  async init() {
    this.model = this.api.model('slidecast_media');

    // Ensure directories exist
    await fs.mkdir(path.join(MEDIA_DIR, 'images'), { recursive: true });
    await fs.mkdir(path.join(MEDIA_DIR, 'videos'), { recursive: true });
    await fs.mkdir(path.join(MEDIA_DIR, 'thumbnails'), { recursive: true });
  }

  /**
   * Get all media
   */
  async getAll() {
    const media = await this.model.findAll();
    return media.map((m) => this.formatMedia(m));
  }

  /**
   * Get media by UUID
   */
  async getById(uuid) {
    const results = await this.model.findAll({ where: { uuid } });
    return results && results.length > 0 ? this.formatMedia(results[0]) : null;
  }

  /**
   * Get media by database ID
   */
  async getByDbId(id) {
    const media = await this.model.findById(id);
    return media ? this.formatMedia(media) : null;
  }

  /**
   * Get media by checksum (for deduplication)
   * @param {string} checksum - SHA256 checksum (without prefix)
   * @returns {Object|null} Media object or null
   */
  async getByChecksum(checksum) {
    // Normalize checksum (remove sha256: prefix if present)
    const normalizedChecksum = checksum.replace('sha256:', '');

    const results = await this.model.findAll({ where: { checksum: normalizedChecksum } });
    return results && results.length > 0 ? this.formatMedia(results[0]) : null;
  }

  /**
   * Detect image dimensions from a buffer using sharp (existing slidecast
   * dependency — also used by SlideImageRenderer/SpriteSheetGenerator).
   *
   * Only runs for type === 'image'. Never throws: dimension detection is
   * best-effort and an undecodable image falls back to null/null so the
   * upload still succeeds (previous behavior).
   *
   * @param {Buffer} buffer - File contents
   * @param {string} type - Media type ('image' | 'video' | ...)
   * @returns {Promise<{width: number|null, height: number|null}>}
   */
  async getImageDimensions(buffer, type) {
    if (type !== 'image' || !buffer) {
      return { width: null, height: null };
    }
    try {
      // Lazy import: sharp is a native module — don't pay the load cost
      // (or crash) on code paths that never touch images.
      const { default: sharp } = await import('sharp');
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width ?? null,
        height: metadata.height ?? null,
      };
    } catch (error) {
      logger.warn(`Failed to detect image dimensions: ${error.message}`);
      return { width: null, height: null };
    }
  }

  /**
   * Create media from file upload
   */
  async createFromFile(file) {
    const uuid = uuidv4();
    const type = this.getMediaType(file.mimetype);
    const ext = path.extname(file.originalname) || this.getExtension(file.mimetype);
    const fileName = `${uuid}${ext}`;
    const subDir = type === 'video' ? 'videos' : 'images';
    const filePath = path.join(MEDIA_DIR, subDir, fileName);

    // Move uploaded file
    await fs.rename(file.path, filePath);

    // Calculate checksum
    const fileBuffer = await fs.readFile(filePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Get dimensions (for images)
    const { width, height } = await this.getImageDimensions(fileBuffer, type);

    // Model API returns the full record
    const media = await this.model.create({
      uuid,
      name: file.originalname,
      type,
      mime_type: file.mimetype,
      file_path: filePath,
      file_size: file.size,
      checksum,
      width,
      height,
      duration: null,
      thumbnail: null,
    });

    return this.formatMedia(media);
  }

  /**
   * Create media from uploaded file (multipart form upload)
   * @param {Object} file - Multer file object with path, originalname, mimetype, size
   */
  async createFromUpload(file) {
    // Handles BOTH multer storage engines. The slidecast media-upload route
    // now uses route-scoped DISK storage (SL2), so `file.path` is set and the
    // disk branch below runs. The buffer branch remains for callers that pass
    // an in-memory file (e.g. memoryStorage or programmatic uploads).
    if (file.buffer) {
      return this.createFromBuffer(file.buffer, file.originalname, file.mimetype);
    }

    const uuid = uuidv4();
    const type = this.getMediaType(file.mimetype);
    const ext = path.extname(file.originalname) || this.getExtension(file.mimetype);
    const fileName = `${uuid}${ext}`;
    const subDir = type === 'video' ? 'videos' : 'images';
    const destPath = path.join(MEDIA_DIR, subDir, fileName);

    // Copy file from temp to media dir, then delete temp (rename fails across filesystems)
    await fs.copyFile(file.path, destPath);
    await fs.unlink(file.path).catch(() => {}); // Clean up temp file

    // Calculate checksum
    const buffer = await fs.readFile(destPath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Get dimensions (for images)
    const { width, height } = await this.getImageDimensions(buffer, type);

    // Model API returns the full record
    const media = await this.model.create({
      uuid,
      name: file.originalname,
      type,
      mime_type: file.mimetype,
      file_path: destPath,
      file_size: file.size,
      checksum,
      width,
      height,
      duration: null,
      thumbnail: null,
    });

    return this.formatMedia(media);
  }

  /**
   * Create media from buffer (for cast import)
   * @param {Buffer} buffer - File buffer
   * @param {string} name - Original filename
   * @param {string} mimeType - MIME type
   * @returns {Object} Created media object
   */
  async createFromBuffer(buffer, name, mimeType) {
    const uuid = uuidv4();
    const type = this.getMediaType(mimeType);
    const ext = this.getExtension(mimeType) || path.extname(name) || '.bin';
    const fileName = `${uuid}${ext}`;
    const subDir = type === 'video' ? 'videos' : 'images';
    const filePath = path.join(MEDIA_DIR, subDir, fileName);

    // Save to disk
    await fs.writeFile(filePath, buffer);

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Get dimensions (for images)
    const { width, height } = await this.getImageDimensions(buffer, type);

    // Create database entry
    const media = await this.model.create({
      uuid,
      name: name || `Imported ${new Date().toISOString()}`,
      type,
      mime_type: mimeType,
      file_path: filePath,
      file_size: buffer.length,
      checksum,
      width,
      height,
      duration: null,
      thumbnail: null,
    });

    return this.formatMedia(media);
  }

  /**
   * Create media from base64 data (clipboard paste)
   */
  async createFromBase64(name, base64Data, mimeType) {
    const uuid = uuidv4();
    const type = this.getMediaType(mimeType);
    const ext = this.getExtension(mimeType);
    const fileName = `${uuid}${ext}`;
    const subDir = type === 'video' ? 'videos' : 'images';
    const filePath = path.join(MEDIA_DIR, subDir, fileName);

    // Decode base64 and save
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filePath, buffer);

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Get dimensions (for images)
    const { width, height } = await this.getImageDimensions(buffer, type);

    // Model API returns the full record
    const media = await this.model.create({
      uuid,
      name: name || `Pasted ${new Date().toISOString()}`,
      type,
      mime_type: mimeType,
      file_path: filePath,
      file_size: buffer.length,
      checksum,
      width,
      height,
      duration: null,
      thumbnail: null,
    });

    return this.formatMedia(media);
  }

  /**
   * Create media from URL (download and save)
   */
  async createFromUrl(url, customName = null) {
    const uuid = uuidv4();

    // Fetch the file from URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    const type = this.getMediaType(contentType);
    const ext = this.getExtension(contentType) || this.getExtFromUrl(url);
    const fileName = `${uuid}${ext}`;
    const subDir = type === 'video' ? 'videos' : 'images';
    const filePath = path.join(MEDIA_DIR, subDir, fileName);

    // Save to disk
    await fs.writeFile(filePath, buffer);

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Extract filename from URL if no custom name provided
    const name = customName || this.getNameFromUrl(url) || `Downloaded ${new Date().toISOString()}`;

    // Get dimensions (for images)
    const { width, height } = await this.getImageDimensions(buffer, type);

    const media = await this.model.create({
      uuid,
      name,
      type,
      mime_type: contentType,
      file_path: filePath,
      file_size: buffer.length,
      checksum,
      width,
      height,
      duration: null,
      thumbnail: null,
    });

    return this.formatMedia(media);
  }

  /**
   * Extract extension from URL
   */
  getExtFromUrl(url) {
    try {
      const { pathname } = new URL(url);
      const ext = path.extname(pathname);
      return ext || '.mp4';
    } catch {
      return '.mp4';
    }
  }

  /**
   * Extract filename from URL
   */
  getNameFromUrl(url) {
    try {
      const { pathname } = new URL(url);
      const basename = path.basename(pathname);
      return basename || null;
    } catch {
      return null;
    }
  }

  /**
   * Delete media
   */
  async delete(uuid) {
    const media = await this.getById(uuid);
    if (!media) return false;

    // Delete file
    try {
      await fs.unlink(media.file_path);
    } catch (error) {
      logger.warn(`Failed to delete file: ${error.message}`);
    }

    // Delete thumbnail if exists
    if (media.thumbnail) {
      try {
        await fs.unlink(media.thumbnail);
      } catch (error) {
        // Ignore thumbnail deletion errors
      }
    }

    // Get the record by uuid to find the db id
    const results = await this.model.findAll({ where: { uuid } });
    if (results && results.length > 0) {
      await this.model.delete(results[0].id);
    }

    return true;
  }

  /**
   * Get file path for serving
   */
  async getFilePath(uuid) {
    const media = await this.getById(uuid);
    return media ? media.file_path : null;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    const media = await this.getAll();

    let totalSize = 0;
    let imageCount = 0;
    let videoCount = 0;

    for (const m of media) {
      totalSize += m.file_size || 0;
      if (m.type === 'image') imageCount++;
      if (m.type === 'video') videoCount++;
    }

    // Get settings for limits
    const settingsModel = this.api.model('slidecast_settings');
    const maxStorageSetting = await settingsModel.findAll({
      where: { key: 'media_max_total_storage' },
    });
    const maxStorage = maxStorageSetting?.[0]?.value
      ? parseInt(maxStorageSetting[0].value, 10)
      : 1073741824; // 1GB default

    return {
      totalSize,
      maxStorage,
      usedPercent: Math.round((totalSize / maxStorage) * 100),
      imageCount,
      videoCount,
      totalCount: media.length,
    };
  }

  /**
   * Get assets referenced in a cast definition
   */
  async getAssetsForCast(definition) {
    const def = typeof definition === 'string' ? JSON.parse(definition) : definition;
    const assetIds = new Set();

    // Collect all asset IDs from slides
    if (def.slides) {
      for (const slide of def.slides) {
        if (slide.elements) {
          for (const el of slide.elements) {
            if (el.asset_id) {
              assetIds.add(el.asset_id);
            }
          }
        }
      }
    }

    // Get asset details
    const assets = [];
    for (const uuid of assetIds) {
      const media = await this.getById(uuid);
      if (media) {
        assets.push({
          id: media.uuid,
          url: `/api/extensions/slidecast/protocol/asset/${media.uuid}`,
          type: media.type,
          mime: media.mime_type,
          size: media.file_size,
          checksum: media.checksum,
        });
      }
    }

    return assets;
  }

  /**
   * Determine media type from MIME type
   */
  getMediaType(mimeType) {
    if (mimeType.startsWith('video/')) return 'video';
    return 'image';
  }

  /**
   * Get file extension from MIME type
   */
  getExtension(mimeType) {
    const extensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
    };
    return extensions[mimeType] || '.bin';
  }

  /**
   * Format media for response
   */
  formatMedia(media) {
    return {
      id: media.id,
      uuid: media.uuid,
      name: media.name,
      type: media.type,
      mime_type: media.mime_type,
      file_path: media.file_path,
      file_size: media.file_size,
      checksum: media.checksum,
      width: media.width,
      height: media.height,
      duration: media.duration,
      thumbnail: media.thumbnail,
      created_at: media.created_at,
      // URL for accessing the media
      url: `/api/extensions/slidecast/protocol/asset/${media.uuid}`,
    };
  }
}

export default MediaLibrary;
