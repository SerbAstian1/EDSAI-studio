import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DiskAssetStore, MemoryAssetStore, safeContentType, mustDownload, safeFilename, kindFor,
  type AssetStore,
} from '../src/assets.js';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import type { Principal } from '@edsai/auth';

/** The same contract, proven against both implementations of the seam. */
const IMPLEMENTATIONS: [string, () => AssetStore][] = [
  ['memory', () => new MemoryAssetStore()],
  ['disk', () => new DiskAssetStore(mkdtempSync(join(tmpdir(), 'edsai-assets-')))],
];

describe.each(IMPLEMENTATIONS)('content-addressed storage (%s)', (_label, make) => {
  it('stores and returns the exact bytes', () => {
    const store = make();
    const bytes = Buffer.from('a logo, pretend');
    const digest = store.put(bytes);
    expect(store.get(digest)?.equals(bytes)).toBe(true);
    expect(store.size(digest)).toBe(bytes.byteLength);
  });

  it('gives identical files one digest, so a re-upload is not a duplicate', () => {
    const store = make();
    expect(store.put(Buffer.from('same'))).toBe(store.put(Buffer.from('same')));
    expect(store.put(Buffer.from('other'))).not.toBe(store.put(Buffer.from('same')));
  });

  it('returns nothing for a digest it does not have', () => {
    const store = make();
    expect(store.get('0'.repeat(64))).toBeUndefined();
    expect(store.has('0'.repeat(64))).toBe(false);
  });

  it('refuses a digest that is not one, rather than treating it as a path', () => {
    // The point of content addressing: a name can never become a path.
    const store = make();
    expect(store.get('../../../etc/passwd')).toBeUndefined();
    expect(store.has('../../../etc/passwd')).toBe(false);
  });

  it('removes a file, and removing it twice is not an error', () => {
    const store = make();
    const digest = store.put(Buffer.from('gone soon'));
    store.remove(digest);
    expect(store.has(digest)).toBe(false);
    expect(() => store.remove(digest)).not.toThrow();
  });
});

describe('what a file may be served as', () => {
  it('lets a real image render in place', () => {
    expect(safeContentType('image/png')).toBe('image/png');
    expect(mustDownload('image/png')).toBe(false);
  });

  it('refuses to serve HTML as HTML, which would run on the portal origin', () => {
    expect(safeContentType('text/html')).toBe('application/octet-stream');
    expect(mustDownload('text/html')).toBe(true);
  });

  it('refuses SVG inline despite it being an image, because it can carry script', () => {
    expect(safeContentType('image/svg+xml')).toBe('application/octet-stream');
  });

  it('is not fooled by a charset parameter or by casing', () => {
    expect(safeContentType('TEXT/HTML; charset=utf-8')).toBe('application/octet-stream');
    expect(safeContentType('Image/PNG')).toBe('image/png');
  });

  it('downgrades anything it does not recognise', () => {
    expect(safeContentType('application/x-shockwave-flash')).toBe('application/octet-stream');
    expect(safeContentType('')).toBe('application/octet-stream');
  });
});

describe('filenames', () => {
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const NUL = String.fromCharCode(0);

  it('strips what would inject a header field', () => {
    expect(safeFilename('in"jected.png')).toBe('injected.png');
    expect(safeFilename(`a${CR}${LF}Content-Type: text/html`)).not.toContain(LF);
    expect(safeFilename(`a${NUL}b.png`)).toBe('ab.png');
  });

  it('keeps a path-looking name as a harmless label', () => {
    // It is never used as a path, so it only has to be safe inside a header.
    expect(safeFilename('../../etc/passwd')).toBe('....etcpasswd');
  });

  it('never returns an empty name', () => {
    expect(safeFilename('   ')).toBe('download');
    expect(safeFilename('"""')).toBe('download');
  });

  it('keeps ordinary names, including non-Latin ones', () => {
    expect(safeFilename('Disan Logo.png')).toBe('Disan Logo.png');
    expect(safeFilename('商标.png')).toBe('商标.png');
  });

  it('bounds the length', () => {
    expect(safeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe('guessing a kind', () => {
  it('reads a logo from the name', () => {
    expect(kindFor('image/png', 'acme-logo.png')).toBe('logo');
    expect(kindFor('image/svg+xml', 'mark.svg')).toBe('logo');
  });

  it('reads the rest from the type', () => {
    expect(kindFor('video/mp4', 'clip.mp4')).toBe('video');
    expect(kindFor('font/woff2', 'Inter.woff2')).toBe('font');
    expect(kindFor('application/pdf', 'guidelines.pdf')).toBe('document');
    expect(kindFor('image/jpeg', 'shoot-01.jpg')).toBe('photography');
    expect(kindFor('application/zip', 'pack.zip')).toBe('other');
  });
});

describe('who can see an asset', () => {
  const NOW = '2026-09-18T00:00:00.000Z';
  const studio: Principal = { kind: 'studio', userId: 'u', role: 'owner' };
  const portal: Principal = { kind: 'portal', userId: 'p', clientId: 'acme', role: 'viewer' };
  const limited: Principal = {
    kind: 'portal', userId: 'p', clientId: 'acme', role: 'limited', collections: ['logos'],
  };

  const fixture = (): RunStore => {
    const store = new RunStore();
    store.saveClient({
      id: 'acme', name: 'Acme', slug: 'acme', status: 'active', createdAt: NOW, updatedAt: NOW,
    });
    const asset = (id: string, approved: boolean, collection?: string) => ({
      id, clientId: 'acme', digest: id.padEnd(64, '0'), filename: `${id}.png`,
      kind: 'logo' as const, contentType: 'image/png', bytes: 10, approved,
      ...(collection ? { collection } : {}), uploadedAt: NOW,
    });
    store.saveAsset(asset('approved', true, 'logos'));
    store.saveAsset(asset('draft', false, 'logos'));
    store.saveAsset(asset('photos', true, 'photography'));
    return store;
  };

  it('shows the studio everything, approved or not', () => {
    expect(new ScopedStore(fixture(), studio).listAssets('acme')).toHaveLength(3);
  });

  it('shows a client only what was approved', () => {
    const seen = new ScopedStore(fixture(), portal).listAssets('acme').map((a) => a.id);
    expect(seen.sort()).toEqual(['approved', 'photos']);
  });

  it('hides an unapproved asset even from a direct fetch by id', () => {
    const scoped = new ScopedStore(fixture(), portal);
    expect(scoped.getAsset('draft')).toBeUndefined();
    expect(scoped.getAsset('approved')?.id).toBe('approved');
  });

  it('holds a limited session to its own collections', () => {
    const scoped = new ScopedStore(fixture(), limited);
    expect(scoped.listAssets('acme').map((a) => a.id)).toEqual(['approved']);
    expect(scoped.getAsset('photos')).toBeUndefined();
  });

  it('gathers every visible asset across clients, and no more', () => {
    const store = fixture();
    store.saveClient({
      id: 'morrow', name: 'Morrow', slug: 'morrow', status: 'active',
      createdAt: NOW, updatedAt: NOW,
    });
    store.saveAsset({
      id: 'theirs', clientId: 'morrow', digest: 't'.padEnd(64, '0'), filename: 't.png',
      kind: 'logo', contentType: 'image/png', bytes: 10, approved: true, uploadedAt: NOW,
    });

    expect(new ScopedStore(store, studio).listAllAssets()).toHaveLength(4);
    // The portal is bound to Acme, so the library view is still only Acme's —
    // a convenience over the same filters, never a wider door.
    expect(new ScopedStore(store, portal).listAllAssets().map((a) => a.id).sort())
      .toEqual(['approved', 'photos']);
    expect(new ScopedStore(store, limited).listAllAssets().map((a) => a.id))
      .toEqual(['approved']);
  });

  it('shows another client nothing', () => {
    const other: Principal = { kind: 'portal', userId: 'x', clientId: 'morrow', role: 'owner' };
    const scoped = new ScopedStore(fixture(), other);
    expect(scoped.listAssets('acme')).toEqual([]);
    expect(scoped.getAsset('approved')).toBeUndefined();
  });
});
