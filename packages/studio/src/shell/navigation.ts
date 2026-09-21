/**
 * The studio's navigation, as data.
 *
 * One list drives the sidebar, the command palette and the route parser, so a
 * section cannot exist in one and be missing from another.
 *
 * `status` is the honest part. The product this shell is being built toward has
 * Clients, Projects, Assets, Templates and Campaigns; the codebase underneath
 * has none of those entities yet. Rendering them as working links would be a
 * demo rather than a product, and hiding them would make the shape of the
 * product unreadable. They are listed, marked with the phase that brings them,
 * and not clickable until the entity behind them exists.
 */

export type SectionStatus = 'built' | 'planned';

export interface Section {
  id: string;
  label: string;
  glyph: string;
  group: 'Workspace' | 'AI' | 'Studio';
  status: SectionStatus;
  /** The hash route, for a built section. */
  href?: string;
  /** Which phase of the build plan introduces it, for a planned one. */
  phase?: string;
  /** What it will be, shown where a planned section is opened. */
  intent?: string;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'overview', label: 'Overview', glyph: '⌂', group: 'Workspace',
    status: 'built', href: '#/',
  },
  {
    id: 'clients', label: 'Clients', glyph: '◉', group: 'Workspace',
    status: 'built', href: '#/clients',
  },
  {
    id: 'projects', label: 'Projects', glyph: '▤', group: 'Workspace',
    status: 'built', href: '#/projects',
  },
  {
    id: 'discovery', label: 'Discovery', glyph: '◐', group: 'Workspace',
    status: 'built', href: '#/discovery',
  },
  {
    id: 'runs', label: 'Pipeline', glyph: '▣', group: 'Workspace',
    status: 'built', href: '#/runs',
  },
  {
    id: 'brands', label: 'Brands', glyph: '✦', group: 'Workspace',
    status: 'built', href: '#/brands',
  },
  {
    id: 'portals', label: 'Portals', glyph: '◎', group: 'Workspace',
    status: 'built', href: '#/portals',
  },
  {
    id: 'assets', label: 'Files', glyph: '◈', group: 'Workspace',
    status: 'built', href: '#/assets',
  },
  {
    id: 'process-builder', label: 'Process Builder', glyph: '⚒', group: 'Workspace',
    status: 'built', href: '#/process-builder',
  },
  {
    id: 'templates', label: 'Templates', glyph: '✎', group: 'Workspace',
    status: 'built', href: '#/templates',
  },
  {
    id: 'campaigns', label: 'Campaigns', glyph: '◌', group: 'Workspace',
    status: 'built', href: '#/campaigns',
  },
  {
    id: 'brand-brain', label: 'Brand Brain', glyph: '✦', group: 'AI',
    status: 'planned', phase: 'P8',
    intent: 'Structured brand context, retrieved per task rather than pasted whole '
      + 'into every prompt. The department outputs are already the raw material.',
  },
  {
    id: 'activity', label: 'Activity', glyph: '◷', group: 'Studio',
    status: 'built', href: '#/activity',
  },
  {
    id: 'settings', label: 'Settings', glyph: '⚙', group: 'Studio',
    status: 'built', href: '#/settings',
  },
  {
    id: 'support', label: 'Support', glyph: '?', group: 'Studio',
    status: 'built', href: '#/support',
  },
];

export const GROUPS = ['Workspace', 'AI', 'Studio'] as const;

export function sectionsIn(group: Section['group']): Section[] {
  return SECTIONS.filter((section) => section.group === group);
}

export function findSection(id: string): Section | undefined {
  return SECTIONS.find((section) => section.id === id);
}
