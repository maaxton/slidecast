/**
 * Quote of the Day Widget
 * Demonstrates HTML template + server code pattern
 * Fetches inspirational quotes from ZenQuotes API
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-quote-of-day-007',
  name: 'Quote of the Day',
  description: 'Display inspirational quotes - demonstrates HTML template + server code',
  category: 'content',
  render_mode: 'image', // Renders as HTML -> image via Satori
  refreshInterval: 3600000, // Update every hour

  defaultSize: { width: 600, height: 300 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'content', label: 'Content', icon: '💬' },
      { id: 'style', label: 'Style', icon: '🎨' },
    ],
    category: {
      type: 'select',
      label: 'Quote Category',
      default: 'inspire',
      tab: 'content',
      options: [
        { value: 'inspire', label: 'Inspirational' },
        { value: 'management', label: 'Management' },
        { value: 'sports', label: 'Sports' },
        { value: 'life', label: 'Life' },
        { value: 'funny', label: 'Funny' },
        { value: 'love', label: 'Love' },
        { value: 'art', label: 'Art' },
        { value: 'students', label: 'Students' },
      ],
    },
    showAuthor: {
      type: 'boolean',
      label: 'Show Author',
      default: true,
      tab: 'content',
    },
    showQuoteMarks: {
      type: 'boolean',
      label: 'Show Quote Marks',
      default: true,
      tab: 'content',
    },
  },

  // Style schema with groups
  styleSchema: {
    theme: {
      type: 'select',
      label: 'Theme',
      default: 'gradient-purple',
      options: [
        { value: 'gradient-purple', label: 'Purple Gradient' },
        { value: 'gradient-blue', label: 'Blue Gradient' },
        { value: 'gradient-sunset', label: 'Sunset' },
        { value: 'dark', label: 'Dark Solid' },
        { value: 'light', label: 'Light Solid' },
        { value: 'transparent', label: 'Transparent' },
      ],
      group: 'Theme',
    },
    quoteSize: {
      type: 'number',
      label: 'Quote Font Size',
      default: 28,
      min: 16,
      max: 60,
      unit: 'px',
      group: 'Typography',
    },
    authorSize: {
      type: 'number',
      label: 'Author Font Size',
      default: 16,
      min: 12,
      max: 32,
      unit: 'px',
      group: 'Typography',
    },
    fontFamily: {
      type: 'font',
      label: 'Quote Font',
      default: 'Merriweather',
      group: 'Typography',
    },
    quoteColor: {
      type: 'color',
      label: 'Quote Color',
      default: '#ffffff',
      group: 'Typography',
    },
    authorColor: {
      type: 'color',
      label: 'Author Color',
      default: '#e2e8f0',
      group: 'Typography',
    },
    padding: {
      type: 'number',
      label: 'Padding',
      default: 40,
      min: 16,
      max: 80,
      unit: 'px',
      group: 'Layout',
    },
    borderRadius: {
      type: 'number',
      label: 'Corner Radius',
      default: 16,
      min: 0,
      max: 40,
      unit: 'px',
      group: 'Border',
    },
  },

  // Preview primitives (fallback for Studio)
  previewPrimitives: [
    {
      type: 'stack',
      direction: 'column',
      align: 'center',
      justify: 'center',
      style: {
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: 16,
        padding: 40,
      },
      children: [
        { type: 'text', content: '"', style: { fontSize: 48, color: 'rgba(255,255,255,0.3)' } },
        {
          type: 'text',
          content: 'The only way to do great work is to love what you do.',
          style: {
            fontSize: 24, color: '#ffffff', textAlign: 'center', fontStyle: 'italic',
          },
        },
        { type: 'text', content: '— Steve Jobs', style: { fontSize: 14, color: '#e2e8f0', marginTop: 16 } },
      ],
    },
  ],

  // Server code - fetches quote from API
  serverCode: `return {
  async run(context) {
    const config = context.config || {};
    
    // ZenQuotes API - free, no key required
    // Using proxy to avoid CORS issues
    const url = 'https://zenquotes.io/api/random';
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data || !data[0]) {
        return { 
          quote: 'The best time to plant a tree was 20 years ago. The second best time is now.',
          author: 'Chinese Proverb'
        };
      }
      
      return {
        quote: data[0].q,
        author: data[0].a
      };
    } catch (error) {
      // Return fallback quote on error
      return { 
        quote: 'The only way to do great work is to love what you do.',
        author: 'Steve Jobs',
        error: error.message
      };
    }
  }
}`,

  // HTML template - rendered to image via Satori
  // Note: Uses simple {{data.key}}, {{styles.key}}, {{config.key}} substitution
  htmlTemplate: `
<div style="
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: {{styles.padding}}px;
  border-radius: {{styles.borderRadius}}px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: {{styles.fontFamily}}, Merriweather, serif;
">
  <div style="font-size: 64px; color: rgba(255,255,255,0.2); line-height: 1; margin-bottom: -20px;">"</div>
  
  <div style="
    font-size: {{styles.quoteSize}}px;
    color: {{styles.quoteColor}};
    text-align: center;
    font-style: italic;
    line-height: 1.4;
    max-width: 90%;
  ">{{data.quote}}</div>
  
  <div style="
    font-size: {{styles.authorSize}}px;
    color: {{styles.authorColor}};
    margin-top: 24px;
    font-style: normal;
  ">— {{data.author}}</div>
</div>
`,

  // Client code for native fallback / preview
  clientCode: `return {
  render(context) {
    const config = context.config || {};
    const styles = context.styles || {};
    const data = context.data || {};

    // Theme backgrounds
    const themes = {
      'gradient-purple': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'gradient-blue': 'linear-gradient(135deg, #0093E9 0%, #80D0C7 100%)',
      'gradient-sunset': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'dark': '#1e293b',
      'light': '#f8fafc',
      'transparent': 'transparent'
    };
    
    const background = themes[styles.theme] || themes['gradient-purple'];
    const quote = data.quote || 'Loading quote...';
    const author = data.author || '';

    const children = [];

    // Quote mark
    if (config.showQuoteMarks !== false) {
      children.push({
        type: 'text',
        content: '"',
        style: {
          fontSize: 64,
          color: 'rgba(255,255,255,0.2)',
          lineHeight: 1,
          marginBottom: -20
        }
      });
    }

    // Quote text
    children.push({
      type: 'text',
      content: quote,
      style: {
        fontSize: styles.quoteSize || 28,
        fontFamily: styles.fontFamily || 'Merriweather',
        color: styles.quoteColor || '#ffffff',
        textAlign: 'center',
        fontStyle: 'italic',
        lineHeight: 1.4,
        maxWidth: '90%'
      }
    });

    // Author
    if (config.showAuthor !== false && author) {
      children.push({
        type: 'text',
        content: '— ' + author,
        style: {
          fontSize: styles.authorSize || 16,
          fontFamily: styles.fontFamily || 'Merriweather',
          color: styles.authorColor || '#e2e8f0',
          marginTop: 24,
          fontStyle: 'normal'
        }
      });
    }

    return [{
      type: 'stack',
      direction: 'column',
      align: 'center',
      justify: 'center',
      style: {
        width: '100%',
        height: '100%',
        padding: styles.padding || 40,
        borderRadius: styles.borderRadius || 16,
        background: background
      },
      children: children
    }];
  }
}`,
};
