import {
  Bell, CheckSquare, Compass, FileText, History, LayoutDashboard, Library,
  Receipt, Settings, Shapes, type LucideIcon,
} from 'lucide-react';

/**
 * One client's workspace, as data.
 *
 * This is the client half of `navigation.ts` and it is deliberately the same
 * shape: the studio rail and the client rail are two navigation contexts, and a
 * second file that described them differently is how they end up disagreeing.
 * Both are read from here, both are checked by the same kinds of test, and
 * neither page invents its own list.
 *
 * **The section is a URL segment, not a piece of state.** `#/clients/:id/:section`
 * is what is in the address bar, so a refresh, a shared link and the back button
 * all land on the same section — the same reason the run screens are routes.
 * The dashboard is the one section the URL leaves off, because
 * `#/clients/:id` is the shortest thing that can mean "this client".
 *
 * Order is the order the work flows, and it is the order the sidebar draws.
 * `settings` is the exception and is drawn after a rule: it is the client's
 * record rather than their work, and putting it in the flow above a designer
 * mid-project would read as "the thing to do next".
 */
export type ClientSection =
  | 'dashboard' | 'updates' | 'tasks' | 'documents' | 'library'
  | 'strategy' | 'hub' | 'timeline' | 'contracts' | 'settings';

export interface ClientSectionItem {
  id: ClientSection;
  label: string;
  icon: LucideIcon;
  /** Drawn below the rule, with the client's record rather than their work. */
  separate?: boolean;
}

export const CLIENT_SECTIONS: readonly ClientSectionItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'updates', label: 'Updates', icon: Bell },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'strategy', label: 'Discovery & Strategy', icon: Compass },
  { id: 'hub', label: 'Brand Hub', icon: Shapes },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'contracts', label: 'Contracts & Invoices', icon: Receipt },
  { id: 'settings', label: 'Settings', icon: Settings, separate: true },
];

/** The first section, which is also the one the URL leaves off. */
export const DEFAULT_SECTION: ClientSection = 'dashboard';

/** What the studio is open to inside one client's workspace. */
export function clientSections(separate: boolean): ClientSectionItem[] {
  return CLIENT_SECTIONS.filter((section) => Boolean(section.separate) === separate);
}

/** The hash route for one section of one client. */
export function clientHref(clientId: string, section: ClientSection): string {
  return section === DEFAULT_SECTION
    ? `#/clients/${clientId}`
    : `#/clients/${clientId}/${section}`;
}

/**
 * Which section a URL segment means, or the dashboard for anything unknown.
 *
 * A stale or mistyped segment lands on the dashboard rather than on a page that
 * says it is missing: the sections are not features that come and go, so a URL
 * pointing at one that no longer exists is a link somebody kept, not a request
 * to be told off.
 */
export function clientSectionOf(tab: string | undefined): ClientSection {
  return CLIENT_SECTIONS.some((section) => section.id === tab) ? tab as ClientSection : DEFAULT_SECTION;
}
