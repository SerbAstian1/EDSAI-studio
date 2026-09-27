import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import type { DocumentPage } from '../api.js';
import FigmaEmbed from './FigmaEmbed.js';
import { pageLabel, pageName, clampIndex, nextIndex, previousIndex } from '../presentation.js';
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
 * Keyboard because a presentation is read with a keyboard in a browser: arrows
 * and Page Up/Down move, Home and End jump, F goes fullscreen. Escape leaves
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

export default function PresentationViewer({
  sourceUrl, pages, title, initialPage = 1, fileHref, onClose,
}: PresentationViewerProps): ReactElement {
  // Held as a 1-based page number because that is how the counter reads and how
  // a designer talks about a deck ("start on page 4"). Converted once, here.
  const [page, setPage] = useState(() => clampIndex(initialPage - 1, pages) + 1);
  const [full, setFull] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  // A manifest that shrank while the reader was on page 14 leaves them on 14 of
  // 6 without this. The dependency on `pages` is the point, not a lint appeasement.
  useEffect(() => {
    setPage((p) => clampIndex(p - 1, pages) + 1);
  }, [pages]);

  const go = useCallback((to: number): void => { setPage(clampIndex(to - 1, pages) + 1); }, [pages]);
  const back = useCallback((): void => { setPage(previousIndex(pages, page - 1) + 1); }, [pages, page]);
  const forward = useCallback((): void => { setPage(nextIndex(pages, page - 1) + 1); }, [pages, page]);

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
        case 'End': go(pages.length); break;
        case 'f': case 'F': setFull((f) => !f); break;
        case 'Escape': if (full) setFull(false); else onClose?.(); break;
        default: return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back, forward, go, pages.length, full, onClose]);

  const current = pages[clampIndex(page - 1, pages)];
  const href = pageUrl(sourceUrl, current);
  const name = pageName(pages, page - 1);
  const label = pageLabel(pages, page - 1);

  return (
    <div className={`deck${full ? ' deck-full' : ''}`} ref={frame} tabIndex={-1} aria-label={`${title}, page ${page}`}>
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
                  disabled={page >= pages.length} onClick={forward}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
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
          showing the previous page's canvas. */}
      <div className="deck-stage">
        <FigmaEmbed key={href} url={href} compact title={`${title} — ${name || `page ${page}`}`} />
      </div>

      {pages.length > 1 && (
        <ol className="deck-strip" aria-label="Pages">
          {pages.map((p, i) => (
            <li key={`${p.order}-${p.name}`}>
              <button type="button" className={i === page - 1 ? 'on' : ''} aria-current={i === page - 1 ? 'true' : undefined}
                      onClick={() => go(i + 1)}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="deck-strip-name">{p.name}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
