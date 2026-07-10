/**
 * Force update all system widgets with latest code
 * This migration deletes and recreates all system widgets
 */

export async function migrate(api) {
  const model = api.model('slidecast_widgets');

  // List of system widget names to reset
  const systemWidgetNames = [
    'Digital Clock',
    'Date Display',
    'Countdown Timer',
    'Current Weather',
    'Text Block',
    'Entity Display',
    'Quote of the Day',
  ];

  let deleted = 0;

  // Delete existing system widgets by name
  for (const name of systemWidgetNames) {
    try {
      const existing = await model.findAll({ where: { name } });
      for (const widget of existing) {
        await model.delete(widget.id);
        deleted++;
      }
    } catch (error) {
      console.log(`[Widget Migration] Could not delete ${name}: ${error.message}`);
    }
  }

  console.log(`[Widget Migration] Deleted ${deleted} widgets, seed will recreate them`);

  return { deleted };
}
