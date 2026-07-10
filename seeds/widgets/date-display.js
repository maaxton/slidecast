/**
 * Date Display Widget
 * Displays current date with customizable format
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-date-display-0002',
  name: 'Date Display',
  description: 'Display the current date with customizable format',
  category: 'time',
  render_mode: 'native',
  refreshInterval: 60000, // Update every minute

  defaultSize: { width: 500, height: 80 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'format', label: 'Format', icon: '📅' },
    ],
    format: {
      type: 'select',
      label: 'Date Format',
      default: 'full',
      tab: 'format',
      options: [
        { value: 'full', label: 'Tuesday, January 14, 2025' },
        { value: 'long', label: 'January 14, 2025' },
        { value: 'medium', label: 'Jan 14, 2025' },
        { value: 'short', label: '1/14/2025' },
        { value: 'weekday-long', label: 'Tuesday' },
        { value: 'weekday-short', label: 'Tue' },
        { value: 'month-day', label: 'January 14' },
        { value: 'iso', label: '2025-01-14' },
      ],
    },
    showYear: {
      type: 'boolean',
      label: 'Show Year',
      default: true,
      tab: 'format',
    },
    showWeekday: {
      type: 'boolean',
      label: 'Show Weekday',
      default: true,
      tab: 'format',
    },
    locale: {
      type: 'select',
      label: 'Language',
      default: 'en-US',
      tab: 'format',
      options: [
        { value: 'en-US', label: 'English (US)' },
        { value: 'en-GB', label: 'English (UK)' },
        { value: 'es-ES', label: 'Spanish' },
        { value: 'fr-FR', label: 'French' },
        { value: 'de-DE', label: 'German' },
        { value: 'it-IT', label: 'Italian' },
        { value: 'pt-BR', label: 'Portuguese' },
        { value: 'ja-JP', label: 'Japanese' },
        { value: 'zh-CN', label: 'Chinese' },
      ],
    },
  },

  // Style schema with groups
  styleSchema: {
    fontSize: {
      type: 'number',
      label: 'Font Size',
      default: 36,
      min: 12,
      max: 150,
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
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'bold', label: 'Bold' },
        { value: '300', label: 'Light' },
        { value: '500', label: 'Medium' },
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
      default: 12,
      min: 0,
      max: 100,
      unit: 'px',
      group: 'Layout',
    },
  },

  // Preview primitives
  previewPrimitives: [
    {
      type: 'text',
      content: 'Tuesday, January 14, 2025',
      style: {
        fontSize: 36,
        fontFamily: 'Inter',
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

    const now = new Date();
    const locale = config.locale || 'en-US';
    let dateString;

    const formatMap = {
      'full': { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
      'long': { year: 'numeric', month: 'long', day: 'numeric' },
      'medium': { year: 'numeric', month: 'short', day: 'numeric' },
      'short': { year: 'numeric', month: 'numeric', day: 'numeric' },
      'weekday-long': { weekday: 'long' },
      'weekday-short': { weekday: 'short' },
      'month-day': { month: 'long', day: 'numeric' },
      'iso': null
    };

    const format = config.format || 'full';

    if (format === 'iso') {
      dateString = now.toISOString().split('T')[0];
    } else {
      let options = { ...formatMap[format] };
      
      // Override with user preferences
      if (config.showYear === false) delete options.year;
      if (config.showWeekday === false) delete options.weekday;
      
      dateString = now.toLocaleDateString(locale, options);
    }

    return [
      {
        type: 'text',
        content: dateString,
        style: {
          fontSize: styles.fontSize || 36,
          fontFamily: styles.fontFamily || 'Inter',
          fontWeight: styles.fontWeight || 'normal',
          color: styles.textColor || '#ffffff',
          textAlign: styles.textAlign || 'center',
          backgroundColor: styles.backgroundColor || 'transparent',
          padding: styles.padding || 12,
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
