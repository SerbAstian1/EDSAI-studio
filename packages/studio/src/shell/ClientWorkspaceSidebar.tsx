import { useEffect, useId, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, CornerUpLeft, Menu, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { api, type ApiError, type Client } from '../api.js';
import { ClientIdentity } from '../components/ClientIdentity.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import OverflowMenu from '../components/OverflowMenu.js';
import { StudioOnly } from '../viewMode.js';
import { CLIENT_SECTIONS, clientHref, type ClientSection } from './clientNavigation.js';

/**
 * The second sidebar: the current client's own workspace.
 *
 * **A third of the way across, or nowhere at all.** This is a sibling of the
 * studio rail rather than a column inside the content, which is the whole
 * point of the layout: the studio rail answers "where in the studio am I", this
 * answers "where in this client am I", and the two questions are independent.
 * It is only rendered inside a client workspace — on the calendar, or the
 * pipeline, or Settings, there is no client open, so a rail of their sections
 * would be a list of destinations that all lead to the same page.
 *
 * The identity header is the client's, and it is the only place on the page
 * that says who they are. The record form that used to sit above the tabs is
 * now under Settings, which is where a person goes to change it, and the
 * destructive action moved into the overflow beside the name — where it is one
 * click away and not next to "Edit" at the same weight.
 *
 * The two rails are the same component language: the same `.nav-item`, the same
 * muted glyph, the same orange rule down the active row. A second visual
 * grammar for the second rail would make the workspace feel like a different
 * application, which is exactly the thing a second sidebar risks.
 */
export interface ClientWorkspaceSidebarProps {
  client: Client;
  section: ClientSection;
  /**
   * Contacts plus projects, which is what the server counts before it refuses
   * a delete. Watched so a refusal left on screen clears itself the moment the
   * thing it is complaining about does.
   */
  dependents: number;
  /** Called after anything that changes the client record. */
  onChanged: () => void;
}

function SectionLink({ clientId, id, label, icon: Icon, current, onNavigate }: {
  clientId: string;
  id: ClientSection;
  label: string;
  icon: LucideIcon;
  current: ClientSection;
  onNavigate: () => void;
}): ReactElement {
  return (
    <a
      className="nav-item"
      href={clientHref(clientId, id)}
      aria-current={current === id ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </a>
  );
}

export function ClientWorkspaceSidebar({
  client, section, dependents, onChanged,
}: ClientWorkspaceSidebarProps): ReactElement {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const remove = useMutation({
    mutationFn: () => api.deleteClient(client.id),
    onSuccess: () => {
      // A hash change rather than a reload, so the query cache survives it —
      // otherwise the clients list still shows the row this just deleted until
      // its own staleTime happened to lapse.
      onChanged();
      location.href = '#/clients';
    },
  });

  // Deliberately not `remove`: its own identity changes the moment `reset()`
  // runs, which would make this fire on every render instead of only when the
  // count that caused the refusal actually moved.
  useEffect(() => { remove.reset(); }, [dependents]);

  useEffect(() => { setOpen(false); }, [section]);

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Delete ${client.name}?`,
      message: 'This cannot be undone. Remove the client’s contacts and projects first.',
      confirmLabel: 'Delete client',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  const currentLabel = CLIENT_SECTIONS.find((item) => item.id === section)?.label ?? 'Menu';

  return (
    <aside className="client-sidebar">
      <div className="client-sidebar-head">
        {/* A disclosure, not a link. It goes nowhere on its own, so it is a
            button with the state on it — `aria-expanded` and `aria-controls` are
            what make the ten sections below announce as something this opens,
            and the name on it is the section you are in rather than a generic
            "Menu", because that is the thing being summarised. */}
        <button
          type="button"
          className="client-sidebar-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className={open ? 'open' : undefined} size={15} aria-hidden="true" />
        </button>

        {/* The client's mark, their name, what they do, and where they are. The
            four things that were repeated above the tabs are the four things
            that belong beside the navigation to them. */}
        <div className="client-sidebar-identity">
          <ClientIdentity size="lg" showName={false} client={client} />
          <div className="client-sidebar-names">
            <p className="label">{client.industry || 'Client'}</p>
            <h2 className="client-sidebar-name">{client.name}</h2>
          </div>
        </div>

        <div className="client-sidebar-status">
          <span className={`pill ${client.status === 'archived' ? 'minor' : 'pass'}`}>
            {client.status}
          </span>
          <StudioOnly>
            <OverflowMenu label={`Actions for ${client.name}`} size="bar" items={[
              { label: 'Edit client', icon: Pencil,
                // The record form is a page in this workspace, not a panel that
                // replaces the header — so the edit is a navigation rather than
                // a mode that hides the navigation.
                onSelect: () => { location.href = clientHref(client.id, 'settings'); } },
              { label: remove.isPending ? 'Deleting…' : 'Delete client', icon: Trash2,
                danger: true, disabled: remove.isPending, onSelect: onDelete },
            ]} />
          </StudioOnly>
        </div>

        {/* A refusal from a delete is only meaningful next to the button that
            caused it, and that button is above. */}
        <StudioOnly>
          {remove.error && <p className="err client-sidebar-error">{(remove.error as ApiError).message}</p>}
        </StudioOnly>
      </div>

      <nav id={menuId} className={`client-sidebar-menu${open ? ' open' : ''}`}
           aria-label={`${client.name} sections`}>
        {CLIENT_SECTIONS.map((item) => (
          <SectionLink
            key={item.id}
            clientId={client.id}
            id={item.id}
            label={item.label}
            icon={item.icon}
            current={section}
            onNavigate={() => setOpen(false)}
          />
        ))}
        <StudioOnly>
          <hr className="nav-rule" aria-hidden="true" />
          <a className="nav-item" href="#/clients" onClick={() => setOpen(false)}>
            <CornerUpLeft className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
            All clients
          </a>
        </StudioOnly>
      </nav>
    </aside>
  );
}
