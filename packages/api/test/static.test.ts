import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiServer, cacheHeaderFor, fileFor, hashedFiles } from '../src/index.js';

/**
 * The traversal cases are the reason this file exists. Everything else here is
 * a header; `fileFor` is the thing standing between a URL and the filesystem
 * of whatever machine this is deployed on.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'edsai-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Studio</title>');
  mkdirSync(join(root, 'assets'));
  // Named the way Vite actually names things: a dash, not a dot.
  writeFileSync(join(root, 'assets', 'index-C_lsOoT-.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'use-media-query.js'), 'console.log(2)');
  mkdirSync(join(root, '.vite'));
  writeFileSync(join(root, '.vite', 'manifest.json'), JSON.stringify({
    'index.html': { file: 'assets/index-C_lsOoT-.js', name: 'index', css: ['assets/index-DCgAT9tx.css'] },
  }));
  // A file outside the root, with a name a traversal would aim at.
  writeFileSync(join(root, '..', 'edsai-secret.txt'), 'not yours');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(root, '..', 'edsai-secret.txt'), { force: true });
});

describe('fileFor', () => {
  it('finds a file in the root', () => {
    expect(fileFor(root, '/assets/index-C_lsOoT-.js'))
      .toBe(join(root, 'assets', 'index-C_lsOoT-.js'));
  });

  it('treats / as the entry document', () => {
    expect(fileFor(root, '/')).toBe(join(root, 'index.html'));
  });

  it('refuses a path that climbs out of the root', () => {
    expect(fileFor(root, '/../edsai-secret.txt')).toBeUndefined();
  });

  it('refuses a climb hidden in percent-encoding', () => {
    // `%2e%2e%2f` is `../`. A server that resolved before decoding would let
    // this through, which is why the decode happens first.
    expect(fileFor(root, '/%2e%2e%2fedsai-secret.txt')).toBeUndefined();
  });

  it('refuses a deep climb that lands back on a real file', () => {
    expect(fileFor(root, '/assets/../../edsai-secret.txt')).toBeUndefined();
  });

  it('refuses an absolute path', () => {
    expect(fileFor(root, '//etc/passwd')).toBeUndefined();
  });

  it('refuses a malformed escape rather than guessing', () => {
    expect(fileFor(root, '/%zz')).toBeUndefined();
  });

  it('refuses a null byte', () => {
    expect(fileFor(root, '/index.html%00.png')).toBeUndefined();
  });

  it('is nothing for a directory', () => {
    expect(fileFor(root, '/assets')).toBeUndefined();
  });

  it('is nothing for a file that is not there', () => {
    expect(fileFor(root, '/nope.js')).toBeUndefined();
  });
});

describe('hashedFiles', () => {
  it('reads the chunks and their stylesheets out of the manifest', () => {
    expect([...hashedFiles(root)].sort())
      .toEqual(['assets/index-C_lsOoT-.js', 'assets/index-DCgAT9tx.css']);
  });

  it('claims nothing when there is no manifest', () => {
    const bare = mkdtempSync(join(tmpdir(), 'edsai-bare-'));
    expect(hashedFiles(bare).size).toBe(0);
    rmSync(bare, { recursive: true, force: true });
  });

  it('claims nothing when the manifest is not JSON', () => {
    const broken = mkdtempSync(join(tmpdir(), 'edsai-broken-'));
    mkdirSync(join(broken, '.vite'));
    writeFileSync(join(broken, '.vite', 'manifest.json'), 'not json');
    expect(hashedFiles(broken).size).toBe(0);
    rmSync(broken, { recursive: true, force: true });
  });
});

describe('cacheHeaderFor', () => {
  const hashed = new Set(['assets/index-C_lsOoT-.js']);

  it('lets a hashed asset be kept forever', () => {
    expect(cacheHeaderFor('assets/index-C_lsOoT-.js', hashed))
      .toBe('public, max-age=31536000, immutable');
  });

  it('never lets the entry document be kept', () => {
    // The failure this prevents: a cached index.html naming assets that a
    // deploy has already replaced, so the app boots into a 404.
    expect(cacheHeaderFor('index.html', hashed)).toBe('no-cache');
  });

  it('does not cache a file the build did not hash', () => {
    // `use-media-query.js` looks exactly like a hashed name to any pattern
    // loose enough to match `index-C_lsOoT-.js`. It is not one.
    expect(cacheHeaderFor('assets/use-media-query.js', hashed)).toBe('no-cache');
  });
});

describe('the server serving the app', () => {
  let server: ApiServer;
  let base: string;

  beforeEach(async () => {
    server = new ApiServer({ app: root });
    base = `http://localhost:${await server.listen(0)}`;
  });

  afterEach(async () => { await server.close(); });

  it('serves the entry document at the root', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('Studio');
  });

  it('serves an asset with its own type, kept forever', async () => {
    const res = await fetch(`${base}/assets/index-C_lsOoT-.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('makes a browser revalidate a file the build did not hash', async () => {
    const res = await fetch(`${base}/assets/use-media-query.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('falls back to the entry document for an unknown path', async () => {
    const res = await fetch(`${base}/clients/acme`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Studio');
  });

  it('still answers an unknown API path as JSON', async () => {
    // The one that would be easy to get wrong: a misspelled endpoint must not
    // come back as an HTML page that looks like it loaded.
    const res = await fetch(`${base}/api/nothing-here`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('leaves the portal to the portal', async () => {
    const res = await fetch(`${base}/portal/enter/nonsense`);
    expect(res.headers.get('content-type')).not.toBe('text/javascript; charset=utf-8');
    expect(res.status).not.toBe(200);
  });

  it('does not serve the app for a write', async () => {
    // Refused at 403 by the origin check, before routing — earlier than the
    // fallback, which is the point: a POST never reaches the app at all.
    const res = await fetch(`${base}/anything`, { method: 'POST' });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('<!doctype html>');
  });
});

describe('a server given no app directory', () => {
  it('404s rather than inventing a page', async () => {
    const server = new ApiServer({});
    const port = await server.listen(0);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(404);
    await server.close();
  });
});

describe('dotfiles', () => {
  it('refuses a file whose name begins with a dot', () => {
    // The one that would matter: an .env that found its way into a build.
    writeFileSync(join(root, '.env'), 'EDSAI_SIGNIN_ALLOW=owner@example.com');
    expect(fileFor(root, '/.env')).toBeUndefined();
  });

  it('refuses a file inside a dot directory', () => {
    expect(fileFor(root, '/.vite/manifest.json')).toBeUndefined();
  });
});

describe('a write from the page this server served', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    // No `origins`: the deployment that forgot to configure them.
    server = new ApiServer({});
    port = await server.listen(0);
  });

  afterEach(async () => { await server.close(); });

  it('is accepted', async () => {
    const res = await fetch(`http://localhost:${port}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
      body: JSON.stringify({ email: 'a@b.co', name: 'Owner', password: 'a-long-passphrase-1' }),
    });
    expect(res.status).toBe(201);
  });

  it('is accepted when TLS was terminated in front of it', async () => {
    // The browser says https; this process only ever saw http.
    const res = await fetch(`http://localhost:${port}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `https://localhost:${port}` },
      body: JSON.stringify({ email: 'a@b.co', name: 'Owner', password: 'a-long-passphrase-1' }),
    });
    expect(res.status).toBe(201);
  });

  it('is refused from somewhere else', async () => {
    const res = await fetch(`http://localhost:${port}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'a@b.co', name: 'Owner', password: 'a-long-passphrase-1' }),
    });
    expect(res.status).toBe(403);
  });
});
