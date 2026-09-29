import { describe, expect, it } from 'vitest';
import {
  canPresent, figmaSource, figmaUrlProblem, isFigmaUrl, pageUrl, withNodeId,
} from '../src/figmaLinks.js';
import {
  clampIndex, deckCount, fitSize, frameRatio, hasNext, hasPrevious, isMultiPage, nextIndex,
  orderedPages, pageCount, pageLabel, pageName, preloadWindow, previousIndex, readablePages,
  resolveViewMode, scaleLabel, uploadViewMode, zoomedScale, MAX_SCALE, MIN_SCALE,
} from '../src/presentation.js';
import { adviseFailure, canRetry } from '../src/figmaDiscovery.js';
import { movePage } from '../src/components/AddDocument.js';
import { groupDocuments } from '../src/components/DocumentLibrary.js';
import type { DocumentEntry, DocumentPage } from '../src/api.js';

const FILE = 'https://www.figma.com/design/AbC123xyz/Brand?node-id=12-345';
const EMBED = `https://www.figma.com/embed?embed_host=edsai&url=${encodeURIComponent(FILE)}`;

const page = (order: number, name: string, nodeId?: string): DocumentPage =>
  ({ documentId: 'd1', order, name, ...(nodeId ? { nodeId } : {}) });

const entry = (over: Partial<DocumentEntry> = {}): DocumentEntry => ({
  id: 'd1', clientId: 'acme', title: 'Guidelines', documentType: 'guideline',
  source: 'figma', viewMode: 'document', status: 'ready',
  createdBy: 's', createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
  ...over,
});

describe('what counts as a Figma link', () => {
  it('accepts figma.com and its subdomains over https', () => {
    expect(isFigmaUrl(FILE)).toBe(true);
    expect(isFigmaUrl('https://figma.com/design/a/b')).toBe(true);
    expect(isFigmaUrl('https://www.figma.com/proto/a/b')).toBe(true);
  });

  it('refuses everything that is not, which is the whole gate on what gets framed', () => {
    expect(isFigmaUrl('http://www.figma.com/design/a/b')).toBe(false);
    expect(isFigmaUrl('https://figma.com.evil.test/design/a/b')).toBe(false);
    expect(isFigmaUrl('https://notfigma.com/design/a/b')).toBe(false);
    expect(isFigmaUrl('www.figma.com/design/a/b')).toBe(false);
    expect(isFigmaUrl('')).toBe(false);
  });
});

describe('reading a Figma link', () => {
  it('takes the file key and the frame out of a design link', () => {
    const source = figmaSource(FILE);
    expect(source?.kind).toBe('design');
    expect(source?.fileKey).toBe('AbC123xyz');
    expect(source?.nodeId).toBe('12-345');
  });

  it('unwraps an embed, because handing the embedder an embed nests it', () => {
    const source = figmaSource(EMBED);
    expect(source?.kind).toBe('design');
    expect(source?.fileKey).toBe('AbC123xyz');
    expect(source?.href).toBe(EMBED);
  });

  it('ignores a node-id that is not a node id', () => {
    expect(figmaSource('https://www.figma.com/design/a/b?node-id=not-a-node')?.nodeId).toBeUndefined();
    expect(figmaSource('https://www.figma.com/design/a/b?node-id=12-345/99')?.nodeId).toBeUndefined();
  });
});

describe('replacing the node-id', () => {
  it('replaces rather than appends, so page 3 to page 4 lands on page 4', () => {
    const moved = withNodeId(FILE, '12-999');
    expect(new URL(moved).searchParams.getAll('node-id')).toEqual(['12-999']);
  });

  it('drops it entirely when a page names no frame', () => {
    expect(new URL(withNodeId(FILE, undefined)).searchParams.get('node-id')).toBeNull();
  });

  it('leaves a link it cannot parse exactly as it found it', () => {
    expect(withNodeId('not a url', '1-2')).toBe('not a url');
  });
});

describe('addressing one page', () => {
  it('points the inner file link at the page frame', () => {
    expect(pageUrl(EMBED, page(1, 'Cover', '1-2'))).toContain('node-id=1-2');
    expect(pageUrl(EMBED, page(1, 'Cover', '1-2'))).not.toContain('embed');
  });

  it('falls back to the file for a page with no frame', () => {
    expect(new URL(pageUrl(FILE, undefined)).searchParams.get('node-id')).toBeNull();
  });
});

describe('whether a link can be paged at all', () => {
  it('is true for anything naming a file, manifest or not', () => {
    expect(canPresent(FILE)).toBe(true);
    expect(canPresent('https://www.figma.com/community/plugin/123')).toBe(false);
  });
});

describe('telling a person what is wrong with a link', () => {
  it('separates the cases, because they need different things from the reader', () => {
    expect(figmaUrlProblem('')).toMatch(/paste a figma link/i);
    expect(figmaUrlProblem('figma.com/design/a/b')).toMatch(/not a link/i);
    expect(figmaUrlProblem('http://www.figma.com/design/a/b')).toMatch(/https/i);
    expect(figmaUrlProblem('https://example.com/design/a/b')).toMatch(/not a figma\.com address/i);
    expect(figmaUrlProblem('https://www.figma.com/community/plugin/9')).toMatch(/community/i);
  });

  it('says nothing about a link that is fine', () => {
    expect(figmaUrlProblem(FILE)).toBeUndefined();
  });
});

describe('paging a deck', () => {
  const deck = [page(3, 'C'), page(1, 'A'), page(2, 'B')];

  it('reads the manifest in the order the designer wrote', () => {
    expect(orderedPages(deck).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('clamps in both directions, because a manifest can shrink mid-deck', () => {
    expect(clampIndex(99, deck)).toBe(2);
    expect(clampIndex(-5, deck)).toBe(0);
    expect(clampIndex(1, deck)).toBe(1);
    expect(clampIndex(Number.NaN, deck)).toBe(0);
    expect(clampIndex(4, [])).toBe(0);
  });

  it('knows the boundaries, so Next is dead on the last page', () => {
    expect(hasPrevious(deck, 0)).toBe(false);
    expect(hasNext(deck, 0)).toBe(true);
    expect(hasNext(deck, 2)).toBe(false);
  });

  it('stops at the ends rather than wrapping', () => {
    expect(previousIndex(deck, 0)).toBe(0);
    expect(nextIndex(deck, 2)).toBe(2);
  });

  it('counts zero pages as not a deck', () => {
    expect(pageCount([])).toBe(0);
    expect(isMultiPage([])).toBe(false);
    expect(isMultiPage(deck)).toBe(true);
  });

  it('pads the counter, because these decks are numbered in Figma', () => {
    expect(pageLabel(deck, 0)).toBe('01 / 03');
    expect(pageLabel(deck, 2)).toBe('03 / 03');
  });

  it('has no counter at all with no pages, rather than saying 01 / 00', () => {
    expect(pageLabel([], 0)).toBe('');
  });

  it('names the page being shown', () => {
    expect(pageName(deck, 1)).toBe('B');
    expect(pageName([], 0)).toBe('');
  });

  it('offers the neighbours for prefetch without mounting them', () => {
    expect(preloadWindow(deck, 1).map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(preloadWindow(deck, 0).map((p) => p.name)).toEqual(['A', 'B']);
    expect(preloadWindow(deck, 2).map((p) => p.name)).toEqual(['B', 'C']);
  });
});

describe('how a document is read', () => {
  it('trusts the stored mode', () => {
    expect(resolveViewMode(entry({ viewMode: 'external' }), [])).toBe('external');
    expect(resolveViewMode(entry({ viewMode: 'presentation' }), [])).toBe('presentation');
    expect(resolveViewMode(entry({ viewMode: 'document' }), [])).toBe('document');
  });

  it('calls a Figma row with a manifest a deck whichever way it was labelled', () => {
    expect(resolveViewMode(entry({ viewMode: 'document' }), [page(1, 'A', '1-2')])).toBe('presentation');
  });

  it('leaves an upload alone whatever its manifest says', () => {
    expect(resolveViewMode(entry({ source: 'upload', viewMode: 'document' }), [page(1, 'A', '1-2')]))
      .toBe('document');
  });

  it('previews only what a browser draws, and offers the rest instead', () => {
    expect(uploadViewMode({ contentType: 'application/pdf' })).toBe('document');
    expect(uploadViewMode({ contentType: 'image/png' })).toBe('document');
    expect(uploadViewMode({ contentType: 'text/markdown' })).toBe('document');
    expect(uploadViewMode({ contentType: 'application/zip' })).toBe('external');
    expect(uploadViewMode({ contentType: 'application/vnd.apple.keynote' })).toBe('external');
  });

  it('offers a missing file rather than pretending to show it', () => {
    expect(uploadViewMode(undefined)).toBe('external');
  });
});

describe('reordering a page manifest', () => {
  const pages = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

  it('moves a page and keeps the rest in order', () => {
    expect(movePage(pages, 0, 2).map((p) => p.name)).toEqual(['B', 'C', 'A']);
    expect(movePage(pages, 2, 0).map((p) => p.name)).toEqual(['C', 'A', 'B']);
  });

  it('refuses to move a page off either end', () => {
    expect(movePage(pages, 0, -1).map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(movePage(pages, 2, 3).map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(movePage(pages, 0, 0).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('a deck, as distinct from a manifest', () => {
  it('is the pages that are in, and an excluded frame is not one of them', () => {
    // The line between "a frame in the file" and "a page of this document". A
    // scratch frame left on the canvas is still returned by Figma, and counting
    // it puts `04 / 18` over a six-slide presentation.
    const manifest = [
      page(1, 'Cover', '1-1'),
      page(2, 'Scratch', '1-2'),
      page(3, 'Strategy', '1-3'),
    ];
    manifest[1]!.included = false;
    expect(readablePages(manifest).map((p) => p.name)).toEqual(['Cover', 'Strategy']);
    expect(orderedPages(manifest)).toHaveLength(3);
  });

  it('counts a page that never said it was included as in', () => {
    // Documents saved before inclusion existed have no flag at all. Treating a
    // missing flag as excluded would empty every one of them on first load.
    expect(readablePages([page(1, 'A', '1-1')]).map((p) => p.name)).toEqual(['A']);
  });

  it('counts the deck on its own, because the manifest is a different number', () => {
    // The frames panel shows "4 of 18" — four in the deck out of eighteen in the
    // file — so the count that decides it is the count of included pages, not
    // the count of rows.
    const manifest = [page(1, 'A', '1-1'), page(2, 'B', '1-2')];
    manifest[1]!.included = false;
    expect(deckCount(manifest)).toBe(1);
    expect(deckCount([])).toBe(0);
  });
});

describe('fitting a frame to a stage', () => {
  const stage = { width: 1000, height: 600 };
  const slide = { width: 1920, height: 1080 };

  it('takes the whole slide, letterboxed inside the stage', () => {
    // 16:9 in a 1000×600 stage, which is taller than 16:9 (1.67): width is the
    // limit, so the frame is 1000 wide, 563 tall, and 37px of stage is left
    // below it. Both dimensions are the frame's own shape, never the stage's.
    expect(fitSize('page', slide, stage)).toEqual({ width: 1000, height: 563 });
  });

  it('fits to the stage rather than to a fixed slide size', () => {
    // The point of the whole exercise: the same frame in a taller stage grows,
    // because the available height is what changed.
    expect(fitSize('page', slide, { width: 1000, height: 900 }))
      .toEqual({ width: 1000, height: 563 });
    expect(fitSize('page', slide, { width: 1600, height: 500 }))
      .toEqual({ width: 889, height: 500 });
  });

  it('takes the full width of the stage when asked, letting the height overflow', () => {
    // "Fit width" is for reading a dense slide, so the frame may be taller than
    // the stage and scroll — scrolling *within* a page is wanted, scrolling
    // *between* pages is the thing this viewer refuses to do.
    expect(fitSize('width', slide, stage)).toEqual({ width: 1000, height: 563 });
  });

  it('shows a frame at its own size at 100%', () => {
    expect(fitSize('actual', { width: 800, height: 600 }, stage))
      .toEqual({ width: 800, height: 600 });
  });

  it('uses 16:9 for a frame whose size was never learned', () => {
    // A hand-added page has no width and height, and a document saved before
    // frames carried sizes has zeros. A fallback ratio is what keeps "fit page"
    // producing a box rather than `NaN` — Figma will fit its own content to the
    // iframe regardless, so this only has to be plausible.
    expect(frameRatio({})).toBe(16 / 9);
    expect(frameRatio({ width: 0, height: 0 })).toBe(16 / 9);
    expect(fitSize('page', { width: 0, height: 0 }, stage)).toEqual({ width: 1000, height: 563 });
  });

  it('draws something rather than a zero box when the stage is not measured yet', () => {
    // The first paint, before the ResizeObserver has reported. The box is never
    // exactly right on that frame and is correct on the next.
    const first = fitSize('page', slide, { width: 0, height: 0 });
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
  });

  it('keeps a frame’s shape, so a portrait slide is not letterboxed into a landscape box', () => {
    expect(frameRatio({ width: 390, height: 844 })).toBeCloseTo(390 / 844, 5);
    // Portrait in a landscape stage: height is the limit, and the width comes
    // from the frame's own ratio rather than the stage's — a phone-shaped frame
    // stays phone-shaped, at 277×599, with room either side.
    expect(fitSize('page', { width: 390, height: 844 }, stage))
      .toEqual({ width: 277, height: 599 });
  });
});

describe('zooming a frame', () => {
  const slide = { width: 1920, height: 1080 };

  it('steps in and out, and comes back to the fit it started from', () => {
    const out = zoomedScale(1, 1);
    expect(out).toBeGreaterThan(1);
    expect(zoomedScale(out, -1)).toBeCloseTo(1, 2);
  });

  it('stops at both ends rather than running away', () => {
    // Unbounded, a held `+` is an unusable page and a scrollbar measured in
    // screens; unbounded the other way, the frame shrinks to a stamp.
    let scale = 1;
    for (let at = 0; at < 40; at += 1) scale = zoomedScale(scale, 1);
    expect(scale).toBe(MAX_SCALE);
    for (let at = 0; at < 80; at += 1) scale = zoomedScale(scale, -1);
    expect(scale).toBe(MIN_SCALE);
  });

  it('holds at the limit rather than snapping back to the middle', () => {
    // Clamped, not wrapped: pressing `+` at 400% should stay at 400%, because
    // wrapping to 100% reads as the control having stopped working.
    expect(zoomedScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(zoomedScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });

  it('shows a number with no float in it, because the scale is displayed', () => {
    // `0.7500000000000001` in a zoom label is the kind of detail that makes a
    // tool feel unfinished.
    expect(scaleLabel({ width: 960, height: 540 }, slide)).toBe('50%');
    expect(scaleLabel({ width: 1920, height: 1080 }, slide)).toBe('100%');
  });

  it('says "Fit" rather than a percentage of a frame with no size', () => {
    expect(scaleLabel({ width: 1000, height: 563 }, { width: 0, height: 0 })).toBe('Fit');
  });
});

describe('what a failed Figma read is worth offering', () => {
  it('offers a retry for a problem that might not happen twice', () => {
    // A rate limit and a dropped connection are both worth asking again, and
    // the button sends the same link rather than only clearing the message.
    expect(canRetry('figma_error')).toBe(true);
    expect(canRetry('network')).toBe(true);
    expect(canRetry('unknown')).toBe(true);
  });

  it('does not offer a retry for a refusal that will refuse again', () => {
    // Re-sending a request that was turned away for being unsigned or
    // malformed is how a panel teaches a designer to keep clicking.
    expect(canRetry('not_connected')).toBe(false);
    expect(canRetry('bad_request')).toBe(false);
  });

  it('sends a designer with no connection to Figma rather than to a retry', () => {
    expect(adviseFailure('not_connected').connect).toBe(true);
  });

  it('sends a designer who cannot see the file to Figma, and to the retry too', () => {
    // Sharing: a retry is a reasonable thing to offer because the file's own
    // sharing is what changes, and a designer who has just fixed it should not
    // have to re-paste the link. Both buttons appear, and Connect is offered
    // because the fix may be a different account rather than a different file.
    const advice = adviseFailure('forbidden');
    expect(advice.connect).toBe(true);
    expect(advice.retry).toBe(true);
  });

  it('has a sentence for every failure a server can name', () => {
    // A failure kind with no advice is a panel showing a raw code, and a raw
    // code is the one thing a designer cannot act on.
    for (const kind of ['not_connected', 'forbidden', 'not_found', 'bad_request',
      'figma_error', 'network', 'unknown'] as const) {
      const advice = adviseFailure(kind);
      expect(advice.title.length).toBeGreaterThan(0);
      expect(advice.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('grouping the added documents', () => {
  it('groups by kind rather than listing newest-first', () => {
    const groups = groupDocuments([
      entry({ id: '1', documentType: 'presentation', title: 'Speed run' }),
      entry({ id: '2', documentType: 'guideline', title: 'Guidelines' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Brand', 'Presentations']);
    expect(groups[0]?.items[0]?.title).toBe('Guidelines');
  });

  it('drops an empty group rather than heading nothing', () => {
    expect(groupDocuments([entry({ documentType: 'invoice' })]).map((g) => g.label)).toEqual(['Commercial']);
  });

  it('keeps a kind this build does not know visible, in an Other group', () => {
    const groups = groupDocuments([entry({ id: '1', documentType: 'from-a-later-release', title: 'Odd one' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Other');
    expect(groups[0]?.items[0]?.title).toBe('Odd one');
  });

  it('places a document once even when two groups could take it', () => {
    const groups = groupDocuments([
      entry({ id: '1', documentType: 'guideline', title: 'A' }),
      entry({ id: '2', documentType: 'guideline', title: 'B' }),
    ]);
    expect(groups.flatMap((g) => g.items).map((d) => d.id)).toEqual(['1', '2']);
  });
});
