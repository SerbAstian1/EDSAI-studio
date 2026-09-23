import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Compass, ExternalLink, FileSignature, FileText, Link2, Presentation,
  Receipt, Sparkles, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { api, type ClientDocument } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';
import { ErrorPanel } from './ErrorPanel.js';
import FigmaEmbed, { isFigmaUrl } from './FigmaEmbed.js';
import OverflowMenu from './OverflowMenu.js';

/**
 * The shelf: eight documents every engagement has, as eight large buttons.
 *
 * Three on the commercial side — proposal, contract, invoice — and five on
 * the brand side, from the strategy through the two speed-run presentations
 * to the final presentation and the guidelines. The same shelf in the same
 * order for every client, so "the contract" is always the second tile.
 *
 * Pressing a tile opens the document *here*, in a Figma frame under the
 * shelf, rather than sending anyone to Figma. One document is open at a
 * time; pressing its tile again, or the ×, closes it.
 *
 * The studio sees every tile and can link, relink or clear one. A client
 * sees the same shelf with the empty tiles greyed out and unpressable —
 * the shape of what is coming, not a list that grows without warning.
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
    <form className="shelf-form stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="field">
        <span className="label">Figma link for {doc.label}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus
               placeholder="https://www.figma.com/design/…" aria-invalid={url.trim() !== '' && !ok} />
        <span className={url.trim() && !ok ? 'err' : 'muted'} style={{ fontSize: 12 }}>
          {url.trim() && !ok
            ? 'Only figma.com links can be previewed.'
            : 'Previews here and in the client’s portal. Nobody is sent to Figma.'}
        </span>
      </label>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="v2, after the March review" />
      </label>
      {save.error && <p className="err">{(save.error as Error).message}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={!ok || save.isPending}>
          {save.isPending ? 'Saving…' : doc.figmaUrl ? 'Update link' : 'Link document'}
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
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['documents', clientId], queryFn: () => api.documents(clientId),
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

  if (isPending) return <p className="muted">Loading documents…</p>;
  if (error) {
    return <ErrorPanel title="Could not load documents" error={error} onRetry={() => { void refetch(); }} />;
  }

  const held = data.filter((d) => d.figmaUrl).length;
  const current = data.find((d) => d.slot === open);
  const editing = data.find((d) => d.slot === linking);

  const press = (doc: ClientDocument): void => {
    if (!doc.figmaUrl) {
      if (editable) { setLinking(doc.slot); setOpen(undefined); }
      return;
    }
    setLinking(undefined);
    setOpen((o) => (o === doc.slot ? undefined : doc.slot));
  };

  return (
    <section className="stack shelf">
      <div className="row">
        <h3 style={{ margin: 0 }}>Documents</h3>
        <span className="muted mono">{held} of {data.length}</span>
      </div>

      {GROUPS.map((group) => (
        <div key={group.id} className="shelf-group">
          <span className="label">{group.label}</span>
          <div className="shelf-tiles">
            {data.filter((d) => d.group === group.id).map((doc) => {
              const Icon = ICONS[doc.slot] ?? FileText;
              const linked = Boolean(doc.figmaUrl);
              const isOpen = open === doc.slot;
              return (
                <button
                  key={doc.slot}
                  type="button"
                  className={`shelf-tile${linked ? ' linked' : ' empty'}${isOpen ? ' open' : ''}`}
                  aria-pressed={isOpen}
                  disabled={!linked && !editable}
                  onClick={() => press(doc)}
                >
                  <Icon className="shelf-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                  <span className="shelf-label">{doc.label}</span>
                  <span className="shelf-meta">
                    {linked
                      ? `Figma · ${when(doc.updatedAt)}${doc.note ? ` · ${doc.note}` : ''}`
                      : editable ? 'Not linked — press to add' : 'Not ready yet'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {editable && editing && (
        <LinkForm clientId={clientId} doc={editing} onDone={() => setLinking(undefined)} />
      )}

      {current?.figmaUrl && (
        <div className="shelf-viewer">
          <div className="row">
            <strong>{current.label}</strong>
            {current.note && <span className="muted">{current.note}</span>}
            <span style={{ marginLeft: 'auto' }} className="row">
              {editable && (
                <OverflowMenu label={`Actions for ${current.label}`} items={[
                  { label: 'Change link', icon: Link2, onSelect: () => { setLinking(current.slot); setOpen(undefined); } },
                  { label: 'Open in Figma', icon: ExternalLink,
                    onSelect: () => { window.open(current.figmaUrl, '_blank', 'noopener'); } },
                  { label: 'Remove from shelf', icon: Trash2, danger: true, disabled: clear.isPending,
                    onSelect: () => {
                      void requestConfirmation({
                        title: `Remove ${current.label}?`,
                        message: 'This clears the linked document from the shelf. You can add it again later.',
                        confirmLabel: 'Remove link',
                      }).then((confirmed) => { if (confirmed) clear.mutate(current.slot); });
                    } },
                ]} />
              )}
              <button type="button" className="overflow-button row" aria-label="Close preview"
                      onClick={() => setOpen(undefined)}>
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
          <FigmaEmbed url={current.figmaUrl} title={current.label} />
        </div>
      )}
    </section>
  );
}
