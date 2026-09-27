/**
 * The studio's navigation, as data.
 *
 * Two lists, one truth. `SECTIONS` is every section the product has, which is
 * what the command palette searches and what the route parser is checked
 * against. `BLOCKS` is the order the sidebar draws a subset of them in, and it
 * is deliberately much shorter: a rail listing sixteen things is a table of
 * contents, and the entry you are looking for stops standing out in one.
 *
 * A section does not have to appear in a block. Everything the product has, and
 * the sidebar does not show, is one of two things: a *client workspace* — a
 * screen that only makes sense scoped to one client, and which therefore lives
 * at `#/clients/:id/tab` — or a section behind the More drawer. Neither is
 * hidden by accident, and both are reachable, which is the property the
 * navigation tests actually assert.
 *
 * `status` is the honest part. The product this shell is being built toward has
 * Clients, Projects, Assets, Templates and Campaigns; the codebase underneath
 * has none of those entities yet. Rendering them as working links would be a
 * demo rather than a product, and hiding them would make the shape of the
 * product unreadable. They are listed, marked with the phase that brings them,
 * and either not clickable or routed to a page that says what is missing —
 * never to a link that quietly does nothing.
 */

import {
  Bell, CalendarDays, CheckSquare, Compass, Files, FolderKanban, Globe, Hexagon,
  Home, LayoutTemplate, LifeBuoy, Megaphone, Palette, Settings, SlidersHorizontal,
  Sparkles, UserPlus, Users, Workflow, type LucideIcon,
} from 'lucide-react';

export type SectionStatus = 'built' | 'planned';

export interface Section {
  id: string;
  label: string;
  /** Kept for the command palette, which is text. The sidebar draws `icon`. */
  glyph: string;
  icon: LucideIcon;
  status: SectionStatus;
  /**
   * The hash route. Every built section has one. A planned section has one only
   * where a route exists that explains what is missing — a link to the honest
   * answer is worth having; a link to nothing is not.
   */
  href?: string;
  /** Which phase of the build plan introduces it, for a planned one. */
  phase?: string;
  /** What it will be, shown on the page a planned section opens. */
  intent?: string;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'overview', label: 'Home', glyph: '⌂', icon: Home,
    status: 'built', href: '#/',
  },
  {
    id: 'updates', label: 'Updates', glyph: '◷', icon: Bell,
    status: 'built', href: '#/updates',
  },
  {
    id: 'tasks', label: 'Tasks', glyph: '☑', icon: CheckSquare,
    status: 'planned', phase: 'P2', href: '#/tasks',
    intent: 'One board for everything the studio owes somebody, across every client — '
      + 'a deadline here, a file to approve, a question still unanswered. It needs a task '
      + 'entity of its own; until it has one, a client’s own work is tracked as milestones '
      + 'on that client’s Timeline.',
  },
  {
    id: 'calendar', label: 'Calendar', glyph: '▤', icon: CalendarDays,
    status: 'built', href: '#/calendar',
  },
  {
    id: 'acquisition', label: 'Client Acquisition', glyph: '✚', icon: UserPlus,
    status: 'built', href: '#/acquisition',
  },
  {
    id: 'clients', label: 'Clients', glyph: '◉', icon: Users,
    status: 'built', href: '#/clients',
  },
  {
    id: 'projects', label: 'Projects', glyph: '▤', icon: FolderKanban,
    status: 'built', href: '#/projects',
  },
  {
    id: 'runs', label: 'Pipeline', glyph: '▣', icon: Workflow,
    status: 'built', href: '#/runs',
  },
  {
    id: 'discovery', label: 'Discovery', glyph: '◐', icon: Compass,
    status: 'built', href: '#/discovery',
  },
  {
    id: 'brands', label: 'Brands', glyph: '✦', icon: Palette,
    status: 'built', href: '#/brands',
  },
  {
    id: 'brand-hub', label: 'Brand Hub', glyph: '⬡', icon: Hexagon,
    status: 'built', href: '#/brand-hub',
  },
  {
    id: 'portals', label: 'Portals', glyph: '◎', icon: Globe,
    status: 'built', href: '#/portals',
  },
  {
    id: 'assets', label: 'Files', glyph: '◈', icon: Files,
    status: 'built', href: '#/assets',
  },
  {
    id: 'process-builder', label: 'Process Builder', glyph: '⚒', icon: SlidersHorizontal,
    status: 'built', href: '#/process-builder',
  },
  {
    id: 'templates', label: 'Templates', glyph: '✎', icon: LayoutTemplate,
    status: 'built', href: '#/templates',
  },
  {
    id: 'campaigns', label: 'Campaigns', glyph: '◌', icon: Megaphone,
    status: 'built', href: '#/campaigns',
  },
  {
    id: 'brand-brain', label: 'Brand Brain', glyph: '✦', icon: Sparkles,
    status: 'planned', phase: 'P8',
    intent: 'Structured brand context, retrieved per task rather than pasted whole '
      + 'into every prompt. The department outputs are already the raw material.',
  },
  {
    id: 'settings', label: 'Settings', glyph: '⚙', icon: Settings,
    status: 'built', href: '#/settings',
  },
  {
    id: 'support', label: 'Support', glyph: '?', icon: LifeBuoy,
    status: 'built', href: '#/support',
  },
];

/**
 * A block of the sidebar: sections, the client list, or the account footer.
 *
 * Order here is order on screen, and a rule is drawn between blocks. Three
 * `sections` blocks is a coincidence rather than a taxonomy — the ids are read
 * by name at the only place that renders them, and one of them is collapsed.
 *
 * `studioOnly` is the rail's half of the client-view toggle. A client has no
 * Home, no pipeline, no calendar and no leads, so a preview that left them on
 * screen was not a preview of anything they would ever be shown. The client
 * block and the account block are kept: the first is the page being previewed,
 * and the second is how the person looking turns the eye back.
 */
export type Block =
  | {
    kind: 'sections'; id: string; label: string; sections: readonly string[];
    collapsed?: boolean; studioOnly?: boolean;
  }
  | { kind: 'clients'; id: string; label: string; /** Where "see them all" goes. */ all: string }
  | { kind: 'account'; id: string; label: string };

export const BLOCKS: readonly Block[] = [
  {
    kind: 'sections', id: 'studio', label: 'Studio', studioOnly: true,
    sections: ['overview', 'updates', 'tasks', 'calendar'],
  },
  {
    kind: 'clients', id: 'clients', label: 'Clients', all: '#/clients',
  },
  {
    kind: 'sections', id: 'acquisition', label: 'Acquisition', studioOnly: true,
    sections: ['acquisition'],
  },
  {
    // The rest of the studio, folded away. A section is only hidden from the
    // rail if it is still one keystroke away in the palette and one click from
    // here — otherwise the slim rail would just be a set of orphans.
    kind: 'sections', id: 'more', label: 'More', collapsed: true, studioOnly: true,
    sections: [
      'runs', 'projects', 'discovery', 'brands', 'brand-hub', 'portals',
      'assets', 'templates', 'campaigns', 'process-builder', 'brand-brain',
    ],
  },
  {
    kind: 'account', id: 'account', label: 'Account',
  },
];

export function findSection(id: string): Section | undefined {
  return SECTIONS.find((section) => section.id === id);
}

/**
 * The sections a `sections` block draws, in the order the block lists them.
 *
 * The block's order, not `SECTIONS`' — a block is a decision about what sits
 * next to what, and reading the order off the master list would quietly
 * overrule it.
 */
export function sectionsIn(block: Block): Section[] {
  if (block.kind !== 'sections') return [];
  return block.sections
    .map((id) => findSection(id))
    .filter((section): section is Section => section !== undefined);
}

/** The section ids the sidebar puts behind a block, for the tests to check. */
export function blockSectionIds(): string[] {
  return BLOCKS.flatMap((block) => (block.kind === 'sections' ? [...block.sections] : []));
}

/**
 * A planned section that has a route, by the first segment of that route.
 *
 * `#/tasks` and `#/calendar` reach the page that says what they are waiting
 * for. The parser asks here rather than keeping its own list, so a section
 * cannot be given an href that resolves to a missing page.
 */
export const PLANNED_ROUTES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SECTIONS
    .filter((section) => section.status === 'planned' && section.href)
    .map((section) => [section.href!.replace(/^#\/?/, ''), section.id])),
);
