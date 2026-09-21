import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the vendored corpus. The corpus is the canonical source for every
 * value in the rubric — the typed output is derived from it and never edited
 * by hand, so that a change to the markdown is the only way to change the rubric.
 */
export function corpusRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'corpus');
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('corpus/ not found: expected a vendored corpus above packages/rubric');
}

/**
 * Every heading and table regex in `markdown.ts` is anchored per line with
 * `$`, which in JavaScript does not cross a `\r` — a file checked out with
 * CRLF line endings (the Windows default before this repo's `.gitattributes`
 * existed) fails every one of those matches silently upstream of here. The
 * corpus itself stays untouched; only what this function hands the parser is
 * normalized.
 */
const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

export function readSkill(root = corpusRoot()): string {
  return toLf(readFileSync(join(root, 'SKILL.md'), 'utf8'));
}

export function readReference(file: string, root = corpusRoot()): string {
  const name = file.replace(/^references\//, '');
  return toLf(readFileSync(join(root, 'references', name), 'utf8'));
}
