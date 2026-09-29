import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildRubric } from '@edsai/rubric';
import { RunStore, shelfDocumentId } from '@edsai/engine';
import { ApiServer, newId } from '../src/server.js';

/**
 * The Figma routes, over real HTTP, against a stand-in for Figma.
 *
 * **The stand-in is a server rather than a stubbed `fetch`.** Every interesting
 * thing about these routes is in the request they build — the token in the
 * header, the file key in the path, `depth=2`, whether the id sent is spelled
 * the way a URL needs it — and a `fetch` mock can be asserted on while the real
 * request is wrong. So the assertions are on what arrived *here*: the path, the
 * method, the token, and what came back out of the studio.
 */

const rubric = buildRubric();
let api: ApiServer;
let base: string;
let store: RunStore;
let figma: Server;
let figmaBase: string;
let cookie = '';

/** Every request the stand-in received, so a test can assert on the wire. */
let seen: { method: string; url: string; token: string | undefined }[] = [];

/** What the stand-in answers with next, keyed by a substring of the path. */
let replies: { match: RegExp; status: number; body: unknown }[] = [];

/**
 * How the next file read is answered, ignoring the table.
 *
 * Separate because the two failure tests need to make Figma misbehave *after*
 * the table has been set up for the file itself, and a table whose first match
 * wins is awkward to aim like that. A bare number is the default: 200.
 */
let figmaResponses = 200;

const FILE_KEY = 'AbC123xyz';
const LINK = `https://www.figma.com/design/${FILE_KEY}/Brand?node-id=1-0`;

/** A file with two canvases and three top-level frames, as Figma writes ids. */
const figmaFile = (names: string[] = ['Cover', 'Strategy', 'Thank you']) => ({
  name: 'Brand file',
  lastModified: '2026-02-01T00:00:00Z',
  version: '7',
  document: {
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [
      {
        id: '0:1',
        name: 'Page 1',
        type: 'CANVAS',
        children: [{
          id: '0:2', name: 'Moodboard', type: 'FRAME', visible: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
        }],
      },
      {
        id: '1:0',
        name: 'Deck',
        type: 'CANVAS',
        children: names.map((name, at) => ({
          id: `1:${at + 1}`, name, type: 'FRAME', visible: true,
          absoluteBoundingBox: { x: 0, y: at * 1200, width: 1920, height: 1080 },
        })),
      },
    ],
  },
});

beforeEach(async () => {
  seen = [];
    replies = [
      { match: /^\/v1\/images\//, status: 200, body: { err: null, images: {} } },
      { match: /^\/v1\/files\//, status: 200, body: figmaFile() },
    ];
    figmaResponses = 200;

    figma = createServer((req, res) => {
    const url = req.url ?? '/';
    seen.push({ method: req.method ?? 'GET', url, token: req.headers['x-figma-token'] as string | undefined });
    const reply = replies.find((r) => r.match.test(url));
    const status = url.startsWith('/v1/files/') ? figmaResponses : (reply?.status ?? 404);
    const body = url.startsWith('/v1/files/') && figmaResponses !== 200
      ? { status: figmaResponses, err: 'Figma said no' }
      : (reply?.body ?? { status: 404, err: 'Not found' });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  figmaBase = `http://localhost:${await new Promise<number>((resolve) => {
    figma.listen(0, () => resolve((figma.address() as { port: number }).port));
  })}`;

  store = new RunStore();
  api = new ApiServer({
    store, rubric, scopeId: 'no-motion-authoring', insecureCookies: true,
    figma: { serverToken: 'figd_test_token', origin: figmaBase },
  });
  base = `http://localhost:${await api.listen(0)}`;
  cookie = await signIn();
});

afterEach(async () => {
  await api.close();
  await new Promise<void>((resolve) => { figma.close(() => resolve()); });
});

async function signIn(): Promise<string> {
  const res = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Studio Owner', email: 'owner@example.com', password: 'a-long-enough-password',
    }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) as Record<string, never> : {} };
};

const files = (): string[] => seen.filter((r) => r.url.startsWith('/v1/files/')).map((r) => r.url);

/** A document entry pointing at the deck, for the refresh route. */
const seedDocument = (id: string) => {
  const now = new Date().toISOString();
  const entry = {
    id, clientId: 'c-test', title: 'Brand presentation', documentType: 'presentation',
    source: 'figma', sourceUrl: LINK, viewMode: 'presentation', status: 'ready',
    figmaFileKey: FILE_KEY, figmaPageId: '1-0',
    pageCount: 2, createdBy: 'u-owner', createdAt: now, updatedAt: now,
  } as const;
  store.saveDocumentEntry(entry);
  return entry;
};

describe('the Figma status the studio is shown', () => {
  it('says connected, and says whose token it is, and nothing else', async () => {
    const { status, body } = await json('/api/figma/status');
    expect(status).toBe(200);
    expect(body['connected']).toBe(true);
    expect(body['perUser']).toBe(false);
    // The whole point of the route's shape: a screen that could read an expiry
    // could read a refresh token next to it.
    expect(Object.keys(body).sort()).toEqual(['connected', 'oauthConfigured', 'perUser']);
  });

  it('says an unconfigured deployment is not connected, rather than failing', async () => {
    const bare = new RunStore();
    const other = new ApiServer({ store: bare, rubric, scopeId: 'no-motion-authoring', insecureCookies: true });
    const at = `http://localhost:${await other.listen(0)}`;
    try {
      const res = await fetch(`${at}/api/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Owner', email: 'o@example.com', password: 'a-long-enough-password',
        }),
      });
      const session = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const status = await fetch(`${at}/api/figma/status`, { headers: { cookie: session } });
      const body = await status.json() as Record<string, unknown>;
      expect(body['connected']).toBe(false);
      expect(body['oauthConfigured']).toBe(false);
    } finally {
      await other.close();
    }
  });
});

describe('reading a file, over the API a designer would use', () => {
  it('answers with the frames, in reading order, with their sizes', async () => {
    const { status, body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
    expect(status).toBe(200);
    const frames = body['frames'] as { name: string; nodeId: string; width: number }[];
    expect(frames.map((f) => f.name)).toEqual(['Cover', 'Strategy', 'Thank you']);
    expect(frames.map((f) => f.nodeId)).toEqual(['1-1', '1-2', '1-3']);
    expect(frames.find((f) => f.name === 'Cover')?.width).toBe(1920);
  });

  it('asks for depth=2 and one call, because a brand file is enormous', async () => {
    // A file read without a depth returns every vector path in it: tens of
    // megabytes to learn eight frame names.
    await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
    expect(files()).toEqual([`/v1/files/${FILE_KEY}?depth=2`]);
  });

  it('sends the token, because a file read without one is a 403', async () => {
    await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
    expect(seen[0]?.token).toBe('figd_test_token');
  });

  it('restricts to the canvas the link named', async () => {
    // `node-id=1-0` is a Figma *page*, and a brand file has its working pages
    // there too. Opening the document as all of them is the wrong document.
    const { body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
    const frames = body['frames'] as { canvasId: string; name: string }[];
    expect(frames.map((f) => f.name)).toEqual(['Cover', 'Strategy', 'Thank you']);
    expect(new Set(frames.map((f) => f.canvasId))).toEqual(new Set(['1-0']));
    expect(body['canvasId']).toBe('1-0');
  });

  it('reads every canvas when the link names no page, and leaves the choice to the panel', async () => {
    const { body } = await json('/api/figma/discover', {
      method: 'POST',
      body: JSON.stringify({
        url: `https://www.figma.com/design/${FILE_KEY}/Brand`, thumbnails: false,
      }),
    });
    expect((body['frames'] as { name: string }[]).map((f) => f.name))
      .toEqual(['Moodboard', 'Cover', 'Strategy', 'Thank you']);
    expect(body['canvasId']).toBeUndefined();
  });

  it('does not mistake a link to one slide for a link to a page', async () => {
    // The distinction is only answerable from the file, which is why the whole
    // file comes back: restricting to a frame would make the deck page one.
    const { body } = await json('/api/figma/discover', {
      method: 'POST',
      body: JSON.stringify({
        url: `https://www.figma.com/design/${FILE_KEY}/Brand?node-id=1-1`, thumbnails: false,
      }),
    });
    expect((body['frames'] as unknown[]).length).toBe(4);
    expect(body['canvasId']).toBeUndefined();
  });

  it('spends a second call for previews only when asked, and attaches them', async () => {
    replies = [
      { match: /^\/v1\/images\//, status: 200, body: { err: null, images: { '1:1': 'https://img.test/cover.png' } } },
      { match: /^\/v1\/files\//, status: 200, body: figmaFile() },
    ];
    const { body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK }),
    });
    const cover = (body['frames'] as { name: string; thumbnailUrl?: string }[])
      .find((f) => f.name === 'Cover');
    expect(cover?.thumbnailUrl).toBe('https://img.test/cover.png');
    expect(seen.some((r) => r.url.startsWith('/v1/images/'))).toBe(true);
  });

  it('still reads the file when the image call fails, because a preview is not a page', async () => {
    // Previews are cosmetic. Taking the read down with them would mean a
    // throttled image endpoint makes the whole file unreadable.
    replies = [
      { match: /^\/v1\/images\//, status: 500, body: { err: 'boom' } },
      { match: /^\/v1\/files\//, status: 200, body: figmaFile() },
    ];
    const { status, body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK }),
    });
    expect(status).toBe(200);
    expect((body['frames'] as unknown[]).length).toBe(3);
  });

  it('refuses a link that is not to a Figma file, without spending a call', async () => {
    const { status, body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: 'https://example.com/whatever' }),
    });
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
    expect(seen).toEqual([]);
  });

  it('refuses an empty link', async () => {
    const { status, body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: '   ' }),
    });
    expect(status).toBe(400);
    expect(body['error']).toBe('bad_request');
  });
});

describe('what a Figma refusal becomes', () => {
  const refused = async (upstream: number) => {
    figmaResponses = upstream;
    return json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
  };

  it('turns a 403 into a 403, so the studio can say "this file is not shared"', async () => {
    const { status, body } = await refused(403);
    expect(status).toBe(403);
    expect(body['error']).toBe('forbidden');
  });

  it('turns a 404 into a 404', async () => {
    const { status, body } = await refused(404);
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
  });

  it('turns a throttle into a 429 that says how long to wait', async () => {
    // The status alone tells a studio it failed; `Retry-After` tells it when it
    // may try again, which is the difference between a wait and a give-up.
    const { status, headers, body } = await refused(429);
    expect(status).toBe(429);
    // Its own kind, not a generic one: a throttle is worth a different sentence
    // in the panel from a file Figma would not serve.
    expect(body['error']).toBe('rate_limited');
    expect(headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('turns Figma being down into a 502, not a 500 of our own', async () => {
    // 502 says the trouble is upstream. 500 would send a designer to whoever
    // runs the studio, which is the wrong person to call.
    const { status, body } = await refused(502);
    expect(status).toBe(502);
    expect(body['error']).toBe('figma_error');
  });

  it('says no frames, when a file reads cleanly and holds none', async () => {
    replies = [
      { match: /^\/v1\/images\//, status: 200, body: { images: {} } },
      { match: /^\/v1\/files\//, status: 200, body: { name: 'Empty', document: { id: '0:0', children: [] } } },
    ];
    figmaResponses = 200;
    const { status, body } = await json('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url: LINK, thumbnails: false }),
    });
    // 422, not 404: the file is there and readable, and the problem is that it
    // has nothing to page through. A studio showing "not found" sends a designer
    // to check their link for a file that exists.
    expect(status).toBe(422);
    expect(body['error']).toBe('no_frames');
  });

  it('never puts Figma’s own error text in the body a studio reads', async () => {
    // The upstream message can name a file and an account. Ours says what kind of
    // refusal it was; the detail is written for the person reading the panel.
    figmaResponses = 403;
    const { body } = await refused(403);
    expect(JSON.stringify(body)).not.toMatch(/Disan Internal/);
  });
});

describe('the fixed document shelf', () => {
  const saveClient = () => {
    const now = new Date().toISOString();
    store.saveClient({
      id: 'c-test', name: 'Disan', slug: 'c-test', status: 'active', createdAt: now, updatedAt: now,
    });
  };

  it('discovers and returns frames when a Figma shelf document is linked', async () => {
    saveClient();
    const linked = await json('/api/clients/c-test/documents/brand-guidelines', {
      method: 'PUT', body: JSON.stringify({ figmaUrl: LINK }),
    });
    expect(linked.status).toBe(200);
    expect((linked.body['document'] as { pageCount: number }).pageCount).toBe(3);

    const shelf = await json('/api/clients/c-test/documents');
    const document = (shelf.body['documents'] as { slot: string; pages: unknown[] }[])
      .find((item) => item.slot === 'brand-guidelines');
    expect(document?.pages).toHaveLength(3);

    await json('/api/clients/c-test/documents/brand-guidelines', { method: 'DELETE' });
    expect(store.listDocumentPages(shelfDocumentId('c-test', 'brand-guidelines'))).toEqual([]);
  });

  it('directs contracts and invoices to their native EDSAI builders', async () => {
    saveClient();
    const response = await json('/api/clients/c-test/documents/contract', {
      method: 'PUT', body: JSON.stringify({ figmaUrl: LINK }),
    });
    expect(response.status).toBe(400);
    expect(response.body['message']).toMatch(/inside EDSAI/);
    expect(files()).toEqual([]);
  });
});

describe('refreshing a document that has been presented', () => {
  it('merges the file into the manifest and reports what changed', async () => {
    const id = newId();
    const now = new Date().toISOString();
    store.saveClient({
      id: 'c-test', name: 'Disan', slug: 'c-test', status: 'active', createdAt: now, updatedAt: now,
    });
    const entry = seedDocument(id);
    // A deck already presented, with one frame the designer left out.
    store.saveDocumentPages(entry.id, [
      { documentId: id, order: 1, name: 'Cover', nodeId: '1-1', included: true, width: 1920, height: 1080 },
      { documentId: id, order: 2, name: 'Strategy', nodeId: '1-2', included: false, width: 1920, height: 1080 },
    ]);

    const { status, body } = await json(`/api/document-entries/${id}/refresh`, { method: 'POST' });
    expect(status).toBe(200);
    const changes = body['changes'] as { added: string[]; removed: string[] };
    // "Thank you" is new and goes on the end, not the top: moving a deck that has
    // been presented is how a client sees their slides in the wrong order.
    expect(changes.added).toEqual(['1-3']);
    expect((body['pages'] as { name: string }[]).map((p) => p.name))
      .toEqual(['Cover', 'Strategy', 'Thank you']);
    // And the exclusion survives, because it is about this document.
    expect((body['pages'] as { included: boolean }[])[1]?.included).toBe(false);
  });

  it('404s a document that is not this session’s, without asking Figma', async () => {
    const { status } = await json('/api/document-entries/nope/refresh', { method: 'POST' });
    expect(status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('reports a Figma failure as a Figma failure, not a missing document', async () => {
    const id = newId();
    seedDocument(id);
    figmaResponses = 403;
    const { status, body } = await json(`/api/document-entries/${id}/refresh`, { method: 'POST' });
    expect(status).toBe(403);
    expect(body['error']).toBe('forbidden');
  });
});

describe('who may read Figma', () => {
  it('refuses a portal session, before any file is read', async () => {
    // A client-facing reader must not be able to point the studio's credential at
    // a file of their choosing.
    const token = 'portal-figma-token';
    const { createHash } = await import('node:crypto');
    const now = new Date().toISOString();
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'portal-user', kind: 'portal', clientId: 'c-test', role: 'editor',
      createdAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const { status, body } = await json('/api/figma/discover', {
      method: 'POST',
      headers: { cookie: `edsai_session=${token}` },
      body: JSON.stringify({ url: LINK }),
    });
    expect(status).toBe(403);
    expect(body['error']).toBe('forbidden');
    expect(seen).toEqual([]);
  });

  it('refuses a portal session from disconnecting the studio’s Figma', async () => {
    const { createHash } = await import('node:crypto');
    const token = 'portal-figma-token-2';
    const now = new Date().toISOString();
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'portal-user', kind: 'portal', clientId: 'c-test', role: 'editor',
      createdAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const { status } = await json('/api/figma/connection', {
      method: 'DELETE', headers: { cookie: `edsai_session=${token}` },
    });
    expect(status).toBe(403);
  });
});

describe('connecting a Figma account', () => {
  it('refuses to start a connection a deployment cannot finish', async () => {
    // A Connect button that leads to a page that comes straight back rejected
    // looks like Figma refusing. Saying so is fixable.
    const bare = new RunStore();
    const other = new ApiServer({ store: bare, rubric, scopeId: 'no-motion-authoring', insecureCookies: true });
    const at = `http://localhost:${await other.listen(0)}`;
    try {
      const res = await fetch(`${at}/api/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Owner', email: 'o@example.com', password: 'a-long-enough-password',
        }),
      });
      const session = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const start = await fetch(`${at}/api/figma/connect`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: session },
      });
      expect(start.status).toBe(409);
    } finally {
      await other.close();
    }
  });

  it('sends the designer back to the studio with a flag, and nothing else', async () => {
    // The callback has to be a navigation, so it answers with a redirect. The
    // flag is the studio's own vocabulary; nothing about a grant travels in it,
    // so the URL can be pasted to a colleague and carries no authority.
    const res = await fetch(`${base}/api/figma/callback?error=access_denied&state=nope`, {
      headers: { cookie }, redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/\?figma=cancelled/);
    expect(location).not.toMatch(/figd_/);
    expect(location).not.toMatch(/access_token/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('will not exchange a state it never issued', async () => {
    // A callback is a GET a third party can cause a browser to make. An
    // unrecognised state is refused before the code is spent, or an attacker who
    // can predict nothing could walk a code of their own into this session.
    const res = await fetch(`${base}/api/figma/callback?code=stolen&state=forged`, {
      headers: { cookie }, redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toMatch(/figma=cancelled/);
  });
});
