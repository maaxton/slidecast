import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
// Bare specifier resolved to extensions/slidecast/ by vitest.config.js resolve.alias
// (ESLint import/no-relative-packages forbids relative imports across the boundary).
import SlideImageRenderer from 'slidecast/SlideImageRenderer.js';

// Proves the poll-path memoization on SlideImageRenderer.getSlideLayerMetadata:
// the per-screen ~10s cast-version poll re-reads + JSON.parses the same
// layers.json repeatedly, so it is cached and invalidated by the file's mtime.

const CAST = 'cast-A';
const SLIDE = 0;

async function writeLayers(renderer, obj, mtimeMs) {
  const dir = renderer.getSlideDir(CAST, SLIDE);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'layers.json');
  await fs.writeFile(file, JSON.stringify(obj));
  if (mtimeMs != null) {
    const t = new Date(mtimeMs);
    await fs.utimes(file, t, t);
  }
  return file;
}

describe('SlideImageRenderer.getSlideLayerMetadata memoization', () => {
  let tmpDir;
  let renderer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slidemeta-'));
    renderer = new SlideImageRenderer(null, { dataDir: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns the memoized parse when mtime is unchanged', async () => {
    const fixedMtime = 1_700_000_000_000;
    await writeLayers(renderer, { layers: [{ id: 'a', file: 'a.png' }] }, fixedMtime);

    const first = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(first.layers[0].id).toBe('a');

    // Rewrite the file with DIFFERENT content but restore the original mtime.
    // A cache that honored mtime must still return the first (stale-by-bytes)
    // value; a cache that re-read on every call would return 'b'.
    await writeLayers(renderer, { layers: [{ id: 'b', file: 'b.png' }] }, fixedMtime);

    const second = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(second.layers[0].id).toBe('a'); // memoized, not re-read
  });

  it('re-reads when the file mtime advances', async () => {
    await writeLayers(renderer, { layers: [{ id: 'a' }] }, 1_700_000_000_000);
    const first = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(first.layers[0].id).toBe('a');

    await writeLayers(renderer, { layers: [{ id: 'b' }] }, 1_700_000_005_000);
    const second = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(second.layers[0].id).toBe('b'); // mtime bumped → cache invalidated
  });

  it('invalidateSlideMeta forces a fresh read even at the same mtime', async () => {
    const fixedMtime = 1_700_000_000_000;
    await writeLayers(renderer, { layers: [{ id: 'a' }] }, fixedMtime);
    await renderer.getSlideLayerMetadata(CAST, SLIDE);

    await writeLayers(renderer, { layers: [{ id: 'b' }] }, fixedMtime);
    renderer.invalidateSlideMeta(CAST, SLIDE);

    const after = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(after.layers[0].id).toBe('b');
  });

  it('returns an independent clone so callers cannot corrupt the cache', async () => {
    await writeLayers(renderer, { layers: [{ id: 'a', contentHash: 'orig' }] }, 1_700_000_000_000);

    const first = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    first.layers[0].contentHash = 'MUTATED'; // simulate rerender-element route

    const second = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(second.layers[0].contentHash).toBe('orig'); // cache untouched
  });

  it('returns null and drops any cached entry when the file is missing', async () => {
    await writeLayers(renderer, { layers: [{ id: 'a' }] }, 1_700_000_000_000);
    await renderer.getSlideLayerMetadata(CAST, SLIDE);

    await fs.rm(renderer.getSlideDir(CAST, SLIDE), { recursive: true, force: true });
    const gone = await renderer.getSlideLayerMetadata(CAST, SLIDE);
    expect(gone).toBeNull();
  });
});
