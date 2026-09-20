import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

/**
 * Serving the Studio from the same process as the API.
 *
 * One origin, one process, one thing to deploy. The alternative — a static host
 * for the interface and a separate host for the API — buys nothing here and
 * costs a CORS configuration, a second deployment, and a cookie that has to be
 * `SameSite=None` to cross between them. The whole session design in this
 * codebase leans on `SameSite=Lax`; splitting the origins would quietly give
 * that up.
 *
 * It also makes the portal link work without configuration. A client's link is
 * built from the browser's own origin, so whatever host this runs on is the
 * host in the link, with nothing to keep in sync.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

/**
 * The file a URL path refers to, or nothing.
 *
 * The check that matters is the last one. A request for
 * `/../../etc/passwd` resolves to a real file outside the build directory, and
 * a server that opened it would hand over whatever the process can read. So the
 * resolved path is compared against the resolved root, and anything that
 * escapes is treated as though it does not exist — which, as far as this server
 * is concerned, it does not.
 *
 * Returning `undefined` rather than throwing keeps the caller's shape simple:
 * every miss, hostile or innocent, falls through to the same place.
 */
export function fileFor(root: string, pathname: string): string | undefined {
  const base = resolve(root);
  const requested = decodeURIComponentSafe(pathname);
  if (requested === undefined) return undefined;

  // A null byte truncates a path in some syscalls; anything containing one is
  // not a filename this server is willing to reason about.
  if (requested.includes('\0')) return undefined;

  const candidate = resolve(join(base, requested === '/' ? 'index.html' : requested));
  if (candidate !== base && !candidate.startsWith(base + sep)) return undefined;

  // Nothing whose name begins with a dot. Vite's `.vite/manifest.json` is
  // harmless, but a build directory is somewhere files arrive by accident, and
  // the accident that matters is a `.env` next to the bundle. A rule about the
  // shape of the name does not depend on anyone noticing the file.
  if (relative(base, candidate).split(sep).some((part) => part.startsWith('.'))) return undefined;
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
  return candidate;
}

function decodeURIComponentSafe(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is not a path. Refusing beats guessing at the bytes.
    return undefined;
  }
}

/**
 * The files the build content-hashed, read from the build's own manifest.
 *
 * The obvious way to do this is to look at the filename, and it is wrong. Vite
 * writes `index-C_lsOoT-.js`, and a pattern loose enough to recognise that
 * also recognises `use-media-query.js`, which is not hashed at all — so the
 * guess either misses the real assets or caches an unhashed file forever. The
 * manifest is not a guess: the build lists exactly what it emitted, and a file
 * in that list has its content in its name by construction.
 *
 * A build with no manifest is not an error. Nothing is treated as hashed, so
 * every file is revalidated — slower, and never wrong.
 */
export function hashedFiles(root: string): ReadonlySet<string> {
  const manifest = join(resolve(root), '.vite', 'manifest.json');
  if (!existsSync(manifest)) return new Set();

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return new Set();

    const files = new Set<string>();
    for (const entry of Object.values(parsed as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const chunk = entry as { file?: unknown; css?: unknown; assets?: unknown };
      if (typeof chunk.file === 'string') files.add(chunk.file);
      for (const list of [chunk.css, chunk.assets]) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (typeof item === 'string') files.add(item);
      }
    }
    return files;
  } catch {
    // A manifest that does not parse tells us nothing, so assume nothing.
    return new Set();
  }
}

/**
 * How long a browser may keep it.
 *
 * A hashed asset can be held forever: a changed file is a changed name, so the
 * cached copy can never be the wrong one. `index.html` names those assets, so
 * it must never be cached — a stale copy points at assets a deploy has already
 * replaced, and the app fails to boot. That is the classic way a good release
 * looks broken.
 */
export function cacheHeaderFor(published: string, hashed: ReadonlySet<string>): string {
  return hashed.has(published) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * A built single-page app, served from disk.
 *
 * The manifest is read once, when this is constructed. A deploy replaces the
 * files and restarts the process, so there is no case where re-reading it per
 * request would learn anything — and one where it would cost a file read on
 * every asset.
 */
export class StaticApp {
  readonly root: string;
  private readonly hashed: ReadonlySet<string>;

  constructor(root: string) {
    this.root = resolve(root);
    this.hashed = hashedFiles(this.root);
  }

  private send(res: ServerResponse, file: string): void {
    const published = relative(this.root, file).split(sep).join('/');
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': cacheHeaderFor(published, this.hashed),
      // The interface is not a document to be framed, and a browser should not
      // go looking for a better type than the one it was given.
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    createReadStream(file).pipe(res);
  }

  /**
   * Serve a path, falling back to the entry document.
   *
   * The Studio routes on the hash, so a deep link is `/#/clients/acme` and the
   * path is always `/`. The fallback is here for the case that is not true —
   * someone bookmarks a path, a future router stops using the hash — where the
   * alternative is a 404 on a page that exists.
   *
   * Anything under `/api` or `/portal` never reaches here: those are the
   * server's own, and answering them with an HTML document would turn a
   * missing endpoint into a page that looks like it loaded.
   */
  serve(res: ServerResponse, pathname: string): boolean {
    const file = fileFor(this.root, pathname) ?? fileFor(this.root, '/');
    if (!file) return false;
    this.send(res, file);
    return true;
  }
}
