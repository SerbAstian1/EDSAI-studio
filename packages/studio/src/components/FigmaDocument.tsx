import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Frame as FrameIcon, Save, X } from 'lucide-react';
import {
  api, figmaFailureOf, type DocumentEntry, type DocumentPage, type FrameChanges,
} from '../api.js';
import FigmaFrames from './FigmaFrames.js';
import PresentationViewer from './PresentationViewer.js';
import { adviseFailure } from '../figmaDiscovery.js';
import { orderedPages, readablePages } from '../presentation.js';
import { manifestOf } from './AddDocument.js';

/**
 * A Figma document that already exists, and the frames it is made of.
 *
 * **This is where the designer's decisions about a deck are actually kept.**
 * `AddDocument` records the first choice of frames; this is the screen somebody
 * comes back to when the file has moved on — a slide was added, a section was
 * dropped, one frame got renamed. The panel is the same component the form used,
 * on purpose: a list of frames should not have two editors.
 *
 * **Refresh is a merge, and it says what it did.** A deck that has been presented
 * is not a draft; silently renumbering it because a designer added a frame
 * halfway up the Figma page would be the worst thing this feature could do. So
 * the server keeps the manifest's order and its exclusions, drops only the frames
 * Figma can no longer serve, and reports the differences here — a designer who
 * expected five new slides should be told when they arrive rather than finding
 * out from a counter, and one who has lost a frame should not have to notice.
 *
 * **Edits are held until they are saved.** The panel edits a list; the Save button
 * is explicit; leaving without saving says so rather than quietly discarding.
 */
export default function FigmaDocument({ entry, pages, onClose }: {
  entry: DocumentEntry;
  pages: readonly DocumentPage[];
  onClose?: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DocumentPage[]>(() => orderedPages(pages));
  const [saved, setSaved] = useState<DocumentPage[]>(() => orderedPages(pages));
  const [changes, setChanges] = useState<FrameChanges | null>(null);
  const [refreshError, setRefreshError] = useState<{ title: string; detail: string } | null>(null);

  // The server is the record. When it sends a different manifest — a refresh
  // that merged, a save that renumbered — the draft follows it rather than
  // keeping a list the panel can no longer save back without conflicts.
  useEffect(() => { setDraft(orderedPages(pages)); setSaved(orderedPages(pages)); }, [pages]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['document-entry', entry.id] });
  };

  /**
   * Whether the panel is holding edits the server has not been told about.
   *
   * Compared as manifests rather than as page objects because the panel reorders
   * and re-lists constantly — a re-render that produced an equal-but-new array
   * would otherwise make every untouched document look unsaved.
   */
  const dirty = JSON.stringify(manifestOf(draft)) !== JSON.stringify(manifestOf(saved));

  /**
   * A page still being named, so it cannot be saved yet.
   *
   * Checked here rather than left to the server so the Save button is honest
   * about what it will do. A name that is only whitespace is the same thing as
   * no name, and a page with neither cannot be saved at all — so the button
   * stays disabled and says which page is the problem, instead of turning a
   * click into a 400.
   */
  const unnamed = draft.findIndex((page) => !page.nodeId && page.name.trim() === '');
  const canSave = dirty && unnamed < 0;

  const save = useMutation({
    mutationFn: () => api.saveDocumentPages(entry.id, manifestOf(draft)),
    onSuccess: (result) => {
      setSaved(orderedPages(result.pages));
      setChanges(null);
      invalidate();
    },
  });

  const refresh = useMutation({
    mutationFn: () => api.refreshDocumentFrames(entry.id),
    onSuccess: (result) => {
      setChanges(result.changes);
      setRefreshError(null);
      invalidate();
    },
    onError: (error: unknown) => {
      const advice = adviseFailure(figmaFailureOf(error));
      setRefreshError({ title: advice.title, detail: advice.detail });
    },
  });

  const excluded = orderedPages(saved).length - readablePages(saved).length;

  return (
    <div className={`figma-doc${open ? ' figma-doc-frames' : ''}`}>
      <PresentationViewer
        sourceUrl={entry.sourceUrl ?? ''}
        pages={saved}
        title={entry.title}
        {...(entry.sourceUrl ? { fileHref: entry.sourceUrl } : {})}
        {...(onClose ? { onClose } : {})}
      />

      {/*
        The frames panel is a sibling of the deck rather than a control inside
        it: the deck's toolbar is the reader's, and a designer editing a manifest
        should not be reshuffling the thing being presented to find the button.
      */}
      <div className="figma-doc-frames-bar">
        <button
          type="button"
          className="overflow-button row"
          aria-expanded={open}
          aria-controls="figma-doc-frames-panel"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={14} aria-hidden="true" /> : <FrameIcon size={14} aria-hidden="true" />}
          {open ? 'Close frames' : 'Frames'}
        </button>
        <span className="muted">
          {readablePages(saved).length} of {orderedPages(saved).length} in the deck
          {excluded > 0 ? ` · ${excluded} left out` : ''}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        {unnamed >= 0 && (
          <span className="figma-doc-unsaved" role="status">
            Name the page at position {unnamed + 1} to save
          </span>
        )}
        {dirty && unnamed < 0 && <span className="figma-doc-unsaved">Unsaved</span>}
        <button
          type="button"
          className="button button-quiet"
          disabled={!canSave || save.isPending}
          onClick={() => save.mutate()}
        >
          <Save size={14} strokeWidth={1.75} aria-hidden="true" />
          {save.isPending ? 'Saving…' : 'Save frames'}
        </button>
      </div>

      {open && (
        <div className="figma-doc-frames-panel" id="figma-doc-frames-panel">
          {/*
            A refresh is a server-side merge, so this panel is given the saved
            manifest and an action rather than a link to paste — the document
            already knows which file it is, and asking again would be asking for
            the one thing that can go wrong in a refresh.
          */}
          <FigmaFrames
            frames={draft}
            onChange={setDraft}
            fileName={entry.title}
            totalInFile={orderedPages(saved).length}
            onRefresh={() => refresh.mutate()}
            refreshing={refresh.isPending}
            onAddManual={() => setDraft((p) => [...p, {
              documentId: entry.id, order: p.length + 1, name: '', included: true,
            }])}
            onRename={(at, name) => setDraft((p) => p.map((q, j) => (j === at ? { ...q, name } : q)))}
          />
        </div>
      )}

      {changes && (changes.added.length > 0 || changes.removed.length > 0 || changes.renamed.length > 0) && (
        <div className="figma-doc-changes" role="status">
          <p>
            <strong>Refreshed from Figma.</strong>{' '}
            {changes.added.length > 0 && `${changes.added.length} added. `}
            {changes.removed.length > 0 && `${changes.removed.length} dropped — no longer in the file. `}
            {changes.renamed.length > 0
              && `Renamed: ${changes.renamed.map((c) => `“${c.from}” is now “${c.to}”`).join(', ')}.`}
          </p>
          <button type="button" className="link-button" onClick={() => setChanges(null)}>Dismiss</button>
        </div>
      )}

      {refreshError && (
        <div className="figma-doc-changes err" role="status">
          <p><strong>{refreshError.title}</strong> {refreshError.detail}</p>
          <button type="button" className="link-button" onClick={() => setRefreshError(null)}>Dismiss</button>
        </div>
      )}

      {save.error && <p className="err">{(save.error as Error).message}</p>}
    </div>
  );
}
