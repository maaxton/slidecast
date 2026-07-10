import crypto from 'crypto';
import logger from './utils/Logger.js';
/**
 * PairingManager - Handles device pairing with codes/QR
 * Manages pairing code generation, validation, and device token lifecycle
 */

export default class PairingManager {
  constructor(api) {
    this.api = api;
    this.CODE_LENGTH = 6;
    this.CODE_EXPIRY_MINUTES = 15;
    this.model = null;
    this.tokenModel = null;
    this.cleanupInterval = null;
    // Job id from the platform scheduler (#1029, Wave 2 of #1024). Stored
    // so destroy() / scheduler.shutdown() can drain the recurring sweep
    // and we don't leak a closure across hot-reload.
    this._cleanupJobId = null;
  }

  async initialize() {
    this.model = this.api.model('slidecast_pairing_codes');
    this.tokenModel = this.api.model('slidecast_device_tokens');

    // Create tables if they don't exist
    await this.model.createTable();
    await this.tokenModel.createTable();

    // Clean up expired codes periodically — schedule via the platform
    // scheduler so the recurring sweep is cancelled cleanly on hot-reload
    // (#1029). Falls back to raw setInterval only when the host did not
    // wire api.scheduler (legacy test fixtures).
    this.cleanupExpiredCodes();
    if (this.api && this.api.scheduler && typeof this.api.scheduler.schedule === 'function') {
      this._cleanupJobId = this.api.scheduler.schedule(
        () => this.cleanupExpiredCodes(),
        { intervalMs: 60000, name: 'pairing-cleanup' },
      );
    } else {
      this.cleanupInterval = setInterval(() => this.cleanupExpiredCodes(), 60000);
    }
  }

  /**
   * Generate a new pairing code for a device
   */
  async generatePairingCode(deviceInfo) {
    const {
      serial, platform, model, app_version, capabilities,
    } = deviceInfo;

    // Check if there's already a pending code for this device
    const existing = await this.model.findAll({
      where: { device_serial: serial, status: 'pending' },
    });

    // Expire any existing codes
    for (const code of existing) {
      await this.model.update(code.id, { status: 'expired' });
    }

    // Generate unique 6-digit code
    const code = await this.generateUniqueCode();

    // Calculate expiry
    const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MINUTES * 60 * 1000);

    // Store the code
    const record = await this.model.create({
      code,
      device_serial: serial,
      device_info: JSON.stringify({
        platform, model, app_version, capabilities,
      }),
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    });

    logger.info(`Pairing code generated for device ${serial}: ${code}`);

    return {
      pairing_code: code,
      expires_at: expiresAt.toISOString(),
      expires_in: this.CODE_EXPIRY_MINUTES * 60,
    };
  }

  /**
   * Generate a unique 6-digit code
   */
  async generateUniqueCode() {
    const maxAttempts = 10;

    for (let i = 0; i < maxAttempts; i++) {
      // Generate random 6-digit code (100000-999999)
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Check if code is already in use
      const existing = await this.model.findAll({
        where: { code, status: 'pending' },
      });

      if (!existing || existing.length === 0) {
        return code;
      }
    }

    throw new Error('Failed to generate unique pairing code');
  }

  /**
   * Get pairing status for a code (device polling)
   */
  async getPairingStatus(code) {
    const records = await this.model.findAll({
      where: { code },
    });

    if (!records || records.length === 0) {
      return { paired: false, expired: true, message: 'Code not found' };
    }

    const record = records[0];

    // Check if expired
    if (new Date(record.expires_at) < new Date()) {
      if (record.status === 'pending') {
        await this.model.update(record.id, { status: 'expired' });
      }
      return { paired: false, expired: true, message: 'Code has expired' };
    }

    if (record.status === 'paired') {
      // Get the device token
      const tokens = await this.tokenModel.findAll({
        where: { device_serial: record.device_serial, revoked: 0 },
      });

      if (tokens && tokens.length > 0) {
        const token = tokens[0];

        // Get screen info
        const screenModel = this.api.model('slidecast_screens');
        const screens = await screenModel.findAll({
          where: { serial: record.device_serial },
        });
        const screen = screens?.[0];

        return {
          paired: true,
          expired: false,
          token: token.token,
          screen_id: record.device_serial,
          assigned_cast: screen?.assigned_cast_id || null,
        };
      }
    }

    // Still pending
    return {
      paired: false,
      expired: false,
      pending: true,
      expires_in: Math.max(0, Math.floor((new Date(record.expires_at) - Date.now()) / 1000)),
    };
  }

  /**
   * Complete pairing from web UI (admin approves)
   */
  async completePairing(code, userId, screenName = null) {
    const records = await this.model.findAll({
      where: { code, status: 'pending' },
    });

    if (!records || records.length === 0) {
      return { success: false, error: 'Invalid or expired code' };
    }

    const record = records[0];

    // Check if expired
    if (new Date(record.expires_at) < new Date()) {
      await this.model.update(record.id, { status: 'expired' });
      return { success: false, error: 'Code has expired' };
    }

    // Generate device token
    const token = this.generateDeviceToken();
    const tokenHash = this.hashToken(token);

    // Store device token
    await this.tokenModel.create({
      device_serial: record.device_serial,
      token,
      token_hash: tokenHash,
      device_info: record.device_info,
      paired_by_user_id: userId,
      last_used_at: new Date().toISOString(),
    });

    // Update pairing code status
    await this.model.update(record.id, {
      status: 'paired',
      paired_by_user_id: userId,
    });

    // Register/update the screen
    const screenModel = this.api.model('slidecast_screens');
    const existingScreens = await screenModel.findAll({
      where: { serial: record.device_serial },
    });

    const deviceInfo = typeof record.device_info === 'string'
      ? JSON.parse(record.device_info)
      : record.device_info;

    if (existingScreens && existingScreens.length > 0) {
      // Update existing screen
      await screenModel.update(existingScreens[0].id, {
        name: screenName || existingScreens[0].name || `Screen ${record.device_serial.slice(-4)}`,
        platform: deviceInfo?.platform,
        model: deviceInfo?.model,
        status: 'online',
        metadata: JSON.stringify(deviceInfo),
      });
    } else {
      // Create new screen
      await screenModel.create({
        serial: record.device_serial,
        name: screenName || `Screen ${record.device_serial.slice(-4)}`,
        platform: deviceInfo?.platform,
        model: deviceInfo?.model,
        status: 'online',
        metadata: JSON.stringify(deviceInfo),
      });
    }

    logger.info(`Device ${record.device_serial} paired by user ${userId}`);

    // Fire automation trigger (if available)
    if (typeof this.api.fireTrigger === 'function') {
      this.api.fireTrigger('device_paired', {
        serial: record.device_serial,
        platform: deviceInfo?.platform,
        paired_by: userId,
      });
    }

    return {
      success: true,
      device_serial: record.device_serial,
      device_info: deviceInfo,
    };
  }

  /**
   * Validate a device token
   */
  async validateToken(token) {
    const tokenHash = this.hashToken(token);

    const records = await this.tokenModel.findAll({
      where: { token_hash: tokenHash, revoked: 0 },
    });

    if (!records || records.length === 0) {
      return { valid: false, reason: 'Token not found' };
    }

    const record = records[0];

    // Update last used
    await this.tokenModel.update(record.id, {
      last_used_at: new Date().toISOString(),
    });

    // Get screen info - try exact serial match first
    const screenModel = this.api.model('slidecast_screens');
    const screens = await screenModel.findAll({
      where: { serial: record.device_serial },
    });
    let screen = screens?.[0];

    // If not found by serial, try to find screen linked via channel_client_id
    // This handles auto-discovered screens where serial is hardware ID but Roku sends ChannelClientId
    if (!screen) {
      const allScreens = await screenModel.findAll();
      screen = allScreens.find((s) => {
        const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});

        // Match by channel_client_id stored in metadata
        if (meta.channel_client_id === record.device_serial) {
          return true;
        }

        // Check device_info for linked_screen_serial
        const deviceInfo = typeof record.device_info === 'string' ? JSON.parse(record.device_info) : (record.device_info || {});
        if (deviceInfo.linked_screen_serial && deviceInfo.linked_screen_serial === s.serial) {
          return true;
        }

        return false;
      });

      if (screen) {
        logger.info(`Found linked screen ${screen.serial} for ChannelClientId ${record.device_serial}`);
      }
    }

    // If no screen exists for this token, the token is orphaned (screen was deleted)
    // Return invalid to force re-pairing, which will recreate the screen
    if (!screen) {
      logger.warn(`Token valid but no screen exists for ${record.device_serial} - forcing re-pair`);
      return {
        valid: false,
        reason: 'screen_not_found',
        device_serial: record.device_serial,
      };
    }

    return {
      valid: true,
      device_serial: record.device_serial,
      screen_id: screen?.serial || record.device_serial,
      assigned_cast: screen?.assigned_cast_id || null,
    };
  }

  /**
   * Revoke a device token
   */
  async revokeToken(deviceSerial, userId) {
    const records = await this.tokenModel.findAll({
      where: { device_serial: deviceSerial, revoked: 0 },
    });

    for (const record of records) {
      await this.tokenModel.update(record.id, {
        revoked: true,
        revoked_at: new Date().toISOString(),
      });
    }

    logger.info(`Device ${deviceSerial} token revoked by user ${userId}`);

    return { success: true };
  }

  /**
   * Get all device tokens (for admin view)
   */
  async getDeviceTokens() {
    return await this.tokenModel.findAll({
      orderBy: 'created_at DESC',
    });
  }

  /**
   * Generate a secure device token
   */
  generateDeviceToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a token for storage
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Auto-pair a device (bypasses pairing code, for open-access mode)
   * Creates a token directly without requiring user approval
   */
  async autoPairDevice(serial, deviceInfo = {}) {
    // Check if device already has a token
    const existingTokens = await this.tokenModel.findAll({
      where: { device_serial: serial },
    });

    if (existingTokens && existingTokens.length > 0) {
      const existingToken = existingTokens[0];

      // Update device_info with new info (to link screen, etc.)
      // Merge existing info with new info
      const existingInfo = typeof existingToken.device_info === 'string'
        ? JSON.parse(existingToken.device_info || '{}')
        : (existingToken.device_info || {});
      const mergedInfo = { ...existingInfo, ...deviceInfo };

      await this.tokenModel.update(existingToken.id, {
        device_info: JSON.stringify(mergedInfo),
        last_used_at: new Date().toISOString(),
      });

      logger.debug(`Device ${serial} already has a token, updated device_info with linked_screen_serial: ${deviceInfo.linked_screen_serial}`);
      return existingToken.token;
    }

    // Generate new token
    const token = this.generateDeviceToken();
    const tokenHash = this.hashToken(token);

    // Store device token
    await this.tokenModel.create({
      device_serial: serial,
      token,
      token_hash: tokenHash,
      device_info: typeof deviceInfo === 'string' ? deviceInfo : JSON.stringify(deviceInfo),
      paired_by_user_id: null, // No user approval needed
      last_used_at: new Date().toISOString(),
    });

    logger.info(`Auto-paired device ${serial}`);
    return token;
  }

  /**
   * Clean up expired pairing codes
   */
  async cleanupExpiredCodes() {
    try {
      const allPending = await this.model.findAll({
        where: { status: 'pending' },
      });

      const now = new Date();
      let cleaned = 0;

      for (const record of allPending || []) {
        if (new Date(record.expires_at) < now) {
          await this.model.update(record.id, { status: 'expired' });
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.debug(`Cleaned up ${cleaned} expired pairing codes`);
      }
    } catch (error) {
      logger.error(`Error cleaning up pairing codes: ${error.message}`);
    }
  }

  /**
   * Stop the cleanup interval
   */
  destroy() {
    if (this._cleanupJobId !== null) {
      try {
        this.api?.scheduler?.cancel?.(this._cleanupJobId);
      } catch { /* noop */ }
      this._cleanupJobId = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
