/**
 * Migration: Add group property to style schema fields
 * Run via: POST /api/extensions/slidecast/run-migration
 */

export async function migrate(api) {
  const log = () => {}; // Silent migration

  log('Starting style groups migration...');

  // Get all widgets
  const model = api.model('slidecast_widgets');
  const widgets = await model.findAll();

  log(`Found ${widgets.length} widgets to check`);

  // Define which fields belong to which groups
  const fieldToGroup = {
    // Background
    backgroundColor: 'Background',
    background: 'Background',
    bgColor: 'Background',
    backgroundOpacity: 'Background',
    backdropBlur: 'Background',

    // Typography
    textColor: 'Typography',
    color: 'Typography',
    fontSize: 'Typography',
    fontFamily: 'Typography',
    fontWeight: 'Typography',
    font: 'Typography',
    textAlign: 'Typography',
    lineHeight: 'Typography',
    letterSpacing: 'Typography',
    subtextColor: 'Typography',
    labelColor: 'Typography',
    valueColor: 'Typography',
    unitColor: 'Typography',

    // Layout
    padding: 'Layout',
    margin: 'Layout',
    gap: 'Layout',
    spacing: 'Layout',
    width: 'Layout',
    height: 'Layout',
    align: 'Layout',
    justify: 'Layout',

    // Effects
    opacity: 'Effects',
    blur: 'Effects',
    shadow: 'Effects',
    glow: 'Effects',

    // Border
    borderRadius: 'Border',
    borderColor: 'Border',
    borderWidth: 'Border',
    border: 'Border',
  };

  let updatedCount = 0;

  for (const widget of widgets) {
    let styleSchema = widget.style_schema;

    // Parse if string
    if (typeof styleSchema === 'string') {
      try {
        styleSchema = JSON.parse(styleSchema);
      } catch (e) {
        log(`Widget ${widget.name}: invalid style_schema JSON, skipping`);
        continue;
      }
    }

    if (!styleSchema || typeof styleSchema !== 'object') {
      continue;
    }

    let modified = false;

    for (const [key, field] of Object.entries(styleSchema)) {
      if (field && typeof field === 'object' && !field.group) {
        // Try to match field key to a group
        const lowerKey = key.toLowerCase();
        let assignedGroup = 'Other';

        for (const [pattern, group] of Object.entries(fieldToGroup)) {
          if (lowerKey.includes(pattern.toLowerCase()) || pattern.toLowerCase().includes(lowerKey)) {
            assignedGroup = group;
            break;
          }
        }

        // Also check field type for hints
        if (field.type === 'color' && assignedGroup === 'Other') {
          if (lowerKey.includes('background') || lowerKey.includes('bg')) {
            assignedGroup = 'Background';
          } else {
            assignedGroup = 'Typography'; // Most color fields are text-related
          }
        } else if ((field.type === 'font' || field.type === 'fontWeight' || field.type === 'typography') && assignedGroup === 'Other') {
          assignedGroup = 'Typography';
        } else if (field.type === 'slider' && assignedGroup === 'Other') {
          if (lowerKey.includes('size') || lowerKey.includes('font')) {
            assignedGroup = 'Typography';
          } else if (lowerKey.includes('radius') || lowerKey.includes('border')) {
            assignedGroup = 'Border';
          } else if (lowerKey.includes('opacity') || lowerKey.includes('blur')) {
            assignedGroup = 'Effects';
          }
        }

        field.group = assignedGroup;
        modified = true;
      }
    }

    if (modified) {
      await model.update(widget.id, {
        style_schema: styleSchema,
      });
      log(`Updated widget "${widget.name}" with style groups`);
      updatedCount++;
    }
  }

  log(`Migration complete. Updated ${updatedCount} widgets.`);

  return {
    success: true,
    message: `Updated ${updatedCount} widgets with style groups`,
    updatedCount,
  };
}
