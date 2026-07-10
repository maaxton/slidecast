import logger from '../utils/Logger.js';

/**
 * WidgetResolver — the single place a widget reference is turned into a runnable
 * widget, unifying the two provider kinds behind ONE contract:
 *
 *   - USER widget: a bare uuid → a code-authored definition in slidecast's own
 *     WidgetRegistry, executed in the sandboxed WidgetRuntime.
 *   - EXTENSION widget: a provider-qualified id "<provider>:<type>" → a type in
 *     the platform WidgetProviderRegistry (ctx.platform.widgetProviderRegistry),
 *     executed as real JS in the providing extension's own ctx.
 *
 * The colon in the id is the discriminator (a DB uuid never contains one). Every
 * consumer — the refresh service, the render pipeline, the studio picker, the
 * interaction dispatcher — goes through resolve() and uses the returned contract,
 * never raw widget code. Contract:
 *
 *   {
 *     id, source: 'user'|'provider', name, renderMode, refreshInterval,
 *     configSchema, styleSchema, defaultSize, actions,
 *     produce({config, styles, size, options}) -> { primitives, data, html },
 *   }
 */
class WidgetResolver {
  constructor({ widgetRegistry, widgetRuntime, widgetProviderRegistry }) {
    this.widgetRegistry = widgetRegistry;
    this.widgetRuntime = widgetRuntime;
    // From ctx.platform — may be null if the platform predates the registry.
    this.widgetProviderRegistry = widgetProviderRegistry || null;
  }

  /** True if this id refers to an extension-provided widget type. */
  static isProviderId(id) {
    return typeof id === 'string' && id.includes(':');
  }

  /**
   * Resolve a widget id to the unified contract, or null if unknown.
   * @param {string} id - a DB widget uuid OR "<provider>:<type>"
   */
  async resolve(id) {
    if (WidgetResolver.isProviderId(id)) {
      const spec = this.widgetProviderRegistry?.resolveById?.(id) || null;
      return spec ? this._fromProvider(spec) : null;
    }
    let def = null;
    try { def = await this.widgetRegistry?.getByUuid?.(id); } catch { def = null; }
    return def ? this._fromUserWidget(def) : null;
  }

  /** Adapter for a code-authored (user) widget — WidgetRuntime does the work. */
  _fromUserWidget(def) {
    const runtime = this.widgetRuntime;
    return {
      id: def.uuid,
      source: 'user',
      name: def.name,
      renderMode: def.renderMode || 'native',
      refreshInterval: def.refreshInterval || 60000,
      configSchema: def.configSchema || {},
      styleSchema: def.styleSchema || {},
      defaultSize: def.defaultSize || { width: 300, height: 150 },
      actions: {}, // user code widgets have no interaction handlers (yet)
      interactions: [],
      async produce({ config = {}, styles = {}, options = {} } = {}) {
        // WidgetRuntime.execute merges schema defaults + runs server→client code,
        // returning { success, primitives, serverData, html, renderMode }.
        const result = await runtime.execute(def, config, styles, null, options);
        if (!result || !result.success) {
          throw new Error(result?.error || 'widget execution failed');
        }
        return { primitives: result.primitives, data: result.serverData, html: result.html };
      },
    };
  }

  /**
   * Adapter for an extension-provided widget type — getData then render, both
   * reached through the WidgetProviderRegistry's invoke methods (fork-host Wave 2
   * Task 2, B1) rather than calling spec.getData/spec.render directly. The
   * registry resolves in-process vs isolated; this adapter only ever sees the
   * unified `Promise<*>` result, same as before.
   */
  _fromProvider(spec) {
    const mergeDefaults = WidgetResolver._mergeDefaults;
    const registry = this.widgetProviderRegistry;
    const providerId = `${spec.provider}:${spec.type}`;
    return {
      id: providerId,
      source: 'provider',
      provider: spec.provider,
      type: spec.type,
      name: spec.name,
      renderMode: spec.renderMode || 'image',
      refreshInterval: spec.refreshInterval || 60000,
      configSchema: spec.configSchema || {},
      styleSchema: spec.styleSchema || {},
      defaultSize: spec.defaultSize || { width: 300, height: 150 },
      actions: spec.actions || {},
      // Focusable interactions ({action, label}) surfaced to the render pipeline
      // (to mark the layer interactive) and the device (OK-press → action).
      interactions: spec.interactions || [],
      // Kept so the interaction dispatcher can call actions with the ext's ctx.
      _spec: spec,
      async produce({
        config = {}, styles = {}, size = null, options = {},
      } = {}) {
        const mergedConfig = mergeDefaults(config, spec.configSchema);
        const mergedStyles = mergeDefaults(styles, spec.styleSchema);
        const data = await registry.getWidgetData(providerId, { config: mergedConfig });
        const primitives = await registry.renderWidget(providerId, {
          config: mergedConfig,
          styles: mergedStyles,
          data,
          size: size || spec.defaultSize,
          ...options,
        });
        return { primitives, data, html: '' };
      },
    };
  }

  /**
   * Dispatch an interaction action for a resolved widget. Only provider widgets
   * expose actions; the handler runs through WidgetProviderRegistry.
   * dispatchWidgetAction (fork-host Wave 2 Task 2, B1) instead of being called
   * directly here — the registry resolves in-process vs isolated.
   * @returns {Promise<any>} the action result
   */
  async dispatchAction(id, actionName, params = {}) {
    const resolved = await this.resolve(id);
    if (!resolved) throw new Error(`Unknown widget: ${id}`);
    const fn = resolved.actions?.[actionName];
    if (typeof fn !== 'function') {
      throw new Error(`Widget ${id} has no action '${actionName}'`);
    }
    logger.info(`widget interaction: ${id}.${actionName}`);
    return this.widgetProviderRegistry.dispatchWidgetAction(id, actionName, params);
  }

  static _mergeDefaults(values, schema) {
    if (!schema || typeof schema !== 'object') return values || {};
    const result = { ...(values || {}) };
    for (const [key, field] of Object.entries(schema)) {
      if (result[key] === undefined && field && field.default !== undefined) {
        result[key] = field.default;
      }
    }
    return result;
  }
}

export default WidgetResolver;
