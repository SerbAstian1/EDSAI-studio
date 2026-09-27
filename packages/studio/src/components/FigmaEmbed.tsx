import { useEffect, useState, type ReactElement } from 'react';
import { ExternalLink, PenTool } from 'lucide-react';
import { isFigmaUrl } from '../figmaLinks.js';

/**
 * A Figma file or prototype, previewed in place.
 *
 * Figma's public embed endpoint wraps any file, prototype or board URL, so a
 * deliverable can be *looked at* here instead of sent off as a link to open
 * somewhere else. Two rules keep it honest:
 *
 *  - Only figma.com is ever framed. The API refuses anything else, and this
 *    component checks again before rendering — a frame is an origin's window
 *    into our page, so the check lives on both sides of the wire.
 *  - The frame is sandboxed so it can run Figma's viewer and open a file in a
 *    new tab, but never navigate *this* page away.
 *
 * The placeholder is not decorative: Figma's viewer takes a moment to boot,
 * and a blank rectangle reads as broken. It shows the file's name and a way
 * out until the frame reports it has loaded.
 *
 * `compact` drops the caption for a caller that supplies its own chrome — the
 * presentation viewer has a title bar with its own way out to Figma, and two
 * "open in Figma" links forty centimetres apart reads as a mistake.
 */

export { isFigmaUrl };

export function figmaEmbedSrc(url: string): string {
  return `https://www.figma.com/embed?embed_host=edsai&url=${encodeURIComponent(url)}`;
}

export default function FigmaEmbed({ url, title, compact }: {
  url: string;
  title: string;
  compact?: boolean;
}): ReactElement | null {
  const [loaded, setLoaded] = useState(false);
  // A frame whose load event never comes (a blocked request, a file Figma
  // refuses) would otherwise sit behind "Loading…" for good. After a while
  // the frame is shown regardless, so whatever Figma has to say is visible.
  useEffect(() => {
    setLoaded(false);
    const timer = setTimeout(() => setLoaded(true), 8000);
    return () => clearTimeout(timer);
  }, [url]);
  if (!isFigmaUrl(url)) return null;

  return (
    <figure className={`figma-embed${loaded ? ' loaded' : ''}${compact ? ' compact' : ''}`}>
      <div className="figma-embed-placeholder" aria-hidden={loaded}>
        <PenTool size={20} strokeWidth={1.75} aria-hidden="true" />
        <span>Loading {title} from Figma…</span>
      </div>
      <iframe
        src={figmaEmbedSrc(url)}
        title={`${title} — Figma preview`}
        loading="lazy"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        onLoad={() => setLoaded(true)}
      />
      {!compact && (
        <figcaption className="figma-embed-caption">
          <PenTool size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Figma preview</span>
          <a href={url} target="_blank" rel="noreferrer">
            Open in Figma <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          </a>
        </figcaption>
      )}
    </figure>
  );
}
