import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Compass, ExternalLink, FileSignature, FileText, Link2, Plus,
  Presentation, Receipt, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { api, type Asset, type DocumentEntry, type DocumentPage } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';
import { ErrorPanel } from './ErrorPanel.js';
import OverflowMenu from './OverflowMenu.js';
import AddDocument from './AddDocument.js';
import DocumentViewer from './DocumentViewer.js';
import { downloadFile } from './actions.js';

/**
 * The documents a designer has added to a client, on top of the eight.
 *
 * **A sibling of the shelf, not a replacement for it.** The eight are the
 * engagement's spine and stay exactly where they were, in the same order, for
 * every client — "the contract is the second tile" is a fact about this product
 * and replacing it with a growing list would lose it. This is the overflow: the
 * fourth strategy document, the guidelines v3, the pitch that lost.
 *
 * Documents are grouped by kind rather than listed newest-first, because the
 * question a client arrives with is "where is the guidelines", not "what is
 * new". A `ready` document is filled and a `draft` or `archived` one is dimmed,
 * so what is finished is legible without opening anything.
 *
 * Pressing a document opens it *in place*, in the same accordion shape the shelf
 * uses, rather than navigating away — reading the guidelines and going back to
 * the list is one press of Escape and no reload.
 */

const ICONS: Record<string, LucideIcon> = {
  proposal: FileText,
  contract: FileSignature,
  invoice: Receipt,
  strategy: Compass,
  guideline: BookOpen,
  presentation: Presentation,
  reference: FileText,
};

const GROUPS: { label: string; types: string[] }[] = [
  { label: 'Commercial', types: ['proposal', 'contract', 'invoice'] },
  { label: 'Brand', types: ['strategy', 'guideline'] },
  { label: 'Presentations', types: ['presentation'] },
  { label: 'Reference', types: ['reference'] },
];

function when(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The groups that have documents in them, in the order above.
 *
 * An empty group is dropped rather than shown as a heading over nothing — the
 * eight-shelf has the same rule, and a section that is always present and
 * usually empty is how a library stops being scannable.
 */
export function groupDocuments(entries: readonly DocumentEntry[]):
{ label: string; items: DocumentEntry[] }[] {
  const placed = new Set<string>();
  const groups: { label: string; items: DocumentEntry[] }[] = [];
  for (const group of GROUPS) {
    const items = entries
      .filter((e) => group.types.includes(e.documentType) && !placed.has(e.id))
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    for (const item of items) placed.add(item.id);
    if (items.length > 0) groups.push({ label: group.label, items });
  }
  // A kind this build does not know about, from a future release or a hand-made
  // row. Dropping it would make a document invisible, which is worse than an
  // unexpected heading.
  const rest = entries.filter((e) => !placed.has(e.id));
  if (rest.length > 0) {
    groups.push({ label: 'Other', items: rest.sort((a, b) => (a.title < b.title ? -1 : 1)) });
  }
  return groups;
}

export default function DocumentLibrary({ clientId, editable, assets }: {
  clientId: string;
  /** The studio adds and removes; a portal only reads. */
  editable: boolean;
  /** The brand's files, needed to render an upload inline. */
  assets: readonly Asset[];
}): ReactElement {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const entries = useQuery({ queryKey: ['document-entries', clientId], queryFn: () => api.documentEntries(clientId) });
  // Only the open document's pages are fetched. A library of forty documents
  // would otherwise fetch forty manifests to show one.
  const detail = useQuery({
    queryKey: ['document-entry', openId],
    queryFn: () => api.documentEntry(openId ?? ''),
    enabled: openId !== undefined,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['document-entries', clientId] });
    if (openId) void queryClient.invalidateQueries({ queryKey: ['document-entry', openId] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDocumentEntry(id),
    onSuccess: () => { setOpenId(undefined); invalidate(); },
  });

  if (entries.isPending) return <p className="muted">Loading documents…</p>;
  if (entries.error) {
    return <ErrorPanel title="Could not load documents" error={entries.error} onRetry={() => { void entries.refetch(); }} />;
  }

  const all = entries.data;
  const live = all.filter((d) => d.status !== 'archived');
  // Archived documents are out of the list. Nothing here can un-archive one, and
  // a library whose bottom third is tombstones is a library nobody scrolls to.
  const groups = groupDocuments(live);
  const open = openId ? all.find((d) => d.id === openId) : undefined;
  const openPages: DocumentPage[] = openId && detail.data?.document.id === openId ? detail.data.pages : [];

  if (adding) return <AddDocument clientId={clientId} onDone={() => { setAdding(false); invalidate(); }} />;

  return (
    <section className="stack shelf">
      <div className="row">
        <h3 style={{ margin: 0 }}>Added documents</h3>
        <span className="muted mono">{all.length}</span>
        {editable && (
          <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" /> Add a document
          </button>
        )}
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <p className="editorial">Nothing added yet.</p>
          <p>
            The eight on the shelf are the engagement&apos;s spine. Anything else — a second
            strategy document, guidelines v3, a pitch that lost — goes here.
            {editable && ' Use Add a document to put one in.'}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="shelf-group">
            <span className="label">{group.label}</span>
            <div className="shelf-tiles">
              {group.items.map((doc) => {
                const Icon = ICONS[doc.documentType] ?? FileText;
                const isOpen = openId === doc.id;
                const panelId = `doc-panel-${doc.id}`;
                const pages = doc.pageCount ?? 0;
                return (
                  <div key={doc.id} className="doc-slot" style={{ display: 'contents' }}>
                    <button
                      type="button"
                      className={`shelf-tile linked${isOpen ? ' open' : ''}${doc.status === 'draft' ? ' dimmed' : ''}`}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      onClick={() => setOpenId((id) => (id === doc.id ? undefined : doc.id))}
                    >
                      <Icon className="shelf-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                      <span className="shelf-label">{doc.title}</span>
                      <span className="shelf-meta">
                        {doc.status === 'draft' && <span className="pill minor">draft</span>}
                        {doc.source === 'figma' ? 'Figma' : 'Upload'}
                        {pages > 0 && ` · ${pages} page${pages === 1 ? '' : 's'}`}
                        {` · ${when(doc.updatedAt)}`}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="shelf-viewer" id={panelId}>
                        <div className="row">
                          <strong>{doc.title}</strong>
                          <span style={{ marginLeft: 'auto' }} className="row">
                            {editable && (
                              <OverflowMenu label={`Actions for ${doc.title}`} items={[
                                { label: 'Open the file', icon: ExternalLink,
                                  onSelect: () => {
                                    if (doc.sourceUrl) window.open(doc.sourceUrl, '_blank', 'noopener');
                                    else if (doc.assetId) downloadFile(api.downloadPath(doc.assetId), doc.title);
                                  } },
                                { label: 'Remove', icon: Trash2, danger: true, disabled: remove.isPending,
                                  onSelect: () => {
                                    void requestConfirmation({
                                      title: `Remove ${doc.title}?`,
                                      message: 'This removes the document from the library. An uploaded file stays in Files, so nothing is lost.',
                                      confirmLabel: 'Remove document',
                                    }).then((confirmed) => { if (confirmed) remove.mutate(doc.id); });
                                  } },
                              ]} />
                            )}
                            <button type="button" className="overflow-button row" aria-label={`Close ${doc.title}`}
                                    onClick={() => setOpenId(undefined)}>
                              <X size={16} aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                        {doc.description && <p className="muted" style={{ margin: 0 }}>{doc.description}</p>}
                        {detail.isPending ? <p className="muted">Loading…</p>
                          : detail.error ? <ErrorPanel title="Could not open this document" error={detail.error} onRetry={() => { void detail.refetch(); }} />
                          : <DocumentViewer entry={doc} pages={openPages} assets={assets} onClose={() => setOpenId(undefined)} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {live.length > 0 && all.length > live.length && (
        <span className="muted" style={{ fontSize: 12 }}>
          {all.length - live.length} archived, hidden until you ask for them.
        </span>
      )}

      {editable && all.length > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <Link2 size={12} aria-hidden="true" /> A Figma document is previewed through Figma&apos;s own
          public embed, so EDSAI never needs a copy of it or a token for it.
        </p>
      )}
    </section>
  );
}
