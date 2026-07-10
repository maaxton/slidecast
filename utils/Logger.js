/**
 * SlideCast Logger - Centralized logging with configurable log level
 *
 * This logger:
 * - Respects the log_level setting from slidecast_settings
 * - Wraps api.log() to store in extension_logs database
 * - Only outputs to console for errors (to keep Docker logs clean)
 *
 * Log Levels (priority order):
 * - error: 3 - Always logged
 * - warn:  2 - Warnings and above
 * - info:  1 - Info, warnings, errors (default)
 * - debug: 0 - Everything (verbose)
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  constructor() {
    this.api = null;
    this.cachedLogLevel = 'warn'; // Default to warn (quieter)
    this.lastLevelCheck = 0;
    this.levelCheckInterval = 30000; // Re-check setting every 30 seconds
  }

  /**
   * Initialize with extension API reference
   */
  init(api) {
    this.api = api;
    // Load initial log level
    this.refreshLogLevel();
  }

  /**
   * Refresh log level from database
   */
  async refreshLogLevel() {
    if (!this.api) return;

    try {
      const settings = await this.api.model('slidecast_settings').findAll({ where: { key: 'log_level' } });
      if (settings && settings.length > 0) {
        this.cachedLogLevel = settings[0].value || 'warn';
      }
      this.lastLevelCheck = Date.now();
    } catch (err) {
      // Silently use cached/default value
    }
  }

  /**
   * Get current log level (with caching)
   */
  async getLogLevel() {
    const now = Date.now();

    // Refresh if cache is stale
    if (now - this.lastLevelCheck > this.levelCheckInterval) {
      await this.refreshLogLevel();
    }

    return this.cachedLogLevel;
  }

  /**
   * Update cached log level (called when settings change)
   */
  setLogLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      this.cachedLogLevel = level;
      this.lastLevelCheck = Date.now();
    }
  }

  /**
   * Check if a level should be logged
   */
  shouldLog(level, configuredLevel) {
    const levelPriority = LOG_LEVELS[level] ?? 1;
    const configuredPriority = LOG_LEVELS[configuredLevel] ?? 1;
    return levelPriority >= configuredPriority;
  }

  /**
   * Main log method - wraps api.log() with local level filtering
   */
  async log(message, level = 'info', metadata = null) {
    // Skip if API not initialized yet (happens during dynamic import)
    if (!this.api) {
      // Only show errors to console as fallback
      if (level === 'error') {
        console.error(`[slidecast] ${message}`);
      }
      return;
    }

    const configuredLevel = await this.getLogLevel();

    // Check if we should log at this level
    if (!this.shouldLog(level, configuredLevel)) {
      return;
    }

    // Use api.log() which handles DB storage and respects debug mode
    try {
      await this.api.log(message, level, metadata);
    } catch (err) {
      // Fallback to console if api.log fails
      if (level === 'error') {
        console.error(`[slidecast] ${message}`);
      }
    }
  }

  // Convenience methods (non-async for easier use, they queue internally)
  // These are safe to call even before init() - they'll silently skip if not ready
  debug(message, metadata = null) {
    if (this.api) this.log(message, 'debug', metadata);
  }

  info(message, metadata = null) {
    if (this.api) this.log(message, 'info', metadata);
  }

  warn(message, metadata = null) {
    if (this.api) this.log(message, 'warn', metadata);
  }

  error(message, metadata = null) {
    // Errors always go to console as fallback
    if (!this.api) {
      console.error(`[slidecast] ${message}`);
      return;
    }
    this.log(message, 'error', metadata);
  }
}

// Singleton instance
const logger = new Logger();

export default logger;
export { Logger, LOG_LEVELS };
