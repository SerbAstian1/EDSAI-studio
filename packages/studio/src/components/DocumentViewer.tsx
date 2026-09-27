import type { ReactElement } from 'react';
import { Download, ExternalLink, FileWarning } from 'lucide-react';
import { api, type Asset, type DocumentEntry, type DocumentPage } from '../api.js';
import FigmaEmbed from './FigmaEmbed.js';
import PresentationViewer from './PresentationViewer.js';
import { resolveViewMode } from '../presentation.js';

/**
 * One added document, read the way it was declared it should be read.
 *
 * The three view modes are three different screens, not three variations of
 * one, and the row's stored `viewMode` is what chooses between them:
 *
 *  - `document` is an uploaded file, framed by the browser — a PDF scrolls, an
 *    image appears. It is an `<iframe>` on the asset's own URL rather than a
 *    custom reader, because the browser already has a good one.
 *  - `presentation` is a Figma deck, one frame at a time, in
 *    `PresentationViewer`. This is the mode that exists because an eighteen-page
 *    deck as a single infinite canvas is unusable.
 *  - `external` is anything this codebase cannot honestly draw — a Keynote
 *    export, a Drive folder, a private file. It shows what it is and offers the
 *    file, rather than opening a blank rectangle and calling it a preview.
 *
 * **The mode is re-resolved here, not trusted.** A Figma row that has since been
 * given a page manifest is a deck whichever way it was labelled, and an upload
 * whose file nothing can display falls back to `external`. `resolveViewMode` and
 * `uploadViewMode` are the same functions the tests cover, so the screen and the
 * rule cannot drift.
 */

export default function DocumentViewer({ entry, pages, assets, onClose }: {
  entry: DocumentEntry;
  /** The manifest, from the same endpoint as the row. */
  pages: readonly DocumentPage[];
  /** The brand's files, so an upload's content type can be found. */
  assets: readonly Asset[];
  onClose?: () => void;
}): ReactElement {
  const mode = resolveViewMode(entry, pages);
  const asset = assets.find((a) => a.id === entry.assetId);
  const src = entry.assetId ? api.downloadPath(entry.assetId) : undefined;

  if (mode === 'presentation' && entry.sourceUrl) {
    return (
      <PresentationViewer
        sourceUrl={entry.sourceUrl}
        pages={pages}
        title={entry.title}
        fileHref={entry.sourceUrl}
        {...(onClose ? { onClose } : {})}
      />
    );
  }

  if (mode === 'document' && src) {
    // An image in a frame would get a browser scrollbar for no reason; a PDF
    // needs one. The content type is the only honest way to tell, and it is
    // already on the asset row.
    const isImage = /^image\//.test(asset?.contentType ?? '');
    return (
      <div className="doc-viewer">
        <div className="row">
          <strong>{entry.title}</strong>
          {entry.description && <span className="muted">{entry.description}</span>}
          {src && (
            <a className="row" style={{ marginLeft: 'auto' }} href={src} download title={`Download ${entry.title}`}>
              <Download size={14} aria-hidden="true" /> Download
            </a>
          )}
        </div>
        {isImage
          ? <img className="doc-image" src={src} alt={entry.title} />
          : src && <iframe className="doc-frame" src={src} title={`${entry.title} — preview`} />}
      </div>
    );
  }

  // External. Not a failure state — a deliberate one, and it should read as
  // "here is the file" rather than "we could not load this".
  return (
    <div className="doc-viewer">
      <div className="row">
        <strong>{entry.title}</strong>
        {entry.description && <span className="muted">{entry.description}</span>}
      </div>
      <div className="empty">
        <FileWarning size={22} strokeWidth={1.5} aria-hidden="true" />
        <p className="editorial">This one opens outside EDSAI.</p>
        <p>
          {entry.source === 'figma'
            ? 'Figma could not read this link, so it is offered as a link rather than previewed here.'
            : 'Nothing here can display this format inline.'}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {entry.sourceUrl && (
            <a className="primary" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden="true" /> Open in Figma
            </a>
          )}
          {src && (
            <a href={src} target="_blank" rel="noopener noreferrer">
              <Download size={14} aria-hidden="true" /> Download the file
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
