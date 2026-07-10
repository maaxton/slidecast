/**
 * Countdown Timer Widget
 * Displays countdown to a target date/time
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-countdown-timer003',
  name: 'Countdown Timer',
  description: 'Count down to a specific date and time',
  category: 'time',
  render_mode: 'native',
  refreshInterval: 1000, // Update every second

  defaultSize: { width: 500, height: 150 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'target', label: 'Target', icon: '🎯' },
      { id: 'display', label: 'Display', icon: '👁️' },
    ],
    targetDate: {
      type: 'datetime',
      label: 'Target Date & Time',
      default: '',
      tab: 'target',
      description: 'When should the countdown end?',
    },
    eventName: {
      type: 'text',
      label: 'Event Name',
      default: '',
      tab: 'target',
      description: 'Optional label to show above countdown',
    },
    showDays: {
      type: 'boolean',
      label: 'Show Days',
      default: true,
      tab: 'display',
    },
    showHours: {
      type: 'boolean',
      label: 'Show Hours',
      default: true,
      tab: 'display',
    },
    showMinutes: {
      type: 'boolean',
      label: 'Show Minutes',
      default: true,
      tab: 'display',
    },
    showSeconds: {
      type: 'boolean',
      label: 'Show Seconds',
      default: true,
      tab: 'display',
    },
    showLabels: {
      type: 'boolean',
      label: 'Show Labels',
      default: true,
      tab: 'display',
    },
    completedMessage: {
      type: 'text',
      label: 'Completed Message',
      default: '🎉 Complete!',
      tab: 'display',
    },
  },

  // Style schema with groups
  styleSchema: {
    fontSize: {
      type: 'number',
      label: 'Number Size',
      default: 64,
      min: 16,
      max: 200,
      unit: 'px',
      group: 'Typography',
    },
    labelSize: {
      type: 'number',
      label: 'Label Size',
      default: 14,
      min: 8,
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
    textColor: {
      type: 'color',
      label: 'Text Color',
      default: '#ffffff',
      group: 'Typography',
    },
    labelColor: {
      type: 'color',
      label: 'Label Color',
      default: '#94a3b8',
      group: 'Typography',
    },
    separatorColor: {
      type: 'color',
      label: 'Separator Color',
      default: '#64748b',
      group: 'Typography',
    },
    backgroundColor: {
      type: 'color',
      label: 'Background',
      default: 'transparent',
      group: 'Background',
    },
    gap: {
      type: 'number',
      label: 'Spacing',
      default: 24,
      min: 8,
      max: 80,
      unit: 'px',
      group: 'Layout',
    },
  },

  // Preview primitives
  previewPrimitives: [
    {
      type: 'text',
      content: '12 : 05 : 32 : 47',
      style: {
        fontSize: 48,
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

    // Calculate time remaining
    let content;
    const targetDate = config.targetDate ? new Date(config.targetDate) : null;

    if (!targetDate || isNaN(targetDate.getTime())) {
      content = 'Set target date';
    } else {
      const now = new Date();
      const diff = targetDate - now;
      
      if (diff <= 0) {
        content = config.completedMessage || '🎉 Complete!';
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        const parts = [];
        
        if (config.showDays !== false && days > 0) {
          parts.push(days.toString().padStart(2, '0'));
        }
        if (config.showHours !== false) {
          parts.push(hours.toString().padStart(2, '0'));
        }
        if (config.showMinutes !== false) {
          parts.push(minutes.toString().padStart(2, '0'));
        }
        if (config.showSeconds !== false) {
          parts.push(seconds.toString().padStart(2, '0'));
        }
        
        content = parts.join(' : ');
      }
    }

    // Build output
    const primitives = [];

    // Event name if set
    if (config.eventName) {
      primitives.push({
        type: 'text',
        content: config.eventName,
        style: {
          fontSize: styles.labelSize || 14,
          fontFamily: styles.fontFamily || 'Inter',
          color: styles.labelColor || '#94a3b8',
          textAlign: 'center',
          marginBottom: 8
        }
      });
    }

    // Main countdown
    primitives.push({
      type: 'text',
      content: content,
      style: {
        fontSize: styles.fontSize || 64,
        fontFamily: styles.fontFamily || 'Inter',
        fontWeight: 'bold',
        color: styles.textColor || '#ffffff',
        textAlign: 'center',
        letterSpacing: 2
      }
    });

    return [
      {
        type: 'stack',
        direction: 'column',
        align: 'center',
        justify: 'center',
        style: {
          backgroundColor: styles.backgroundColor || 'transparent',
          width: '100%',
          height: '100%',
          gap: 8
        },
        children: primitives
      }
    ];
  }
}`,
};
