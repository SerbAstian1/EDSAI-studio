import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement,
} from 'react';
import {
  ChevronLeft, ChevronRight, ExternalLink, Grid3x3, Layout, Maximize2, Minimize2, Minus, Plus,
} from 'lucide-react';
import type { DocumentPage } from '../api.js';
import FigmaEmbed from './FigmaEmbed.js';
import {
  clampIndex, fitSize, frameRatio, nextIndex, pageLabel, pageName, previousIndex, readablePages,
  scaleLabel, zoomedScale, type FitMode, type FrameSize,
} from '../presentation.js';
import { pageUrl } from '../figmaLinks.js';

/**
 * A deck, one page at a time.
 *
 * **One iframe, ever.** Not one per page, not one kept alive, not a carousel of
 * embeds with the neighbours hidden — a single mounted frame whose `node-id`
 * changes. Eighteen Figma embeds is eighteen live canvases competing for the
 * same layout and main thread, and it is why "the presentation is slow" happens;
 * one frame swapping its address is a navigation, which Figma already does well.
 *
 * The controls are the second half of that. A deck with no page indicator and no
 * bound on Next is an infinite canvas with extra steps, so the counter is always
 * visible, Next is dead on the last page rather than looping, and the index is
 * clamped to whatever the manifest says *now* — including a manifest the designer
 * has since shortened underneath a reader who is halfway through.
 *
 * **Fitting is the size of the iframe, not a transform.** Figma's embed fits its
 * node to whatever box it is handed, so "fit page" means handing it the largest
 * box of the frame's shape that fits the stage, and "100%" means a box of
 * exactly the frame's Figma pixels. There is no scaling of rendered text and so
 * nothing blurry, and the readout in the toolbar is that same ratio — the same
 * number a designer sees in Figma's own zoom bar.
 *
 * **Scrolling moves within a page; paging moves between them.** `fit-width`
 * deliberately overflows vertically, because a dense frame has to be readable
 * without leaving it. What the viewer never does is scroll from one page into
 * the next: that is the infinite canvas this replaced.
 *
 * Keyboard because a presentation is read with a keyboard in a browser: arrows
 * and Page Up/Down move, Home and End jump, F goes fullscreen, and Escape leaves
 * fullscreen, which the browser handles, and the frame is focusable so the keys
 * work once the reader has tabbed in.
 */

export interface PresentationViewerProps {
  /** The stored Figma link. Each page is this link pointed at a different frame. */
  sourceUrl: string;
  pages: readonly DocumentPage[];
  title: string;
  /** Which page to open on; 1-based, as a person counts. */
  initialPage?: number;
  /** The link to the file, for the escape hatch. Defaults to `sourceUrl`. */
  fileHref?: string;
  onClose?: () => void;
}

const FIT_LABEL: Record<FitMode, string> = {
  page: 'Fit page', width: 'Fit width', actual: '100%',
};

export default function PresentationViewer({
  sourceUrl, pages, title, initialPage = 1, fileHref, onClose,
}: PresentationViewerProps): ReactElement {
  /**
   * The deck, not the manifest.
   *
   * **Read once, here, and never re-derived.** A frame the designer excluded is
   * still a frame in the file, but it is not a page of this document, so counting
   * it would put `04 / 18` over a six-slide presentation. Everything below reads
   * this list, which is why the counter, Next, the strip and the fit maths cannot
   * disagree about how many pages there are.
   *
   * Memoized because of what depends on it: the clamp effect below keys on
   * `deck`, and a fresh array every render would make that effect fire on every
   * render too — a manifest that did not change, re-clamping a page number that
   * was already correct.
   */
  const deck = useMemo(() => readablePages(pages), [pages]);

  // Held as a 1-based page number because that is how the counter reads and how
  // a designer talks about a deck ("start on page 4"). Converted once, here.
  const [page, setPage] = useState(() => clampIndex(initialPage - 1, deck) + 1);
  const [full, setFull] = useState(false);
  const [fit, setFit] = useState<FitMode>('page');
  const [zoom, setZoom] = useState(1);
  const [overview, setOverview] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<FrameSize>({ width: 0, height: 0 });

  // A manifest that shrank while the reader was on page 14 leaves them on 14 of
  // 6 without this. The dependency on `deck` is the point, not a lint appeasement.
  useEffect(() => {
    setPage((p) => clampIndex(p - 1, deck) + 1);
  }, [deck]);

  /**
   * The space available for the frame, measured rather than guessed.
   *
   * **A ResizeObserver and not a `window` resize listener**, because the stage
   * does not change size when the window does — it changes when a sidebar
   * collapses, when the browser chrome shows and hides, and when the window is
   * dragged. Guessing the stage from the window is how a fitted frame ends up
   * 20px too wide and quietly scrollable when it should be exactly whole.
   */
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const read = () => setStageSize({ width: node.clientWidth, height: node.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const go = useCallback((to: number): void => { setPage(clampIndex(to - 1, deck) + 1); }, [deck]);
  const back = useCallback((): void => { setPage(previousIndex(deck, page - 1) + 1); }, [deck, page]);
  const forward = useCallback((): void => { setPage(nextIndex(deck, page - 1) + 1); }, [deck, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while typing: a designer naming a page in a form is not browsing a
      // deck, and the arrow keys belong to the text field.
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': forward(); break;
        case 'ArrowLeft': case 'PageUp': back(); break;
        case 'Home': go(1); break;
        case 'End': go(deck.length); break;
        case 'f': case 'F': setFull((f) => !f); break;
        case 'o': case 'O': setOverview((o) => !o); break;
        case 'Escape': if (full) setFull(false); else onClose?.(); break;
        default: return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back, forward, go, deck.length, full, onClose]);

  const current = deck[clampIndex(page - 1, deck)];
  const href = pageUrl(sourceUrl, current);
  const name = pageName(deck, page - 1);
  const label = pageLabel(deck, page - 1);
  // Before the stage has been measured there is nothing to fit into, so the
  // first paint is a `100%` frame rather than a divide-by-zero-sized one.
  const own: FrameSize = { width: current?.width ?? 0, height: current?.height ?? 0 };
  const drawn = stageSize.width > 0
    ? fitSize(fit, own, stageSize)
    : own.width > 0 ? own : { width: 0, height: 0 };
  // Zoom only means anything on top of a fitted frame, and only when the frame
  // has a real pixel size to be a percentage of.
  const size = zoom === 1 || own.width === 0
    ? drawn
    : { width: Math.round(own.width * zoom), height: Math.round(own.height * zoom) };

  return (
    <div className={`deck${full ? ' deck-full' : ''}`} tabIndex={-1} aria-label={`${title}, page ${page}`}>
      <div className="deck-bar">
        <div className="deck-title">
          <strong>{title}</strong>
          {name && <span className="muted">{name}</span>}
        </div>
        <div className="deck-nav">
          <button type="button" className="overflow-button row" aria-label="Previous page"
                  disabled={page <= 1} onClick={back}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="deck-counter mono" aria-live="polite">{label || '—'}</span>
          <button type="button" className="overflow-button row" aria-label="Next page"
                  disabled={page >= deck.length} onClick={forward}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="row deck-tools" style={{ marginLeft: 'auto' }}>
          {deck.length > 1 && (
            <button
              type="button"
              className="overflow-button row"
              aria-pressed={overview}
              aria-label="All pages"
              title="All pages (O)"
              onClick={() => setOverview((o) => !o)}
            >
              {overview ? <Layout size={14} aria-hidden="true" /> : <Grid3x3 size={14} aria-hidden="true" />}
            </button>
          )}
          <div className="deck-zoom" role="group" aria-label="How the page is fitted">
            <button
              type="button" className="overflow-button row" aria-label="Zoom out"
              disabled={own.width === 0} onClick={() => setZoom((z) => zoomedScale(z, -1))}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            {/* The three ways a frame can be fitted, in one menu rather than two
                buttons, because "fit to page" and "100%" are the same decision
                and a third of the toolbar is not worth two more controls. */}
            <label className="deck-fit">
              <span className="sr-only">How the page is fitted</span>
              <select
                value={fit}
                onChange={(event) => { setFit(event.target.value as FitMode); setZoom(1); }}
              >
                <option value="page">{FIT_LABEL.page}</option>
                <option value="width">{FIT_LABEL.width}</option>
                <option value="actual">{FIT_LABEL.actual}</option>
              </select>
            </label>
            <button
              type="button" className="overflow-button row" aria-label="Zoom in"
              disabled={own.width === 0} onClick={() => setZoom((z) => zoomedScale(z, 1))}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <span className="deck-scale mono" aria-live="polite">
              {own.width === 0 ? '' : scaleLabel(size, own)}
            </span>
          </div>
          <a className="icon-link" href={fileHref ?? sourceUrl} target="_blank" rel="noopener noreferrer"
             title="Open the whole file in Figma">
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          <button type="button" className="overflow-button row" aria-label={full ? 'Leave fullscreen' : 'Fullscreen'}
                  onClick={() => setFull((f) => !f)}>
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* The one frame. `key` is the href so a page change is a remount rather
          than a prop the embedder might not watch, which is how a deck ends up
          showing the previous page's canvas.

          `stage` is measured here and not on `.deck` above because this is the
          box the frame is fitted into: it is what the toolbar and the overview
          strip do not occupy, and sizing against the outer box would fit every
          frame to a height the toolbar has already spent. */}
      <div className="deck-stage" ref={stage}>
        <div
          className="deck-canvas"
          style={size.width > 0 ? { width: `${size.width}px`, height: `${size.height}px` } : undefined}
        >
          <FigmaEmbed key={href} url={href} compact title={`${title} — ${name || `page ${page}`}`} />
        </div>
      </div>

      {overview && deck.length > 1 && (
        <ol className="deck-overview" aria-label="All pages">
          {deck.map((p, i) => (
            <li key={`${p.nodeId ?? 'p'}-${p.order}`}>
              <button
                type="button"
                className={i === page - 1 ? 'on' : ''}
                aria-current={i === page - 1 ? 'true' : undefined}
                onClick={() => { go(i + 1); setOverview(false); }}
              >
                <span
                  className="deck-overview-thumb"
                  style={{ aspectRatio: `${frameRatio({ width: p.width, height: p.height })}` }}
                  aria-hidden="true"
                >
                  {p.thumbnailUrl
                    ? <img
                      src={p.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      // Figma's previews are signed and expire. One going stale
                      // costs a grey rectangle in the overview, which is why
                      // this falls back rather than showing a broken image.
                      onError={(event) => {
                        const img = event.currentTarget;
                        img.style.visibility = 'hidden';
                      }}
                    />
                    : null}
                </span>
                <span className="deck-overview-label">
                  <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="deck-strip-name">{p.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
