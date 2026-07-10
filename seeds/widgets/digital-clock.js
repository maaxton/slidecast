/**
 * Digital Clock Widget
 * Displays current time with customizable format
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-digital-clock-001',
  name: 'Digital Clock',
  description: 'Display the current time with customizable format and style',
  category: 'time',
  render_mode: 'native',
  refreshInterval: 1000, // Update every second

  defaultSize: { width: 400, height: 120 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'format', label: 'Format', icon: '🕐' },
    ],
    showSeconds: {
      type: 'boolean',
      label: 'Show Seconds',
      default: true,
      tab: 'format',
    },
    use24Hour: {
      type: 'boolean',
      label: '24-Hour Format',
      default: false,
      tab: 'format',
    },
    showAmPm: {
      type: 'boolean',
      label: 'Show AM/PM',
      default: true,
      tab: 'format',
    },
    timezone: {
      type: 'select',
      label: 'Timezone',
      default: 'local',
      tab: 'format',
      options: [
        { value: 'local', label: 'Local Time' },
        { value: 'America/New_York', label: 'New York (ET)' },
        { value: 'America/Chicago', label: 'Chicago (CT)' },
        { value: 'America/Denver', label: 'Denver (MT)' },
        { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
        { value: 'Europe/London', label: 'London (GMT)' },
        { value: 'Europe/Paris', label: 'Paris (CET)' },
        { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
        { value: 'UTC', label: 'UTC' },
      ],
    },
  },

  // Style schema with groups
  styleSchema: {
    fontSize: {
      type: 'number',
      label: 'Font Size',
      default: 72,
      min: 12,
      max: 200,
      unit: 'px',
      group: 'Typography',
    },
    fontFamily: {
      type: 'font',
      label: 'Font',
      default: 'Inter',
      group: 'Typography',
    },
    fontWeight: {
      type: 'select',
      label: 'Weight',
      default: 'bold',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'bold', label: 'Bold' },
        { value: '100', label: 'Thin' },
        { value: '300', label: 'Light' },
        { value: '500', label: 'Medium' },
        { value: '700', label: 'Bold' },
        { value: '900', label: 'Black' },
      ],
      group: 'Typography',
    },
    textColor: {
      type: 'color',
      label: 'Text Color',
      default: '#ffffff',
      group: 'Typography',
    },
    textAlign: {
      type: 'select',
      label: 'Alignment',
      default: 'center',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
      group: 'Layout',
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
      max: 100,
      unit: 'px',
      group: 'Layout',
    },
  },

  // Preview primitives for Studio canvas
  previewPrimitives: [
    {
      type: 'text',
      content: '12:34:56 PM',
      style: {
        fontSize: 72,
        fontFamily: 'Inter',
        fontWeight: 'bold',
        color: '#ffffff',
        textAlign: 'center',
      },
    },
  ],

  // Widget client code - must export render function
  clientCode: `return {
  render(context) {
    const config = context.config || {};
    const styles = context.styles || {};

    // Get current time
    const now = new Date();

    // Handle timezone
    let timeString;
    if (config.timezone && config.timezone !== 'local') {
      try {
        timeString = now.toLocaleTimeString('en-US', {
          timeZone: config.timezone,
          hour12: !config.use24Hour,
          hour: '2-digit',
          minute: '2-digit',
          second: config.showSeconds !== false ? '2-digit' : undefined
        });
      } catch (e) {
        timeString = now.toLocaleTimeString();
      }
    } else {
      const hours = config.use24Hour ? now.getHours() : (now.getHours() % 12 || 12);
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const seconds = now.getSeconds().toString().padStart(2, '0');
      const ampm = config.showAmPm !== false && !config.use24Hour ? (now.getHours() >= 12 ? ' PM' : ' AM') : '';
      
      timeString = config.showSeconds !== false 
        ? hours + ':' + minutes + ':' + seconds + ampm
        : hours + ':' + minutes + ampm;
    }

    // Return primitives
    return [
      {
        type: 'text',
        content: timeString,
        style: {
          fontSize: styles.fontSize || 72,
          fontFamily: styles.fontFamily || 'Inter',
          fontWeight: styles.fontWeight || 'bold',
          color: styles.textColor || '#ffffff',
          textAlign: styles.textAlign || 'center',
          backgroundColor: styles.backgroundColor || 'transparent',
          padding: styles.padding || 16,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: styles.textAlign === 'left' ? 'flex-start' : styles.textAlign === 'right' ? 'flex-end' : 'center'
        }
      }
    ];
  }
}`,
};
