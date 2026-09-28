import type { ReactElement, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { ClientWorkspaceSidebar } from './ClientWorkspaceSidebar.js';
import { clientSectionOf, type ClientSection } from './clientNavigation.js';

/**
 * The one place a client's workspace exists.
 *
 * Ten routes used to be ten copies of a horizontal tab strip, and the strip was
 * the only thing tying them together: a section added to one page and not the
 * others produced a tab that went nowhere on half the client's screens. The
 * sidebar is rendered here, once, in the shared layout, so the navigation is
 * the same object on every section by construction rather than by discipline.
 *
 * **The client is read here, not passed in.** The sidebar needs the record, and
 * so does the page below it, and both ask for `['client', id]` — one request
 * between them, filled by whichever mounts first. That is the same arrangement
 * the studio rail and the Clients screen already have.
 *
 * `ClientDetail` stays the section renderer. This owns the frame around it, so
 * no section has to know that a sidebar exists, and a future section is added
 * to one list (`clientNavigation.ts`) rather than to a layout and ten screens.
 */
export interface ClientWorkspaceProps {
  clientId: string;
  /** The section in the URL, resolved to a real one. */
  tab?: string | undefined;
  children: ReactNode;
}

export function ClientWorkspace({ clientId, tab, children }: ClientWorkspaceProps): ReactElement {
  const queryClient = useQueryClient();
  const section: ClientSection = clientSectionOf(tab);

  const { data, isPending, error } = useQuery({
    queryKey: ['client', clientId], queryFn: () => api.client(clientId),
  });

  /*
   * One rule for "something changed on this client": everything keyed to it
   * goes stale together, rather than each panel deciding for itself which of
   * the four lists a write to the record touched. A plain callback rather than
   * a mutation, because nothing is being written here — this is the *response*
   * to a write the sidebar or the page below it made.
   */
  const onChanged = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  return (
    <div className="workspace">
      {data && (
        <ClientWorkspaceSidebar
          client={data.client}
          section={section}
          dependents={data.contacts.length + data.projects.length}
          onChanged={onChanged}
        />
      )}
      {!data && !error && (
        <aside className="client-sidebar" aria-hidden="true">
          <div className="client-sidebar-head">
            <p className="muted">Loading client…</p>
          </div>
        </aside>
      )}
      {/*
        The error is not repeated here. The page below it renders the one
        `ErrorPanel` for a client that will not load, and two of them saying
        the same sentence is how a real cause gets missed.
      */}
      <main className="content">{children}</main>
    </div>
  );
}
