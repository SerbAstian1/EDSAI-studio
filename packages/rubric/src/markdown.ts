/**
 * A deliberately small markdown table reader.
 *
 * The corpus is hand-written prose with tables in it, not a data format. A full
 * markdown parser would buy us AST fidelity we never use and a dependency we
 * would have to keep honest across 33 files. What we need is narrow: find a
 * table under a known heading, split its rows, and keep the cell text intact.
 */

export interface Table {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Strip the emphasis, code ticks and footnote markers the corpus uses for style. */
export function plain(cell: string): string {
  return cell
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const isDivider = (line: string): boolean => /^\|[\s:|-]+\|?$/.test(line.trim());

/** Every pipe table in the given block of markdown, in document order. */
export function tables(markdown: string): Table[] {
  const lines = markdown.split('\n');
  const found: Table[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.trim().startsWith('|') || !isDivider(next)) continue;

    const headers = splitRow(line);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = lines[j] ?? '';
      if (!row.trim().startsWith('|')) break;
      rows.push(splitRow(row));
    }
    found.push({ headers, rows });
    i = j - 1;
  }
  return found;
}

/**
 * The markdown under a heading, up to the next heading of the same or higher
 * level. Matching is on the heading text, case-insensitively, because the
 * corpus capitalises inconsistently across files.
 */
export function section(markdown: string, heading: string | RegExp): string | undefined {
  const lines = markdown.split('\n');
  const matches = (text: string): boolean =>
    heading instanceof RegExp ? heading.test(text) : text.toLowerCase() === heading.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i] ?? '');
    if (!m) continue;
    const level = (m[1] ?? '').length;
    if (!matches((m[2] ?? '').trim())) continue;

    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const deeper = /^(#{1,6})\s+/.exec(lines[j] ?? '');
      if (deeper && (deeper[1] ?? '').length <= level) break;
      body.push(lines[j] ?? '');
    }
    return body.join('\n');
  }
  return undefined;
}

/** Bullet items of the form `- **Name** — description`, as [name, description]. */
export function definitionBullets(markdown: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/.exec(line);
    if (m) out.push([(m[1] ?? '').trim(), (m[2] ?? '').trim()]);
  }
  return out;
}
