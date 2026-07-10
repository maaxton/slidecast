/**
 * Entity Display Widget
 * Displays entity state with customizable formatting
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-entity-display06',
  name: 'Entity Display',
  description: 'Display state of a platform entity',
  category: 'info',
  render_mode: 'native',
  refreshInterval: 30000, // Update every 30 seconds

  defaultSize: { width: 300, height: 100 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'entity', label: 'Entity', icon: '🔗' },
      { id: 'display', label: 'Display', icon: '👁️' },
    ],
    entityId: {
      type: 'entity',
      label: 'Entity ID',
      default: '',
      tab: 'entity',
      description: 'e.g., sensor.temperature, switch.living_room',
    },
    label: {
      type: 'text',
      label: 'Custom Label',
      default: '',
      tab: 'display',
      description: 'Leave blank to use entity name',
    },
    showLabel: {
      type: 'boolean',
      label: 'Show Label',
      default: true,
      tab: 'display',
    },
    showUnit: {
      type: 'boolean',
      label: 'Show Unit',
      default: true,
      tab: 'display',
    },
    showIcon: {
      type: 'boolean',
      label: 'Show Icon',
      default: true,
      tab: 'display',
    },
    prefix: {
      type: 'text',
      label: 'Prefix',
      default: '',
      tab: 'display',
    },
    suffix: {
      type: 'text',
      label: 'Suffix',
      default: '',
      tab: 'display',
    },
    precision: {
      type: 'number',
      label: 'Decimal Places',
      default: 1,
      min: 0,
      max: 5,
      tab: 'display',
    },
  },

  // Style schema with groups
  styleSchema: {
    layout: {
      type: 'select',
      label: 'Layout',
      default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'value-only', label: 'Value Only' },
      ],
      group: 'Layout',
    },
    valueSize: {
      type: 'number',
      label: 'Value Size',
      default: 48,
      min: 16,
      max: 150,
      unit: 'px',
      group: 'Typography',
    },
    labelSize: {
      type: 'number',
      label: 'Label Size',
      default: 14,
      min: 10,
      max: 36,
      unit: 'px',
      group: 'Typography',
    },
    fontFamily: {
      type: 'font',
      label: 'Font',
      default: 'Inter',
      group: 'Typography',
    },
    valueColor: {
      type: 'color',
      label: 'Value Color',
      default: '#ffffff',
      group: 'Typography',
    },
    labelColor: {
      type: 'color',
      label: 'Label Color',
      default: '#94a3b8',
      group: 'Typography',
    },
    iconColor: {
      type: 'color',
      label: 'Icon Color',
      default: '#60a5fa',
      group: 'Typography',
    },
    iconSize: {
      type: 'number',
      label: 'Icon Size',
      default: 32,
      min: 16,
      max: 80,
      unit: 'px',
      group: 'Typography',
    },
    backgroundColor: {
      type: 'color',
      label: 'Background',
      default: 'transparent',
      group: 'Background',
    },
    padding: {
      type: 'number',
      label: 'Padding',
      default: 16,
      min: 0,
      max: 60,
      unit: 'px',
      group: 'Layout',
    },
    gap: {
      type: 'number',
      label: 'Spacing',
      default: 12,
      min: 4,
      max: 40,
      unit: 'px',
      group: 'Layout',
    },
    borderRadius: {
      type: 'number',
      label: 'Corner Radius',
      default: 8,
      min: 0,
      max: 30,
      unit: 'px',
      group: 'Border',
    },
  },

  // Preview primitives
  previewPrimitives: [
    {
      type: 'text',
      content: 'Select an entity',
      style: {
        fontSize: 24,
        color: '#94a3b8',
        textAlign: 'center',
      },
    },
  ],

  // Widget client code - must export render function
  clientCode: `return {
  render(context) {
    const config = context.config || {};
    const styles = context.styles || {};

    // If no entity selected, show placeholder
    if (!config.entityId) {
      return [{
        type: 'text',
        content: 'Select an entity',
        style: {
          fontSize: 20,
          color: '#94a3b8',
          textAlign: 'center',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }
      }];
    }

    // Try to get entity state from context
    const entityState = context.entities ? context.entities[config.entityId] : null;

    // Format the value
    let displayValue;
    let unit = '';
    let icon = 'fa-solid fa-circle-info';
    let label = config.label || config.entityId.split('.').pop().replace(/_/g, ' ');

    if (!entityState) {
      displayValue = 'N/A';
    } else {
      const state = entityState.state;
      
      // Handle numeric values
      if (!isNaN(parseFloat(state))) {
        const precision = config.precision !== undefined ? config.precision : 1;
        displayValue = parseFloat(state).toFixed(precision);
      } else {
        displayValue = state;
      }
      
      // Get unit from attributes
      if (config.showUnit !== false && entityState.attributes && entityState.attributes.unit_of_measurement) {
        unit = entityState.attributes.unit_of_measurement;
      }
      
      // Get icon from domain
      const domain = config.entityId.split('.')[0];
      const domainIcons = {
        sensor: 'fa-solid fa-gauge',
        switch: 'fa-solid fa-toggle-on',
        light: 'fa-solid fa-lightbulb',
        climate: 'fa-solid fa-thermometer-half',
        binary_sensor: 'fa-solid fa-circle',
        weather: 'fa-solid fa-cloud',
        person: 'fa-solid fa-user',
        device_tracker: 'fa-solid fa-location-dot'
      };
      icon = domainIcons[domain] || 'fa-solid fa-circle-info';
      
      // Get friendly name
      if (entityState.attributes && entityState.attributes.friendly_name && !config.label) {
        label = entityState.attributes.friendly_name;
      }
    }

    // Add prefix/suffix
    displayValue = (config.prefix || '') + displayValue + (unit ? ' ' + unit : '') + (config.suffix || '');

    // Build output based on layout
    const layout = styles.layout || 'horizontal';
    const children = [];

    // Icon
    if (config.showIcon !== false && layout !== 'value-only') {
      children.push({
        type: 'icon',
        icon: icon,
        style: {
          fontSize: styles.iconSize || 32,
          color: styles.iconColor || '#60a5fa'
        }
      });
    }

    // Value and label stack
    const valueStack = [];

    if (config.showLabel !== false && layout !== 'value-only') {
      valueStack.push({
        type: 'text',
        content: label,
        style: {
          fontSize: styles.labelSize || 14,
          fontFamily: styles.fontFamily || 'Inter',
          color: styles.labelColor || '#94a3b8',
          textTransform: 'capitalize'
        }
      });
    }

    valueStack.push({
      type: 'text',
      content: displayValue,
      style: {
        fontSize: styles.valueSize || 48,
        fontFamily: styles.fontFamily || 'Inter',
        fontWeight: 'bold',
        color: styles.valueColor || '#ffffff'
      }
    });

    if (layout === 'value-only') {
      return [{
        type: 'stack',
        direction: 'column',
        align: 'center',
        justify: 'center',
        style: {
          width: '100%',
          height: '100%',
          padding: styles.padding || 16,
          backgroundColor: styles.backgroundColor || 'transparent',
          borderRadius: styles.borderRadius || 8
        },
        children: valueStack
      }];
    }

    children.push({
      type: 'stack',
      direction: 'column',
      align: layout === 'horizontal' ? 'flex-start' : 'center',
      style: { gap: 4 },
      children: layout === 'vertical' ? valueStack.reverse() : valueStack
    });

    return [{
      type: 'stack',
      direction: layout === 'horizontal' ? 'row' : 'column',
      align: 'center',
      justify: 'center',
      style: {
        gap: styles.gap || 12,
        padding: styles.padding || 16,
        backgroundColor: styles.backgroundColor || 'transparent',
        borderRadius: styles.borderRadius || 8,
        width: '100%',
        height: '100%'
      },
      children: children
    }];
  }
}`,
};
