import { plain, tables } from '../markdown.js';
import type { Activation, ActivationRow } from '../types.js';

/**
 * The activation matrix decides which of Departments 35–47 run at a given
 * system level. It is the gate that stops a portfolio site receiving a
 * microfrontend lecture, so it is read from the corpus rather than restated.
 */

/** The corpus draws activation as glyphs; this is the only place they are interpreted. */
const GLYPHS: readonly (readonly [RegExp, Activation])[] = [
  [/●●\s*\+\s*RT/i, 'full-plus-realtime'],
  [/●●/, 'full-plus'],
  [/●/, 'full'],
  [/◐/, 'baseline'],
  [/^[—–-]$/, 'off'],
];

function readGlyph(cell: string, context: string): Activation {
  const text = plain(cell);
  for (const [pattern, activation] of GLYPHS) {
    if (pattern.test(text)) return activation;
  }
  throw new Error(`00-frontend-classification.md: unreadable activation "${text}" (${context})`);
}

export function parseActivationMatrix(classification: string): ActivationRow[] {
  // The matrix is the only six-level table in the file: header L0..L5.
  const matrix = tables(classification).find(
    (t) => t.headers.length === 7 && /L0/i.test(t.headers[1] ?? ''),
  );
  if (!matrix) throw new Error('00-frontend-classification.md: activation matrix not found');

  return matrix.rows.map((row) => {
    const label = plain(row[0] ?? '');
    const id = Number.parseInt(label, 10);
    if (!Number.isInteger(id)) {
      throw new Error(`00-frontend-classification.md: no department id in "${label}"`);
    }
    const cells = row.slice(1, 7);
    if (cells.length !== 6) {
      throw new Error(`00-frontend-classification.md: department ${id} has ${cells.length} levels, expected 6`);
    }
    const byLevel = cells.map((c, level) => readGlyph(c, `dept ${id} L${level}`)) as ActivationRow['byLevel'];

    return {
      departmentId: id,
      departmentName: label.replace(/^\d+\s*/, '').trim(),
      byLevel,
    };
  });
}
