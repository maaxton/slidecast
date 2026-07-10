/**
 * Current Weather Widget
 * Displays current weather using Open-Meteo API (free, no key required)
 * Beautiful modern card design with vivid gradient backgrounds
 */

export default {
  // Hardcoded UUID for stable references
  uuid: 'seed-widget-current-weather04',
  name: 'Current Weather',
  description: 'Display current weather conditions for a location',
  category: 'weather',
  render_mode: 'hybrid',
  refreshInterval: 300000, // Update every 5 minutes

  defaultSize: { width: 420, height: 220 },

  // Config schema with tabs
  configSchema: {
    _tabs: [
      { id: 'location', label: 'Location', icon: '📍' },
      { id: 'display', label: 'Display', icon: '👁️' },
    ],
    locationMode: {
      type: 'select',
      label: 'Location Input',
      default: 'zip',
      tab: 'location',
      options: [
        { value: 'zip', label: 'ZIP Code (US)' },
        { value: 'coords', label: 'Latitude/Longitude' },
      ],
      description: 'Choose how to specify location',
    },
    zipCode: {
      type: 'string',
      label: 'ZIP Code',
      default: '10001',
      tab: 'location',
      description: 'US ZIP code (e.g., 10001 for NYC)',
      showIf: { locationMode: 'zip' },
    },
    latitude: {
      type: 'number',
      label: 'Latitude',
      default: 40.7128,
      step: 0.0001,
      tab: 'location',
      description: 'e.g., 40.7128 for New York',
      showIf: { locationMode: 'coords' },
    },
    longitude: {
      type: 'number',
      label: 'Longitude',
      default: -74.0060,
      step: 0.0001,
      tab: 'location',
      description: 'e.g., -74.0060 for New York',
      showIf: { locationMode: 'coords' },
    },
    units: {
      type: 'select',
      label: 'Temperature Units',
      default: 'fahrenheit',
      tab: 'display',
      options: [
        { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
        { value: 'celsius', label: 'Celsius (°C)' },
      ],
    },
    showLocation: {
      type: 'boolean',
      label: 'Show Location Name',
      default: true,
      tab: 'display',
    },
    showCondition: {
      type: 'boolean',
      label: 'Show Condition Text',
      default: true,
      tab: 'display',
    },
    showFeelsLike: {
      type: 'boolean',
      label: 'Show Feels Like',
      default: true,
      tab: 'display',
    },
    showHumidity: {
      type: 'boolean',
      label: 'Show Humidity',
      default: true,
      tab: 'display',
    },
    showWind: {
      type: 'boolean',
      label: 'Show Wind Speed',
      default: false,
      tab: 'display',
    },
    showIcon: {
      type: 'boolean',
      label: 'Show Weather Icon',
      default: true,
      tab: 'display',
    },
  },

  // Style schema with groups
  styleSchema: {
    theme: {
      type: 'select',
      label: 'Theme',
      default: 'ocean',
      options: [
        { value: 'ocean', label: '🌊 Ocean Blue' },
        { value: 'sunset', label: '🌅 Sunset' },
        { value: 'aurora', label: '🌌 Aurora' },
        { value: 'forest', label: '🌲 Forest' },
        { value: 'midnight', label: '🌙 Midnight' },
        { value: 'glass', label: '💎 Glass' },
        { value: 'transparent', label: '🚫 Transparent' },
      ],
      group: 'Theme',
    },
    backgroundOpacity: {
      type: 'number',
      label: 'Background Opacity',
      default: 100,
      min: 0,
      max: 100,
      unit: '%',
      group: 'Theme',
      description: 'Set to 0 for fully transparent',
    },
    fontFamily: {
      type: 'font',
      label: 'Font',
      default: 'Inter',
      group: 'Typography',
    },
    temperatureSize: {
      type: 'number',
      label: 'Temperature Size',
      default: 80,
      min: 24,
      max: 150,
      unit: 'px',
      group: 'Typography',
    },
    locationSize: {
      type: 'number',
      label: 'Location Size',
      default: 16,
      min: 10,
      max: 32,
      unit: 'px',
      group: 'Typography',
    },
    conditionSize: {
      type: 'number',
      label: 'Condition Size',
      default: 20,
      min: 12,
      max: 36,
      unit: 'px',
      group: 'Typography',
    },
    detailSize: {
      type: 'number',
      label: 'Details Size',
      default: 14,
      min: 10,
      max: 24,
      unit: 'px',
      group: 'Typography',
      description: 'Humidity, feels like, wind text',
    },
    iconSize: {
      type: 'number',
      label: 'Weather Icon Size',
      default: 80,
      min: 40,
      max: 150,
      unit: 'px',
      group: 'Icons',
    },
    detailIconSize: {
      type: 'number',
      label: 'Detail Icon Size',
      default: 16,
      min: 12,
      max: 32,
      unit: 'px',
      group: 'Icons',
      description: 'Humidity, thermometer icons',
    },
    borderRadius: {
      type: 'number',
      label: 'Corner Radius',
      default: 28,
      min: 0,
      max: 50,
      unit: 'px',
      group: 'Border',
    },
    padding: {
      type: 'number',
      label: 'Padding',
      default: 32,
      min: 8,
      max: 60,
      unit: 'px',
      group: 'Layout',
    },
  },

  // Preview primitives - shows what widget looks like in gallery
  previewPrimitives: [
    {
      type: 'box',
      background: 'linear-gradient(135deg, #0077b6 0%, #00b4d8 50%, #90e0ef 100%)',
      borderRadius: 28,
      width: '100%',
      height: '100%',
      children: [
        {
          type: 'stack',
          direction: 'horizontal',
          padding: 32,
          width: '100%',
          height: '100%',
          align: 'center',
          justify: 'space-between',
          children: [
            {
              type: 'stack',
              direction: 'vertical',
              gap: 8,
              children: [
                {
                  type: 'text',
                  content: 'New York',
                  style: {
                    fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase',
                  },
                },
                {
                  type: 'text',
                  content: '72°',
                  style: {
                    fontSize: 80, fontWeight: '100', color: '#ffffff', lineHeight: 0.9,
                  },
                },
                { type: 'text', content: 'Partly Cloudy', style: { fontSize: 20, color: 'rgba(255,255,255,0.95)', fontWeight: '500' } },
              ],
            },
            {
              type: 'stack',
              direction: 'vertical',
              align: 'flex-end',
              gap: 16,
              children: [
                { type: 'text', content: '⛅', style: { fontSize: 80 } },
                {
                  type: 'stack',
                  direction: 'horizontal',
                  gap: 20,
                  children: [
                    { type: 'text', content: '💧 45%', style: { fontSize: 14, color: 'rgba(255,255,255,0.85)' } },
                    { type: 'text', content: '🌡️ 68°', style: { fontSize: 14, color: 'rgba(255,255,255,0.85)' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],

  // Widget client code - must export render function
  clientCode: `return {
  render(context) {
    const config = context.config || {};
    const styles = context.styles || {};
    const serverData = context.data || {};

    // Meteocons weather icons - beautiful gradient SVGs by Bas Milius (MIT License)
    const icons = {
      sun: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2226.75%22%20x2%3D%2237.25%22%20y1%3D%2222.91%22%20y2%3D%2241.09%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23fbbf24%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23fbbf24%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23f59e0b%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2210.5%22%20fill%3D%22url%28%23a%29%22%20stroke%3D%22%23f8af18%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%23fbbf24%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%223%22%20d%3D%22M32%2015.71V9.5m0%2045v-6.21m11.52-27.81l4.39-4.39M16.09%2047.91l4.39-4.39m0-23l-4.39-4.39m31.82%2031.78l-4.39-4.39M15.71%2032H9.5m45%200h-6.21%22%2F%3E%3C%2Fsvg%3E",
      partlyCloudy: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2216.5%22%20x2%3D%2221.5%22%20y1%3D%2219.67%22%20y2%3D%2228.33%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23fbbf24%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23fbbf24%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23f59e0b%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Ccircle%20cx%3D%2219%22%20cy%3D%2224%22%20r%3D%225%22%20fill%3D%22url%28%23a%29%22%20stroke%3D%22%23f8af18%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%23fbbf24%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%222%22%20d%3D%22M19%2015.67V12.5m0%2023v-3.17m5.89-14.22l2.24-2.24M10.87%2032.13l2.24-2.24m0-11.78l-2.24-2.24m16.26%2016.26l-2.24-2.24M7.5%2024h3.17m19.83%200h-3.17%22%2F%3E%3Cpath%20fill%3D%22url%28%23b%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3C%2Fsvg%3E",
      cloudy: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23a%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3C%2Fsvg%3E",
      rain: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2222.53%22%20x2%3D%2225.47%22%20y1%3D%2242.95%22%20y2%3D%2248.05%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%234286ee%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%234286ee%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230950bc%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23b%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%222%22%20d%3D%22M24.39%2043.03l-.78%204.94M31.39%2043.03l-.78%204.94M38.39%2043.03l-.78%204.94%22%2F%3E%3C%2Fsvg%3E",
      snow: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2230.12%22%20x2%3D%2231.88%22%20y1%3D%2243.48%22%20y2%3D%2246.52%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%2386c3db%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%2386c3db%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%235eafcf%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23b%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3Ccircle%20cx%3D%2231%22%20cy%3D%2245%22%20r%3D%221.25%22%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-miterlimit%3D%2210%22%2F%3E%3Ccircle%20cx%3D%2224%22%20cy%3D%2245%22%20r%3D%221.25%22%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-miterlimit%3D%2210%22%2F%3E%3Ccircle%20cx%3D%2238%22%20cy%3D%2245%22%20r%3D%221.25%22%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-miterlimit%3D%2210%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20d%3D%22M33.17%2046.25l-1.09-.63m-2.16-1.24l-1.09-.63M31%2042.5v1.25m0%203.75v-1.25m-1.08-.63l-1.09.63m4.34-2.5l-1.09.63%22%2F%3E%3C%2Fsvg%3E",
      storm: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2226.74%22%20x2%3D%2235.76%22%20y1%3D%2237.88%22%20y2%3D%2253.52%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f7b23b%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f7b23b%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23f59e0b%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23a%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3Cpath%20fill%3D%22url%28%23b%29%22%20stroke%3D%22%23f6a823%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M30%2036l-4%2012h4l-2%2010%2010-14h-6l4-8h-6z%22%2F%3E%3C%2Fsvg%3E",
      fog: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2222.56%22%20x2%3D%2239.2%22%20y1%3D%2221.96%22%20y2%3D%2250.8%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23f3f7fe%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23deeafb%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2227.5%22%20x2%3D%2236.5%22%20y1%3D%2250.21%22%20y2%3D%2265.79%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23bec1c6%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23b%29%22%20stroke%3D%22%23e6effc%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M46.5%2031.5h-.32a10.49%2010.49%200%2000-19.11-8%207%207%200%2000-10.57%206%207.21%207.21%200%2000.1%201.14A7.5%207.5%200%200018%2045.5a4.19%204.19%200%2000.5%200v0h28a7%207%200%20000-14z%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%223%22%20d%3D%22M17%2058h30M17%2052h30%22%2F%3E%3C%2Fsvg%3E",
      humidity: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2223.61%22%20x2%3D%2237.27%22%20y1%3D%2221.85%22%20y2%3D%2245.52%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%233392d6%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%233392d6%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%232477b2%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url%28%23a%29%22%20stroke%3D%22%232885c7%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%22.5%22%20d%3D%22M32%2017c-6.09%209-10%2014.62-10%2020.09a10%2010%200%200020%200C42%2031.62%2038.09%2026%2032%2017z%22%2F%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M26.24%2030.19a3%203%200%20012.12-.69%203%203%200%20012.12.69%202.51%202.51%200%2001.74%201.92v1.24a2.48%202.48%200%2001-.74%201.9%203.05%203.05%200%2001-2.12.68%203%203%200%2001-2.12-.68%202.48%202.48%200%2001-.74-1.9v-1.24a2.51%202.51%200%2001.74-1.92zm11-.23a.42.42%200%2001-.08.4L29%2041.69a1.37%201.37%200%2001-.44.44%201.87%201.87%200%2001-.72.09h-.67c-.2%200-.33-.06-.38-.18s0-.25.09-.42l8.2-11.35a1%201%200%2001.41-.41%202%202%200%2001.67-.08h.76q.27%200%20.34.22zm-8.9%201.17c-.79%200-1.19.36-1.19%201.07v1c0%20.71.4%201.07%201.19%201.07s1.19-.36%201.19-1.07v-1c.02-.71-.38-1.07-1.17-1.07zm5.16%205.63a3%203%200%20012.12-.69%203%203%200%20012.12.69%202.51%202.51%200%2001.74%201.92v1.24a2.48%202.48%200%2001-.74%201.9%203%203%200%2001-2.12.68%203.05%203.05%200%2001-2.12-.68%202.48%202.48%200%2001-.74-1.9v-1.24a2.51%202.51%200%2001.76-1.92zm2.12.94c-.79%200-1.19.35-1.19%201.07v1c0%20.73.4%201.09%201.19%201.09s1.19-.36%201.19-1.09v-1c.02-.72-.38-1.07-1.17-1.07z%22%2F%3E%3C%2Fsvg%3E",
      thermometer: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2223.73%22%20x2%3D%2239.18%22%20y1%3D%2219.16%22%20y2%3D%2245.93%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23515a69%22%20stop-opacity%3D%22.05%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%236b7280%22%20stop-opacity%3D%22.05%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23384354%22%20stop-opacity%3D%22.1%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22b%22%20x1%3D%2223.48%22%20x2%3D%2239.43%22%20y1%3D%2218.73%22%20y2%3D%2246.36%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23bec1c6%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2242%22%20r%3D%224.5%22%20fill%3D%22%23ef4444%22%2F%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%23ef4444%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%223%22%20d%3D%22M32%2027v15%22%2F%3E%3Cpath%20fill%3D%22url%28%23a%29%22%20stroke%3D%22url%28%23b%29%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22M39%2041.9a7%207%200%2011-14%200%207.12%207.12%200%20013-5.83v-17a4%204%200%20118%200v17a7.12%207.12%200%20013%205.83zM32.5%2025H36m-3.5-4H36m-3.5%208H36%22%2F%3E%3C%2Fsvg%3E",
      wind: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2227.56%22%20x2%3D%2238.27%22%20y1%3D%2217.64%22%20y2%3D%2236.19%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%22.45%22%20stop-color%3D%22%23d4d7dd%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23bec1c6%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22url%28%23a%29%22%20stroke-linecap%3D%22round%22%20stroke-miterlimit%3D%2210%22%20stroke-width%3D%223%22%20d%3D%22M43.64%2020a5%205%200%20113.61%208.46h-35.5M29.14%2044a5%205%200%20103.61-8.46h-21%22%2F%3E%3C%2Fsvg%3E"
    };

    // Weather code to icon mapping
    const weatherIcons = {
      0: { desc: 'Clear Sky', icon: icons.sun },
      1: { desc: 'Mostly Clear', icon: icons.partlyCloudy },
      2: { desc: 'Partly Cloudy', icon: icons.partlyCloudy },
      3: { desc: 'Overcast', icon: icons.cloudy },
      45: { desc: 'Foggy', icon: icons.fog },
      48: { desc: 'Rime Fog', icon: icons.fog },
      51: { desc: 'Light Drizzle', icon: icons.rain },
      53: { desc: 'Drizzle', icon: icons.rain },
      55: { desc: 'Heavy Drizzle', icon: icons.rain },
      61: { desc: 'Light Rain', icon: icons.rain },
      63: { desc: 'Rain', icon: icons.rain },
      65: { desc: 'Heavy Rain', icon: icons.rain },
      71: { desc: 'Light Snow', icon: icons.snow },
      73: { desc: 'Snow', icon: icons.snow },
      75: { desc: 'Heavy Snow', icon: icons.snow },
      77: { desc: 'Snow Grains', icon: icons.snow },
      80: { desc: 'Light Showers', icon: icons.rain },
      81: { desc: 'Showers', icon: icons.rain },
      82: { desc: 'Heavy Showers', icon: icons.rain },
      85: { desc: 'Snow Showers', icon: icons.snow },
      86: { desc: 'Heavy Snow', icon: icons.snow },
      95: { desc: 'Thunderstorm', icon: icons.storm },
      96: { desc: 'Thunderstorm', icon: icons.storm },
      99: { desc: 'Severe Storm', icon: icons.storm }
    };

    // Theme backgrounds - vivid multi-stop gradients
    const themes = {
      'ocean': 'linear-gradient(135deg, #0077b6 0%, #00b4d8 50%, #90e0ef 100%)',
      'sunset': 'linear-gradient(135deg, #ff6b6b 0%, #feca57 50%, #ff9ff3 100%)',
      'aurora': 'linear-gradient(135deg, #a855f7 0%, #06b6d4 50%, #22c55e 100%)',
      'forest': 'linear-gradient(135deg, #065f46 0%, #059669 50%, #34d399 100%)',
      'midnight': 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)',
      'glass': 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
      'transparent': 'transparent'
    };
    
    // Get background style based on theme
    const bgStyle = themes[styles.theme] || themes['ocean'];

    // Handle errors or loading
    if (serverData.error || serverData.temperature === undefined) {
      return [{
        type: 'box',
        background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
        borderRadius: styles.borderRadius || 28,
        width: '100%',
        height: '100%',
        align: 'center',
        justify: 'center',
        children: [
          {
            type: 'stack',
            direction: 'vertical',
            align: 'center',
            padding: styles.padding || 32,
            gap: 16,
            children: [
              { type: 'image', src: icons.thermometer, width: 56, height: 56 },
              { type: 'text', content: serverData.error || 'Loading weather...', style: { color: 'rgba(255,255,255,0.7)', fontSize: 16, textAlign: 'center' } }
            ]
          }
        ]
      }];
    }

    const weather = weatherIcons[serverData.weatherCode] || { desc: 'Unknown', icon: icons.cloudy };
    const font = styles.fontFamily || 'Inter';
    const padding = styles.padding || 32;
    const radius = styles.borderRadius || 28;
    
    // Size settings from styles
    const tempSize = styles.temperatureSize || 80;
    const locationSize = styles.locationSize || 16;
    const conditionSize = styles.conditionSize || 20;
    const detailSize = styles.detailSize || 14;
    const iconSize = styles.iconSize || 80;
    const detailIconSize = styles.detailIconSize || 16;

    // Build detail items with icon + text
    const detailItems = [];
    if (config.showHumidity !== false && serverData.humidity !== undefined) {
      detailItems.push({
        type: 'stack', direction: 'horizontal', align: 'center', gap: 4,
        children: [
          { type: 'image', src: icons.humidity, width: detailIconSize, height: detailIconSize },
          { type: 'text', content: serverData.humidity + '%', style: { fontSize: detailSize, fontFamily: font, color: 'rgba(255,255,255,0.85)' } }
        ]
      });
    }
    if (config.showFeelsLike !== false && serverData.feelsLike !== undefined) {
      detailItems.push({
        type: 'stack', direction: 'horizontal', align: 'center', gap: 4,
        children: [
          { type: 'image', src: icons.thermometer, width: detailIconSize, height: detailIconSize },
          { type: 'text', content: serverData.feelsLike + '°', style: { fontSize: detailSize, fontFamily: font, color: 'rgba(255,255,255,0.85)' } }
        ]
      });
    }
    if (config.showWind && serverData.windSpeed !== undefined) {
      detailItems.push({
        type: 'stack', direction: 'horizontal', align: 'center', gap: 4,
        children: [
          { type: 'image', src: icons.wind, width: detailIconSize, height: detailIconSize },
          { type: 'text', content: serverData.windSpeed + ' mph', style: { fontSize: detailSize, fontFamily: font, color: 'rgba(255,255,255,0.85)' } }
        ]
      });
    }

    // Left side - location, temp, condition
    const leftChildren = [];
    
    if (config.showLocation !== false && serverData.location?.city) {
      leftChildren.push({
        type: 'text',
        content: serverData.location.city + (serverData.location.state ? ', ' + serverData.location.state : ''),
        style: {
          fontSize: locationSize,
          fontFamily: font,
          fontWeight: '600',
          color: 'rgba(255,255,255,0.9)',
          letterSpacing: '0.5px',
          textTransform: 'uppercase'
        }
      });
    }

    leftChildren.push({
      type: 'text',
      content: serverData.temperature + '°',
      style: {
        fontSize: tempSize,
        fontFamily: font,
        fontWeight: '100',
        color: '#ffffff',
        lineHeight: 0.9
      }
    });

    if (config.showCondition !== false) {
      leftChildren.push({
        type: 'text',
        content: weather.desc,
        style: {
          fontSize: conditionSize,
          fontFamily: font,
          fontWeight: '500',
          color: 'rgba(255,255,255,0.95)'
        }
      });
    }

    // Right side - weather icon and details
    const rightChildren = [];
    
    if (config.showIcon !== false) {
      rightChildren.push({
        type: 'image',
        src: weather.icon,
        width: iconSize,
        height: iconSize
      });
    }

    if (detailItems.length > 0) {
      rightChildren.push({
        type: 'stack',
        direction: 'horizontal',
        gap: 20,
        children: detailItems
      });
    }

    // Main container with gradient background
    // Apply background opacity (only to the background, not content)
    const bgOpacity = (styles.backgroundOpacity ?? 100) / 100;
    const showBackground = styles.theme !== 'transparent' && bgOpacity > 0;
    
    // Build children array - background layer + content layer
    const containerChildren = [];
    
    // Background layer (with opacity) - only if visible
    if (showBackground) {
      containerChildren.push({
        type: 'box',
        background: bgStyle,
        opacity: bgOpacity,
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0
      });
    }
    
    // Content layer (always visible)
    containerChildren.push({
      type: 'stack',
      direction: 'horizontal',
      padding: padding,
      width: '100%',
      height: '100%',
      align: 'center',
      justify: 'space-between',
      position: 'relative',
      zIndex: 1,
      children: [
        {
          type: 'stack',
          direction: 'vertical',
          align: 'flex-start',
          gap: 8,
          children: leftChildren
        },
        {
          type: 'stack',
          direction: 'vertical',
          align: 'flex-end',
          gap: 16,
          children: rightChildren
        }
      ]
    });
    
    return [{
      type: 'box',
      position: 'relative',
      borderRadius: radius,
      overflow: 'hidden',
      width: '100%',
      height: '100%',
      children: containerChildren
    }];
  }
}`,

  // Server code - fetches weather data from API
  serverCode: `return {
  async run(context) {
    const config = context.config || {};
    const units = config.units || 'fahrenheit';
    const locationMode = config.locationMode || 'zip';
    
    let lat, lon, locationInfo = {};
    
    if (locationMode === 'zip' && config.zipCode) {
      try {
        const geoUrl = 'https://api.zippopotam.us/us/' + encodeURIComponent(config.zipCode);
        const geoData = await context.api.http.get(geoUrl);
        if (!geoData || !geoData.places || geoData.places.length === 0) {
          return { error: 'Invalid ZIP: ' + config.zipCode };
        }
        lat = parseFloat(geoData.places[0].latitude);
        lon = parseFloat(geoData.places[0].longitude);
        locationInfo = { city: geoData.places[0]['place name'], state: geoData.places[0]['state abbreviation'] };
      } catch (e) {
        return { error: 'ZIP lookup failed: ' + e.message };
      }
    } else {
      lat = config.latitude || 40.7128;
      lon = config.longitude || -74.0060;
      
      // Reverse geocode coordinates to get city name
      try {
        const geoUrl = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon + '&zoom=10';
        const geoResponse = await fetch(geoUrl, {
          headers: { 'User-Agent': 'WeatherWidget/1.0' }
        });
        const geoData = await geoResponse.json();
        if (geoData && geoData.address) {
          const addr = geoData.address;
          locationInfo = {
            city: addr.city || addr.town || addr.village || addr.municipality || addr.county || 'Unknown',
            state: addr.state || addr.country
          };
        }
      } catch (e) {
        // Reverse geocoding failed, show coordinates
        locationInfo = { city: lat.toFixed(2) + ', ' + lon.toFixed(2) };
      }
    }

    const tempUnit = units === 'celsius' ? 'celsius' : 'fahrenheit';
    const windUnit = units === 'celsius' ? 'kmh' : 'mph';
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto&temperature_unit=' + tempUnit + '&wind_speed_unit=' + windUnit;

    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data.current) {
        return { error: 'No weather data' };
      }
      
      const _days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const _daily = data.daily || {};
      const _forecast = [];
      if (_daily.time) {
        for (let i = 0; i < Math.min(5, _daily.time.length); i++) {
          const _dt = new Date(_daily.time[i] + 'T12:00:00');
          _forecast.push({
            day: i === 0 ? 'Today' : _days[_dt.getDay()],
            code: _daily.weather_code[i],
            hi: Math.round(_daily.temperature_2m_max[i]),
            lo: Math.round(_daily.temperature_2m_min[i])
          });
        }
      }
      return {
        temperature: Math.round(data.current.temperature_2m),
        feelsLike: Math.round(data.current.apparent_temperature),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        weatherCode: data.current.weather_code,
        units: units,
        location: locationInfo,
        forecast: _forecast
      };
    } catch (error) {
      return { error: 'Weather unavailable' };
    }
  }
}`,
};
