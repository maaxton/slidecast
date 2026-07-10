/**
 * Code Snippets for Widget Factory
 * Pre-built widget templates for quick insertion
 */

export const CODE_SNIPPETS = [
  {
    name: 'Basic Widget',
    description: 'Minimal widget structure',
    code: `return {
  render(context) {
    const { config, styles, api } = context;
    
    return [{
      type: 'box',
      background: styles.background || '#1a1a2e',
      padding: 20,
      borderRadius: 12,
      width: '100%',
      height: '100%',
      children: [
        {
          type: 'text',
          content: 'Hello Widget!',
          style: {
            fontSize: 24,
            fontWeight: 'bold',
            color: styles.textColor || '#ffffff'
          }
        }
      ]
    }];
  }
}`,
  },
  {
    name: 'Clock Widget',
    description: 'Display current time',
    code: `return {
  render(context) {
    const { config, styles, api } = context;
    const time = api.system.time();
    
    return [{
      type: 'box',
      background: styles.background || '#1a1a2e',
      padding: 20,
      borderRadius: 12,
      width: '100%',
      height: '100%',
      justify: 'center',
      align: 'center',
      children: [
        {
          type: 'text',
          content: time.formatted,
          style: {
            fontSize: styles.fontSize || 48,
            fontWeight: 'bold',
            color: styles.textColor || '#ffffff'
          }
        }
      ]
    }];
  }
}`,
  },
  {
    name: 'HTTP Data Widget',
    description: 'Fetch and display data from API',
    code: `return {
  async render(context) {
    const { config, styles, api, data } = context;
    
    // Use data from server.js (recommended for API calls)
    // Or fetch directly in client (less ideal):
    // const response = await api.http.get('https://api.example.com/data');
    
    context.debug({ config, data }); // See in Debug panel
    
    return [{
      type: 'stack',
      direction: 'vertical',
      padding: 16,
      gap: 8,
      background: '#1a1a2e',
      borderRadius: 12,
      width: '100%',
      height: '100%',
      children: [
        {
          type: 'text',
          content: data?.title || config.title || 'No data',
          style: { fontSize: 18, fontWeight: 'bold', color: '#fff' }
        },
        {
          type: 'text',
          content: data?.description || '',
          style: { fontSize: 14, color: 'rgba(255,255,255,0.7)' }
        }
      ]
    }];
  }
}`,
  },
  {
    name: 'Widget with Assets',
    description: 'Use uploaded images',
    code: `return {
  render(context) {
    const { config, styles, api } = context;
    
    return [{
      type: 'stack',
      direction: 'horizontal',
      padding: 16,
      gap: 12,
      background: '#1a1a2e',
      borderRadius: 12,
      width: '100%',
      height: '100%',
      align: 'center',
      children: [
        {
          type: 'image',
          src: api.assets.get('icon.png'), // Upload in Assets panel
          width: 48,
          height: 48
        },
        {
          type: 'text',
          content: 'Widget with Image',
          style: { fontSize: 18, color: '#fff' }
        }
      ]
    }];
  }
}`,
  },
];
