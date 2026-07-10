import multer from 'multer';
import fs from 'fs';
import logger from '../utils/Logger.js';

/**
 * Media Routes - CRUD operations for media assets
 * V2 route factory: returns a route definition map for ctx.registerRoutes()
 *
 * IMPORTANT: Route order matters! Express matches routes in registration order.
 * Static paths (e.g. /media/stats) MUST come before parameterized paths
 * (e.g. /media/:id), otherwise the param route swallows the static one.
 */

// SL2: route-scoped upload handling. The shared SDK RouteManager wires the
// `[upload]` modifier to a multer.memoryStorage() with NO size limit — it
// buffers the ENTIRE uploaded file in RAM, which can OOM a small box. Instead
// this route uses the `[stream]` modifier (so it receives the raw Express req
// via ctx.res.req) and runs its OWN multer with DISK storage + a hard
// fileSize limit. Nothing hits RAM beyond multer's small streaming chunks.
const UPLOAD_TMP_DIR = `${process.env.DATA_DIR || '/app/data'}/slidecast/uploads-tmp`;
// Default 500MB ceiling (videos are large); override with SLIDECAST_MAX_UPLOAD_BYTES.
const MAX_UPLOAD_BYTES = parseInt(
  process.env.SLIDECAST_MAX_UPLOAD_BYTES || String(500 * 1024 * 1024),
  10,
);

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(UPLOAD_TMP_DIR, { recursive: true }, (err) => cb(err, UPLOAD_TMP_DIR));
  },
  filename: (req, file, cb) => {
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  },
});
const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
}).single('file');

// Promisified single-file multer run against the raw Express req/res.
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadMiddleware(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

export default function createMediaRoutes(deps) {
  const { mediaLibrary, videoProcessor } = deps;

  // ==================== ROUTE DEFINITIONS ====================
  // Routes are ordered so static paths register before parameterized ones.

  return {
    // ==================== MEDIA (static paths first) ====================

    // List all media
    'GET /media': async (ctx) => {
      const media = await mediaLibrary.getAll();
      return { success: true, media };
    },

    // Get storage stats
    'GET /media/stats': async (ctx) => {
      const stats = await mediaLibrary.getStorageStats();
      return { success: true, stats };
    },

    // Upload media via multipart form (proper file upload).
    // [stream] (not [upload]) so we get the raw req via ctx.res.req and run a
    // route-scoped disk-storage multer with a size limit (SL2). We send the
    // JSON response ourselves — [stream] skips RouteManager's auto-JSON.
    'POST /media/upload [stream]': async (ctx) => {
      const { res } = ctx;
      const req = res && res.req;
      if (!req || !res) {
        if (res) { res.status(500).json({ success: false, error: 'Upload context unavailable' }); }
        return;
      }

      // Parse the multipart body to disk with the fileSize limit enforced.
      try {
        await runUpload(req, res);
      } catch (err) {
        const tooLarge = err && err.code === 'LIMIT_FILE_SIZE';
        const status = tooLarge ? 413 : 400;
        const message = tooLarge
          ? `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`
          : `Upload failed: ${err.message}`;
        logger.error(message);
        res.status(status).json({ success: false, error: message });
        return;
      }

      const { file } = req;
      if (!file) {
        res.status(400).json({ success: false, error: 'No file provided' });
        return;
      }

      try {
        logger.info(`Uploading media: ${file.originalname}, type: ${file.mimetype}, size: ${file.size}`);
        const media = await mediaLibrary.createFromUpload(file);
        logger.info(`Media created: ${media.uuid}`);
        res.json({ success: true, media });
      } catch (error) {
        logger.error(`Media upload failed: ${error.message}`);
        // Best-effort cleanup of the temp file if the move failed partway.
        if (file.path) { fs.promises.unlink(file.path).catch(() => {}); }
        res.status(500).json({ success: false, error: error.message });
      }
    },

    // Also keep base64 for clipboard paste (small images only)
    'POST /media/base64': async (ctx) => {
      try {
        const { name, data, mime_type } = ctx.body;
        if (!data) {
          return { success: false, error: 'No data provided', status: 400 };
        }
        if (!mime_type) {
          return { success: false, error: 'No mime_type provided', status: 400 };
        }
        // Limit base64 to 5MB (after base64 encoding, roughly 3.75MB original)
        if (data.length > 5 * 1024 * 1024) {
          return { success: false, error: 'File too large for base64 upload. Use file upload instead.', status: 413 };
        }
        logger.info(`Uploading media (base64): ${name}, type: ${mime_type}, size: ${data?.length || 0} chars`);
        const media = await mediaLibrary.createFromBase64(name, data, mime_type);
        logger.info(`Media created: ${media.uuid}`);
        return { success: true, media };
      } catch (error) {
        logger.error(`Media upload failed: ${error.message}`);
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Import media from URL
    'POST /media/import-url': async (ctx) => {
      const { url, name } = ctx.body;
      if (!url) {
        return { success: false, error: 'URL is required', status: 400 };
      }
      try {
        const media = await mediaLibrary.createFromUrl(url, name);
        return { success: true, media };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Delete ALL media (for cleanup/reset) — must be before DELETE /media/:id
    'DELETE /media/all': async (ctx) => {
      try {
        // Get all media records
        const allMedia = await ctx.data.slidecast_media.findAll();
        let deleted = 0;
        let errors = 0;

        for (const media of allMedia) {
          try {
            // Try to delete via mediaLibrary (handles file deletion).
            // mediaLibrary.delete() looks records up by uuid, not db id.
            const success = await mediaLibrary.delete(media.uuid);
            if (success) {
              deleted++;
            } else {
              // If mediaLibrary.delete fails (orphaned record), delete directly from DB
              await ctx.data.slidecast_media.delete(media.id);
              deleted++;
            }
          } catch (err) {
            // Force delete from DB even if file operations fail
            try {
              await ctx.data.slidecast_media.delete(media.id);
              deleted++;
            } catch {
              errors++;
            }
          }
        }

        logger.info(`Deleted all media: ${deleted} removed, ${errors} errors`);
        return { success: true, deleted, errors };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // ==================== VIDEO PROCESSING (static paths) ====================

    // Check if video processing is available (ffmpeg installed)
    'GET /media/video/capabilities': async (ctx) => {
      if (!videoProcessor) {
        return { success: true, available: false, reason: 'Video processor not initialized' };
      }
      const ffmpegAvailable = await videoProcessor.checkFfmpeg();
      const presets = videoProcessor.getPresets();
      return {
        success: true,
        available: ffmpegAvailable,
        features: ffmpegAvailable ? {
          loop: true,
          transitions: [
            { id: 'none', label: 'None', description: 'Simple loop with hard cuts at loop points (fastest)' },
            { id: 'crossfade', label: 'Crossfade', description: 'Smooth crossfade between each loop iteration' },
          ],
          fadeInOut: true, // Separate option to add fade in/out from black
          quality: Object.entries(presets.quality).map(([id, preset]) => ({
            id,
            label: preset.label,
            description: preset.description,
          })),
          resolution: Object.entries(presets.resolution).map(([id, preset]) => ({
            id,
            label: preset.label,
            description: preset.description,
          })),
        } : null,
        reason: ffmpegAvailable ? null : 'ffmpeg not installed',
      };
    },

    // Legacy estimate endpoint (general, not media-specific)
    'POST /media/video/estimate': async (ctx) => {
      const {
        targetDuration, transition = 'none', quality = 'medium', resolution = 'original',
      } = ctx.body;
      if (!targetDuration || targetDuration <= 0) {
        return { success: false, error: 'Invalid target duration', status: 400 };
      }
      const estimatedSeconds = videoProcessor.estimateTime(targetDuration, transition, quality, resolution);
      return {
        success: true,
        estimatedSeconds,
        estimatedMinutes: Math.ceil(estimatedSeconds / 60),
      };
    },

    // Get all active video processing jobs
    'GET /media/video/jobs': async (ctx) => {
      const jobs = videoProcessor.getActiveJobs();
      return {
        success: true,
        jobs: jobs.map((job) => ({
          id: job.id,
          status: job.status,
          progress: job.progress,
          sourceName: job.sourceName,
          targetDuration: job.targetDuration,
        })),
      };
    },

    // Get video processing job status
    'GET /media/video/jobs/:jobId': async (ctx) => {
      const job = videoProcessor.getJob(ctx.params.jobId);
      if (!job) {
        return { success: false, error: 'Job not found', status: 404 };
      }

      // Calculate elapsed time
      const elapsedMs = job.completedAt
        ? job.completedAt - job.startedAt
        : Date.now() - job.startedAt;

      return {
        success: true,
        job: {
          id: job.id,
          status: job.status,
          progress: job.progress,
          currentTime: job.currentTime,
          speed: job.speed,
          eta: job.eta,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          error: job.error,
          sourceName: job.sourceName,
          sourceDuration: job.sourceDuration,
          sourceInfo: job.sourceInfo,
          targetDuration: job.targetDuration,
          transition: job.transition,
          quality: job.quality,
          qualityLabel: job.qualitySettings?.label,
          resolution: job.resolution,
          resolutionLabel: job.resolutionSettings?.label,
          estimatedSize: job.estimatedSize,
          actualSize: job.actualSize,
          outputUuid: job.outputUuid,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        },
      };
    },

    // Cancel a video processing job
    'DELETE /media/video/jobs/:jobId': async (ctx) => {
      const cancelled = videoProcessor.cancelJob(ctx.params.jobId);
      return { success: cancelled };
    },

    // ==================== PARAMETERIZED ROUTES (must come last) ====================

    // Get single media
    'GET /media/:id': async (ctx) => {
      const media = await mediaLibrary.getById(ctx.params.id);
      if (!media) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      return { success: true, media };
    },

    // Get video info (duration, resolution, bitrate, etc.)
    'GET /media/:id/info': async (ctx) => {
      const media = await mediaLibrary.getById(ctx.params.id);
      if (!media) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      if (media.type !== 'video') {
        return { success: false, error: 'Not a video', status: 400 };
      }
      try {
        const info = await videoProcessor.getVideoInfo(media.file_path);
        return {
          success: true,
          duration: info.duration,
          width: info.width,
          height: info.height,
          fps: info.fps,
          codec: info.codec,
          bitrate: info.bitrate,
          fileSize: info.fileSize || media.file_size,
        };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Get video duration (legacy endpoint for compatibility)
    'GET /media/:id/duration': async (ctx) => {
      const media = await mediaLibrary.getById(ctx.params.id);
      if (!media) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      if (media.type !== 'video') {
        return { success: false, error: 'Not a video', status: 400 };
      }
      try {
        const duration = await videoProcessor.getVideoDuration(media.file_path);
        return { success: true, duration };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Estimate video processing time and output size
    'POST /media/:id/estimate': async (ctx) => {
      const {
        targetDuration,
        transition = 'none',
        quality = 'medium',
        resolution = 'original',
      } = ctx.body;

      if (!targetDuration || targetDuration <= 0) {
        return { success: false, error: 'Invalid target duration', status: 400 };
      }

      const media = await mediaLibrary.getById(ctx.params.id);
      if (!media) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      if (media.type !== 'video') {
        return { success: false, error: 'Not a video', status: 400 };
      }

      try {
        // Get source info
        const sourceInfo = await videoProcessor.getVideoInfo(media.file_path);
        const sourceDuration = sourceInfo.duration || await videoProcessor.getVideoDuration(media.file_path);

        // Estimate time and size
        const estimatedSeconds = videoProcessor.estimateTime(targetDuration, transition, quality, resolution);
        const estimatedSize = videoProcessor.estimateOutputSize(
          { ...sourceInfo, fileSize: media.file_size },
          targetDuration,
          sourceDuration,
          quality,
          resolution,
          transition,
        );

        return {
          success: true,
          source: {
            duration: sourceDuration,
            width: sourceInfo.width,
            height: sourceInfo.height,
            fileSize: media.file_size,
            bitrate: sourceInfo.bitrate,
          },
          estimate: {
            processingTimeSeconds: estimatedSeconds,
            processingTimeMinutes: Math.ceil(estimatedSeconds / 60),
            outputSizeBytes: estimatedSize.bytes,
            outputBitrate: estimatedSize.bitrate,
            isApproximate: true,
          },
        };
      } catch (error) {
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Start video loop processing job
    'POST /media/:id/loop': async (ctx) => {
      const {
        targetDuration,
        transition = 'none',
        transitionDuration = 1.5,
        fadeInOut = false,
        fadeDuration = 1.5,
        quality = 'medium',
        resolution = 'original',
      } = ctx.body;

      if (!targetDuration || targetDuration <= 0) {
        return { success: false, error: 'Invalid target duration', status: 400 };
      }

      const media = await mediaLibrary.getById(ctx.params.id);
      if (!media) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      if (media.type !== 'video') {
        return { success: false, error: 'Not a video', status: 400 };
      }

      try {
        const jobId = await videoProcessor.startLoopJob(ctx.params.id, targetDuration, {
          transition,
          transitionDuration,
          fadeInOut,
          fadeDuration,
          quality,
          resolution,
        });

        const job = videoProcessor.getJob(jobId);

        return {
          success: true,
          jobId,
          job: {
            id: job.id,
            status: job.status,
            sourceName: job.sourceName,
            sourceDuration: job.sourceDuration,
            sourceInfo: job.sourceInfo,
            targetDuration: job.targetDuration,
            transition: job.transition,
            quality: job.quality,
            resolution: job.resolution,
            estimatedSize: job.estimatedSize,
          },
        };
      } catch (error) {
        logger.error(`Video loop failed: ${error.message}`);
        return { success: false, error: error.message, status: 500 };
      }
    },

    // Delete media
    'DELETE /media/:id': async (ctx) => {
      const success = await mediaLibrary.delete(ctx.params.id);
      if (!success) {
        return { success: false, error: 'Media not found', status: 404 };
      }
      return { success: true };
    },
  };
}
