import data from './preview-data.json';

/**
 * Preview mode.
 *
 * The Studio is a client of an HTTP API. In a preview build there is no server,
 * so this swaps the transport underneath `fetch` — and nothing else. Every
 * component, every query, every piece of logic above this line is the shipping
 * application, unmodified.
 *
 * **It replays, it does not simulate.** The responses come from
 * `scripts/capture-preview.mjs`, which signs in to a real server and writes
 * down what it actually returned. There is no second implementation of the API
 * here, because a hand-written one would be a second opinion about how the
 * server behaves — and it would drift silently, staying plausible while the
 * product broke.
 *
 * **It refuses writes rather than faking them.** Accepting an upload and
 * showing it in the list would teach the reader that something works when it
 * has never been tried. A preview that lies is worse than no preview, so a
 * write here fails with a message saying exactly why, and the interface shows
 * that message the way it shows any other refusal.
 */

interface Recorded { status: number; body: unknown }

const RESPONSES = (data as { responses: Record<string, Recorded> }).responses;

export const CAPTURED_AT = (data as { capturedAt: string }).capturedAt;

/** What a write is told. Stated once, so every refusal says the same thing. */
export const WRITE_REFUSED =
  'This is a preview with no server behind it, so nothing can be saved. '
  + 'Everything you can read here is a real capture from a running EDSAI.';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function compatibleRecording(path: string, body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const record = body as Record<string, unknown>;

  if (path === '/api/rubric' && !Array.isArray(record['tracks'])) {
    return { ...record, tracks: [] };
  }

  if (path === '/api/runs' && Array.isArray(record['runs'])) {
    return {
      ...record,
      runs: record['runs'].map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const run = entry as Record<string, unknown>;
        const tracks = typeof run['tracks'] === 'string'
          ? run['tracks'].split(/\s+/).filter(Boolean)
          : run['tracks'];
        const activatedDepartments = typeof run['activatedDepartments'] === 'string'
          ? run['activatedDepartments'].split(/\s+/).map(Number).filter(Number.isFinite)
          : run['activatedDepartments'];
        return { ...run, tracks, activatedDepartments };
      }),
    };
  }

  return body;
}

/**
 * The key a recording is filed under: path **and** query.
 *
 * The query is part of the request, not decoration — `?x=E4&y=E6` chooses which
 * chart the positioning endpoint returns. An earlier version keyed on pathname
 * alone, so every chart resolved to whichever one happened to be recorded, or
 * to nothing at all.
 */
function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input
    : input instanceof URL ? input.href
      : input.url;
  try {
    const url = new URL(raw, location.origin);
    return url.pathname + url.search;
  } catch {
    return raw;
  }
}

export function installPreviewTransport(): void {
  const real = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init) => {
    const path = pathOf(input);
    if (!path.startsWith('/api/')) return real(input, init);

    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      return json(503, { error: 'preview', message: WRITE_REFUSED });
    }

    const recorded = RESPONSES[path];
    if (!recorded) {
      // Honest about its own edges: a path nobody captured is missing from the
      // recording, which is a different thing from the server having no answer.
      return json(404, {
        error: 'not_captured',
        message: `This preview has no recording of ${path}. `
          + 'It captures the screens it was built to show, not the whole API.',
      });
    }
    return json(recorded.status, compatibleRecording(path, recorded.body));
  };
}
