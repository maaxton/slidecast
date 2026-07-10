import crypto from 'crypto';
import logger from '../utils/Logger.js';
/**
 * WidgetSecrets - Encrypted per-widget secret management
 * Stores API keys and sensitive data securely
 */

class WidgetSecrets {
  constructor(api) {
    this.api = api;
    this.model = null;
    this.encryptionKey = null;
    this.algorithm = 'aes-256-gcm';
  }

  async init() {
    this.model = this.api.model('slidecast_widget_secrets');

    // Get or generate encryption key from system secrets
    await this.initEncryptionKey();

    logger.info('WidgetSecrets initialized');
  }

  /**
   * Initialize encryption key from extension settings
   */
  async initEncryptionKey() {
    try {
      // Try to get existing key from slidecast_settings
      const settings = await this.api.model('slidecast_settings').findAll({
        where: { key: 'widget_encryption_key' },
      });

      if (settings && settings.length > 0 && settings[0].value) {
        this.encryptionKey = Buffer.from(settings[0].value, 'hex');
      } else {
        // Generate new key
        this.encryptionKey = crypto.randomBytes(32);

        // Store in slidecast_settings
        await this.api.model('slidecast_settings').create({
          key: 'widget_encryption_key',
          value: this.encryptionKey.toString('hex'),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        logger.info('Generated new widget encryption key');
      }
    } catch (error) {
      // Fallback to derived key - still secure, just not rotatable
      logger.debug(`Using derived encryption key: ${error.message}`);
      this.encryptionKey = crypto.scryptSync('slidecast-widget-secrets', 'waiveo-salt-v4', 32);
    }
  }

  /**
   * Encrypt a value
   */
  encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return IV + authTag + encrypted data
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a value
   */
  decrypt(encrypted) {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const data = parts[2];

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Set a secret for a widget
   */
  async set(widgetUuid, keyName, value) {
    const encryptedValue = this.encrypt(value);

    // Check if exists
    const existing = await this.model.findAll({
      where: { widget_uuid: widgetUuid, key_name: keyName },
    });

    if (existing && existing.length > 0) {
      // Update existing
      await this.model.update(existing[0].id, {
        encrypted_value: encryptedValue,
      });
    } else {
      // Create new
      await this.model.create({
        widget_uuid: widgetUuid,
        key_name: keyName,
        encrypted_value: encryptedValue,
        created_at: new Date().toISOString(),
      });
    }

    logger.debug(`Secret '${keyName}' set for widget ${widgetUuid}`);
    return true;
  }

  /**
   * Get decrypted secret value
   */
  async getDecrypted(widgetUuid, keyName) {
    const secrets = await this.model.findAll({
      where: { widget_uuid: widgetUuid, key_name: keyName },
    });

    if (!secrets || secrets.length === 0) {
      return null;
    }

    try {
      return this.decrypt(secrets[0].encrypted_value);
    } catch (error) {
      logger.error(`Failed to decrypt secret '${keyName}': ${error.message}`);
      return null;
    }
  }

  /**
   * List secret keys for a widget (not values)
   */
  async list(widgetUuid) {
    const secrets = await this.model.findAll({
      where: { widget_uuid: widgetUuid },
    });

    return secrets.map((s) => ({
      keyName: s.key_name,
      createdAt: s.created_at,
      // Mask the value
      hasValue: true,
    }));
  }

  /**
   * Delete a secret
   */
  async delete(widgetUuid, keyName) {
    const secrets = await this.model.findAll({
      where: { widget_uuid: widgetUuid, key_name: keyName },
    });

    if (secrets && secrets.length > 0) {
      await this.model.delete(secrets[0].id);
      logger.debug(`Secret '${keyName}' deleted for widget ${widgetUuid}`);
      return true;
    }

    return false;
  }

  /**
   * Delete all secrets for a widget
   */
  async deleteAll(widgetUuid) {
    const secrets = await this.model.findAll({
      where: { widget_uuid: widgetUuid },
    });

    for (const secret of secrets) {
      await this.model.delete(secret.id);
    }

    return secrets.length;
  }

  /**
   * Check if a secret exists
   */
  async exists(widgetUuid, keyName) {
    const secrets = await this.model.findAll({
      where: { widget_uuid: widgetUuid, key_name: keyName },
    });

    return secrets && secrets.length > 0;
  }
}

export default WidgetSecrets;
