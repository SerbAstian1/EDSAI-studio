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

export function readSkill(root = corpusRoot()): string {
  return readFileSync(join(root, 'SKILL.md'), 'utf8');
}

export function readReference(file: string, root = corpusRoot()): string {
  const name = file.replace(/^references\//, '');
  return readFileSync(join(root, 'references', name), 'utf8');
}
