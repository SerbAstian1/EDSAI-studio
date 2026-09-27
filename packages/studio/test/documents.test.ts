import { describe, expect, it } from 'vitest';
import {
  canPresent, figmaSource, figmaUrlProblem, isFigmaUrl, pageUrl, withNodeId,
} from '../src/figmaLinks.js';
import {
  clampIndex, hasNext, hasPrevious, isMultiPage, nextIndex, orderedPages, pageCount,
  pageLabel, pageName, preloadWindow, previousIndex, resolveViewMode, uploadViewMode,
} from '../src/presentation.js';
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
