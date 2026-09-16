#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { corpusRoot } from '../corpus.js';

/**
 * Compares the vendored corpus against the installed EDSAI skill.
 *
 * The vendored copy is what the build parses and what CI pins; the installed
 * skill is what the model reads in a Claude Code session. They are meant to be
 * the same document. This reports where they are not, and — because overwriting
 * either one silently is how a rubric quietly stops matching its own corpus —
 * copies nothing unless explicitly told to.
 */

const SKILL_ENV = 'EDSAI_SKILL_DIR';

/**
 * Several installed skills ship a SKILL.md beside a references/ directory, so
 * shape alone is not enough to identify EDSAI — the first match would be
 * whichever skill the walk reached first. The corpus names itself in its own
 * first lines, so that is what we match on.
 */
function isEdsai(dir: string): boolean {
  try {
    const head = readFileSync(join(dir, 'SKILL.md'), 'utf8').slice(0, 2000);
    return /Every Design Specialist AI|# EDSAI\b/.test(head);
  } catch {
    return false;
  }
}

function findInstalledSkill(): string | undefined {
  const fromEnv = process.env[SKILL_ENV];
  if (fromEnv) return existsSync(join(fromEnv, 'SKILL.md')) ? fromEnv : undefined;

  const home = process.env['HOME'] ?? '';
  const roots = [join(home, '.claude', 'skills'), join(home, '.claude', 'skills', 'synced')];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      if (!dir) continue;
      if (existsSync(join(dir, 'references')) && isEdsai(dir)) return dir;
      for (const entry of readdirSync(dir)) {
        const child = join(dir, entry);
        try {
          if (statSync(child).isDirectory()) stack.push(child);
        } catch { /* unreadable entry: not our business */ }
      }
    }
  }
  return undefined;
}

function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

const read = (root: string, file: string): string | undefined =>
  existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : undefined;

function main(): void {
  const args = new Set(process.argv.slice(2));
  const pull = args.has('--pull');
  const push = args.has('--push');

  if (pull && push) {
    console.error('corpus:diff — choose --pull or --push, not both');
    process.exit(2);
  }

  const vendored = corpusRoot();
  const installed = findInstalledSkill();

  if (!installed) {
    console.error(
      `corpus:diff — no installed EDSAI skill found.\n` +
      `  Set ${SKILL_ENV} to the skill directory to compare against it.`,
    );
    process.exit(1);
  }

  console.log(`vendored:  ${vendored}`);
  console.log(`installed: ${installed}\n`);

  const files = [...new Set([...markdownFiles(vendored), ...markdownFiles(installed)])].sort();
  let differing = 0;
  let onlyVendored = 0;
  let onlyInstalled = 0;

  for (const file of files) {
    const a = read(vendored, file);
    const b = read(installed, file);

    if (a === undefined) { onlyInstalled++; console.log(`  only in skill    ${file}`); continue; }
    if (b === undefined) { onlyVendored++; console.log(`  only in repo     ${file}`); continue; }
    if (a === b) continue;

    differing++;
    const da = a.split('\n').length;
    const db = b.split('\n').length;
    console.log(`  differs          ${file}  (repo ${da} lines, skill ${db} lines)`);
  }

  const clean = differing === 0 && onlyVendored === 0 && onlyInstalled === 0;
  console.log(
    `\n${files.length} files compared — ` +
    `${differing} differ, ${onlyVendored} only in repo, ${onlyInstalled} only in skill`,
  );

  if (clean) { console.log('corpus is in sync'); return; }

  if (!pull && !push) {
    console.log('\nnothing copied. Re-run with --pull (skill → repo) or --push (repo → skill).');
    process.exit(1);
  }

  const [from, to] = pull ? [installed, vendored] : [vendored, installed];
  let copied = 0;
  for (const file of files) {
    const source = read(from, file);
    if (source === undefined || source === read(to, file)) continue;
    const target = join(to, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, source);
    copied++;
  }
  console.log(`\n${pull ? 'pulled' : 'pushed'} ${copied} file(s)`);
}

main();
