import { definitionBullets, section } from '../markdown.js';
import type { CompositionFamily, CompositionStructure } from '../types.js';

/**
 * The composition catalog. Departments 2, 5, 12, 13 and 14 must name a
 * structure from this list rather than describing a layout in adjectives, so
 * the catalog becomes an enum the schema can enforce.
 */

/** A stable slug, so a stored composition survives a wording change in the corpus. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[/&]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseCompositionCatalog(frameworks: string): CompositionFamily[] {
  const catalog = section(frameworks, /^The Catalog$/i);
  if (!catalog) throw new Error('composition-frameworks.md: "The Catalog" not found');

  const families: CompositionFamily[] = [];
  const headings = [...catalog.matchAll(/^###\s+Family:\s*(.+)$/gm)];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (!heading) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[i + 1]?.index ?? catalog.length;
    const body = catalog.slice(start, end);

    const raw = (heading[1] ?? '').trim();
    // "Grid & Proportion (calm, structured, editorial)" — name, then its effect.
    const withEffect = /^(.*?)\s*\((.*)\)\s*$/.exec(raw);
    const name = (withEffect?.[1] ?? raw).trim();
    const effect = (withEffect?.[2] ?? '').trim();

    const structures: CompositionStructure[] = definitionBullets(body).map(([label, description]) => ({
      id: slug(label),
      name: label,
      family: name,
      description,
    }));

    if (structures.length === 0) {
      throw new Error(`composition-frameworks.md: family "${name}" has no structures`);
    }
    families.push({ name, effect, structures });
  }

  if (families.length === 0) throw new Error('composition-frameworks.md: no families parsed');
  return families;
}
