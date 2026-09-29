import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client } from '../../api.js';
import DocumentShelf from '../../components/DocumentShelf.js';
import DocumentLibrary from '../../components/DocumentLibrary.js';

/**
 * The client's documents: the same eight the studio keeps, read-only, each
 * opening in place, and then whatever the studio has added on top.
 *
 * **Both, in that order, and never merged into one list.** The eight are the
 * engagement's spine and keep their fixed positions — "the contract is the
 * second tile" is a fact a client relies on. The added documents sit below as
 * their own library, grouped by kind, because they are a different kind of thing:
 * a document the studio chose to hand over, not a slot in the engagement.
 *
 * An empty slot shows as a greyed tile rather than being hidden, so a client can
 * see what is still to come. A library with nothing in it says so in one line
 * rather than showing a heading over nothing.
 */
export default function DocumentsSection({ client }: { client: Client }): ReactElement {
  // The library needs the file list to render an upload inline, and the shelf
  // fetches its own documents; neither needs the other's data.
  const assets = useQuery({ queryKey: ['assets', client.id], queryFn: () => api.assets(client.id) });

  return (
    <section className="stack">
      <div>
        <p className="label mono">01</p>
        <h1 className="display portal-page-title">Documents</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Your proposal, contract and invoice, and the brand work as it lands. Press one to read it here.
        </p>
      </div>
      <DocumentShelf clientId={client.id} editable={false} />
      <DocumentLibrary clientId={client.id} editable={false} assets={assets.data ?? []} />
    </section>
  );
}
