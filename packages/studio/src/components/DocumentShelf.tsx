import { Fragment, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Compass, ExternalLink, FileSignature, FileText, Link2, Presentation,
  Receipt, Sparkles, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { api, type ClientDocument, type Contract, type Invoice } from '../api.js';
import { isFigmaUrl } from '../figmaLinks.js';
import { clientHref } from '../shell/clientNavigation.js';
import { requestConfirmation } from './ConfirmDialog.js';
import { ErrorPanel } from './ErrorPanel.js';
import OverflowMenu from './OverflowMenu.js';
import PresentationViewer from './PresentationViewer.js';

/**
 * The fixed engagement shelf.
 *
 * Contract and invoice are first-class EDSAI records, not pasted links. The
 * remaining Figma-backed slots are saved with a frame manifest and always open
 * in the bounded presentation viewer: one frame at a time, with Previous/Next.
 */

const ICONS: Record<string, LucideIcon> = {
  proposal: FileText,
  contract: FileSignature,
  invoice: Receipt,
  'brand-strategy': Compass,
  'speed-run-1': Presentation,
  'speed-run-2': Presentation,
  'final-presentation': Sparkles,
  'brand-guidelines': BookOpen,
};

const GROUPS: { id: ClientDocument['group']; label: string }[] = [
  { id: 'commercial', label: 'Commercial' },
  { id: 'brand', label: 'Brand' },
];

function when(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function LinkForm({ clientId, doc, onDone }: {
  clientId: string; doc: ClientDocument; onDone: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(doc.figmaUrl ?? '');
  const [note, setNote] = useState(doc.note ?? '');
  const ok = isFigmaUrl(url.trim());
  const save = useMutation({
    mutationFn: () => api.setDocument(clientId, doc.slot, {
      figmaUrl: url.trim(), ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents', clientId] });
      onDone();
    },
  });
  return (
    <form className="shelf-form stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <label className="field">
        <span className="label">Figma link for {doc.label}</span>
        <input value={url} onChange={(event) => setUrl(event.target.value)} autoFocus
               placeholder="https://www.figma.com/design/…" aria-invalid={url.trim() !== '' && !ok} />
        <span className={url.trim() && !ok ? 'err' : 'muted'} style={{ fontSize: 12 }}>
          {url.trim() && !ok
            ? 'Only figma.com links can be previewed.'
            : 'EDSAI reads the frames now, then shows one frame at a time here and in the portal.'}
        </span>
      </label>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input value={note} onChange={(event) => setNote(event.target.value)}
               placeholder="v2, after the March review" />
      </label>
      {save.error && <p className="err">{(save.error as Error).message}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={!ok || save.isPending}>
          {save.isPending ? 'Reading frames…' : doc.figmaUrl ? 'Update document' : 'Link document'}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function DocumentShelf({ clientId, editable }: {
  clientId: string;
  /** The studio edits; a portal only looks. */
  editable: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ['documents', clientId], queryFn: () => api.documents(clientId),
  });
  const contracts = useQuery({
    queryKey: ['contracts', clientId], queryFn: () => api.contracts(clientId),
  });
  const invoices = useQuery({
    queryKey: ['invoices', clientId], queryFn: () => api.invoices(clientId),
  });
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [linking, setLinking] = useState<string | undefined>(undefined);

  const clear = useMutation({
    mutationFn: (slot: string) => api.clearDocument(clientId, slot),
    onSuccess: () => {
      setOpen(undefined);
      void queryClient.invalidateQueries({ queryKey: ['documents', clientId] });
    },
  });

  if (documents.isPending || contracts.isPending || invoices.isPending) {
    return <p className="muted">Loading documents…</p>;
  }
  const queryError = documents.error ?? contracts.error ?? invoices.error;
  if (queryError || !documents.data || !contracts.data || !invoices.data) {
    return <ErrorPanel title="Could not load documents"
      error={queryError ?? new Error('No document data was returned.')}
      onRetry={() => { void Promise.all([documents.refetch(), contracts.refetch(), invoices.refetch()]); }} />;
  }

  const isNative = (slot: string): boolean => slot === 'contract' || slot === 'invoice';
  const nativeRecords = (slot: string): (Contract | Invoice)[] => {
    if (slot === 'contract') return contracts.data;
    if (slot === 'invoice') return invoices.data.invoices;
    return [];
  };
  const filled = (doc: ClientDocument): boolean => isNative(doc.slot)
    ? nativeRecords(doc.slot).length > 0
    : Boolean(doc.figmaUrl);
  const held = documents.data.filter(filled).length;

  const press = (doc: ClientDocument): void => {
    if (isNative(doc.slot)) {
      if (nativeRecords(doc.slot).length === 0) {
        if (editable) location.href = clientHref(clientId, 'contracts');
        return;
      }
      setLinking(undefined);
      setOpen((value) => (value === doc.slot ? undefined : doc.slot));
      return;
    }
    if (!doc.figmaUrl) {
      if (editable) { setLinking(doc.slot); setOpen(undefined); }
      return;
    }
    setLinking(undefined);
    setOpen((value) => (value === doc.slot ? undefined : doc.slot));
  };

  return (
    <section className="stack shelf">
      <div className="row">
        <h3 style={{ margin: 0 }}>Documents</h3>
        <span className="muted mono">{held} of {documents.data.length}</span>
      </div>

      {GROUPS.map((group) => (
        <div key={group.id} className="shelf-group">
          <span className="label">{group.label}</span>
          <div className="shelf-tiles">
            {documents.data.filter((document) => document.group === group.id).map((doc) => {
              const Icon = ICONS[doc.slot] ?? FileText;
              const url = doc.figmaUrl;
              const native = isNative(doc.slot);
              const records = nativeRecords(doc.slot);
              const linked = filled(doc);
              const isOpen = open === doc.slot;
              const isLinking = linking === doc.slot;
              const panelId = `shelf-panel-${clientId}-${doc.slot}`;
              return (
                <Fragment key={doc.slot}>
                  <button type="button"
                    className={`shelf-tile${linked ? ' linked' : ' empty'}${isOpen || isLinking ? ' open' : ''}`}
                    aria-expanded={linked ? isOpen : isLinking}
                    aria-controls={isOpen || isLinking ? panelId : undefined}
                    disabled={!linked && !editable}
                    onClick={() => press(doc)}>
                    <Icon className="shelf-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                    <span className="shelf-label">{doc.label}</span>
                    <span className="shelf-meta">
                      {native
                        ? linked
                          ? `${records.length} ${doc.slot}${records.length === 1 ? '' : 's'} in EDSAI`
                          : editable ? `No ${doc.slot}s yet — press to create` : 'Not ready yet'
                        : linked
                          ? `${doc.pageCount ?? 0} frame${doc.pageCount === 1 ? '' : 's'} · ${when(doc.updatedAt)}${doc.note ? ` · ${doc.note}` : ''}`
                          : editable ? 'Not linked — press to add' : 'Not ready yet'}
                    </span>
                  </button>

                  {isOpen && native && (
                    <div className="shelf-viewer stack" id={panelId}>
                      <div className="row">
                        <strong>{doc.label}</strong>
                        <span className="muted">Created and managed in EDSAI</span>
                        <button type="button" className="overflow-button row" style={{ marginLeft: 'auto' }}
                                aria-label={`Close ${doc.label}`} onClick={() => setOpen(undefined)}>
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="stack" style={{ gap: 8 }}>
                        {records.map((record) => {
                          const contract = doc.slot === 'contract' ? record as Contract : undefined;
                          const invoice = doc.slot === 'invoice' ? record as Invoice : undefined;
                          const href = contract ? api.contractDocumentUrl(contract.id) : api.invoiceDocumentUrl(record.id);
                          return (
                            <a key={record.id} className="card row" href={href} target="_blank" rel="noreferrer">
                              <FileText size={16} aria-hidden="true" />
                              <span><strong>{contract?.title ?? invoice?.description}</strong><br />
                                <span className="muted">{contract?.number ?? invoice?.number} · {record.status}</span>
                              </span>
                              <ExternalLink size={15} aria-hidden="true" style={{ marginLeft: 'auto' }} />
                            </a>
                          );
                        })}
                      </div>
                      {editable && <a className="link" href={clientHref(clientId, 'contracts')}>Manage contracts &amp; invoices</a>}
                    </div>
                  )}

                  {isOpen && !native && url && (
                    <div className="shelf-viewer" id={panelId}>
                      <div className="row">
                        <strong>{doc.label}</strong>
                        {doc.note && <span className="muted">{doc.note}</span>}
                        <span style={{ marginLeft: 'auto' }} className="row">
                          {editable && (
                            <OverflowMenu label={`Actions for ${doc.label}`} items={[
                              { label: 'Change link', icon: Link2,
                                onSelect: () => { setLinking(doc.slot); setOpen(undefined); } },
                              { label: 'Open in Figma', icon: ExternalLink,
                                onSelect: () => { window.open(url, '_blank', 'noopener'); } },
                              { label: 'Remove from shelf', icon: Trash2, danger: true, disabled: clear.isPending,
                                onSelect: () => {
                                  void requestConfirmation({
                                    title: `Remove ${doc.label}?`,
                                    message: 'This clears the linked document and its saved frame list from the shelf.',
                                    confirmLabel: 'Remove link',
                                  }).then((confirmed) => { if (confirmed) clear.mutate(doc.slot); });
                                } },
                            ]} />
                          )}
                          <button type="button" className="overflow-button row" aria-label={`Close ${doc.label}`}
                                  onClick={() => setOpen(undefined)}>
                            <X size={16} aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                      {(doc.pages?.length ?? 0) > 0 ? (
                        <PresentationViewer sourceUrl={url} pages={doc.pages ?? []}
                                            title={doc.label} fileHref={url} />
                      ) : (
                        <div className="empty-state compact stack">
                          <strong>This legacy link has no frame list.</strong>
                          <span className="muted">Relink it once to discover its Figma frames and use Previous/Next navigation.</span>
                          {editable && <button type="button"
                            onClick={() => { setLinking(doc.slot); setOpen(undefined); }}>Relink document</button>}
                        </div>
                      )}
                    </div>
                  )}

                  {isLinking && editable && !native && (
                    <div id={panelId}>
                      <LinkForm clientId={clientId} doc={doc} onDone={() => setLinking(undefined)} />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
