/**
 * Migration: Add app_last_heartbeat column to slidecast_screens
 * This tracks when the Waiveo app last sent a heartbeat (separate from device discovery)
 */

export async function migrate(api) {
  try {
    // Check if column already exists
    const tableInfo = await api.queryBuilder('slidecast_screens')
      .raw('PRAGMA table_info(slidecast_screens)')
      .catch(() => []);

    const columns = Array.isArray(tableInfo) ? tableInfo : [];
    const hasColumn = columns.some((col) => col.name === 'app_last_heartbeat');

    if (!hasColumn) {
      await api.queryBuilder('slidecast_screens')
        .raw('ALTER TABLE slidecast_screens ADD COLUMN app_last_heartbeat TEXT');
    }

    return { success: true };
  } catch (error) {
    console.error('[Slidecast] app_last_heartbeat migration error:', error.message);
    return { success: false, error: error.message };
  }
}
