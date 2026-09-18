import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { installPreviewTransport, CAPTURED_AT } from './preview.js';

/**
 * The preview entry.
 *
 * Two lines of difference from `main.tsx`: the transport is swapped for a
 * replay of captured responses, and a bar says so. The application below is
 * the shipping one.
 *
 * The bar is not decoration. Someone looking at this on a phone has no way to
 * tell a real deployment from a recording, and letting them believe they are
 * looking at live data is the one thing a preview must not do.
 */

installPreviewTransport();

function Banner(): ReactElement {
  const captured = new Date(CAPTURED_AT);
  const when = Number.isNaN(captured.getTime())
    ? 'an earlier session'
    : captured.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="preview-bar">
      <strong>Preview</strong>
      <span>
        Real screens, real data — captured from a running EDSAI on {when}. There is no
        server behind this page, so nothing you change is saved.
      </span>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Banner />
      <App />
    </StrictMode>,
  );
}
