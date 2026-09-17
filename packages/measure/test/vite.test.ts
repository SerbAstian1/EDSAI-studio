import { describe, expect, it } from 'vitest';
import { bundleFromViteManifest, initialKeys, type ViteManifest } from '../src/vite.js';

/**
 * The manifest, not the filename, decides what is on the initial route. This is
 * tested against the shape the Studio's own build produces, including the case
 * that caught the filename heuristic out: a shared module reached only from
 * lazy screens, whose name resembles one of them.
 */

const manifest: ViteManifest = {
  'index.html': {
    file: 'assets/index-aaa.js',
    isEntry: true,
    imports: ['_react-bbb.js', '_query-ccc.js'],
    dynamicImports: ['src/screens/Scorecard.tsx'],
    css: ['assets/index-ddd.css'],
  },
  '_react-bbb.js': { file: 'assets/react-bbb.js' },
  '_query-ccc.js': { file: 'assets/query-ccc.js' },
  'src/screens/Scorecard.tsx': {
    file: 'assets/Scorecard-eee.js',
    imports: ['_scorecard-fff.js'],
    css: ['assets/Scorecard-ggg.css'],
  },
  '_scorecard-fff.js': { file: 'assets/scorecard-fff.js' },
};

const sizeOf = (file: string) => ({ bytes: file.length * 100, gzipBytes: file.length * 30 });

describe('initialKeys', () => {
  it('follows static imports from the entry and stops at a dynamic one', () => {
    expect(initialKeys(manifest)).toEqual(new Set(['index.html', '_react-bbb.js', '_query-ccc.js']));
  });

  it('does not treat a shared module reached only from a lazy screen as initial', () => {
    expect(initialKeys(manifest).has('_scorecard-fff.js')).toBe(false);
  });

  it('survives a cycle rather than recursing forever', () => {
    const cyclic: ViteManifest = {
      a: { file: 'a.js', isEntry: true, imports: ['b'] },
      b: { file: 'b.js', imports: ['a'] },
    };
    expect(initialKeys(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('returns nothing when no entry is marked', () => {
    expect(initialKeys({ a: { file: 'a.js' } }).size).toBe(0);
  });
});

describe('bundleFromViteManifest', () => {
  it('splits initial from lazy across both js and css', () => {
    const record = bundleFromViteManifest(manifest, sizeOf);
    const initial = record.chunks.filter((c) => c.initial).map((c) => c.name).sort();
    expect(initial).toEqual([
      'assets/index-aaa.js', 'assets/index-ddd.css', 'assets/query-ccc.js', 'assets/react-bbb.js',
    ]);
    expect(record.chunks.filter((c) => !c.initial).map((c) => c.name).sort()).toEqual([
      'assets/Scorecard-eee.js', 'assets/Scorecard-ggg.css', 'assets/scorecard-fff.js',
    ]);
  });

  it('marks only initial-route CSS render-blocking', () => {
    const record = bundleFromViteManifest(manifest, sizeOf);
    expect(record.chunks.filter((c) => c.renderBlocking).map((c) => c.name))
      .toEqual(['assets/index-ddd.css']);
  });

  it('skips a file the build did not emit rather than sizing it at zero', () => {
    const record = bundleFromViteManifest(manifest, (file) =>
      file.endsWith('.css') ? undefined : sizeOf(file));
    expect(record.chunks.every((c) => !c.name.endsWith('.css'))).toBe(true);
  });

  it('records a file once even when two manifest entries reference it', () => {
    const shared: ViteManifest = {
      a: { file: 'a.js', isEntry: true, css: ['shared.css'] },
      b: { file: 'b.js', css: ['shared.css'] },
    };
    const record = bundleFromViteManifest(shared, sizeOf);
    expect(record.chunks.filter((c) => c.name === 'shared.css')).toHaveLength(1);
  });
});
