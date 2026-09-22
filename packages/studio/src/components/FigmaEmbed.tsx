import { useState, type ReactElement } from 'react';
import { ExternalLink, PenTool } from 'lucide-react';

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
 */

export function isFigmaUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'figma.com' || host.endsWith('.figma.com');
}

export function figmaEmbedSrc(url: string): string {
  return `https://www.figma.com/embed?embed_host=edsai&url=${encodeURIComponent(url)}`;
}

export default function FigmaEmbed({ url, title }: { url: string; title: string }): ReactElement | null {
  const [loaded, setLoaded] = useState(false);
  if (!isFigmaUrl(url)) return null;

  return (
    <figure className={`figma-embed${loaded ? ' loaded' : ''}`}>
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
      <figcaption className="figma-embed-caption">
        <PenTool size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Figma preview</span>
        <a href={url} target="_blank" rel="noreferrer">
          Open in Figma <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}
