/**
 * Model schemas for Slidecast extension
 * Defines all database table structures
 */

export const MODEL_SCHEMAS = {
  casts: {
    tableName: 'slidecast_casts',
    description: 'Slidecast presentations',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      uuid: { type: 'string', required: true },
      name: { type: 'string', required: true },
      description: { type: 'string' },
      definition: { type: 'json', required: true },
      thumbnail: { type: 'string' },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      updated_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['definition'],
    dateFields: ['created_at', 'updated_at'],
  },
  screens: {
    tableName: 'slidecast_screens',
    description: 'Connected TV screens',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      serial: { type: 'string', required: true },
      name: { type: 'string' },
      platform: { type: 'string' },
      model: { type: 'string' },
      ip_address: { type: 'string' },
      assigned_cast_id: { type: 'string' },
      tags: { type: 'json' },
      status: { type: 'string', default: 'offline' },
      last_seen_at: { type: 'datetime' },
      app_last_heartbeat: { type: 'datetime' }, // When Waiveo app last sent heartbeat
      metadata: { type: 'json' },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['tags', 'metadata'],
    dateFields: ['last_seen_at', 'app_last_heartbeat', 'created_at'],
  },
  media: {
    tableName: 'slidecast_media',
    description: 'Media assets (images, videos)',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      uuid: { type: 'string', required: true },
      name: { type: 'string', required: true },
      type: { type: 'string', required: true },
      mime_type: { type: 'string' },
      file_path: { type: 'string', required: true },
      file_size: { type: 'integer' },
      checksum: { type: 'string' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      duration: { type: 'integer' },
      thumbnail: { type: 'string' },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    dateFields: ['created_at'],
  },
  settings: {
    tableName: 'slidecast_settings',
    description: 'Extension settings',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      key: { type: 'string', required: true },
      value: { type: 'string', required: true },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      updated_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    dateFields: ['created_at', 'updated_at'],
  },
  templates: {
    tableName: 'slidecast_templates',
    description: 'Cast templates',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      uuid: { type: 'string', required: true },
      name: { type: 'string', required: true },
      description: { type: 'string' },
      author: { type: 'string' },
      definition: { type: 'json', required: true },
      thumbnail: { type: 'string' },
      is_builtin: { type: 'boolean', default: false },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['definition'],
    dateFields: ['created_at'],
  },
  // Widget system tables
  widgets: {
    tableName: 'slidecast_widgets',
    description: 'Widget definitions',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      uuid: { type: 'string', required: true },
      name: { type: 'string', required: true },
      description: { type: 'string' },
      category: { type: 'string', default: 'custom' },
      render_mode: { type: 'string', default: 'native' },
      // Multi-file code structure
      server_code: { type: 'string' }, // Node.js server code (optional) - has access to secrets
      html_template: { type: 'string' }, // HTML/Mustache template
      client_code: { type: 'string' }, // Client-side JS (optional, for native mode)
      code: { type: 'string' }, // Legacy: single code field (migrate to client_code)
      config_schema: { type: 'json' }, // Also contains _tabs for custom tabs
      style_schema: { type: 'json' },
      default_size: { type: 'json' },
      table_schema: { type: 'json' }, // Widget-defined database tables schema
      preview_primitives: { type: 'json' }, // Static preview for Studio canvas
      refresh_interval: { type: 'integer', default: 60000 },
      supports_animation: { type: 'boolean', default: false }, // Widget supports sprite sheet animation
      is_system: { type: 'boolean', default: false },
      is_published: { type: 'boolean', default: false },
      thumbnail: { type: 'string' },
      current_version: { type: 'integer', default: 1 }, // Simple version number (v1, v2, v3)
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      updated_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['config_schema', 'style_schema', 'default_size', 'table_schema', 'preview_primitives'],
    dateFields: ['created_at', 'updated_at'],
  },
  widget_assets: {
    tableName: 'slidecast_widget_assets',
    description: 'Widget assets (images, icons)',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      widget_uuid: { type: 'string', required: true },
      filename: { type: 'string', required: true },
      mime_type: { type: 'string', required: true },
      size: { type: 'integer' },
      data: { type: 'blob' },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    dateFields: ['created_at'],
  },
  widget_versions: {
    tableName: 'slidecast_widget_versions',
    description: 'Widget version history with full snapshots',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      widget_uuid: { type: 'string', required: true },
      version: { type: 'integer', required: true },
      // Code snapshots (all files)
      code: { type: 'string' }, // Legacy single file
      server_code: { type: 'string' }, // Server code snapshot
      client_code: { type: 'string' }, // Client code snapshot
      html_template: { type: 'string' }, // Template snapshot
      // Schema snapshots
      config_schema: { type: 'json' },
      style_schema: { type: 'json' },
      table_schema: { type: 'json' }, // Table definitions at this version
      // Data snapshots
      db_snapshot: { type: 'json' }, // All table data at this version
      assets_snapshot: { type: 'json' }, // Asset metadata (binary stored separately)
      // Metadata
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['config_schema', 'style_schema', 'table_schema', 'db_snapshot', 'assets_snapshot'],
    dateFields: ['created_at'],
  },
  widget_secrets: {
    tableName: 'slidecast_widget_secrets',
    description: 'Encrypted widget secrets (API keys)',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      widget_uuid: { type: 'string', required: true },
      key_name: { type: 'string', required: true },
      encrypted_value: { type: 'string', required: true },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    dateFields: ['created_at'],
  },
  widget_cache: {
    tableName: 'slidecast_widget_cache',
    description: 'Widget render cache metadata',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      cache_key: { type: 'string', required: true },
      widget_uuid: { type: 'string', required: true },
      config_hash: { type: 'string' },
      styles_hash: { type: 'string' },
      data_hash: { type: 'string' },
      content_hash: { type: 'string' }, // Hash of rendered image for Roku version detection
      file_path: { type: 'string', required: true },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      expires_at: { type: 'datetime' },
    },
    dateFields: ['created_at', 'expires_at'],
  },
  widget_storage: {
    tableName: 'slidecast_widget_storage',
    description: 'Persistent key-value storage for widgets',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      widget_uuid: { type: 'string', required: true },
      instance_id: { type: 'string' }, // NULL = widget-level (shared), otherwise instance-specific
      scope: { type: 'string', default: 'instance' }, // 'widget' or 'instance'
      key: { type: 'string', required: true },
      value: { type: 'json' }, // JSON-serialized value
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      updated_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['value'],
    dateFields: ['created_at', 'updated_at'],
  },
  widget_events: {
    tableName: 'slidecast_widget_events',
    description: 'Event store for widget subscriptions (ring buffer)',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      event_type: { type: 'string', required: true }, // e.g., 'entity:state_changed', 'automation:trigger'
      source: { type: 'string' }, // Extension or system that emitted the event
      entity_id: { type: 'string' }, // Optional: entity ID for state events
      data: { type: 'json' }, // Event payload
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['data'],
    dateFields: ['created_at'],
  },
  // Device pairing tables
  pairing_codes: {
    tableName: 'slidecast_pairing_codes',
    description: 'Temporary pairing codes for device setup',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      code: { type: 'string', required: true }, // 6-digit code
      device_serial: { type: 'string', required: true }, // Device requesting pairing
      device_info: { type: 'json' }, // Platform, model, etc.
      status: { type: 'string', default: 'pending' }, // pending, paired, expired
      paired_by_user_id: { type: 'integer' }, // User who approved pairing
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      expires_at: { type: 'datetime', required: true },
    },
    jsonFields: ['device_info'],
    dateFields: ['created_at', 'expires_at'],
  },
  device_tokens: {
    tableName: 'slidecast_device_tokens',
    description: 'Persistent device authentication tokens',
    fields: {
      id: { type: 'integer', primaryKey: true, autoIncrement: true },
      device_serial: { type: 'string', required: true }, // Unique device identifier
      token: { type: 'string', required: true }, // JWT or secure token
      token_hash: { type: 'string', required: true }, // For fast lookup
      device_info: { type: 'json' }, // Platform, model, app version
      paired_by_user_id: { type: 'integer' }, // User who approved
      last_used_at: { type: 'datetime' },
      revoked: { type: 'boolean', default: false },
      revoked_at: { type: 'datetime' },
      created_at: { type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    },
    jsonFields: ['device_info'],
    dateFields: ['created_at', 'last_used_at', 'revoked_at'],
  },
};
