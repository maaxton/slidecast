/**
 * WidgetImageRenderer - Server-side rendering of widgets to images
 * Uses Satori (HTML to SVG) + Sharp (SVG to PNG/JPEG)
 *
 * This is a lightweight alternative to Puppeteer (~20MB vs ~400MB)
 * Satori is developed by Vercel and used for OG image generation.
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import logger from '../utils/Logger.js';
import { NATIVE_FONTS, GOOGLE_FONTS_URL } from './WidgetFonts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-load satori and sharp to avoid startup cost
let satori = null;
let sharp = null;
let fontsLoaded = false;
let fontBuffers = {};

class WidgetImageRenderer {
  constructor(api) {
    this.api = api;
    this.renderDir = `${process.env.DATA_DIR || '/app/data'}/slidecast/widget-renders`;
    this.fontsDir = `${process.env.DATA_DIR || '/app/data'}/slidecast/fonts`;
    this.isInitialized = false;
  }

  async init() {
    // Create directories
    try {
      await fs.mkdir(this.renderDir, { recursive: true });
      await fs.mkdir(this.fontsDir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create widget directories: ${error.message}`);
      throw error;
    }

    // Verify native dependencies are available
    try {
      await import('satori');
      await import('sharp');
    } catch (e) {
      logger.error('Widget rendering dependencies not available:', e.message);
      if (this.api?.reportDegraded) this.api.reportDegraded('Widget image rendering unavailable');
    }

    this.isInitialized = true;
    logger.info('WidgetImageRenderer initialized (Satori + Sharp)');
  }

  /**
   * Lazy-load Satori and Sharp
   */
  async loadDependencies() {
    if (!satori) {
      try {
        const satoriModule = await import('satori');
        satori = satoriModule.default;
        logger.info('Satori loaded successfully');
      } catch (error) {
        logger.error(`Failed to load Satori: ${error.message}`);
        throw new Error('Image rendering not available - Satori failed to load');
      }
    }

    if (!sharp) {
      try {
        const sharpModule = await import('sharp');
        sharp = sharpModule.default;
        logger.info('Sharp loaded successfully');
      } catch (error) {
        logger.error(`Failed to load Sharp: ${error.message}`);
        throw new Error('Image rendering not available - Sharp failed to load');
      }
    }
  }

  /**
   * Load font files for Satori
   * Satori requires font buffers, not system fonts
   */
  async loadFonts() {
    if (fontsLoaded) return;

    // SL4: point Satori at the 9 REAL bundled font files. The old list named 27
    // per-weight files (Inter-Regular.ttf, Roboto-Medium.ttf, …) that do not
    // exist — every read threw, fontBuffers stayed empty, and Satori fell back
    // to a gstatic download (fails offline) → every widget rendered Inter-400.
    //
    // Each family actually ships as ONE .ttf (single source of truth = the
    // FONT_FACE_DECLARATIONS table in routes/protocol.js). Variable fonts cover
    // the whole 100–900 axis; static ones rely on faux-bold. We register the
    // same buffer under several weights so Satori (which picks the nearest
    // registered weight) can satisfy any requested fontWeight.
    const bundledFonts = [
      { name: 'Inter', file: 'Inter.ttf', weights: [400, 500, 600, 700] },
      { name: 'Roboto', file: 'Roboto.ttf', weights: [400, 500, 700] },
      { name: 'Open Sans', file: 'OpenSans.ttf', weights: [400, 600, 700] },
      { name: 'Montserrat', file: 'Montserrat.ttf', weights: [400, 500, 600, 700] },
      { name: 'Oswald', file: 'Oswald.ttf', weights: [400, 500, 600, 700] },
      { name: 'Playfair Display', file: 'PlayfairDisplay.ttf', weights: [400, 700] },
      { name: 'Roboto Mono', file: 'RobotoMono.ttf', weights: [400, 500, 700] },
      { name: 'Lato', file: 'Lato.ttf', weights: [400, 700] },
      { name: 'Poppins', file: 'Poppins.ttf', weights: [400, 700] },
    ];

    // Resolve from the data-dir override first (custom/provisioned fonts), then
    // the fonts bundled with the extension image, so fresh installs (empty data
    // dir) still render offline. Mirrors the /protocol/font route resolution.
    const candidateDirs = [
      this.fontsDir,
      path.resolve(__dirname, '../fonts'),
    ];

    fontBuffers = [];

    for (const font of bundledFonts) {
      let data = null;
      for (const dir of candidateDirs) {
        try {
          data = await fs.readFile(path.join(dir, font.file));
          break;
        } catch {
          // Not in this dir — try the next candidate.
        }
      }
      if (!data) {
        logger.warn(`Bundled font missing: ${font.file}`);
        continue;
      }
      for (const weight of font.weights) {
        fontBuffers.push({
          name: font.name, weight, style: 'normal', data,
        });
      }
    }

    // If no fonts loaded, download Inter from Google Fonts
    if (fontBuffers.length === 0) {
      logger.warn('No bundled fonts found, downloading from Google Fonts');
      try {
        // Download Inter Regular (most essential)
        const interRegularUrl = 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff';
        const response = await fetch(interRegularUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          fontBuffers.push({
            name: 'Inter',
            weight: 400,
            style: 'normal',
            data: Buffer.from(arrayBuffer),
          });
          logger.info('Downloaded Inter font from Google Fonts');
        }
      } catch (downloadError) {
        logger.error(`Failed to download fallback font: ${downloadError.message}`);
      }
    }

    fontsLoaded = true;
    logger.info(`Loaded ${fontBuffers.length} font files for image rendering`);
  }

  /**
   * Render widget primitives to an image
   * @param {Object} primitives - The render primitives from widget execution
   * @param {Object} options - Render options
   * @returns {Object} Image buffer and metadata
   */
  async render(primitives, options = {}) {
    const {
      width = 300,
      height = 150,
      format = 'png',
      quality = 90,
      scale = 1, // 1x default for Roku/TV devices (use 2 for retina displays)
    } = options;

    const actualWidth = width * scale;
    const actualHeight = height * scale;

    try {
      await this.loadDependencies();
      await this.loadFonts();

      // Pre-process primitives to resolve asset URLs to data URIs
      const resolvedPrimitives = await this.resolveAssetUrls(primitives);

      // Convert primitives to Satori-compatible React-like elements
      // Pass dimensions so percentage values (100%) have something to be relative to
      const element = this.primitivesToSatori(resolvedPrimitives, scale, {
        width: actualWidth,
        height: actualHeight,
      });

      // Render to SVG using Satori
      let svg;
      try {
        svg = await satori(element, {
          width: actualWidth,
          height: actualHeight,
          fonts: fontBuffers.length > 0 ? fontBuffers : undefined,
        });
      } catch (satoriError) {
        logger.error(`Satori render error: ${satoriError.message}`);
        logger.debug(`Element structure: ${JSON.stringify(element).substring(0, 500)}...`);
        throw satoriError;
      }

      // Convert SVG to PNG/JPEG using Sharp
      let imageBuffer;
      const sharpInstance = sharp(Buffer.from(svg));

      if (format === 'jpeg' || format === 'jpg') {
        imageBuffer = await sharpInstance.jpeg({ quality }).toBuffer();
      } else {
        imageBuffer = await sharpInstance.png().toBuffer();
      }

      return {
        buffer: imageBuffer,
        width: actualWidth,
        height: actualHeight,
        format,
        size: imageBuffer.length,
      };
    } catch (error) {
      logger.error(`Widget render failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Render and save to file
   */
  async renderToFile(primitives, options = {}) {
    const result = await this.render(primitives, options);

    // Generate filename from hash
    const hash = crypto.createHash('md5')
      .update(JSON.stringify(primitives))
      .digest('hex')
      .substring(0, 12);

    const filename = `widget-${hash}.${options.format || 'png'}`;
    const filePath = path.join(this.renderDir, filename);

    await fs.writeFile(filePath, result.buffer);

    return {
      ...result,
      filePath,
      filename,
    };
  }

  /**
   * Convert widget primitives to Satori-compatible elements
   * Satori uses a React-like element structure with JSX-style objects
   * @param {Object|Array} primitive - The primitive(s) to convert
   * @param {number} scale - Scale factor for dimensions
   * @param {Object} dimensions - Optional width/height for root wrapper
   */
  primitivesToSatori(primitive, scale = 1, dimensions = null) {
    if (!primitive) return null;

    // Handle arrays - wrap in a container with explicit dimensions
    if (Array.isArray(primitive)) {
      const wrapperStyle = {
        display: 'flex',
        flexDirection: 'column',
      };
      // Set explicit dimensions for percentage values to work
      if (dimensions) {
        wrapperStyle.width = dimensions.width;
        wrapperStyle.height = dimensions.height;
      }
      return {
        type: 'div',
        props: {
          style: wrapperStyle,
          children: primitive.map((p) => this.primitivesToSatori(p, scale)).filter(Boolean),
        },
      };
    }

    const { type } = primitive;

    switch (type) {
      case 'box':
        return this.boxToSatori(primitive, scale);
      case 'stack':
        return this.stackToSatori(primitive, scale);
      case 'text':
        return this.textToSatori(primitive, scale);
      case 'image':
        return this.imageToSatori(primitive, scale);
      case 'spacer':
        return this.spacerToSatori(primitive, scale);
      default:
        // Unknown type - try to render as box
        if (primitive.children) {
          return this.boxToSatori(primitive, scale);
        }
        return null;
    }
  }

  /**
   * Convert box primitive to Satori element
   */
  boxToSatori(primitive, scale) {
    // Support both primitive.style and direct properties
    const s = primitive.style || {};

    const style = {
      display: 'flex',
      alignItems: primitive.align || s.alignItems || 'center',
      justifyContent: primitive.justify || s.justifyContent || 'center',
    };

    // Check both direct properties and style object
    const background = primitive.background || s.background;
    const borderRadius = primitive.borderRadius ?? s.borderRadius;
    const padding = primitive.padding ?? s.padding;
    const border = primitive.border || s.border;
    const width = primitive.width || s.width;
    const height = primitive.height || s.height;
    const opacity = primitive.opacity ?? s.opacity;

    // Position properties for absolute/relative positioning
    const position = primitive.position || s.position;
    const top = primitive.top ?? s.top;
    const left = primitive.left ?? s.left;
    const right = primitive.right ?? s.right;
    const bottom = primitive.bottom ?? s.bottom;
    const zIndex = primitive.zIndex ?? s.zIndex;
    const overflow = primitive.overflow || s.overflow;

    // Satori requires backgroundImage for gradients, not background
    if (background) {
      if (typeof background === 'string' && background.includes('gradient')) {
        style.backgroundImage = background;
      } else {
        style.backgroundColor = background;
      }
    }
    if (borderRadius) style.borderRadius = typeof borderRadius === 'number' ? borderRadius * scale : borderRadius;
    if (padding) style.padding = typeof padding === 'number' ? padding * scale : padding;
    if (border) style.border = border;
    if (width) style.width = typeof width === 'number' ? width * scale : width;
    if (height) style.height = typeof height === 'number' ? height * scale : height;
    if (opacity !== undefined) style.opacity = opacity;

    // Position properties
    if (position) style.position = position;
    if (top !== undefined) style.top = typeof top === 'number' ? top * scale : top;
    if (left !== undefined) style.left = typeof left === 'number' ? left * scale : left;
    if (right !== undefined) style.right = typeof right === 'number' ? right * scale : right;
    if (bottom !== undefined) style.bottom = typeof bottom === 'number' ? bottom * scale : bottom;
    if (zIndex !== undefined) style.zIndex = zIndex;
    if (overflow) style.overflow = overflow;

    const children = this.processChildren(primitive.children, scale);

    return {
      type: 'div',
      props: { style, children },
    };
  }

  /**
   * Convert stack primitive to Satori element
   */
  stackToSatori(primitive, scale) {
    const direction = primitive.direction || 'horizontal';
    // Support both primitive.style and direct properties
    const s = primitive.style || {};

    // Support both naming conventions: 'vertical'/'horizontal' and 'column'/'row'
    const isVertical = direction === 'vertical' || direction === 'column';

    const style = {
      display: 'flex',
      flexDirection: isVertical ? 'column' : 'row',
    };

    // Check both direct properties and style object
    const gap = primitive.gap || s.gap;
    const align = primitive.align || s.alignItems;
    const justify = primitive.justify || s.justifyContent;
    const padding = primitive.padding ?? s.padding;
    const background = primitive.background || s.background;
    const borderRadius = primitive.borderRadius ?? s.borderRadius;
    const width = primitive.width || s.width;
    const height = primitive.height || s.height;

    // Position properties for absolute/relative positioning
    const position = primitive.position || s.position;
    const top = primitive.top ?? s.top;
    const left = primitive.left ?? s.left;
    const right = primitive.right ?? s.right;
    const bottom = primitive.bottom ?? s.bottom;
    const zIndex = primitive.zIndex ?? s.zIndex;
    const overflow = primitive.overflow || s.overflow;

    if (gap) style.gap = gap * scale;
    if (align) style.alignItems = align;
    if (justify) style.justifyContent = justify;
    if (padding) style.padding = typeof padding === 'number' ? padding * scale : padding;
    // Satori requires backgroundImage for gradients, not background
    if (background) {
      if (typeof background === 'string' && background.includes('gradient')) {
        style.backgroundImage = background;
      } else {
        style.backgroundColor = background;
      }
    }
    if (borderRadius) style.borderRadius = typeof borderRadius === 'number' ? borderRadius * scale : borderRadius;
    if (primitive.wrap) style.flexWrap = 'wrap';
    if (width) style.width = typeof width === 'number' ? width * scale : width;
    if (height) style.height = typeof height === 'number' ? height * scale : height;

    // Position properties
    if (position) style.position = position;
    if (top !== undefined) style.top = typeof top === 'number' ? top * scale : top;
    if (left !== undefined) style.left = typeof left === 'number' ? left * scale : left;
    if (right !== undefined) style.right = typeof right === 'number' ? right * scale : right;
    if (bottom !== undefined) style.bottom = typeof bottom === 'number' ? bottom * scale : bottom;
    if (zIndex !== undefined) style.zIndex = zIndex;
    if (overflow) style.overflow = overflow;

    const children = this.processChildren(primitive.children, scale);

    return {
      type: 'div',
      props: { style, children },
    };
  }

  /**
   * Convert text primitive to Satori element
   */
  textToSatori(primitive, scale) {
    const s = primitive.style || {};

    const style = {
      display: 'flex',
    };

    if (s.fontSize) style.fontSize = s.fontSize * scale;
    if (s.fontWeight) style.fontWeight = s.fontWeight;
    if (s.fontFamily) style.fontFamily = s.fontFamily;
    if (s.fontStyle) style.fontStyle = s.fontStyle;
    if (s.color) style.color = s.color;
    if (s.textAlign) style.textAlign = s.textAlign;
    if (s.lineHeight) style.lineHeight = s.lineHeight;
    if (s.letterSpacing) {
      // Handle both numeric (2) and string ('0.5px') values
      const spacing = typeof s.letterSpacing === 'string'
        ? parseFloat(s.letterSpacing)
        : s.letterSpacing;
      if (!isNaN(spacing)) {
        style.letterSpacing = spacing * scale;
      }
    }
    if (s.opacity !== undefined) style.opacity = s.opacity;

    // CRITICAL: Satori requires children to be strings - convert any non-string content
    // Numbers, booleans, etc. will cause "inputValue.trim is not a function" error
    const { content } = primitive;
    const textContent = content === null || content === undefined ? '' : String(content);

    return {
      type: 'span',
      props: {
        style,
        children: textContent,
      },
    };
  }

  /**
   * Resolve asset URLs in primitives to data URIs
   * This is necessary because Satori runs server-side and can't fetch relative URLs
   */
  async resolveAssetUrls(primitives) {
    if (!primitives) return primitives;

    try {
      // Handle array of primitives
      if (Array.isArray(primitives)) {
        const results = [];
        for (const p of primitives) {
          results.push(await this.resolveAssetUrls(p));
        }
        return results;
      }

      // Handle single primitive
      const resolved = { ...primitives };

      // Resolve image src if it's a widget asset URL
      // Handles both old format (/widgets/{uuid}/assets/) and new format (/protocol/widget/{uuid}/asset/)
      if (resolved.type === 'image' && resolved.src
        && (resolved.src.includes('/widget/') || resolved.src.includes('/widgets/'))
        && (resolved.src.includes('/asset/') || resolved.src.includes('/assets/'))) {
        resolved.src = await this.resolveAssetUrl(resolved.src);
      }

      // Recursively resolve children
      if (resolved.children) {
        resolved.children = await this.resolveAssetUrls(resolved.children);
      }

      return resolved;
    } catch (error) {
      logger.error(`Error resolving asset URLs: ${error.message}`);
      return primitives; // Return original on error
    }
  }

  /**
   * Resolve a single asset URL to a data URI
   * Converts SVG to PNG for better Satori compatibility
   */
  async resolveAssetUrl(url) {
    // Parse widget UUID and filename from URL
    // Format 1: /api/extensions/slidecast/widgets/{uuid}/assets/{filename}
    // Format 2: /api/extensions/slidecast/protocol/widget/{uuid}/asset/{filename}
    let match = url.match(/\/widgets\/([^/]+)\/assets\/([^?]+)/);
    if (!match) {
      match = url.match(/\/protocol\/widget\/([^/]+)\/asset\/([^?]+)/);
    }
    if (!match) {
      logger.debug(`Asset URL doesn't match pattern: ${url}`);
      return url;
    }

    const [, widgetUuid, encodedFilename] = match;
    const filename = decodeURIComponent(encodedFilename);

    try {
      // Fetch asset from database
      const assetsModel = this.api.model('slidecast_widget_assets');
      const assets = await assetsModel.findAll({
        where: { widget_uuid: widgetUuid, filename },
      });

      logger.debug(`Asset lookup for ${filename}: found ${assets?.length || 0} results`);

      if (!assets || assets.length === 0) {
        logger.warn(`Asset not found in DB: ${filename} for widget ${widgetUuid}`);
        return url;
      }

      const asset = assets[0];

      if (!asset.data) {
        logger.warn(`Asset has no data: ${filename}`);
        return url;
      }

      let imageData = Buffer.from(asset.data);
      let mimeType = asset.mime_type || 'image/png';

      // Convert SVG to PNG for better Satori compatibility
      if (mimeType === 'image/svg+xml') {
        try {
          await this.loadDependencies(); // Ensure Sharp is loaded
          // Sharp requires density setting for SVG to control rasterization size
          const pngBuffer = await sharp(imageData, { density: 150 })
            .resize(96, 96, {
              fit: 'contain',
              background: {
                r: 0, g: 0, b: 0, alpha: 0,
              },
            })
            .png()
            .toBuffer();
          imageData = pngBuffer;
          mimeType = 'image/png';
          logger.debug(`Converted SVG ${filename} to PNG (${pngBuffer.length} bytes)`);
        } catch (svgError) {
          logger.warn(`Failed to convert SVG to PNG: ${svgError.message}`);
          // Return transparent 1x1 PNG as placeholder (verified transparent)
          // PNG: 1x1 RGBA transparent pixel
          const transparentPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
          return `data:image/png;base64,${transparentPng}`;
        }
      }

      const base64 = imageData.toString('base64');
      logger.debug(`Resolved asset ${filename} to ${mimeType} data URI (${base64.length} chars)`);
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      logger.error(`Failed to resolve asset URL ${filename}: ${error.message}`);
      return url;
    }
  }

  /**
   * Convert image primitive to Satori element
   */
  imageToSatori(primitive, scale) {
    const style = {};
    const s = primitive.style || {};

    if (primitive.width) style.width = primitive.width * scale;
    if (primitive.height) style.height = primitive.height * scale;
    if (s.objectFit) style.objectFit = s.objectFit;
    if (s.borderRadius) style.borderRadius = s.borderRadius * scale;
    if (s.opacity !== undefined) style.opacity = s.opacity;

    return {
      type: 'img',
      props: {
        src: primitive.src || '',
        style,
      },
    };
  }

  /**
   * Convert spacer primitive to Satori element
   */
  spacerToSatori(primitive, scale) {
    const flex = primitive.flex || 1;
    const minSize = primitive.minSize ? primitive.minSize * scale : 0;

    return {
      type: 'div',
      props: {
        style: {
          flex,
          minWidth: minSize,
          minHeight: minSize,
        },
      },
    };
  }

  /**
   * Process children array
   */
  processChildren(children, scale) {
    if (!children) return null;
    if (Array.isArray(children)) {
      return children.filter(Boolean).map((c) => this.primitivesToSatori(c, scale)).filter(Boolean);
    }
    return this.primitivesToSatori(children, scale);
  }

  /**
   * Render primitives to an image buffer
   * Convenience method for thumbnail generation
   */
  async renderToImage(primitives, size, format = 'png') {
    const result = await this.render(primitives, {
      width: size.width,
      height: size.height,
      format,
      scale: 1, // Don't scale up for thumbnails
    });
    return result.buffer;
  }

  /**
   * Check if Satori/Sharp are available
   */
  async isAvailable() {
    try {
      await this.loadDependencies();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup (no browser to close, but keeping interface)
   */
  async cleanup() {
    // Nothing to clean up with Satori + Sharp
    logger.info('WidgetImageRenderer cleanup complete');
  }
}

export default WidgetImageRenderer;
