/**
 * pngDimensions.js — minimal PNG header reader.
 *
 * Reads only the first 24 bytes of a PNG file (8-byte signature + 4-byte
 * IHDR length + 4-byte chunk type + 8 bytes width/height) and returns the
 * dimensions. Used by SlideImageRenderer cache-validation (#924) to detect
 * stale cached PNGs that have the wrong dimensions for the current render
 * pipeline.
 *
 * - Cheap: reads 24 bytes, no decoding.
 * - Safe: returns null on any I/O / parse failure (never throws).
 * - Sync API to keep the cache-check path simple; opens an FD, reads 24
 *   bytes, closes. For 1920x1080 batches this is microseconds.
 */

import {
  openSync, readSync, closeSync, statSync,
} from 'fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read PNG dimensions from a file path.
 *
 * @param {string} filePath - Absolute path to a .png file.
 * @returns {{width:number,height:number}|null} Dimensions, or null on
 *   any I/O / parse failure (file missing, not a PNG, truncated, etc.).
 */
export function readPngDimensions(filePath) {
  let fd = null;
  try {
    // Quick-fail on tiny files: a valid PNG must be at least 24 bytes.
    const st = statSync(filePath);
    if (!st.isFile() || st.size < 24) return null;

    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    const bytesRead = readSync(fd, buf, 0, 24, 0);
    if (bytesRead < 24) return null;

    // Validate PNG signature
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

    // After signature: 4 bytes length + 4 bytes "IHDR" + 4 bytes width + 4 bytes height
    // IHDR chunk type at bytes 12..15 should be ASCII "IHDR"
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;

    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Convenience: returns true iff the PNG at filePath has exactly the
 * expected dimensions. Returns false if file is missing, unreadable,
 * not a PNG, or has different dimensions. Used by cache-hit validation.
 */
export function pngHasDimensions(filePath, expectedWidth, expectedHeight) {
  const dims = readPngDimensions(filePath);
  if (!dims) return false;
  return dims.width === expectedWidth && dims.height === expectedHeight;
}
