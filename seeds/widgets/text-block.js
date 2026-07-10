/**
 * Text Block Widget
 * A simple text display widget with rich styling options
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-text-block-00005',
  name: 'Text Block',
  description: 'Display styled text with various formatting options',
  category: 'content',
  render_mode: 'native',
  refreshInterval: 0, // Static content, no refresh needed

  defaultSize: { width: 400, height: 100 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'content', label: 'Content', icon: '📝' },
    ],
    text: {
      type: 'textarea',
      label: 'Text Content',
      default: 'Your text here',
      tab: 'content',
      rows: 4,
    },
    marquee: {
      type: 'boolean',
      label: 'Scrolling Text (Marquee)',
      default: false,
      tab: 'content',
    },
    marqueeSpeed: {
      type: 'select',
      label: 'Scroll Speed',
      default: 'medium',
      tab: 'content',
      options: [
        { value: 'slow', label: 'Slow' },
        { value: 'medium', label: 'Medium' },
        { value: 'fast', label: 'Fast' },
      ],
    },
  },

  // Style schema with groups
  styleSchema: {
    fontSize: {
      type: 'number',
      label: 'Font Size',
      default: 32,
      min: 10,
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
      default: 'normal',
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
    fontStyle: {
      type: 'select',
      label: 'Style',
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'italic', label: 'Italic' },
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
    lineHeight: {
      type: 'number',
      label: 'Line Height',
      default: 1.4,
      min: 0.8,
      max: 3,
      step: 0.1,
      group: 'Typography',
    },
    letterSpacing: {
      type: 'number',
      label: 'Letter Spacing',
      default: 0,
      min: -5,
      max: 20,
      unit: 'px',
      group: 'Typography',
    },
    textTransform: {
      type: 'select',
      label: 'Transform',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'uppercase', label: 'UPPERCASE' },
        { value: 'lowercase', label: 'lowercase' },
        { value: 'capitalize', label: 'Capitalize' },
      ],
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
      max: 100,
      unit: 'px',
      group: 'Layout',
    },
    borderRadius: {
      type: 'number',
      label: 'Corner Radius',
      default: 0,
      min: 0,
      max: 50,
      unit: 'px',
      group: 'Border',
    },
  },

  // Preview primitives
  previewPrimitives: [
    {
      type: 'text',
      content: 'Your text here',
      style: {
        fontSize: 32,
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

    const text = config.text || 'Your text here';

    const textStyle = {
      fontSize: styles.fontSize || 32,
      fontFamily: styles.fontFamily || 'Inter',
      fontWeight: styles.fontWeight || 'normal',
      fontStyle: styles.fontStyle || 'normal',
      color: styles.textColor || '#ffffff',
      textAlign: styles.textAlign || 'center',
      lineHeight: styles.lineHeight || 1.4,
      letterSpacing: styles.letterSpacing || 0, // Number, not string
      backgroundColor: styles.backgroundColor || 'transparent',
      padding: styles.padding || 16,
      borderRadius: styles.borderRadius || 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: styles.textAlign === 'left' ? 'flex-start' : styles.textAlign === 'right' ? 'flex-end' : 'center'
    };

    // Handle marquee (scrolling text)
    if (config.marquee) {
      const speeds = { slow: 30, medium: 20, fast: 10 };
      const duration = speeds[config.marqueeSpeed] || 20;
      
      return [{
        type: 'marquee',
        content: text,
        speed: duration,
        style: textStyle
      }];
    }

    return [{
      type: 'text',
      content: text,
      style: textStyle
    }];
  }
}`,
};
