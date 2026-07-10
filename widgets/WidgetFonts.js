/**
 * WidgetFonts - Font catalog for widget rendering
 *
 * ROKU COMPATIBILITY NOTES:
 * - Roku apps must bundle TTF/OTF font files (no web fonts)
 * - This curated list is optimized for Roku app bundle size (~3-4MB total)
 * - All fonts are Google Fonts with SIL Open Font License (free to bundle)
 * - Fonts are downloaded to /app/data/slidecast/fonts/ at runtime
 *
 * For Roku native text rendering, these fonts will be included in the app package.
 * For widget image rendering (Satori), fonts are loaded server-side.
 */

/**
 * Fonts available for both widget rendering and Roku native text
 * These fonts are bundled with the Roku app and available server-side
 */
export const NATIVE_FONTS = [
  // Sans-serif (Primary choices for readability on TV)
  {
    name: 'Inter', family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700], roku: true,
  },
  {
    name: 'Roboto', family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700], roku: true,
  },
  {
    name: 'Open Sans', family: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700], roku: true,
  },
  {
    name: 'Lato', family: 'Lato', category: 'sans-serif', weights: [400, 700], roku: true,
  },

  // Serif (Elegant, traditional look)
  {
    name: 'Roboto Slab', family: 'Roboto Slab', category: 'serif', weights: [400, 500, 700], roku: true,
  },
  {
    name: 'Merriweather', family: 'Merriweather', category: 'serif', weights: [400, 700], roku: true,
  },

  // Monospace (Clocks, timers, code)
  {
    name: 'JetBrains Mono', family: 'JetBrains Mono', category: 'monospace', weights: [400, 500, 600, 700], roku: true,
  },
  {
    name: 'Roboto Mono', family: 'Roboto Mono', category: 'monospace', weights: [400, 500, 700], roku: true,
  },

  // Display (Headlines, attention-grabbing)
  {
    name: 'Bebas Neue', family: 'Bebas Neue', category: 'display', weights: [400], roku: true,
  },
  {
    name: 'Oswald', family: 'Oswald', category: 'display', weights: [400, 500, 600, 700], roku: true,
  },

  // System fallback (always available)
  {
    name: 'System', family: 'system-ui, -apple-system, sans-serif', category: 'system', weights: [400, 500, 600, 700], roku: false,
  },
];

/**
 * Generate Google Fonts URL for all fonts
 */
export const GOOGLE_FONTS_URL = (() => {
  const fontFamilies = NATIVE_FONTS
    .filter((f) => f.category !== 'system')
    .map((f) => {
      const weights = f.weights.join(';');
      return `family=${f.family.replace(/ /g, '+')}:wght@${weights}`;
    })
    .join('&');

  return `https://fonts.googleapis.com/css2?${fontFamilies}&display=swap`;
})();

/**
 * Get fonts by category
 */
export function getFontsByCategory(category) {
  return NATIVE_FONTS.filter((f) => f.category === category);
}

/**
 * Get font by name
 */
export function getFont(name) {
  return NATIVE_FONTS.find((f) => f.name === name);
}

/**
 * Check if a font is supported
 */
export function isFontSupported(name) {
  return NATIVE_FONTS.some((f) => f.name === name || f.family === name);
}

/**
 * Get all font names for UI dropdowns
 */
export function getFontOptions() {
  return NATIVE_FONTS.map((f) => ({
    value: f.family,
    label: f.name,
    category: f.category,
  }));
}

/**
 * Font categories for grouping in UI
 */
export const FONT_CATEGORIES = [
  { id: 'sans-serif', label: 'Sans Serif', description: 'Clean, modern fonts for body text' },
  { id: 'serif', label: 'Serif', description: 'Classic, elegant fonts' },
  { id: 'monospace', label: 'Monospace', description: 'Fixed-width fonts for clocks/timers' },
  { id: 'display', label: 'Display', description: 'Bold headline fonts' },
  { id: 'system', label: 'System', description: 'Default system font' },
];

/**
 * Default fonts by use case
 */
export const DEFAULT_FONTS = {
  heading: 'Inter',
  body: 'Inter',
  mono: 'JetBrains Mono',
  display: 'Bebas Neue',
  clock: 'JetBrains Mono',
  date: 'Inter',
};

/**
 * Get Roku-compatible fonts only
 */
export function getRokuFonts() {
  return NATIVE_FONTS.filter((f) => f.roku === true);
}

export default {
  NATIVE_FONTS,
  GOOGLE_FONTS_URL,
  getFontsByCategory,
  getFont,
  isFontSupported,
  getFontOptions,
  getRokuFonts,
  FONT_CATEGORIES,
  DEFAULT_FONTS,
};
