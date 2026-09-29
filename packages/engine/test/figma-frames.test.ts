import { describe, expect, it } from 'vitest';
import {
  discoverFrames, framesOnCanvas, inReadingOrder, mergeFrames, ordinalHint, pagesFromFrames,
  type FigmaFrame,
} from '../src/figma-frames.js';
import { DocumentPage } from '../src/documents.js';
import { figmaAuthHeaders } from '../src/figma-client.js';
import { authorizationUrl } from '../src/figma-oauth.js';

/**
 * What a Figma file is, as far as reading one goes.
 *
 * Built by hand rather than captured, because every one of these shapes is a
 * thing that has been got wrong by a real client: a canvas with no children, a
 * node with no bounding box, a group where a frame was assumed, a `visible:
 * false` on something a template left behind.
 */
const frame = (id: string, name: string, box: {
  x?: number; y: number; width?: number; height?: number;
}, type = 'FRAME', extra: Record<string, unknown> = {}) => ({
  id, name, type, visible: true,
  absoluteBoundingBox: { x: box.x ?? 0, y: box.y, width: box.width ?? 1920, height: box.height ?? 1080 },
  ...extra,
});

const file = (canvases: { id: string; name: string; children?: unknown[] }[]) => ({
  name: 'Brand file',
  lastModified: '2026-02-01T00:00:00Z',
  version: '1',
  document: {
    id: '0:0', name: 'Document', type: 'DOCUMENT',
    children: canvases.map((canvas) => ({
      id: canvas.id, name: canvas.name, type: 'CANVAS', children: canvas.children ?? [],
    })),
  },
});

describe('Figma authentication', () => {
  it('uses Bearer authentication for a per-user OAuth grant', () => {
    expect(figmaAuthHeaders({ accessToken: 'oauth-token', serverToken: 'fallback' }))
      .toEqual({ Authorization: 'Bearer oauth-token' });
  });

  it('uses Figma\'s token header for a server personal token', () => {
    expect(figmaAuthHeaders({ serverToken: 'personal-token' }))
      .toEqual({ 'X-Figma-Token': 'personal-token' });
  });

  it('requests only the current file-content read scope', () => {
    const url = new URL(authorizationUrl({
      config: { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://studio.test/callback' },
      state: 'state',
    }));
    expect(url.searchParams.get('scope')).toBe('file_content:read');
  });
});

const deck = (...names: string[]): FigmaFrame[] => names.map((name, at) => ({
  nodeId: `1-${at + 1}`,
  name,
  canvasId: '1-0',
  canvasName: 'Deck',
  width: 1920,
  height: 1080,
  x: 0,
  y: at * 1200,
}));

describe('what counts as a page of a document', () => {
  it('is a top-level frame, in reading order', () => {
    const found = discoverFrames(file([{
      id: '1:0', name: 'Deck',
      children: [
        frame('1:2', 'Strategy', { y: 1200 }),
        frame('1:1', 'Cover', { y: 0 }),
      ],
    }]));
    expect(found.map((f) => f.name)).toEqual(['Cover', 'Strategy']);
    // Figma's API writes `1:1`; EDSAI stores and links `1-1`. Without this
    // translation every frame in a real file is dropped as malformed.
    expect(found.map((f) => f.nodeId)).toEqual(['1-1', '1-2']);
  });

  it('is not a component inside a slide', () => {
    // The line that keeps a design system's button from becoming page four of
    // the deck. `discoverFrames` walks exactly one level for exactly this reason.
    const found = discoverFrames(file([{
      id: '1:0', name: 'Deck',
      children: [
        frame('1:1', 'Cover', { y: 0 }, 'FRAME', {
          children: [frame('1:9', 'Button / Primary', { y: 40 }, 'COMPONENT')],
        }),
        frame('1:2', 'Strategy', { y: 1200 }),
      ],
    }]));
    expect(found.map((f) => f.name)).toEqual(['Cover', 'Strategy']);
  });

  it('is not a frame the designer has hidden', () => {
    // A hidden frame is still returned by Figma's API, so a template frame left
    // on the canvas reappears in every document built from it unless it is
    // excluded by `visible`.
    const found = discoverFrames(file([{
      id: '1:0', name: 'Deck',
      children: [
        frame('1:1', 'Cover', { y: 0 }),
        frame('1:2', 'Template', { y: 1200 }, 'FRAME', { visible: false }),
      ],
    }]));
    expect(found.map((f) => f.name)).toEqual(['Cover']);
  });

  it('is a component or a section set up as one', () => {
    // A designer who has made a slide a component is still presenting a slide.
    const found = discoverFrames(file([{
      id: '1:0', name: 'Deck',
      children: [
        frame('1:1', 'Cover', { y: 0 }, 'COMPONENT'),
        frame('1:2', 'Chapter', { y: 1200 }, 'SECTION'),
        frame('1:3', 'Scratch', { y: 2400 }, 'GROUP'),
      ],
    }]));
    expect(found.map((f) => f.name)).toEqual(['Cover', 'Chapter']);
  });

  it('is skipped when Figma gives no size for it', () => {
    // A frame with no bounding box has no shape to fit, so there is nothing to
    // draw. Reporting it would give a viewer a page whose `fit page` is `NaN`.
    const found = discoverFrames(file([{
      id: '1:0', name: 'Deck',
      children: [
        frame('1:1', 'Cover', { y: 0 }),
        { id: '1:2', name: 'Sizeless', type: 'FRAME', visible: true, absoluteBoundingBox: null },
      ],
    }]));
    expect(found.map((f) => f.name)).toEqual(['Cover']);
  });

  it('is every frame in the file, when the link names no Figma page', () => {
    // A brand file routinely has working pages and the deck on separate canvases.
    // A link with no `node-id` means all of them, and the frames panel is then
    // how a designer says which belong to the document.
    const found = discoverFrames(file([
      { id: '0:1', name: 'Working', children: [frame('0:2', 'Moodboard', { y: 0 })] },
      { id: '1:0', name: 'Deck', children: [frame('1:1', 'Cover', { y: 0 })] },
    ]));
    expect(found.map((f) => [f.name, f.canvasName])).toEqual([
      ['Moodboard', 'Working'], ['Cover', 'Deck'],
    ]);
  });

  it('is only that canvas, when the link names one', () => {
    // A deep link to a Figma *page* is `?node-id=12-345` where that id is the
    // canvas. A document pointed at `Brand Presentation` must not open as
    // `Page 1`'s frames plus the deck's. The file spells the canvas `1:0` and
    // the link spells it `1-0`; both are accepted.
    const body = file([
      { id: '0:1', name: 'Page 1', children: [frame('0:2', 'Moodboard', { y: 0 })] },
      { id: '1:0', name: 'Brand Presentation', children: [frame('1:1', 'Cover', { y: 0 })] },
    ]);
    expect(discoverFrames(body, { canvasId: '1-0' }).map((f) => f.name)).toEqual(['Cover']);
    expect(discoverFrames(body, { canvasId: '1:0' }).map((f) => f.name)).toEqual(['Cover']);
  });

  it('is nothing at all, rather than a crash, for a body it cannot read', () => {
    // A file with no frames is a real answer, and the caller decides what to do
    // about it. Throwing here would turn a rate-limited response into a 500.
    expect(discoverFrames(undefined)).toEqual([]);
    expect(discoverFrames({})).toEqual([]);
    expect(discoverFrames({ document: { children: 'not an array' } })).toEqual([]);
  });
});

describe('the order frames are read in', () => {
  it('goes down a column of slides, which is how decks are built', () => {
    const found = inReadingOrder(deck('Cover', 'Strategy', 'Colors', 'Thank you'));
    expect(found.map((f) => f.name)).toEqual(['Cover', 'Strategy', 'Colors', 'Thank you']);
  });

  it('goes across a row, because a row is also a reading order', () => {
    const row = ['Cover', 'Strategy', 'Colors'].map((name, at) => ({
      nodeId: `1:${at + 1}`, name, canvasId: '1-0', canvasName: 'Deck',
      width: 1920, height: 1080, x: at * 2000, y: 0,
    }));
    expect(inReadingOrder(row).map((f) => f.name)).toEqual(['Cover', 'Strategy', 'Colors']);
  });

  it('reads the numbers in the names when a row is numbered', () => {
    // Two ordinals in one row is a numbered strip and the numbers are the
    // intent, even though the designer has laid them out in the other order.
    const numbered = ['03 — Colors', '01 — Cover', '02 — Strategy'].map((name, at) => ({
      nodeId: `1:${at + 1}`, name, canvasId: '1-0', canvasName: 'Deck',
      width: 1920, height: 1080, x: (2 - at) * 2000, y: 0,
    }));
    expect(inReadingOrder(numbered).map((f) => f.name)).toEqual([
      '01 — Cover', '02 — Strategy', '03 — Colors',
    ]);
  });

  it('lets position win over a number, because a number in one row cannot mean much', () => {
    // A designer who has put "Chapter 2" above "Chapter 1" has arranged it that
    // way on purpose, and the ordinal must not reorder across rows.
    const stacked = [
      { nodeId: '1:2', name: '02 — Strategy', canvasId: '1-0', canvasName: 'Deck', width: 1920, height: 1080, x: 0, y: 1200 },
      { nodeId: '1:1', name: '01 — Cover', canvasId: '1-0', canvasName: 'Deck', width: 1920, height: 1080, x: 0, y: 0 },
    ];
    expect(inReadingOrder(stacked).map((f) => f.name)).toEqual(['01 — Cover', '02 — Strategy']);
  });

  it('is the same every time, whatever order the frames arrive in', () => {
    // The difference between a document and a shuffle: two runs over the same
    // canvas produce the same deck, so a document does not reorder itself
    // because Figma returned its children differently.
    const frames = deck('Cover', 'Strategy', 'Colors');
    const once = inReadingOrder(frames).map((f) => f.nodeId);
    const twice = inReadingOrder([...frames].reverse()).map((f) => f.nodeId);
    expect(twice).toEqual(once);
  });

  it('sorts node ids as numbers, so 2:9 does not come after 12:0', () => {
    // Lexicographic ordering is the bug that puts a deck's tenth frame second.
    const frames = [
      { nodeId: '12-0', name: 'Twelfth', canvasId: '1-0', canvasName: 'Deck', width: 100, height: 100, x: 0, y: 0 },
      { nodeId: '2-9', name: 'Second', canvasId: '1-0', canvasName: 'Deck', width: 100, height: 100, x: 0, y: 0 },
    ];
    expect(inReadingOrder(frames).map((f) => f.nodeId)).toEqual(['2-9', '12-0']);
  });

  it('reads a number out of the shapes designers actually use', () => {
    expect(ordinalHint('01 — Cover')).toBe(1);
    expect(ordinalHint('1. Typography')).toBe(1);
    expect(ordinalHint('03: Colors')).toBe(3);
    expect(ordinalHint('Chapter 2 — Strategy')).toBeUndefined();
    expect(ordinalHint('Cover')).toBeUndefined();
    expect(ordinalHint('')).toBeUndefined();
  });
});

describe('restricting to the canvas a document was pointed at', () => {
  it('keeps the order the frames were already discovered in', () => {
    const all = discoverFrames(file([
      { id: '0:1', name: 'Page 1', children: [frame('0:2', 'Moodboard', { y: 0 })] },
      {
        id: '1:0',
        name: 'Deck',
        children: [frame('1:1', 'Cover', { y: 0 }), frame('1:2', 'Strategy', { y: 1200 })],
      },
    ]));
    expect(framesOnCanvas(all, '1-0').map((f) => f.name)).toEqual(['Cover', 'Strategy']);
    expect(framesOnCanvas(all, '9:9')).toEqual([]);
  });

  it('does not restrict a deep link that names a frame rather than a page', () => {
    // A link to one slide must not reduce the document to that slide. The
    // distinction is answered after the file has been read, because only the file
    // knows whether the id is a canvas.
    const all = discoverFrames(file([{
      id: '1:0', name: 'Deck', children: [frame('1:1', 'Cover', { y: 0 }), frame('1:2', 'Strategy', { y: 1200 })],
    }]));
    expect(framesOnCanvas(all, '1-1')).toEqual([]);
  });
});

describe('a first manifest, from a file that has just been read', () => {
  it('numbers every frame from one, in reading order, all of them included', () => {
    const pages = pagesFromFrames('d1', deck('Cover', 'Strategy', 'Colors'));
    expect(pages.map((p) => [p.order, p.name, p.included])).toEqual([
      [1, 'Cover', true], [2, 'Strategy', true], [3, 'Colors', true],
    ]);
    expect(pages.every((p) => p.documentId === 'd1')).toBe(true);
  });

  it('brings the frame’s size, so "fit this page" is arithmetic', () => {
    const [page] = pagesFromFrames('d1', [{
      nodeId: '1-1', name: 'Portrait', canvasId: '1-0', canvasName: 'Deck',
      width: 390, height: 844, x: 0, y: 0,
    }]);
    expect([page?.width, page?.height]).toEqual([390, 844]);
  });
});

describe('refreshing a document that has already been presented', () => {
  const manifest = (pages: [string, string, boolean?][]): DocumentPage[] => pages.map(
    ([nodeId, name, included], at) => DocumentPage.parse({
      documentId: 'd1', order: at + 1, name, nodeId, ...(included === undefined ? {} : { included }),
    }),
  );

  it('appends what is new, at the end, in reading order', () => {
    // The designer's order is the base. A frame added at the top of the Figma
    // canvas is *appended*, because moving a deck that has been presented to
    // match a canvas is how a client sees their slides in the wrong order.
    const { pages, changes } = mergeFrames(
      manifest([['1-1', 'Cover'], ['1-2', 'Strategy']]),
      deck('Cover', 'Strategy', 'Colors', 'Thank you'),
    );
    expect(pages.map((p) => p.name)).toEqual(['Cover', 'Strategy', 'Colors', 'Thank you']);
    expect(pages.map((p) => p.order)).toEqual([1, 2, 3, 4]);
    expect(changes.added).toEqual(['1-3', '1-4']);
    expect(changes.removed).toEqual([]);
  });

  it('leaves a frame the designer excluded excluded', () => {
    // The exclusion is about *this* document. A scratch frame and an archive are
    // siblings on the same canvas, and a refresh that put the archive back in
    // would be presenting it to a client.
    const { pages, changes } = mergeFrames(
      manifest([['1-1', 'Cover', false], ['1-2', 'Strategy']]),
      deck('Cover', 'Strategy'),
    );
    expect(pages.map((p) => [p.name, p.included])).toEqual([
      ['Cover', false], ['Strategy', true],
    ]);
    expect(changes.added).toEqual([]);
  });

  it('drops a frame Figma can no longer serve, and says which', () => {
    // Keeping it would leave a Next button pointing at a frame that 404s.
    const { pages, changes } = mergeFrames(
      manifest([['1-1', 'Cover'], ['1-2', 'Strategy'], ['1-3', 'Old news']]),
      deck('Cover', 'Strategy'),
    );
    expect(pages.map((p) => p.name)).toEqual(['Cover', 'Strategy']);
    expect(changes.removed).toEqual(['1-3']);
  });

  it('takes a renamed frame’s name from the file, and reports it', () => {
    // A manifest name is only ever a copy of Figma's — EDSAI does not let a
    // frame be renamed — so a stale copy is a deck labelled `01 — Cover` beside
    // a frame called `07 — Thank you`.
    const { pages, changes } = mergeFrames(
      manifest([['1-1', 'Cover'], ['1-2', 'Old title']]),
      deck('Cover', '07 — Thank you'),
    );
    expect(pages.map((p) => p.name)).toEqual(['Cover', '07 — Thank you']);
    expect(changes.renamed).toEqual([{ nodeId: '1-2', from: 'Old title', to: '07 — Thank you' }]);
  });

  it('re-measures a frame that has been resized', () => {
    const { pages } = mergeFrames(
      manifest([['1-1', 'Cover']]),
      [{ ...deck('Cover')[0]!, width: 1280, height: 720 }],
    );
    expect([pages[0]?.width, pages[0]?.height]).toEqual([1280, 720]);
  });

  it('keeps a whole-file page, which has no frame to be corrected by', () => {
    const existing = [DocumentPage.parse({ documentId: 'd1', order: 1, name: 'The file' })];
    const { pages, changes } = mergeFrames(existing, deck('Cover'));
    expect(pages.map((p) => p.name)).toEqual(['The file', 'Cover']);
    expect(changes.removed).toEqual([]);
  });

  it('changes nothing when the file is exactly as it was', () => {
    const before = manifest([['1-1', 'Cover'], ['1-2', 'Strategy']]);
    const { pages, changes } = mergeFrames(before, deck('Cover', 'Strategy'));
    expect(pages.map((p) => [p.order, p.name])).toEqual([[1, 'Cover'], [2, 'Strategy']]);
    expect(changes).toMatchObject({ added: [], removed: [], renamed: [] });
  });
});
