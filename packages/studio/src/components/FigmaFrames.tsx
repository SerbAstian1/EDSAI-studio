import { useState, type ReactElement } from 'react';
import {
  ArrowDown, ArrowUp, EyeOff, Frame as FrameIcon, Loader2, Plus, RefreshCw, Undo2,
} from 'lucide-react';
import type { DocumentPage } from '../api.js';
import { frameRatio, orderedPages, readablePages } from '../presentation.js';
import { adviseFailure, type FigmaDiscovery } from '../figmaDiscovery.js';
import { isFigmaUrl } from '../figmaLinks.js';

/**
 * The frames of a Figma file, chosen.
 *
 * **This panel is the replacement for Figma's canvas, and it is the reason the
 * rest of the viewer is simple.** A designer opens their file, EDSAI asks Figma
 * what is in it, and the designer ticks what belongs in the document. Everything
 * downstream — the page counter, the fit maths, the thumbnails — reads the list
 * this panel produces and nothing else, so a file with thirty frames and a
 * presentation with six behave identically from here on.
 *
 * Three rules, all of them about not losing a designer's work:
 *
 *  - **Excluded frames are kept, not deleted.** `included: false` is a decision
 *    about this document, not an opinion about Figma, and a designer who changes
 *    their mind gets their frame back in the position it was in. Deleting it
 *    would also mean the panel and the file could no longer be reconciled.
 *  - **Order is explicit and always renumbered.** `order` is expressed by
 *    position, so moving a frame up and down is the whole reordering feature —
 *    no drag, no hidden sort, and the same result on a keyboard and a trackpad.
 *  - **Nothing is saved by this panel.** It edits a list and hands it up. A
 *    document that has never been saved and one that is mid-edit are the same
 *    situation, and a panel with its own save button is how a half-finished edit
 *    becomes a half-finished document.
 */

/**
 * A Figma preview, or the shape of one.
 *
 * **Figma's preview URLs are signed and short-lived, so this will fail
 * eventually.** When it does the frame keeps its box — the aspect ratio is the
 * frame's, not the image's — and shows a frame icon instead. Losing a thumbnail
 * is a small cosmetic loss; losing the row, or a broken-image glyph in its
 * place, would read as "this frame is gone", which is exactly the wrong thing to
 * suggest about a frame that is very much there.
 */
function Thumb({ src, ratio }: { src: string; ratio?: number }): ReactElement {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="figma-frame-thumb-blank">
        <FrameIcon size={16} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      style={ratio ? { aspectRatio: `${ratio}` } : undefined}
      onError={() => setBroken(true)}
    />
  );
}

export interface FigmaFramesProps {
  /** The manifest being edited. The panel never renames a frame on its own. */
  frames: DocumentPage[];
  onChange: (frames: DocumentPage[]) => void;
  /** Where the reading came from, for the caption under the header. */
  fileName?: string | undefined;
  /** How many frames are in the file that are not in this deck. */
  totalInFile?: number;
  /**
   * Discovery, when the panel is the one that reads the file.
   *
   * Optional so the same list can be rendered from a manifest that came with the
   * document — in which case there is nothing to read, and the header offers a
   * refresh instead of a link.
   */
  discovery?: FigmaDiscovery;
  /** Read a pasted link. Ignored without a `discovery`. */
  onRead?: (url: string) => void;
  /** Re-read a document that already exists. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Disable every control, for a document that is not a Figma file. */
  readOnly?: boolean;
  /**
   * Append a page with no Figma frame behind it.
   *
   * **The escape hatch, and it is not a fallback that only appears on failure.**
   * A studio with no Figma app set up still has to be able to hold a deck, and a
   * designer working in Figma's own UI can name a page that is not in the file
   * yet. A hand-made page has no `node-id`, which the viewer already treats as
   * "show the file as a whole" — so it is a real, if plain, page rather than a
   * broken one.
   */
  onAddManual?: () => void;
  /** Rename a page at a position. Frames are named by Figma and are not editable. */
  onRename?: (at: number, name: string) => void;
}

export default function FigmaFrames({
  frames, onChange, fileName, totalInFile, discovery, onRead, onRefresh, refreshing, readOnly,
  onAddManual, onRename,
}: FigmaFramesProps): ReactElement {
  const [url, setUrl] = useState('');
  const ordered = orderedPages(frames);
  const inDeck = readablePages(frames).length;

  const emit = (next: DocumentPage[]) => onChange(next.map((page, at) => ({ ...page, order: at + 1 })));

  const move = (at: number, by: -1 | 1) => {
    const to = at + by;
    if (to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    const [taken] = next.splice(at, 1);
    if (taken) next.splice(to, 0, taken);
    emit(next);
  };

  /**
   * Toggle one row, by position.
   *
   * **By index and not by node id**, because a manually added page has no node
   * id at all: matching on `nodeId === ''` matches *every* hand-added page at
   * once, so unticking one of them silently unticks all of them. Two pages that
   * share a missing identity are still two rows in a list, and a list addresses
   * its rows by position.
   */
  const include = (at: number, wanted: boolean) => {
    emit(ordered.map((page, index) => (index === at ? { ...page, included: wanted } : page)));
  };

  const setAll = (wanted: boolean) => {
    emit(ordered.map((page) => ({ ...page, included: wanted })));
  };

  const failure = discovery?.state.failure ?? null;
  const advice = failure ? adviseFailure(failure) : null;
  const reading = discovery && discovery.state.phase === 'reading';
  const canRead = Boolean(discovery && onRead) && !readOnly;

  return (
    <section className="figma-frames" aria-label="Figma frames">
      <header className="figma-frames-header">
        <div className="figma-frames-heading">
          <h3><FrameIcon size={14} strokeWidth={1.75} aria-hidden="true" /> Figma frames</h3>
          {ordered.length > 0 && (
            <p className="figma-frames-count">
              {fileName ? `${fileName} · ` : ''}
              {ordered.length === 1 ? '1 frame' : `${ordered.length} frames`}
              {totalInFile !== undefined && totalInFile > ordered.length ? ` · ${inDeck} in this deck` : ''}
            </p>
          )}
        </div>
        {ordered.length > 0 && !readOnly && (
          <div className="figma-frames-bulk">
            <button type="button" onClick={() => setAll(true)} disabled={inDeck === ordered.length}>
              All
            </button>
            <button type="button" onClick={() => setAll(false)} disabled={inDeck === 0}>
              None
            </button>
          </div>
        )}
      </header>

      {canRead && (
        <form
          className="figma-frames-read"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim() && isFigmaUrl(url.trim())) onRead?.(url.trim());
          }}
        >
          <label className="sr-only" htmlFor="figma-frames-url">Figma file link</label>
          <input
            id="figma-frames-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a Figma file link…"
            spellCheck={false}
            autoComplete="off"
            disabled={reading}
          />
          <button type="submit" className="button button-quiet" disabled={reading || !isFigmaUrl(url.trim())}>
            {reading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
            Read
          </button>
        </form>
      )}

      {onRefresh && !readOnly && (
        <div className="figma-frames-refresh">
          <button type="button" className="button button-quiet" onClick={onRefresh} disabled={refreshing}>
            {refreshing
              ? <Loader2 size={14} className="spin" aria-hidden="true" />
              : <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />}
            {refreshing ? 'Reading the file again…' : 'Refresh from Figma'}
          </button>
          <p className="figma-frames-refresh-note">
            Keeps the order and the choices here; only adds what Figma gained and says
            what changed.
          </p>
        </div>
      )}

      {discovery?.status && !discovery.status.connected && (
        <p className="figma-frames-note">
          Figma is not connected, so no file can be read yet.{' '}
          {discovery.status.oauthConfigured ? (
            <button type="button" className="link-button" onClick={() => void discovery.connect()}>
              Connect Figma
            </button>
          ) : (
            'Whoever runs this server has not set a Figma app up.'
          )}
        </p>
      )}

      {advice && (
        <div className="figma-frames-failure" role="status">
          <p className="figma-frames-failure-title">
            {advice.title}
            {discovery?.state.detail ? <span className="figma-frames-failure-detail">{discovery.state.detail}</span> : null}
          </p>
          <p>{advice.detail}</p>
          <div className="figma-frames-failure-actions">
            {advice.connect && discovery?.status?.oauthConfigured && (
              <button type="button" className="button button-quiet" onClick={() => void discovery.connect()}>
                Connect Figma
              </button>
            )}
            {advice.retry && discovery && (
              // A real retry: the same link, asked for again. The alternative —
              // clearing the message — leaves a designer who was refused a link
              // they know is right, an empty panel, and nothing to click.
              discovery.state.lastUrl !== '' && (
                <button type="button" className="button button-quiet" onClick={() => void discovery.retry()}>
                  <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" /> Try again
                </button>
              )
            )}
          </div>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="figma-frames-empty">
          {canRead
            ? 'Read a Figma file and its frames appear here to choose from.'
            : 'No frames yet. A presentation is made of the top-level frames in a Figma file.'}
        </p>
      ) : (
        <ol className="figma-frames-list">
          {ordered.map((page, at) => {
            const inIt = page.included !== false;
            // Keyed by node id where there is one, by name and position where
            // there is not: two hand-added pages both keyed `frame-0` would make
            // React reuse one row's input for the other, so unticking one would
            // appear to untick whichever row happened to keep its element.
            const key = page.nodeId
              ? `frame-${page.nodeId}`
              : `frame-manual-${at}-${page.name}`;
            return (
              <li key={key} className={`figma-frame${inIt ? '' : ' excluded'}`}>
                <label className="figma-frame-tick">
                  <input
                    type="checkbox"
                    checked={inIt}
                    disabled={readOnly}
                    onChange={(event) => include(at, event.target.checked)}
                  />
                  <span className="sr-only">Include {page.name} in this document</span>
                </label>

                <div className="figma-frame-thumb" aria-hidden="true">
                  {page.thumbnailUrl && inIt
                    ? <Thumb src={page.thumbnailUrl} />
                    : <span className="figma-frame-thumb-blank">
                      {inIt ? <FrameIcon size={16} strokeWidth={1.5} /> : <EyeOff size={16} strokeWidth={1.5} />}
                    </span>}
                </div>

                <div className="figma-frame-meta">
                  {page.nodeId
                    ? <span className="figma-frame-name">{page.name}</span>
                    : (
                      <input
                        className="figma-frame-name"
                        value={page.name}
                        placeholder="Page name"
                        aria-label={`Name of page ${at + 1}`}
                        disabled={readOnly}
                        onChange={(event) => onRename?.(at, event.target.value)}
                      />
                    )}
                  <span className="figma-frame-size">
                    <span className="figma-frame-order">{String(at + 1).padStart(2, '0')}</span>
                    {page.width && page.height
                      ? `${Math.round(page.width)} × ${Math.round(page.height)}`
                      : `${frameRatio({ width: page.width, height: page.height }).toFixed(2)}:1`}
                  </span>
                </div>

                {!readOnly && (
                  <div className="figma-frame-move">
                    <button
                      type="button"
                      onClick={() => move(at, -1)}
                      disabled={at === 0}
                      title={`Move ${page.name} up`}
                    >
                      <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Move {page.name} up</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(at, 1)}
                      disabled={at === ordered.length - 1}
                      title={`Move ${page.name} down`}
                    >
                      <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Move {page.name} down</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {onAddManual && !readOnly && (
        <button type="button" className="figma-frames-manual" onClick={onAddManual}>
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Add a page by hand
        </button>
      )}
    </section>
  );
}
