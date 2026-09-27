import { describe, expect, it } from 'vitest';
import {
  canPresent, figmaSource, figmaUrlProblem, isFigmaUrl, pageUrl, withNodeId,
} from '../src/figma-source.js';

/**
 * Reading a Figma address bar.
 *
 * This is the whole of the Figma integration: the rest of a document feature
 * is a list of node ids a designer recorded, and this is the function that
 * decides whether a link is one, which file it names, and which frame in it is
 * page four. It is worth testing hard because the answer decides what gets
 * framed inside the product.
 */

const FILE = 'https://www.figma.com/file/abc123XYZ/Brand%20Book';
const DESIGN = 'https://www.figma.com/design/abc123XYZ/Brand-Book';

describe('is this a Figma link', () => {
  it('accepts figma.com and its subdomains', () => {
    expect(isFigmaUrl(FILE)).toBe(true);
    expect(isFigmaUrl('https://figma.com/file/abc/X')).toBe(true);
    expect(isFigmaUrl('https://help.figma.com/hc/en-us')).toBe(true);
  });

  it('refuses a look-alike host, which is the attack this check exists for', () => {
    expect(isFigmaUrl('https://figma.com.evil.test/file/abc/X')).toBe(false);
    expect(isFigmaUrl('https://evil-figma.com/file/abc/X')).toBe(false);
    expect(isFigmaUrl('https://figma.com@evil.test/file/abc/X')).toBe(false);
  });

  it('refuses anything that is not an https address on that host', () => {
    expect(isFigmaUrl('http://www.figma.com/file/abc/X')).toBe(false);
    expect(isFigmaUrl('javascript:alert(1)')).toBe(false);
    expect(isFigmaUrl('www.figma.com/file/abc/X')).toBe(false);
    expect(isFigmaUrl('')).toBe(false);
  });
});

describe('what a Figma link is', () => {
  it('names the file, and the frame it already points at', () => {
    const source = figmaSource(`${FILE}?node-id=120-449`);
    expect(source?.kind).toBe('file');
    expect(source?.fileKey).toBe('abc123XYZ');
    expect(source?.nodeId).toBe('120-449');
  });

  it('reads every kind of link that names a file the same way', () => {
    // The path segment is how Figma distinguishes them; the key is always the
    // second segment, and a designer pastes whichever one their browser gave
    // them without knowing the difference.
    for (const [path, kind] of [
      ['file', 'file'], ['design', 'design'], ['proto', 'proto'],
      ['board', 'board'], ['slideshow', 'slideshow'],
    ] as const) {
      const source = figmaSource(`https://www.figma.com/${path}/KEY9/Name`);
      expect(source?.kind).toBe(kind);
      expect(source?.fileKey).toBe('KEY9');
      expect(canPresent(`https://www.figma.com/${path}/KEY9/Name`)).toBe(true);
    }
  });

  it('takes the frame off an embed link, which is a wrapper around a link', () => {
    // Handing an embed URL to the embedder instead is how a document ends up
    // embedded inside an embed.
    const embed = `https://www.figma.com/embed?embed_host=edsai&url=${encodeURIComponent(`${FILE}?node-id=1-2`)}`;
    const source = figmaSource(embed);
    expect(source?.kind).toBe('file');
    expect(source?.fileKey).toBe('abc123XYZ');
    expect(source?.nodeId).toBe('1-2');
    expect(source?.href).toBe(embed);
    expect(source?.innerHref).not.toContain('/embed');
  });

  it('has nothing to say about a link with no file behind it', () => {
    expect(figmaSource('https://www.figma.com/community/file/12345/Sample')?.kind).toBe('community');
    expect(figmaSource('https://www.figma.com/community/file/12345/Sample')?.fileKey).toBeUndefined();
    expect(canPresent('https://www.figma.com/community/file/12345/Sample')).toBe(false);
  });

  it('refuses a link that is not a Figma one, with no partial answer', () => {
    expect(figmaSource('https://example.com/file/abc/X')).toBeUndefined();
    expect(figmaSource('not a url')).toBeUndefined();
  });

  it('only accepts a node id shaped like one', () => {
    // Figma writes `12-345` in an address bar. Anything else is not a frame,
    // and treating it as one is what lands a viewer on a whole file.
    expect(figmaSource(`${FILE}?node-id=12-345`)?.nodeId).toBe('12-345');
    expect(figmaSource(`${FILE}?node-id=12%3A345`)?.nodeId).toBeUndefined();
    expect(figmaSource(`${FILE}?node-id=../../etc`)?.nodeId).toBeUndefined();
    expect(figmaSource(`${FILE}?node-id=`)?.nodeId).toBeUndefined();
  });
});

describe('addressing one frame', () => {
  it('points at a frame, and replaces a frame already there', () => {
    // Two node-ids on one URL land on neither, so replacing is the only safe
    // edit when moving from page three to page four.
    expect(withNodeId(FILE, '7-8')).toBe(`${FILE}?node-id=7-8`);
    expect(withNodeId(`${FILE}?node-id=1-2`, '7-8')).toBe(`${FILE}?node-id=7-8`);
  });

  it('drops the frame when there is none to point at', () => {
    expect(withNodeId(`${FILE}?node-id=1-2`, undefined)).toBe(FILE);
  });

  it('leaves a value it cannot understand exactly as it found it', () => {
    expect(withNodeId(FILE, 'not-a-node')).toBe(FILE);
    expect(withNodeId('not a url', '1-2')).toBe('not a url');
  });
});

describe('the link for one page', () => {
  it('points at the frame of a page, unwrapping an embed link first', () => {
    const embed = `https://www.figma.com/embed?embed_host=edsai&url=${encodeURIComponent(FILE)}`;
    expect(pageUrl(embed, { nodeId: '5-6' })).toBe(`${FILE}?node-id=5-6`);
    expect(pageUrl(FILE, { nodeId: '5-6' })).toBe(`${FILE}?node-id=5-6`);
  });

  it('falls back to the file itself for a page that names no frame', () => {
    expect(pageUrl(`${FILE}?node-id=1-2`, undefined)).toBe(FILE);
  });
});

describe('telling a person what is wrong with a link', () => {
  it('says nothing about a good one', () => {
    expect(figmaUrlProblem(FILE)).toBeUndefined();
    expect(figmaUrlProblem(`${FILE}?node-id=12-345`)).toBeUndefined();
  });

  it('names the four different problems, because they need different fixes', () => {
    // A typo is fixed by the reader, a private file needs a share, a community
    // file needs copying, and a deleted one needs the studio. Calling all of
    // them "not a Figma link" is how a real problem gets filed as a bug.
    expect(figmaUrlProblem('')).toMatch(/Paste a Figma link/);
    expect(figmaUrlProblem('figma.com/file/abc/X')).toMatch(/not a link/);
    expect(figmaUrlProblem('http://www.figma.com/file/abc/X')).toMatch(/https/);
    expect(figmaUrlProblem('https://example.com/file/abc/X')).toMatch(/not a figma.com address/);
    expect(figmaUrlProblem('https://www.figma.com/community/file/1/X')).toMatch(/Community/);
    expect(figmaUrlProblem('https://www.figma.com/')).toMatch(/does not point at a file/);
  });
});
