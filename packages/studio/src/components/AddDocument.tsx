import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import {
  api,
  DOCUMENT_TYPES,
  type DocumentEntryInput,
  type DocumentPage,
  type DocumentStatus,
  type DocumentViewMode,
} from '../api.js';
import { figmaUrlProblem, pageUrl } from '../figmaLinks.js';
import FigmaFrames from './FigmaFrames.js';
import { useFigmaDiscovery } from '../figmaDiscovery.js';

/**
 * Adding a document to a client's library.
 *
 * **Upload or Figma, and the form changes shape around the answer.** The brief
 * says a document can arrive either way, and pretending they are the same is how
 * you end up with a form offering "paste a Figma link" to somebody who has a
 * PDF in their Downloads folder. Choosing the source first means the rest of the
 * form is only ever asking questions that apply to what was chosen.
 *
 * **A deck's pages are read out of the file, not typed off the canvas.** EDSAI
 * asks Figma what frames a file has and in what order, and the designer ticks
 * the ones that are the document. This is the single change that makes the
 * presentation viewer possible without a human transcribing a `node-id` per
 * slide: the manifest is a record of a decision rather than a transcription, so
 * it can be merged against the file later instead of being right once and then
 * quietly going stale.
 *
 * **It reads on paste, not on save.** A designer who pastes a link and waits
 * should see the frames, not a Save button that might be about to work or might
 * not. The read happens when the field loses focus with something that looks
 * like a Figma link in it — a keystroke is not a decision, a field the designer
 * has finished with is.
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
export function movePage<T>(pages: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages;
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/**
 * A manifest as the API wants it.
 *
 * **The document id and the order numbers are dropped, and previews are kept.**
 * The server renumbers the order and knows which document the pages belong to —
 * it was just told — so sending either is redundant, and sending a `documentId`
 * left over from another document is actively wrong. Figma's preview URLs go the
 * other way and are kept: they are the only pictures the page overview has on the
 * first open, they are replaced on every refresh, and a stale one is an image
 * that fails rather than a frame that fails.
 */
export function manifestOf(pages: readonly DocumentPage[]): NonNullable<DocumentEntryInput['pages']> {
  return pages.map((page) => ({
    name: page.name.trim(),
    ...(page.nodeId ? { nodeId: page.nodeId } : {}),
    ...(page.included === false ? { included: false } : {}),
    ...(page.width && page.height ? { width: page.width, height: page.height } : {}),
    ...(page.thumbnailUrl ? { thumbnailUrl: page.thumbnailUrl } : {}),
  }));
}

/** Pages the API will accept: every one has a name, and a name is required. */
export function namedPages(pages: readonly DocumentPage[]): DocumentPage[] {
  return pages.filter((page) => page.name.trim().length > 0);
}

export default function AddDocument({ clientId, onDone }: {
  clientId: string;
  onDone: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const figma = useFigmaDiscovery();
  const [source, setSource] = useState<'upload' | 'figma'>('upload');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState<string>('reference');
  const [viewMode, setViewMode] = useState<DocumentViewMode>('document');
  const [status, setStatus] = useState<DocumentStatus>('ready');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState<DocumentPage[]>([]);

  const urlProblem = source === 'figma' ? figmaUrlProblem(url) : undefined;
  // A deck's manifest is only worth asking for once the source can hold one, so
  // switching from Figma to upload clears it rather than leaving dead state.
  const manifestWanted = source === 'figma' && viewMode === 'presentation';
  const titleOk = title.trim().length > 0;
  // An unnamed page is refused by the API rather than quietly saved as "", so it
  // is refused here where the designer can see which one it is.
  const unnamed = manifestWanted && pages.some((page) => page.name.trim().length === 0);
  const canSave = titleOk && !unnamed && (source === 'figma' ? !urlProblem : file !== undefined);

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
        ...(manifestWanted && pages.length > 0 ? { pages: manifestOf(namedPages(pages)) } : {}),
      };
      await api.createDocumentEntry(clientId, input);
      void queryClient.invalidateQueries({ queryKey: ['document-entries', clientId] });
    },
    onSuccess: onDone,
  });

  /**
   * Read a link into a manifest.
   *
   * **The URL that was read is the URL that is saved.** A designer who pastes a
   * link to one Figma page, gets the frames of that page, and is saved against
   * the whole file would find their deck mysteriously missing half of itself on
   * the next refresh — so the reading's own `canvasId` is put back onto the
   * link, which is a link to the same file that names the page it came from.
   */
  const read = async (link: string): Promise<void> => {
    const reading = await figma.read(link);
    if (!reading) return;
    setPages(reading.pages);
    setUrl(reading.canvasId ? pageUrl(link, { nodeId: reading.canvasId }) : link);
  };

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
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.figma.com/design/…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={url.trim() !== '' && urlProblem !== undefined}
            // On losing focus, not on every keystroke: a read is a round trip to
            // Figma, and a designer halfway through pasting a link should not
            // spend five of them.
            onBlur={() => {
              const pasted = url.trim();
              if (manifestWanted && !urlProblem && pasted && figmaUrlProblem(pasted) === undefined) {
                void read(pasted);
              }
            }}
          />
          <span className={url.trim() !== '' && urlProblem ? 'err' : 'muted'} style={{ fontSize: 12 }}>
            {urlProblem ?? 'Shown here and in the client’s portal. Nobody is sent to Figma.'}
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
            {DOCUMENT_TYPES.filter((type) => type !== 'contract' && type !== 'invoice')
              .map((type) => <option key={type} value={type}>{type}</option>)}
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
        <FigmaFrames
          frames={pages}
          onChange={setPages}
          discovery={figma}
          onRead={(link) => void read(link)}
          fileName={figma.state.reading?.fileName}
          onAddManual={() => setPages((p) => [...p, {
            documentId: '', order: p.length + 1, name: '', included: true,
          }])}
          onRename={(at, name) => setPages((p) => p.map((q, j) => (j === at ? { ...q, name } : q)))}
        />
      )}

      {unnamed && (
        <p className="err">Every page needs a name. Frames read from Figma have one; a page added by hand does not until you give it one.</p>
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
