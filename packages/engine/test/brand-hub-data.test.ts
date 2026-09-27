import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import { EMPTY_DNA, type BrandAsset, type BrandHub } from '../src/brand-hub.js';
import type { ClientDocumentEntry, DocumentPage } from '../src/documents.js';
import type { Client } from '../src/entities.js';

/**
 * The three new kinds of row, end to end.
 *
 * These are tested together on purpose. A hub that says what a brand is, a
 * document that was added to its library, and a design a client exported are
 * one feature from the reader's side — "what EDSAI made for this client, and
 * what I may do with it" — and the parts that matter are the joins and the
 * refusals rather than each schema on its own.
 */

const NOW = '2026-09-27T00:00:00.000Z';
const FIGMA = 'https://www.figma.com/file/abc123XYZ/Brand-Book';

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const acmePortal: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'editor' };

const client = (id: string): Client => ({
  id, name: id, slug: id, status: 'active', createdAt: NOW, updatedAt: NOW,
});

/** A file, in the shape the asset store records: a digest, never a path. */
const file = (id: string, clientId: string, approved = true) => ({
  id, clientId, digest: id.padEnd(64, '0'), filename: `${id}.png`, kind: 'pattern' as const,
  contentType: 'image/png', bytes: 10, approved, uploadedAt: NOW,
});

const hub = (over: Partial<BrandHub> = {}): BrandHub => ({
  clientId: 'acme', status: 'active', tools: ['pattern-studio'],
  dna: { systems: ['pattern', 'riso'] },
  config: {
    modules: { 'pattern-studio': { presets: [{ id: 'heavy', label: 'Heavy', values: { scale: 200 } }], defaultPreset: 'heavy', locked: [], unlocked: [], order: 0 } },
    rules: { colors: ['#eb5e28'], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: ['svg'] },
  },
  createdAt: NOW, updatedAt: NOW, ...over,
});

const entry = (over: Partial<ClientDocumentEntry> = {}): ClientDocumentEntry => ({
  id: 'd1', clientId: 'acme', title: 'Brand Book', documentType: 'guideline',
  source: 'figma', sourceUrl: FIGMA, viewMode: 'presentation', status: 'ready',
  pageCount: 3, createdBy: 'u1', createdAt: NOW, updatedAt: NOW, ...over,
});

const pages: DocumentPage[] = [
  { documentId: 'd1', order: 1, name: 'Cover', nodeId: '1-2' },
  { documentId: 'd1', order: 2, name: 'Colour', nodeId: '3-4' },
  { documentId: 'd1', order: 3, name: 'Type' },
];

function fixture(): RunStore {
  const store = new RunStore();
  store.saveClient(client('acme'));
  store.saveClient(client('morrow'));
  return store;
}

/* ------------------------------------------------------------------- the hub */

describe('a hub keeps what the brand is', () => {
  it('round-trips the DNA and the configuration', () => {
    const store = fixture();
    store.saveBrandHub(hub());
    const read = store.getBrandHub('acme');
    expect(read?.dna.systems).toEqual(['pattern', 'riso']);
    expect(read?.config.modules['pattern-studio']?.defaultPreset).toBe('heavy');
    expect(read?.config.rules.colors).toEqual(['#eb5e28']);
  });

  it('revises a hub without touching what it already knew', () => {
    const store = fixture();
    store.saveBrandHub(hub());
    store.saveBrandHub(hub({ tools: ['pattern-studio', 'poster'], status: 'suspended' }));
    const read = store.getBrandHub('acme');
    expect(read?.tools).toEqual(['pattern-studio', 'poster']);
    expect(read?.status).toBe('suspended');
    expect(read?.dna.systems).toEqual(['pattern', 'riso']);
  });
});

describe('a database written before the brand had a way to say so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edsai-migrate-'));
  // The file handle is closed before the directory is removed, or Windows
  // refuses the delete and the cleanup becomes the failing test.
  const opened: RunStore[] = [];
  afterAll(() => {
    for (const store of opened) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens, and every hub it holds reads as a brand that has declared nothing', () => {
    // The pre-Brand-Hub schema, written by hand, because this is the one thing
    // a real upgrade has to survive: a file on disk that predates the columns.
    const path = join(dir, 'legacy.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE brand_hubs (
        client_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft',
        tools TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    old.prepare('INSERT INTO brand_hubs VALUES (?, ?, ?, ?, ?)')
      .run('acme', 'active', '["pattern-studio"]', NOW, NOW);
    old.close();

    const store = new RunStore(path);
    opened.push(store);
    const read = store.getBrandHub('acme');
    // Not an error, and not an invented brand: a tool list, and nothing said
    // about the identity behind it. Every resolver treats it as carrying no
    // systems, which is what makes a legacy hub show a client nothing.
    expect(read?.tools).toEqual(['pattern-studio']);
    expect(read?.dna).toEqual(EMPTY_DNA);

    // And it is writable afterwards, which is the other half of surviving.
    store.saveBrandHub(hub());
    expect(store.getBrandHub('acme')?.dna.systems).toEqual(['pattern', 'riso']);
  });
});

/* --------------------------------------------------------------- the library */

describe('the documents a studio added', () => {
  it('keeps an upload and a Figma link as different things', () => {
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentEntry(entry({
      id: 'd2', title: 'Colour Brief', source: 'upload', assetId: 'a1',
      sourceUrl: undefined, viewMode: 'document', pageCount: undefined,
    }));
    expect(store.listDocumentEntries('acme').map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(store.getDocumentEntry('d2')?.source).toBe('upload');
    expect(store.getDocumentEntry('d2')?.assetId).toBe('a1');
  });

  it('applies the schema defaults a caller left out', () => {
    const store = fixture();
    store.saveDocumentEntry(entry({
      viewMode: undefined as never, status: undefined as never, documentType: undefined as never,
    }));
    const read = store.getDocumentEntry('d1');
    expect(read?.viewMode).toBe('document');
    expect(read?.status).toBe('ready');
    expect(read?.documentType).toBe('document');
  });

  it('keeps the eight slots exactly as they were', () => {
    // The point of a separate table: adding documents cannot disturb the
    // shelf every client has always had.
    const store = fixture();
    store.saveDocumentEntry(entry());
    expect(store.listDocuments('acme')).toEqual([]);
    store.saveDocument({ clientId: 'acme', slot: 'brand-guidelines', figmaUrl: FIGMA, updatedAt: NOW });
    expect(store.listDocuments('acme')).toHaveLength(1);
    expect(store.listDocumentEntries('acme')).toHaveLength(1);
  });

  it('lists newest first, so the document being worked on is the first one', () => {
    const store = fixture();
    store.saveDocumentEntry(entry({ id: 'd1', updatedAt: '2026-01-01T00:00:00.000Z' }));
    store.saveDocumentEntry(entry({ id: 'd2', updatedAt: '2026-09-01T00:00:00.000Z' }));
    expect(store.listDocumentEntries('acme').map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('takes a presentation manifest away with the document it described', () => {
    // Nothing cascades in SQLite, so a manifest left behind would be found by
    // a later document that happened to reuse the id.
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentPages('d1', pages);
    expect(store.listDocumentPages('d1')).toHaveLength(3);
    store.deleteDocumentEntry('d1');
    expect(store.listDocumentPages('d1')).toEqual([]);
    expect(store.getDocumentEntry('d1')).toBeUndefined();
  });

  it('replaces a manifest rather than adding to it', () => {
    // Diffing it would leave a stale page behind a page that was renumbered,
    // which is a viewer whose control points at a deleted frame.
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentPages('d1', pages);
    store.saveDocumentPages('d1', [{ documentId: 'd1', order: 1, name: 'Cover', nodeId: '1-2' }]);
    expect(store.listDocumentPages('d1')).toEqual([{ documentId: 'd1', order: 1, name: 'Cover', nodeId: '1-2' }]);
  });

  it('stores pages in order however they arrive', () => {
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentPages('d1', [...pages].reverse());
    expect(store.listDocumentPages('d1').map((p) => p.order)).toEqual([1, 2, 3]);
  });
});

/* ------------------------------------------------------- the generated assets */

describe('a design kept in the shared library', () => {
  const design: BrandAsset = {
    id: 'ba1', clientId: 'acme', assetId: 'a1', toolId: 'pattern-studio',
    projectId: 'bp1', presetId: 'heavy', kind: 'pattern', format: 'svg',
    width: 1200, height: 1200, createdBy: 'u1', createdAt: NOW,
  };

  it('round-trips, keeping the provenance the asset file has no column for', () => {
    const store = fixture();
    store.saveBrandAsset(design);
    const read = store.getBrandAsset('ba1');
    expect(read?.assetId).toBe('a1');
    expect(read?.projectId).toBe('bp1');
    expect(read?.presetId).toBe('heavy');
    expect(read?.width).toBe(1200);
  });

  it('cannot be moved to another client by saving it again under the same id', () => {
    const store = fixture();
    store.saveBrandAsset(design);
    store.saveBrandAsset({ ...design, clientId: 'morrow', assetId: 'a2' });
    expect(store.getBrandAsset('ba1')?.clientId).toBe('acme');
  });

  it('is deleted without touching the file it points at', () => {
    const store = fixture();
    store.saveBrandAsset(design);
    store.deleteBrandAsset('ba1');
    expect(store.getBrandAsset('ba1')).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- the boundary */

describe('a portal session and the documents a studio added', () => {
  it('reads them, because a client is the one they are for', () => {
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentPages('d1', pages);
    const scoped = new ScopedStore(store, acmePortal);
    expect(scoped.listDocumentEntries('acme')).toHaveLength(1);
    expect(scoped.listDocumentPages('d1')).toHaveLength(3);
  });

  it('cannot add, revise or remove one', () => {
    // `document` is studio-managed, so a client who types the request gets the
    // same refusal as one who is only looking at the screen.
    const scoped = new ScopedStore(fixture(), acmePortal);
    expect(() => scoped.saveDocumentEntry(entry())).toThrow(Forbidden);
    expect(() => scoped.saveDocumentPages('d1', pages)).toThrow(Forbidden);
  });

  it('sees nothing of another client, and cannot reach a manifest by guessing its id', () => {
    const store = fixture();
    store.saveDocumentEntry(entry());
    store.saveDocumentPages('d1', pages);
    const scoped = new ScopedStore(store, acmePortal);
    expect(scoped.listDocumentEntries('morrow')).toEqual([]);
    expect(scoped.getDocumentEntry('d1')?.clientId).toBe('acme');
    // The id in the path is never trusted on its own: a manifest is resolved
    // through its document, and the document is the thing that is scoped.
    expect(scoped.listDocumentPages('d-does-not-exist')).toEqual([]);
  });
});

describe('a document refused at the boundary rather than repaired', () => {
  const studio_ = (): ScopedStore => new ScopedStore(fixture(), studio);

  it('needs a link for a Figma document, and a real one', () => {
    expect(() => studio_().saveDocumentEntry(entry({ sourceUrl: undefined }))).toThrow(Forbidden);
    expect(() => studio_().saveDocumentEntry(entry({ sourceUrl: 'https://example.com/file/a/X' }))).toThrow(Forbidden);
    expect(() => studio_().saveDocumentEntry(entry({ sourceUrl: 'not a link' }))).toThrow(Forbidden);
    expect(() => studio_().saveDocumentEntry(entry({ sourceUrl: 'https://www.figma.com/community/file/1/X' }))).toThrow(Forbidden);
  });

  it('needs a file for an upload, and refuses one that also carries a link', () => {
    // The source is what says where the bytes come from. A row that says both
    // is a row no later reader can trust.
    expect(() => studio_().saveDocumentEntry(entry({ source: 'upload', assetId: undefined }))).toThrow(Forbidden);
    expect(() => studio_().saveDocumentEntry(entry({
      source: 'upload', assetId: 'a1', sourceUrl: FIGMA,
    }))).toThrow(Forbidden);
  });

  it('refuses to point at a file belonging to somebody else', () => {
    const store = fixture();
    store.saveAsset(file('a-morrow', 'morrow', false));
    const scoped = new ScopedStore(store, studio);
    expect(() => scoped.saveDocumentEntry(entry({ source: 'upload', assetId: 'a-morrow', sourceUrl: undefined })))
      .toThrow(Forbidden);
    expect(scoped.getDocumentEntry('d1')).toBeUndefined();
  });

  it('gives pages only to a Figma document, and only numbered 1 to n', () => {
    const store = fixture();
    store.saveAsset(file('a1', 'acme'));
    const scoped = new ScopedStore(store, studio);
    scoped.saveDocumentEntry(entry());
    expect(() => scoped.saveDocumentPages('d1', [{ documentId: 'd1', order: 4, name: 'Cover' }])).toThrow(Forbidden);
    expect(() => scoped.saveDocumentPages('d1', [
      { documentId: 'd1', order: 1, name: 'A' }, { documentId: 'd1', order: 1, name: 'B' },
    ])).toThrow(Forbidden);

    scoped.saveDocumentEntry(entry({
      id: 'd2', title: 'Spec', source: 'upload', assetId: 'a1', sourceUrl: undefined, viewMode: 'document',
    }));
    expect(() => scoped.saveDocumentPages('d2', pages)).toThrow(Forbidden);
  });
});

describe('a design a client exported', () => {
  it('is a thing a client may do, because saving one is', () => {
    // Both under `brand-project`, so the two permissions cannot disagree: there
    // is no way to be allowed to save a design and refused the right to keep
    // the thing you just made.
    const store = fixture();
    store.saveAsset(file('a1', 'acme'));
    const scoped = new ScopedStore(store, acmePortal);
    expect(() => scoped.saveBrandAsset({
      id: 'ba1', clientId: 'acme', assetId: 'a1', toolId: 'pattern-studio', kind: 'pattern',
      format: 'png', createdBy: 'p1', createdAt: NOW,
    })).not.toThrow();
    expect(scoped.listBrandAssets('acme')).toHaveLength(1);
  });

  it('refuses another client file, and another client', () => {
    const store = fixture();
    store.saveAsset(file('a-morrow', 'morrow', false));
    const scoped = new ScopedStore(store, acmePortal);
    expect(() => scoped.saveBrandAsset({
      id: 'ba1', clientId: 'acme', assetId: 'a-morrow', toolId: 'pattern-studio', kind: 'pattern',
      format: 'png', createdBy: 'p1', createdAt: NOW,
    })).toThrow(Forbidden);
    expect(() => scoped.saveBrandAsset({
      id: 'ba2', clientId: 'morrow', assetId: 'a-morrow', toolId: 'pattern-studio', kind: 'pattern',
      format: 'png', createdBy: 'p1', createdAt: NOW,
    })).toThrow(Forbidden);
  });

  it('cannot be read across a client boundary by knowing the id', () => {
    const store = fixture();
    store.saveAsset(file('a1', 'acme'));
    new ScopedStore(store, studio).saveBrandAsset({
      id: 'ba1', clientId: 'acme', assetId: 'a1', toolId: 'pattern-studio', kind: 'pattern',
      format: 'png', createdBy: 'u1', createdAt: NOW,
    });
    expect(new ScopedStore(store, acmePortal).getBrandAsset('ba1')?.id).toBe('ba1');
    expect(new ScopedStore(store, { kind: 'portal', userId: 'p2', clientId: 'morrow', role: 'editor' }).getBrandAsset('ba1'))
      .toBeUndefined();
  });
});
