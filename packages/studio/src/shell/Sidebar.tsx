import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactElement } from 'react';
import { ChevronDown, LogOut, Menu, Search } from 'lucide-react';
import { api, type Client } from '../api.js';
import { ClientIdentity, initialsOf } from '../components/ClientIdentity.js';
import {
  BLOCKS, findSection, sectionsIn, type Block, type Section,
} from './navigation.js';

/**
 * The global sidebar.
 *
 * Five blocks and a rule between each: the studio's own four sections, the
 * clients, acquisition, everything else folded away, and the account. The
 * clients are the point of the rail — a studio owner thinks in client names, not
 * in "the Documents screen" — so they are read from the server rather than
 * listed by hand, and the block ends in a link to the full list because a
 * prospect is a client too and does not belong in the rail.
 *
 * A planned section with a route renders as a link that opens the page saying
 * what it is waiting for. A planned section without one renders as text:
 * `aria-disabled` and no `href`, so a screen reader announces it as unavailable
 * instead of it silently doing nothing when clicked.
 */

/** A section the sidebar draws, or explains. */
function Item({ section, current, onNavigate }: {
  section: Section;
  current: string;
  onNavigate: () => void;
}): ReactElement {
  const Icon = section.icon;

  if (section.status === 'planned' && !section.href) {
    return (
      <span className="nav-item pending" aria-disabled="true" title={section.intent}>
        <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
        {section.label}
        <span className="phase">{section.phase}</span>
      </span>
    );
  }

  return (
    <a
      className={`nav-item${section.status === 'planned' ? ' pending' : ''}`}
      href={section.href}
      aria-current={current === section.id ? 'page' : undefined}
      onClick={onNavigate}
      {...(section.status === 'planned' && section.phase ? { title: `${section.phase} — not built yet` } : {})}
    >
      <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
      {section.label}
      {section.status === 'planned' && <span className="phase">{section.phase}</span>}
    </a>
  );
}

/**
 * Who is on the rail.
 *
 * Active clients only: a dormant or archived one is a real record and belongs
 * in the full list, but listing it here beside the work in hand would make the
 * rail disagree with itself. `sort` is on the name rather than the record's
 * creation order, so the list reads alphabetically however the studio grew.
 */
export function railClients(clients: readonly Client[]): Client[] {
  return clients
    .filter((client) => client.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ClientBlock({ block, clients, currentClientId, onNavigate }: {
  block: Extract<Block, { kind: 'clients' }>;
  clients: readonly Client[] | undefined;
  currentClientId: string | undefined;
  onNavigate: () => void;
}): ReactElement {
  const onRail = railClients(clients ?? []);

  return (
    <nav className="nav-group" aria-label={block.label}>
      <span className="label">{block.label}</span>

      {clients === undefined && <p className="nav-note">Loading…</p>}

      {clients !== undefined && onRail.length === 0 && (
        <p className="nav-note">No active clients yet.</p>
      )}

      {onRail.map((client) => (
        <a
          key={client.id}
          className="nav-item nav-client"
          href={`#/clients/${client.id}`}
          aria-current={currentClientId === client.id ? 'page' : undefined}
          onClick={onNavigate}
        >
          {/* The rail is where a client is recognised at a glance among a dozen
              other people, so it gets the real mark when there is one and the
              same initials fallback as everywhere else when there is not. */}
          <ClientIdentity size="sm" showName={false} client={client} />
          <span className="nav-client-name">{client.name}</span>
        </a>
      ))}

      {/* Never "show all": the point of the rail is that the work in hand is
          already on it, and this is for the records the rail is not for. */}
      <a className="nav-item nav-more-link" href={block.all} onClick={onNavigate}>
        {onRail.length === 0 ? 'Add a client' : 'All clients'}
      </a>
    </nav>
  );
}

function AccountBlock({ block, onNavigate }: {
  block: Extract<Block, { kind: 'account' }>;
  onNavigate: () => void;
}): ReactElement {
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.session });
  const name = session?.user?.name ?? (session?.principal?.kind === 'portal' ? 'Client' : 'Studio');

  // A hard reload rather than a route change: every query the session gate
  // holds is keyed to who was signed in, and the simplest way to guarantee
  // none of it survives a sign-out is to not keep the page that cached it.
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => { location.href = '#/'; location.reload(); },
  });

  const links = ['settings', 'support']
    .map((id) => findSection(id))
    .filter((section): section is Section => section !== undefined);

  return (
    <div className="nav-group nav-account" aria-label={block.label}>
      <div className="nav-account-identity">
        <span className="nav-avatar" aria-hidden="true">{initialsOf(name)}</span>
        <span className="nav-client-name">{name}</span>
      </div>
      {links.map((section) => {
        const Icon = section.icon;
        return (
          <a key={section.id} className="nav-item" href={section.href} onClick={onNavigate}>
            <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
            {section.label}
          </a>
        );
      })}
      <button
        type="button"
        className="nav-item nav-item-button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        <LogOut className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
        {signOut.isPending ? 'Signing out…' : 'Logout'}
      </button>
    </div>
  );
}

function Sections({ block, current, onNavigate }: {
  block: Extract<Block, { kind: 'sections' }>;
  current: string;
  onNavigate: () => void;
}): ReactElement {
  const sections = sectionsIn(block);
  const items = sections.map((section) => (
    <Item key={section.id} section={section} current={current} onNavigate={onNavigate} />
  ));

  if (!block.collapsed) {
    return (
      <nav className="nav-group" aria-label={block.label}>
        <span className="label">{block.label}</span>
        {items}
      </nav>
    );
  }

  // A native disclosure rather than a button and a boolean: it is open or
  // closed, it is reachable by keyboard, and it is announced as a disclosure
  // without a line of code here to say so.
  return (
    <details className="nav-group nav-more">
      <summary className="label nav-more-summary">
        {block.label}
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </summary>
      {items}
    </details>
  );
}

export function Sidebar({ current, currentClientId, onOpenPalette }: {
  current: string;
  /** Which client's page is open, so the right name in the rail reads as current. */
  currentClientId: string | undefined;
  onOpenPalette: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const currentLabel = findSection(current)?.label
    ?? (currentClientId ? 'Client' : 'Menu');

  // The same key the Clients screen and the File Library use, so the rail costs
  // no request of its own — the first of those to load fills it for all three.
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  useEffect(() => setOpen(false), [current, currentClientId]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <a className="wordmark" href="#/" onClick={() => setOpen(false)}>EDS AI</a>
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className={open ? 'open' : undefined} size={15} aria-hidden="true" />
        </button>
      </div>

      <div id={menuId} className={`sidebar-menu${open ? ' open' : ''}`}>
        {/* Under the wordmark rather than pinned to the bottom. Pushed down by
            `margin-top: auto` it left a column of dead space on every screen,
            and it is the fastest way to reach anything here — not a footer. */}
        <button className="search" onClick={() => { setOpen(false); onOpenPalette(); }}>
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          Search
          <span className="kbd" aria-hidden="true">⌘K</span>
        </button>

        {BLOCKS.map((block, index) => (
          <div
            key={block.id}
            className="nav-block"
            data-studio-only={block.kind === 'sections' && block.studioOnly ? 'true' : undefined}
          >
            {index > 0 && <hr className="nav-rule" aria-hidden="true" />}
            {block.kind === 'sections' && (
              <Sections block={block} current={current} onNavigate={() => setOpen(false)} />
            )}
            {block.kind === 'clients' && (
              <ClientBlock
                block={block}
                clients={clients.data}
                currentClientId={currentClientId}
                onNavigate={() => setOpen(false)}
              />
            )}
            {block.kind === 'account' && <AccountBlock block={block} onNavigate={() => setOpen(false)} />}
          </div>
        ))}
      </div>
    </aside>
  );
}
