import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BundleRecord } from './records.js';

/**
 * Read a Vite build into a `BundleRecord`.
 *
 * The distinction that decides the whole measurement is which chunks are on the
 * initial route. The manifest states it exactly: the entry, plus everything it
 * reaches through `imports`, is initial; anything reached only through
 * `dynamicImports` is not. Inferring it from filenames — which is what the
 * Studio's budget script did first — quietly breaks the moment a lazy screen is
 * renamed, and the failure looks like the bundle getting smaller.
 *
 * Gzip is computed at level 9 rather than estimated, so the figure is the one a
 * CDN actually sends.
 */

export interface ViteManifestEntry {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

export type ViteManifest = Record<string, ViteManifestEntry>;

/** Which manifest keys are reachable from an entry through static imports only. */
export function initialKeys(manifest: ViteManifest): Set<string> {
  const reached = new Set<string>();
  const walk = (key: string): void => {
    if (reached.has(key)) return;
    const entry = manifest[key];
    if (!entry) return;
    reached.add(key);
    for (const next of entry.imports ?? []) walk(next);
  };
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isEntry) walk(key);
  }
  return reached;
}

export interface FileSize {
  bytes: number;
  gzipBytes: number;
}

/**
 * The pure half: a manifest plus a way to size a file becomes a record.
 *
 * Kept separate from disk so it can be tested without a build, and so a CI job
 * that already has sizes does not have to re-read the files.
 */
export function bundleFromViteManifest(
  manifest: ViteManifest,
  sizeOf: (file: string) => FileSize | undefined,
): BundleRecord {
  const initial = initialKeys(manifest);
  const chunks: BundleRecord['chunks'] = [];
  const seen = new Set<string>();

  const add = (file: string, isInitial: boolean, renderBlocking: boolean): void => {
    if (seen.has(file)) return;
    const size = sizeOf(file);
    if (!size) return;
    seen.add(file);
    chunks.push({
      name: file,
      bytes: size.bytes,
      gzipBytes: size.gzipBytes,
      initial: isInitial,
      renderBlocking,
    });
  };

  for (const [key, entry] of Object.entries(manifest)) {
    const isInitial = initial.has(key);
    add(entry.file, isInitial, false);
    // A stylesheet on the initial route blocks first paint; one pulled in with a
    // lazy chunk does not, because nothing is waiting on it yet.
    for (const css of entry.css ?? []) add(css, isInitial, isInitial);
  }

  return BundleRecord.parse({ chunks, source: 'vite manifest' });
}

/** Read `dist/.vite/manifest.json` and gzip each referenced file. */
export function bundleFromViteDist(distDir: string): BundleRecord {
  const manifestPath = [
    join(distDir, '.vite', 'manifest.json'),
    join(distDir, 'manifest.json'),
  ].find((candidate) => existsSync(candidate));

  if (!manifestPath) {
    throw new Error(
      `No Vite manifest under ${distDir}. Set build.manifest to true — without it the initial ` +
      'route has to be guessed from filenames, and a guess is not a measurement.',
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ViteManifest;
  return bundleFromViteManifest(manifest, (file) => {
    const path = join(distDir, file);
    if (!existsSync(path)) return undefined;
    const contents = readFileSync(path);
    return { bytes: contents.byteLength, gzipBytes: gzipSync(contents, { level: 9 }).byteLength };
  });
}
