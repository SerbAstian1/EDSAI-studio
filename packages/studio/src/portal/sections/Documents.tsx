import type { ReactElement } from 'react';
import type { Client } from '../../api.js';
import DocumentShelf from '../../components/DocumentShelf.js';

/**
 * The client's shelf: the same eight documents the studio keeps, read-only,
 * each opening in place. An empty slot shows as a greyed tile rather than
 * being hidden, so a client can see what is still to come.
 */
export default function DocumentsSection({ client }: { client: Client }): ReactElement {
  return (
    <section className="stack">
      <div>
        <p className="label mono">01</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Documents</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Your proposal, contract and invoice, and the brand work as it lands. Press one to read it here.
        </p>
      </div>
      <DocumentShelf clientId={client.id} editable={false} />
    </section>
  );
}
