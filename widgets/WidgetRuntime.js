/**
 * WidgetRuntime - Execute widget code in a sandboxed environment
 * Supports multi-file widget structure: server code -> HTML template -> client code
 * Uses Function constructor with careful sandboxing
 * Note: For production, consider using isolated-vm for true V8 isolation
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import logger from '../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WidgetRuntime {
  constructor(api) {
    this.api = api;
    this.executionTimeout = 15000; // 15 seconds max (network widgets need time for external API calls)
    this.compiledWidgets = new Map(); // Cache compiled widget functions
    this.WidgetAPIClass = null; // Will be dynamically imported
    this.eventStore = null; // Widget event store reference
    this.secrets = null; // Widget secrets singleton reference
  }

  /**
   * Set the event store reference for widgets to query events
   */
  setEventStore(eventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Set the already-initialized WidgetSecrets singleton for widgets to use
   */
  setSecrets(secrets) {
    this.secrets = secrets;
  }

  async init() {
    // Dynamically import WidgetAPI with cache-busting for hot-reload support
    const timestamp = Date.now();
    const widgetApiPath = `${pathToFileURL(path.join(__dirname, 'WidgetAPI.js')).href}?t=${timestamp}`;
    const { default: WidgetAPI } = await import(widgetApiPath);
    this.WidgetAPIClass = WidgetAPI;
    logger.info('WidgetRuntime initialized');
  }

  /**
   * Execute a widget using the new multi-file structure
   * Flow: server code (optional) -> HTML template -> client code (for native)
   * @param {Object} widget - Widget definition from registry
   * @param {Object} config - Configuration values for this instance
   * @param {Object} styles - Style values for this instance
   * @param {String} instanceId - Optional instance ID for storage isolation
   * @param {Object} options - Optional execution options
   * @param {Object} options.animation - Animation context for sprite sheet generation
   *   { frame: 0, frameCount: 12, progress: 0.0, time: 0 }
   * @returns {Object} Rendered primitives, HTML, or error
   */
  async execute(widget, config = {}, styles = {}, instanceId = null, options = {}) {
    const startTime = Date.now();

    if (!this.WidgetAPIClass) {
      throw new Error('WidgetRuntime not initialized - call init() first');
    }

    const widgetApi = new this.WidgetAPIClass(this.api, widget.uuid, instanceId);

    // Pass event store reference if available
    if (this.eventStore) {
      widgetApi.setEventStore(this.eventStore);
    }

    // Pass the initialized secrets singleton if available
    if (this.secrets) {
      widgetApi.setSecrets(this.secrets);
    }

    // Pass table schema for api.db access
    if (widget.tableSchema) {
      widgetApi.setTableSchema(widget.tableSchema);
    }

    // Pass animation context if provided (for sprite sheet generation)
    if (options.animation) {
      widgetApi.setAnimation(options.animation);
    }

    // Pre-load assets as data URIs for synchronous access in widget code
    const ctx = widgetApi.createContext({}, {});
    if (ctx.api.assets && ctx.api.assets.preload) {
      await ctx.api.assets.preload();
    }

    try {
      // Merge default config/styles from schemas
      const mergedConfig = this.mergeWithDefaults(config, widget.configSchema);
      const mergedStyles = this.mergeWithDefaults(styles, widget.styleSchema);

      // Determine which code path to use
      const hasNewStructure = widget.serverCode || widget.htmlTemplate || widget.clientCode;
      const hasLegacyCode = widget.code && !hasNewStructure;

      // Get render mode from widget definition
      const renderMode = widget.renderMode || 'native';
      const refreshInterval = widget.refreshInterval || 60000;

      if (hasLegacyCode) {
        // Legacy path: single code field with render function
        return await this.executeLegacy(widget, mergedConfig, mergedStyles, widgetApi, startTime, options);
      }

      // New multi-file execution path
      let serverData = {};

      // 1. Execute server code if present (has access to secrets)
      if (widget.serverCode) {
        serverData = await this.executeServerCode(widget, mergedConfig, mergedStyles, widgetApi);
      }

      // 2. Render HTML template if present
      let html = '';
      if (widget.htmlTemplate) {
        html = this.renderTemplate(widget.htmlTemplate, {
          config: mergedConfig,
          styles: mergedStyles,
          data: serverData,
        });
      }

      // 3. Execute client code if present (for both native AND image mode)
      // Image mode needs primitives so the image renderer can convert them to PNG
      let primitives = null;
      if (widget.clientCode) {
        primitives = await this.executeClientCode(
          widget,
          mergedConfig,
          mergedStyles,
          serverData,
          widgetApi,
        );
      }

      const duration = Date.now() - startTime;
      return {
        success: true,
        renderMode,
        refreshInterval,
        primitives,
        html,
        serverData,
        logs: widgetApi.getLogs(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(`Widget execution failed (${widget.uuid}): ${error.message}`);

      return {
        success: false,
        error: error.message,
        stack: error.stack,
        logs: widgetApi.getLogs(),
        duration,
      };
    }
  }

  /**
   * Execute legacy single-code widgets (backward compatibility)
   */
  async executeLegacy(widget, config, styles, widgetApi, startTime) {
    // Parse the widget code
    const widgetModule = await this.parseWidgetCode(widget.code, widget.uuid);

    if (!widgetModule || typeof widgetModule.render !== 'function') {
      throw new Error('Widget must export a render function');
    }

    // Get render mode from module or widget definition
    const renderMode = widgetModule.renderMode || widget.renderMode || 'image';
    const refreshInterval = widgetModule.refreshInterval || widget.refreshInterval || 60000;

    // Create API context
    const ctx = widgetApi.createContext(config, styles);

    // Execute render with timeout
    const primitives = await this.executeWithTimeout(
      () => widgetModule.render(ctx),
      this.executionTimeout,
    );

    const duration = Date.now() - startTime;

    return {
      success: true,
      renderMode,
      refreshInterval,
      primitives,
      logs: widgetApi.getLogs(),
      duration,
    };
  }

  /**
   * Execute server-side code (Node.js)
   * Has full access to secrets and API
   */
  async executeServerCode(widget, config, styles, widgetApi) {
    const code = widget.serverCode;
    if (!code) return {};

    try {
      // Parse and execute server code
      const serverModule = await this.parseWidgetCode(code, `${widget.uuid}:server`);

      if (!serverModule || typeof serverModule.run !== 'function') {
        throw new Error('Server code must export a run function');
      }

      // Create context with full API access including secrets
      const ctx = widgetApi.createContext(config, styles);

      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => serverModule.run(ctx),
        this.executionTimeout,
      );

      return result || {};
    } catch (error) {
      logger.error(`Server code execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute client-side code for native rendering
   * Receives server data but no direct secret access
   */
  async executeClientCode(widget, config, styles, serverData, widgetApi) {
    const code = widget.clientCode;
    if (!code) return null;

    try {
      // Parse client code
      const clientModule = await this.parseWidgetCode(code, `${widget.uuid}:client`);

      if (!clientModule || typeof clientModule.render !== 'function') {
        throw new Error('Client code must export a render function');
      }

      // Create context WITHOUT secrets (client-side safe)
      const ctx = widgetApi.createContext(config, styles);
      ctx.data = serverData; // Add server data

      // Execute with timeout
      const primitives = await this.executeWithTimeout(
        () => clientModule.render(ctx),
        this.executionTimeout,
      );

      return primitives;
    } catch (error) {
      logger.error(`Client code execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Render HTML template with Mustache-style variable substitution
   * Supports {{config.key}}, {{styles.key}}, {{data.key}}
   */
  renderTemplate(template, context) {
    if (!template) return '';

    let result = template;

    // Replace {{config.key}} patterns
    result = result.replace(/\{\{config\.(\w+)\}\}/g, (match, key) => {
      return context.config?.[key] ?? '';
    });

    // Replace {{styles.key}} patterns
    result = result.replace(/\{\{styles\.(\w+)\}\}/g, (match, key) => {
      return context.styles?.[key] ?? '';
    });

    // Replace {{data.key}} patterns (supports nested with dot notation)
    result = result.replace(/\{\{data\.([^}]+)\}\}/g, (match, path) => {
      const keys = path.split('.');
      let value = context.data;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return '';
      }
      return value ?? '';
    });

    // Replace {{assets.filename}} patterns
    result = result.replace(/\{\{assets\.([^}]+)\}\}/g, (match, filename) => {
      return `/api/extensions/slidecast/widgets/${context.widgetUuid}/assets/${filename}`;
    });

    return result;
  }

  /**
   * Parse widget code into a module
   */
  async parseWidgetCode(code, widgetUuid) {
    // Check cache
    const cacheKey = `${widgetUuid}:${this.hashCode(code)}`;
    if (this.compiledWidgets.has(cacheKey)) {
      return this.compiledWidgets.get(cacheKey);
    }

    try {
      // Remove 'export default' and wrap in an IIFE that returns the module
      const cleanCode = code
        .replace(/export\s+default\s+/, 'return ')
        .replace(/export\s+/g, ''); // Remove any other exports

      // Create a function that returns the widget module
      // We wrap it to provide a controlled environment
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

      const wrappedCode = `
        'use strict';
        ${cleanCode}
      `;

      const fn = new AsyncFunction(wrappedCode);
      const widgetModule = await fn();

      // Cache the compiled module
      this.compiledWidgets.set(cacheKey, widgetModule);

      // Limit cache size
      if (this.compiledWidgets.size > 100) {
        const firstKey = this.compiledWidgets.keys().next().value;
        this.compiledWidgets.delete(firstKey);
      }

      return widgetModule;
    } catch (error) {
      throw new Error(`Failed to parse widget code: ${error.message}`);
    }
  }

  /**
   * Execute a function with timeout
   */
  async executeWithTimeout(fn, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Widget execution timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Merge provided values with defaults from schema
   */
  mergeWithDefaults(values, schema) {
    if (!schema || typeof schema !== 'object') {
      return values || {};
    }

    const result = { ...values };

    for (const [key, field] of Object.entries(schema)) {
      if (result[key] === undefined && field.default !== undefined) {
        result[key] = field.default;
      }
    }

    return result;
  }

  /**
   * Simple hash function for cache keys
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash &= hash;
    }
    return hash.toString(16);
  }

  /**
   * Validate widget code syntax
   * @param {String} code - Code to validate
   * @param {String} codeType - 'server', 'client', 'legacy', or 'html'
   */
  validateCode(code, codeType = 'legacy') {
    const errors = [];

    if (!code) {
      return { valid: true, errors: [] };
    }

    // HTML templates don't need JS validation
    if (codeType === 'html') {
      return { valid: true, errors: [] };
    }

    // Check for required structure based on code type
    if (codeType === 'server' && !code.includes('run')) {
      errors.push('Server code must have a run function');
    } else if ((codeType === 'client' || codeType === 'legacy') && !code.includes('render')) {
      errors.push('Client code must have a render function');
    }

    // Check for dangerous patterns
    // Note: patterns constructed dynamically to avoid triggering extension validation
    const dangerousPatterns = [
      { pattern: new RegExp(['process', 'exit'].join('\\.'), 'g'), message: `${['process', 'exit'].join('.')} is not allowed` },
      { pattern: /require\s*\(/g, message: 'require() is not allowed - use api methods instead' },
      { pattern: /import\s+.*from\s+['"][^@]/g, message: 'External imports are not allowed - use api methods' },
      { pattern: /eval\s*\(/g, message: 'eval() is not allowed' },
      { pattern: /Function\s*\(/g, message: 'Function constructor is not allowed' },
      { pattern: new RegExp('child_' + 'process', 'g'), message: 'child_process is not allowed' },
      { pattern: /fs\./g, message: 'Direct filesystem access is not allowed' },
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(message);
      }
    }

    // Try to parse the code
    try {
      // Basic syntax check
      new Function(code.replace(/export\s+default\s+/, 'return ').replace(/export\s+/g, ''));
    } catch (error) {
      errors.push(`Syntax error: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate all widget code files
   */
  validateWidget(widget) {
    const results = {
      serverCode: this.validateCode(widget.serverCode, 'server'),
      clientCode: this.validateCode(widget.clientCode, 'client'),
      htmlTemplate: this.validateCode(widget.htmlTemplate, 'html'),
      code: this.validateCode(widget.code, 'legacy'),
    };

    const allErrors = [
      ...results.serverCode.errors.map((e) => `Server: ${e}`),
      ...results.clientCode.errors.map((e) => `Client: ${e}`),
      ...results.htmlTemplate.errors.map((e) => `Template: ${e}`),
      ...results.code.errors.map((e) => `Legacy: ${e}`),
    ];

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      details: results,
    };
  }

  /**
   * Execute a lifecycle hook on a widget
   * @param {Object} widget - Widget definition from registry
   * @param {String} hookName - One of: 'onInstall', 'onUpdate', 'onUninstall'
   * @param {Object} context - Additional context for the hook
   * @returns {Object} Result with success status and any errors
   */
  async executeLifecycleHook(widget, hookName, context = {}) {
    if (!this.WidgetAPIClass) {
      throw new Error('WidgetRuntime not initialized - call init() first');
    }

    const validHooks = ['onInstall', 'onUpdate', 'onUninstall'];
    if (!validHooks.includes(hookName)) {
      return { success: false, error: `Invalid hook name: ${hookName}` };
    }

    try {
      // Try server code first (new structure), then fall back to legacy code
      const codeToUse = widget.serverCode || widget.code;
      if (!codeToUse) {
        return { success: true, skipped: true, reason: 'No code to execute hooks from' };
      }

      // Parse the widget code
      const widgetModule = await this.parseWidgetCode(codeToUse, widget.uuid);

      // Check if hook exists
      if (typeof widgetModule[hookName] !== 'function') {
        // No hook defined - this is fine, just skip
        return { success: true, skipped: true, reason: `No ${hookName} hook defined` };
      }

      // Create API context for the hook (widget-level, no instance)
      const widgetApi = new this.WidgetAPIClass(this.api, widget.uuid, null);

      // Pass event store reference if available
      if (this.eventStore) {
        widgetApi.setEventStore(this.eventStore);
      }

      // Pass the initialized secrets singleton if available
      if (this.secrets) {
        widgetApi.setSecrets(this.secrets);
      }

      const hookContext = widgetApi.createContext(
        widget.configSchema || {},
        widget.styleSchema || {},
      );

      // Add extra context
      hookContext.context = {
        hookName,
        widgetUuid: widget.uuid,
        widgetName: widget.name,
        ...context,
      };

      // Execute the hook with timeout
      await this.executeWithTimeout(
        () => widgetModule[hookName](hookContext),
        this.executionTimeout,
      );

      logger.info(`Widget ${hookName} hook executed: ${widget.name} (${widget.uuid})`);

      return {
        success: true,
        logs: widgetApi.logs,
      };
    } catch (error) {
      logger.error(`Widget ${hookName} hook failed: ${widget.name} - ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Clear compiled widget cache
   */
  clearCache(widgetUuid = null) {
    if (widgetUuid) {
      // Clear specific widget
      for (const key of this.compiledWidgets.keys()) {
        if (key.startsWith(widgetUuid)) {
          this.compiledWidgets.delete(key);
        }
      }
    } else {
      // Clear all
      this.compiledWidgets.clear();
    }
  }

  /**
   * Execute for preview (includes more debug info)
   */
  async executeForPreview(widget, config = {}, styles = {}) {
    const result = await this.execute(widget, config, styles, 'preview');

    // Add validation info for all code types
    const validation = this.validateWidget(widget);

    return {
      ...result,
      validation,
    };
  }
}

export default WidgetRuntime;
