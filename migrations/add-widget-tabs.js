/**
 * Migration: Add tabs to widget config schemas and groups to style schemas
 *
 * Config Schema: Gets _tabs and tab assignments on fields
 * Style Schema: Gets ONLY group assignments (no tabs!) - shown in Default tab
 */

export async function migrate(api) {
  const log = () => {}; // Silent migration

  log('Starting widget tabs migration...');

  const model = api.model('slidecast_widgets');
  const widgets = await model.findAll();

  log(`Found ${widgets.length} widgets to process`);

  let updatedCount = 0;

  for (const widget of widgets) {
    const name = widget.name?.toLowerCase() || '';
    let configSchema = parseSchema(widget.config_schema);
    let styleSchema = parseSchema(widget.style_schema);

    // Initialize schemas if null
    configSchema = configSchema || {};
    styleSchema = styleSchema || {};

    // IMPORTANT: Style schema should NEVER have _tabs - clean up any that exist
    delete styleSchema._tabs;

    // Clean up any tab assignments from style fields
    for (const [key, field] of Object.entries(styleSchema)) {
      if (field && typeof field === 'object') {
        delete field.tab;
      }
    }

    // Apply widget-specific tab configurations
    if (name.includes('clock') || name.includes('digital clock')) {
      applyClockTabs(configSchema, styleSchema);
    } else if (name.includes('date')) {
      applyDateTabs(configSchema, styleSchema);
    } else if (name.includes('countdown') || name.includes('timer')) {
      applyCountdownTabs(configSchema, styleSchema);
    } else if (name.includes('weather')) {
      applyWeatherTabs(configSchema, styleSchema);
    } else if (name.includes('text')) {
      applyTextBlockTabs(configSchema, styleSchema);
    } else if (name.includes('entity')) {
      applyEntityTabs(configSchema, styleSchema);
    } else {
      // Generic widget - apply default organization
      applyGenericTabs(configSchema, styleSchema);
    }

    // Assign groups to style fields based on field names
    assignStyleGroups(styleSchema);

    await model.update(widget.id, {
      config_schema: JSON.stringify(configSchema),
      style_schema: JSON.stringify(styleSchema),
    });

    log(`Updated widget "${widget.name}"`);
    updatedCount++;
  }

  log(`Migration complete. Updated ${updatedCount} widgets.`);

  return {
    success: true,
    message: `Updated ${updatedCount} widgets with tabs`,
    updatedCount,
  };
}

function parseSchema(schema) {
  if (!schema) return {};
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema);
    } catch (e) {
      return {};
    }
  }
  return schema;
}

// ============= DIGITAL CLOCK =============
function applyClockTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'format', label: 'Format', icon: '🕐' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'format',
    ['format', 'timeFormat', 'showSeconds', 'use24Hour', 'hour12', 'timezone', 'showTimezone'],
  );
}

// ============= DATE DISPLAY =============
function applyDateTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'format', label: 'Format', icon: '📅' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'format',
    ['format', 'dateFormat', 'showYear', 'showDay', 'showWeekday', 'locale', 'timezone'],
  );
}

// ============= COUNTDOWN TIMER =============
function applyCountdownTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'target', label: 'Target', icon: '🎯' },
    { id: 'display', label: 'Display', icon: '👁️' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'target',
    ['targetDate', 'countdownDate', 'date', 'endDate', 'eventDate', 'eventName', 'title', 'label'],
  );

  assignConfigFieldsToTab(
    configSchema,
    'display',
    ['showDays', 'showHours', 'showMinutes', 'showSeconds', 'showLabels',
      'completedMessage', 'completedText', 'expiredMessage', 'format'],
  );
}

// ============= CURRENT WEATHER =============
function applyWeatherTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'location', label: 'Location', icon: '📍' },
    { id: 'display', label: 'Display', icon: '👁️' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'location',
    ['latitude', 'lat', 'longitude', 'lon', 'lng', 'location', 'city', 'zipCode', 'zip'],
  );

  assignConfigFieldsToTab(
    configSchema,
    'display',
    ['units', 'temperatureUnits', 'showCondition', 'showConditionText', 'showIcon',
      'showWeatherIcon', 'showHumidity', 'showWind', 'showFeelsLike',
      'width', 'height', 'size', 'theme'],
  );
}

// ============= TEXT BLOCK =============
function applyTextBlockTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'content', label: 'Content', icon: '📝' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'content',
    ['text', 'message', 'content', 'html', 'title', 'subtitle', 'body'],
  );
}

// ============= ENTITY DISPLAY =============
function applyEntityTabs(configSchema, styleSchema) {
  configSchema._tabs = [
    { id: 'entity', label: 'Entity', icon: '🔗' },
    { id: 'display', label: 'Display', icon: '👁️' },
  ];

  assignConfigFieldsToTab(
    configSchema,
    'entity',
    ['entityId', 'entity_id', 'entity', 'sensor', 'device'],
  );

  assignConfigFieldsToTab(
    configSchema,
    'display',
    ['label', 'showLabel', 'showUnit', 'unit', 'prefix', 'suffix',
      'format', 'precision', 'decimals'],
  );
}

// ============= GENERIC WIDGET =============
function applyGenericTabs(configSchema, styleSchema) {
  // Don't override existing tabs if they look intentional
  if (!configSchema._tabs || !Array.isArray(configSchema._tabs)) {
    configSchema._tabs = [];
  }
}

// Helper: Assign config fields to a specific tab
function assignConfigFieldsToTab(schema, tabId, fieldPatterns) {
  if (!schema) return;

  for (const [key, field] of Object.entries(schema)) {
    if (key === '_tabs' || !field || typeof field !== 'object') continue;

    const lowerKey = key.toLowerCase();
    for (const pattern of fieldPatterns) {
      if (lowerKey.includes(pattern.toLowerCase())) {
        field.tab = tabId;
        break;
      }
    }
  }
}

// Helper: Assign groups to ALL style fields based on field names
function assignStyleGroups(styleSchema) {
  if (!styleSchema) return;

  for (const [key, field] of Object.entries(styleSchema)) {
    if (!field || typeof field !== 'object') continue;

    // Make sure tab is never set on style fields
    delete field.tab;

    // Assign group based on field name
    field.group = guessGroup(key);
  }
}

// Helper: Guess which group a field belongs to based on its key name
function guessGroup(key) {
  const lowerKey = key.toLowerCase();

  if (lowerKey.includes('background') || lowerKey.includes('bg')) {
    return 'Background';
  }
  if (lowerKey.includes('font') || lowerKey.includes('text') || lowerKey.includes('color')
      || (lowerKey.includes('size') && !lowerKey.includes('padding'))) {
    return 'Typography';
  }
  if (lowerKey.includes('padding') || lowerKey.includes('margin')
      || lowerKey.includes('spacing') || lowerKey.includes('gap') || lowerKey.includes('align')) {
    return 'Layout';
  }
  if (lowerKey.includes('border') || lowerKey.includes('radius')) {
    return 'Border';
  }
  if (lowerKey.includes('opacity') || lowerKey.includes('shadow') || lowerKey.includes('blur')) {
    return 'Effects';
  }
  if (lowerKey.includes('theme')) {
    return 'Theme';
  }

  return 'Other';
}
