/**
 * VideoProcessor - Video looping and processing with ffmpeg
 * Supports extending videos to custom durations with optional crossfade transitions
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import logger from './utils/Logger.js';

const MEDIA_DIR = `${process.env.DATA_DIR || '/app/data'}/slidecast/media`;
const PROCESSED_DIR = `${process.env.DATA_DIR || '/app/data'}/slidecast/media/processed`;

// Active jobs for progress tracking
const activeJobs = new Map();

// Quality presets - CRF values (lower = better quality, larger file)
const QUALITY_PRESETS = {
  high: {
    crf: 18, preset: 'slow', label: 'High Quality', description: 'Visually lossless, larger files',
  },
  medium: {
    crf: 23, preset: 'medium', label: 'Medium Quality', description: 'Good balance of quality and size',
  },
  low: {
    crf: 28, preset: 'veryfast', label: 'Low Quality', description: 'Smaller files, faster processing',
  },
};

// Resolution presets
const RESOLUTION_PRESETS = {
  original: { scale: null, label: 'Original', description: 'Keep source resolution' },
  '1080p': { scale: '1920:-2', label: '1080p', description: 'Full HD (1920x1080)' },
  '720p': { scale: '1280:-2', label: '720p', description: 'HD (1280x720)' },
  '480p': { scale: '854:-2', label: '480p', description: 'SD (854x480)' },
};

class VideoProcessor {
  constructor(api, mediaLibrary) {
    this.api = api;
    this.mediaLibrary = mediaLibrary;
  }

  async init() {
    // Ensure processed directory exists
    await fs.mkdir(PROCESSED_DIR, { recursive: true });

    // Verify ffmpeg is available
    try {
      const { execSync } = await import('child_process');
      execSync('which ffmpeg', { stdio: 'ignore' });
    } catch (e) {
      logger.error('ffmpeg not available:', e.message);
      if (this.api?.reportDegraded) this.api.reportDegraded('Video processing unavailable');
    }
  }

  /**
   * Check if ffmpeg is available
   */
  async checkFfmpeg() {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-version']);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Get video duration using ffprobe
   */
  async getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ];

      const proc = spawn('ffprobe', args);
      let output = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { logger.debug(`ffprobe stderr: ${data}`); });

      proc.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(isNaN(duration) ? null : duration);
        } else {
          reject(new Error('ffprobe failed'));
        }
      });
    });
  }

  /**
   * Get detailed video info using ffprobe
   */
  async getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,bit_rate,codec_name,r_frame_rate:format=duration,size,bit_rate',
        '-of', 'json',
        filePath,
      ];

      const proc = spawn('ffprobe', args);
      let output = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', () => {}); // Suppress stderr

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const data = JSON.parse(output);
            const stream = data.streams?.[0] || {};
            const format = data.format || {};

            // Parse frame rate (can be "30/1" or "29.97")
            let fps = 30;
            if (stream.r_frame_rate) {
              const parts = stream.r_frame_rate.split('/');
              fps = parts.length === 2 ? parseInt(parts[0], 10) / parseInt(parts[1], 10) : parseFloat(parts[0]);
            }

            resolve({
              width: stream.width || null,
              height: stream.height || null,
              codec: stream.codec_name || null,
              fps: Math.round(fps * 100) / 100,
              duration: parseFloat(format.duration) || null,
              fileSize: parseInt(format.size, 10) || null,
              bitrate: parseInt(format.bit_rate, 10) || parseInt(stream.bit_rate, 10) || null,
            });
          } catch (e) {
            resolve({
              width: null, height: null, codec: null, fps: null, duration: null, fileSize: null, bitrate: null,
            });
          }
        } else {
          reject(new Error('ffprobe failed'));
        }
      });
    });
  }

  /**
   * Check if video has an audio stream
   */
  async hasAudioStream(filePath) {
    return new Promise((resolve) => {
      const args = [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ];

      const proc = spawn('ffprobe', args);
      let output = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => {
        // If ffprobe found an audio stream, output will contain "audio"
        resolve(code === 0 && output.trim().toLowerCase() === 'audio');
      });
    });
  }

  /**
   * Start a video loop job
   * @param {string} sourceUuid - Source media UUID
   * @param {number} targetDuration - Target duration in seconds
   * @param {Object} options - Processing options
   * @returns {string} Job ID
   */
  async startLoopJob(sourceUuid, targetDuration, options = {}) {
    const {
      transition = 'none', // none, crossfade
      transitionDuration = 1.5, // seconds for crossfade
      fadeInOut = false, // add fade in/out from black to final video
      fadeDuration = 1.5, // seconds for fade in/out
      quality = 'medium', // high, medium, low
      resolution = 'original', // original, 1080p, 720p, 480p
    } = options;

    // Get source media
    const source = await this.mediaLibrary.getById(sourceUuid);
    if (!source) {
      throw new Error('Source media not found');
    }

    if (source.type !== 'video') {
      throw new Error('Source must be a video');
    }

    // Get source duration
    const sourceDuration = await this.getVideoDuration(source.file_path);
    if (!sourceDuration) {
      throw new Error('Could not determine source video duration');
    }

    // Check if source has audio (needed for crossfade filters)
    const hasAudio = await this.hasAudioStream(source.file_path);
    logger.debug(`Video ${source.name}: hasAudio=${hasAudio}`);

    // Get detailed source info for size estimation
    let sourceInfo = {
      width: null, height: null, bitrate: null, fileSize: source.file_size,
    };
    try {
      sourceInfo = await this.getVideoInfo(source.file_path);
    } catch (e) {
      logger.debug(`Could not get detailed video info: ${e.message}`);
    }

    // Get quality and resolution settings
    const qualitySettings = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
    const resolutionSettings = RESOLUTION_PRESETS[resolution] || RESOLUTION_PRESETS.original;

    // Estimate output size
    const estimatedSize = this.estimateOutputSize(sourceInfo, targetDuration, sourceDuration, quality, resolution, transition);

    // Create job
    const jobId = uuidv4();
    const outputFileName = `${jobId}.mp4`;
    const outputPath = path.join(PROCESSED_DIR, outputFileName);

    const job = {
      id: jobId,
      sourceUuid,
      sourcePath: source.file_path,
      sourceName: source.name,
      sourceDuration,
      sourceInfo,
      targetDuration,
      transition,
      transitionDuration,
      fadeInOut,
      fadeDuration,
      quality,
      qualitySettings,
      resolution,
      resolutionSettings,
      hasAudio, // Track if source has audio
      outputPath,
      status: 'pending',
      progress: 0,
      currentTime: 0,
      speed: 0,
      eta: null,
      estimatedSize,
      actualSize: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      outputUuid: null,
    };

    activeJobs.set(jobId, job);

    // Start processing in background
    this.processVideo(job).catch((err) => {
      // A cancelled job's ffmpeg was SIGKILLed (SL10) — the resulting non-zero
      // close is expected, so don't clobber the 'cancelled' status with 'failed'.
      if (job.status === 'cancelled') {
        logger.info(`Video job ${job.id} cancelled`);
        return;
      }
      job.status = 'failed';
      job.error = err.message;
      logger.error(`Video processing failed: ${err.message}`);
    });

    return jobId;
  }

  /**
   * Process video with ffmpeg
   */
  async processVideo(job) {
    job.status = 'processing';

    const args = this.buildFfmpegArgs(job);
    logger.debug(`Starting ffmpeg: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      // SL10: keep a handle so cancelJob() can actually kill this child.
      job._proc = proc;

      // Parse progress from stdout (where -progress pipe:1 outputs)
      proc.stdout.on('data', (data) => {
        const output = data.toString();
        this.parseProgress(job, output);
      });

      // Also consume stderr to prevent blocking (ffmpeg logs go here)
      proc.stderr.on('data', (data) => {
        // Log ffmpeg stderr for debugging
        const output = data.toString();
        if (output.includes('Error') || output.includes('error')) {
          logger.error(`ffmpeg error: ${output}`);
        }
      });

      proc.on('close', async (code) => {
        job._proc = null;
        if (code === 0) {
          job.status = 'complete';
          job.progress = 100;
          job.completedAt = Date.now();

          // Move processed video to videos directory and create media entry
          try {
            const outputUuid = uuidv4();
            const finalFileName = `${outputUuid}.mp4`;
            const finalPath = path.join(MEDIA_DIR, 'videos', finalFileName);

            // Ensure videos directory exists
            await fs.mkdir(path.join(MEDIA_DIR, 'videos'), { recursive: true });

            // Move from processed/ to videos/
            await fs.rename(job.outputPath, finalPath);
            logger.debug(`Moved processed video to: ${finalPath}`);

            const stat = await fs.stat(finalPath);

            // Store actual size for comparison with estimate
            job.actualSize = stat.size;

            // Get output video info for accurate dimensions
            let outputWidth = job.sourceInfo?.width;
            let outputHeight = job.sourceInfo?.height;
            try {
              const outputInfo = await this.getVideoInfo(finalPath);
              outputWidth = outputInfo.width || outputWidth;
              outputHeight = outputInfo.height || outputHeight;
            } catch (e) {
              // Use source dimensions if we can't read output
            }

            // Build descriptive name
            const qualityLabel = job.qualitySettings?.label || 'Medium Quality';
            const resLabel = job.resolution !== 'original' ? ` ${job.resolutionSettings?.label}` : '';
            const loopName = `${job.sourceName} (${job.targetDuration}s${resLabel})`;

            // Create database entry with proper path
            const media = await this.mediaLibrary.model.create({
              uuid: outputUuid,
              name: loopName,
              type: 'video',
              mime_type: 'video/mp4',
              file_path: finalPath,
              file_size: stat.size,
              checksum: null,
              width: outputWidth,
              height: outputHeight,
              duration: job.targetDuration,
              thumbnail: null,
            });

            job.outputUuid = outputUuid;
            logger.info(`Video processing complete: ${outputUuid} -> ${finalPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
            resolve(media);
          } catch (err) {
            // Clean up processed file on error
            try { await fs.unlink(job.outputPath); } catch { /* ignore: best-effort cleanup */ }
            reject(err);
          }
        } else {
          // Clean up failed output file
          try { await fs.unlink(job.outputPath); } catch { /* ignore: best-effort cleanup */ }
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Build ffmpeg arguments based on job configuration
   */
  buildFfmpegArgs(job) {
    const {
      sourcePath, targetDuration, transition, transitionDuration, fadeInOut, fadeDuration, hasAudio, qualitySettings, resolutionSettings, resolution,
    } = job;
    const { crf, preset } = qualitySettings;
    const needsReencode = resolution !== 'original' || transition !== 'none' || fadeInOut;

    // Build video filter chain
    const buildVideoFilters = (baseFilters = []) => {
      const filters = [...baseFilters];
      if (resolutionSettings.scale) {
        filters.push(`scale=${resolutionSettings.scale}`);
      }
      return filters.length > 0 ? filters.join(',') : null;
    };

    // Case 1: No loop transition, no fade, original resolution - use fast stream copy
    if (transition === 'none' && !fadeInOut && resolution === 'original') {
      return [
        '-y',
        '-stream_loop', '-1',
        '-i', sourcePath,
        '-t', targetDuration.toString(),
        '-c', 'copy',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        job.outputPath,
      ];
    }

    // Case 2: No loop transition, but needs re-encode (fade or resolution change)
    if (transition === 'none') {
      const fadeOutStart = targetDuration - fadeDuration;
      const args = [
        '-y',
        '-stream_loop', '-1',
        '-i', sourcePath,
        '-t', targetDuration.toString(),
      ];

      // Build video filter
      const vfParts = [];
      if (fadeInOut) {
        vfParts.push(`fade=t=in:st=0:d=${fadeDuration}`);
        vfParts.push(`fade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
      }
      if (resolutionSettings.scale) {
        vfParts.push(`scale=${resolutionSettings.scale}`);
      }
      if (vfParts.length > 0) {
        args.push('-vf', vfParts.join(','));
      }

      // Only add audio filters if source has audio
      if (hasAudio) {
        if (fadeInOut) {
          args.push('-af', `afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
        }
        args.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        args.push('-an'); // No audio output
      }

      args.push(
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p', // Required for Roku compatibility
        '-preset',
        preset,
        '-crf',
        crf.toString(),
        '-threads',
        '0',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        job.outputPath,
      );
      return args;
    }

    // Case 3: Crossfade between loops
    if (transition === 'crossfade') {
      const loopDuration = job.sourceDuration;
      const xfadeDuration = Math.min(transitionDuration, loopDuration / 3);

      const effectiveLoopDuration = loopDuration - xfadeDuration;
      const loopsNeeded = Math.ceil((targetDuration - loopDuration) / effectiveLoopDuration) + 1;
      const maxLoops = Math.min(loopsNeeded, 15);

      const args = ['-y'];
      for (let i = 0; i < maxLoops; i++) {
        args.push('-i', sourcePath);
      }

      // Build crossfade filter chain - handle videos with and without audio
      let filterComplex = '';
      let currentOffset = loopDuration - xfadeDuration;
      let lastVideoLabel = '[0:v]';
      let lastAudioLabel = hasAudio ? '[0:a]' : null;

      for (let i = 1; i < maxLoops; i++) {
        const isLast = i === maxLoops - 1;
        // If fadeInOut or scale is enabled, we need intermediate labels
        const needsPostProcess = fadeInOut || resolutionSettings.scale;
        const vOutLabel = isLast ? (needsPostProcess ? '[vpre]' : '[vout]') : `[v${i}]`;

        // Video crossfade
        filterComplex += `${lastVideoLabel}[${i}:v]xfade=transition=fade:duration=${xfadeDuration}:offset=${currentOffset.toFixed(3)}${vOutLabel};`;

        // Audio crossfade (only if source has audio)
        if (hasAudio) {
          const aOutLabel = isLast ? (fadeInOut ? '[apre]' : '[aout]') : `[a${i}]`;
          filterComplex += `${lastAudioLabel}[${i}:a]acrossfade=d=${xfadeDuration}:c1=tri:c2=tri${aOutLabel};`;
          lastAudioLabel = aOutLabel;
        }

        lastVideoLabel = vOutLabel;
        currentOffset += effectiveLoopDuration;
      }

      // Post-processing: fade and/or scale
      const postFilters = [];
      if (fadeInOut) {
        const fadeOutStart = targetDuration - fadeDuration;
        postFilters.push(`fade=t=in:st=0:d=${fadeDuration}`);
        postFilters.push(`fade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
      }
      if (resolutionSettings.scale) {
        postFilters.push(`scale=${resolutionSettings.scale}`);
      }

      if (postFilters.length > 0) {
        filterComplex += `[vpre]${postFilters.join(',')}[vout];`;
        if (hasAudio && fadeInOut) {
          const fadeOutStart = targetDuration - fadeDuration;
          filterComplex += `[apre]afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${fadeOutStart}:d=${fadeDuration}[aout];`;
        }
      }

      filterComplex = filterComplex.replace(/;$/, '');

      args.push('-filter_complex', filterComplex);
      args.push('-map', '[vout]');

      if (hasAudio) {
        args.push('-map', '[aout]');
        args.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        args.push('-an'); // No audio output
      }

      args.push(
        '-t',
        targetDuration.toString(),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p', // Required for Roku compatibility
        '-preset',
        preset,
        '-crf',
        crf.toString(),
        '-threads',
        '0',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        job.outputPath,
      );

      return args;
    }

    // Default: simple loop (fallback)
    return [
      '-y',
      '-stream_loop', '-1',
      '-i', sourcePath,
      '-t', targetDuration.toString(),
      '-c', 'copy',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      job.outputPath,
    ];
  }

  /**
   * Parse ffmpeg progress output
   */
  parseProgress(job, output) {
    // Parse out_time_ms=XXXXXX
    const timeMatch = output.match(/out_time_ms=(\d+)/);
    if (timeMatch) {
      const currentMs = parseInt(timeMatch[1], 10);
      job.currentTime = currentMs / 1000000; // Convert to seconds
      job.progress = Math.min(99, Math.round((job.currentTime / job.targetDuration) * 100));
    }

    // Parse speed=X.XXx
    const speedMatch = output.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) {
      job.speed = parseFloat(speedMatch[1]);

      // Calculate ETA
      if (job.speed > 0) {
        const remaining = job.targetDuration - job.currentTime;
        job.eta = Math.round(remaining / job.speed);
      }
    }
  }

  /**
   * Get job status
   */
  getJob(jobId) {
    return activeJobs.get(jobId) || null;
  }

  /**
   * Get all active jobs
   */
  getActiveJobs() {
    return Array.from(activeJobs.values()).filter((j) => j.status === 'processing');
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    const job = activeJobs.get(jobId);
    if (job && job.status === 'processing') {
      job.status = 'cancelled';
      // SL10: actually kill the ffmpeg child. Without this the encode kept
      // running to completion and the "cancelled" video reappeared in the
      // library. The SIGKILL'd close triggers cleanup of the partial output.
      if (job._proc) {
        try { job._proc.kill('SIGKILL'); } catch { /* already exited */ }
      }
      return true;
    }
    return false;
  }

  /**
   * Clean up old completed jobs from memory
   */
  cleanupJobs(maxAge = 3600000) {
    const now = Date.now();
    for (const [id, job] of activeJobs) {
      if (job.completedAt && (now - job.completedAt) > maxAge) {
        activeJobs.delete(id);
      }
    }
  }

  /**
   * Estimate processing time based on options
   */
  estimateTime(targetDuration, transition, quality = 'medium', resolution = 'original') {
    // Base estimates based on typical encoding speeds on a Raspberry Pi 4
    // Stream copy: very fast
    // Re-encoding varies by preset

    const needsReencode = transition !== 'none' || resolution !== 'original';

    if (!needsReencode) {
      return Math.ceil(targetDuration / 20); // Fast stream copy
    }

    // Re-encoding speed factors based on preset
    const qualityFactors = {
      high: 0.3, // slow preset - ~0.3x realtime
      medium: 0.8, // medium preset - ~0.8x realtime
      low: 2.0, // veryfast preset - ~2x realtime
    };

    const factor = qualityFactors[quality] || 0.8;
    return Math.ceil(targetDuration / factor);
  }

  /**
   * Estimate output file size
   * CRF encoding is content-dependent, so we use conservative estimates
   */
  estimateOutputSize(sourceInfo, targetDuration, sourceDuration, quality = 'medium', resolution = 'original', transition = 'none') {
    // Base calculation on source bitrate or reasonable default
    let baseBitrate = sourceInfo.bitrate || 8000000; // Default 8 Mbps (conservative)

    // If we have file size and duration, calculate actual bitrate
    if (sourceInfo.fileSize && sourceDuration) {
      baseBitrate = (sourceInfo.fileSize * 8) / sourceDuration; // bits per second
    }

    // CRF quality multipliers - these are more aggressive based on real-world results
    // CRF encoding can produce larger files than source, especially at high quality
    // These multipliers are relative to source bitrate when re-encoding
    const qualityMultipliers = {
      high: 2.8, // CRF 18 with slow preset - visually lossless, often larger than source
      medium: 1.8, // CRF 23 with medium preset - good quality, similar or slightly larger
      low: 0.8, // CRF 28 with veryfast preset - noticeable compression
    };

    // Resolution multipliers (based on pixel count ratios)
    const resolutionMultipliers = {
      original: 1.0,
      '1080p': 1.0,
      '720p': 0.44, // 720p is ~44% of 1080p pixels
      '480p': 0.2, // 480p is ~20% of 1080p pixels
    };

    // Adjust resolution multiplier based on source resolution
    let resMultiplier = resolutionMultipliers[resolution] || 1.0;
    if (resolution !== 'original' && sourceInfo.height) {
      const targetHeights = { '1080p': 1080, '720p': 720, '480p': 480 };
      const targetHeight = targetHeights[resolution];
      if (sourceInfo.height <= targetHeight) {
        // Source is smaller than target - won't upscale
        resMultiplier = 1.0;
      } else {
        // Calculate actual pixel ratio for more accurate estimate
        const sourcePixels = sourceInfo.width * sourceInfo.height;
        const targetWidth = Math.round(targetHeight * (sourceInfo.width / sourceInfo.height));
        const targetPixels = targetWidth * targetHeight;
        resMultiplier = targetPixels / sourcePixels;
      }
    }

    const qualMultiplier = qualityMultipliers[quality] || 1.8;

    // Stream copy preserves exact bitrate, re-encoding changes it
    const needsReencode = transition !== 'none' || resolution !== 'original' || quality !== 'original';

    let estimatedBitrate;
    if (!needsReencode && transition === 'none') {
      // Stream copy - exact same bitrate
      estimatedBitrate = baseBitrate;
    } else {
      // Re-encoding - apply quality and resolution multipliers
      estimatedBitrate = baseBitrate * qualMultiplier * resMultiplier;

      // Add overhead for fade/crossfade operations (slight increase in complexity)
      if (transition === 'crossfade') {
        estimatedBitrate *= 1.1; // 10% overhead for crossfade
      }
    }

    // Calculate estimated size in bytes
    const estimatedBytes = (estimatedBitrate * targetDuration) / 8;

    // Add 15% safety margin for estimation uncertainty
    const safeEstimate = estimatedBytes * 1.15;

    return {
      bytes: Math.round(safeEstimate),
      bitrate: Math.round(estimatedBitrate),
      isEstimate: true,
      confidence: 'approximate', // Could be ±30% depending on content
    };
  }

  /**
   * Get available quality and resolution presets
   */
  getPresets() {
    return {
      quality: QUALITY_PRESETS,
      resolution: RESOLUTION_PRESETS,
    };
  }
}

export default VideoProcessor;
