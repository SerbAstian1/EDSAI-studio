import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FileUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  api,
  DOCUMENT_TYPES,
  type DocumentEntryInput,
  type DocumentStatus,
  type DocumentViewMode,
} from '../api.js';
import { figmaUrlProblem } from '../figmaLinks.js';

/**
 * Adding a document to a client's library.
 *
 * **Upload or Figma, and the form changes shape around the answer.** The brief
 * says a document can arrive either way, and pretending they are the same is how
 * you end up with a form offering "paste a Figma link" to somebody who has a
 * PDF in their Downloads folder. Choosing the source first means the rest of the
 * form is only ever asking questions that apply to what was chosen.
 *
 * **A deck's pages are recorded, not discovered.** EDSAI holds no Figma token
 * and puts none in a browser, so the page list is something the designer reads
 * off the canvas and types in — a name and a `node-id` per page, in order. That
 * is why this form is willing to be a long form for a presentation: it is the
 * whole reason the presentation viewer can show one page at a time instead of
 * one infinite canvas. A deck added with no pages still opens as a deck, and can
 * have its pages filled in later.
 *
 * **The file is uploaded first, then the row is created pointing at it.** A row
 * that references an upload that failed is a broken document nobody can remove;
 * uploading first means the worst case is an orphan file, which the Files screen
 * already knows how to clear.
 */

const STATUSES: { id: DocumentStatus; label: string }[] = [
  { id: 'ready', label: 'Ready' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
];

const VIEW_MODES: { id: DocumentViewMode; label: string; detail: string }[] = [
  { id: 'document', label: 'As a document', detail: 'Scrolls. For a proposal, guidelines or a contract.' },
  { id: 'presentation', label: 'As a presentation', detail: 'One page at a time. For anything you would present.' },
  { id: 'external', label: 'As a link', detail: 'Opens outside EDSAI. For anything else.' },
];

/** A `node-id` is digits-dash-digits, and nothing else. */
const NODE_ID = /^\d+-\d+$/;

/** Move one page within the manifest, and refuse to move it off either end. */
export function movePage(pages: { name: string; nodeId?: string }[], from: number, to: number):
{ name: string; nodeId?: string }[] {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages;
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export default function AddDocument({ clientId, onDone }: {
  clientId: string;
  onDone: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<'upload' | 'figma'>('upload');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState<string>('reference');
  const [viewMode, setViewMode] = useState<DocumentViewMode>('document');
  const [status, setStatus] = useState<DocumentStatus>('ready');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState<{ name: string; nodeId?: string }[]>([]);

  const urlProblem = source === 'figma' ? figmaUrlProblem(url) : undefined;
  // A deck's manifest is only worth asking for once the source can hold one, so
  // switching from Figma to upload clears it rather than leaving dead state.
  const manifestWanted = source === 'figma' && viewMode === 'presentation';
  const titleOk = title.trim().length > 0;
  const canSave = titleOk && (source === 'figma' ? !urlProblem : file !== undefined);

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      let assetId: string | undefined;
      if (source === 'upload') {
        if (!file) return;
        // Into a collection of its own, so the Files screen can tell a
        // document from a brand asset without a database join.
        const asset = await api.uploadAsset(clientId, file, { collection: 'documents' });
        assetId = asset.id;
      }
      const input: DocumentEntryInput = {
        title: title.trim(),
        documentType,
        source,
        viewMode,
        status,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assetId ? { assetId } : {}),
        ...(source === 'figma' ? { sourceUrl: url.trim() } : {}),
        ...(manifestWanted && pages.length > 0 ? { pages } : {}),
      };
      await api.createDocumentEntry(clientId, input);
      void queryClient.invalidateQueries({ queryKey: ['document-entries', clientId] });
    },
    onSuccess: onDone,
  });

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
      <span className="label">Add a document</span>

      <fieldset className="dna-group">
        <legend className="label">Where is it?</legend>
        <div className="dna-row">
          <label className="choice dna-chip">
            <input type="radio" name="doc-source" checked={source === 'upload'}
                   onChange={() => { setSource('upload'); setViewMode('document'); setPages([]); }} />
            <span className="row"><FileUp size={13} aria-hidden="true" /> A file I have</span>
          </label>
          <label className="choice dna-chip">
            <input type="radio" name="doc-source" checked={source === 'figma'}
                   onChange={() => { setSource('figma'); }} />
            <span className="row">A Figma link</span>
          </label>
        </div>
      </fieldset>

      {source === 'upload' ? (
        <label className="field">
          <span className="label">The file</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0])} />
          <span className="muted" style={{ fontSize: 12 }}>
            A PDF, an image, or anything else — the second kind is offered as a download rather than
            previewed.
          </span>
        </label>
      ) : (
        <label className="field">
          <span className="label">Figma link</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/design/…"
                 aria-invalid={url.trim() !== '' && urlProblem !== undefined} />
          <span className={url.trim() !== '' && urlProblem ? 'err' : 'muted'} style={{ fontSize: 12 }}>
            {urlProblem ?? 'Previewed here and in the client’s portal. Nobody is sent to Figma.'}
          </span>
        </label>
      )}

      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '2 1 220px' }}>
          <span className="label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brand guidelines, v3" />
        </label>
        <label className="field" style={{ flex: '1 1 130px' }}>
          <span className="label">Kind</span>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 130px' }}>
          <span className="label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus)}>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="label">Note (optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="For the launch, supersedes v2" />
      </label>

      <fieldset className="dna-group">
        <legend className="label">How should it be read?</legend>
        <div className="dna-row">
          {VIEW_MODES
            .filter((m) => m.id !== 'presentation' || source === 'figma')
            .map((m) => (
              <label key={m.id} className={`choice dna-chip${viewMode === m.id ? ' on' : ''}`}>
                <input type="radio" name="doc-view" checked={viewMode === m.id}
                       onChange={() => { setViewMode(m.id); if (m.id !== 'presentation') setPages([]); }} />
                <span><strong>{m.label}</strong><span className="why">{m.detail}</span></span>
              </label>
            ))}
        </div>
      </fieldset>

      {manifestWanted && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="label">Pages, in order</span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              The frame id is the last part of the frame’s Figma link.
            </span>
          </div>
          {pages.length === 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              No pages yet. A deck with no pages opens the file whole, and the client can be sent to
              the same Figma link — add the pages to page through it here.
            </p>
          )}
          {pages.map((p, i) => (
            <div key={i} className="row preset-row">
              <GripVertical size={14} className="muted" aria-hidden="true" />
              <span className="mono muted" style={{ minWidth: 22 }}>{String(i + 1).padStart(2, '0')}</span>
              <input
                value={p.name}
                aria-label={`Name of page ${i + 1}`}
                placeholder="Cover"
                onChange={(e) => setPages(pages.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))}
              />
              <input
                className="mono"
                value={p.nodeId ?? ''}
                aria-label={`Figma frame id of page ${i + 1}`}
                placeholder="1-2"
                aria-invalid={(p.nodeId ?? '') !== '' && !NODE_ID.test(p.nodeId ?? '')}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setPages(pages.map((q, j) => {
                    if (j !== i) return q;
                    const { nodeId: _dropped, ...rest } = q;
                    return { ...rest, ...(NODE_ID.test(v) ? { nodeId: v } : {}) };
                  }));
                }}
              />
              <button type="button" className="overflow-button row" aria-label={`Move ${p.name || `page ${i + 1}`} up`}
                      disabled={i === 0} onClick={() => setPages(movePage(pages, i, i - 1))}>
                <ArrowUp size={14} aria-hidden="true" />
              </button>
              <button type="button" className="overflow-button row" aria-label={`Move ${p.name || `page ${i + 1}`} down`}
                      disabled={i === pages.length - 1} onClick={() => setPages(movePage(pages, i, i + 1))}>
                <ArrowDown size={14} aria-hidden="true" />
              </button>
              <button type="button" className="overflow-button row" aria-label={`Remove ${p.name || `page ${i + 1}`}`}
                      onClick={() => setPages(pages.filter((_, j) => j !== i))}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setPages([...pages, { name: '' }])}>
            <Plus size={14} aria-hidden="true" /> Add a page
          </button>
        </div>
      )}

      {save.error && <p className="err">{(save.error as Error).message}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={!canSave || save.isPending}>
          {save.isPending ? 'Adding…' : 'Add document'}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
