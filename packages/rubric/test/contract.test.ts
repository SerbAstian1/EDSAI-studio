import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRubric, corpusRoot, Score, ScoreValue, Rubric } from '../src/index.js';

/** A throwaway copy of the corpus, so a tamper test never touches the real one. */
function copyCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edsai-corpus-'));
  cpSync(corpusRoot(), join(dir, 'corpus'), { recursive: true });
  return join(dir, 'corpus');
}

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(join(temps.pop() ?? '', '..'), { recursive: true, force: true });
});

describe('score schema', () => {
  it('accepts a score with a justification', () => {
    expect(() =>
      Score.parse({ dimension: 'Brand Fidelity', value: 8, justification: 'Traces to the mark.' }),
    ).not.toThrow();
  });

  it('rejects a score with no justification, per §1', () => {
    expect(() => Score.parse({ dimension: 'Brand Fidelity', value: 8, justification: '' })).toThrow();
  });

  it('rejects a missing justification outright', () => {
    expect(() => Score.parse({ dimension: 'Brand Fidelity', value: 8 })).toThrow();
  });

  it('rejects a non-integer score', () => {
    expect(() => ScoreValue.parse(7.5)).toThrow();
  });

  it('rejects a score outside 1–10', () => {
    expect(() => ScoreValue.parse(0)).toThrow();
    expect(() => ScoreValue.parse(11)).toThrow();
  });

  it('defaults inverse to false so direction is never ambiguous by omission', () => {
    expect(Score.parse({ dimension: 'X', value: 5, justification: 'y' }).inverse).toBe(false);
  });
});

describe('rubric schema', () => {
  it('requires exactly four universal dimensions', () => {
    const r = buildRubric();
    expect(() => Rubric.parse({ ...r, universalDimensions: r.universalDimensions.slice(1) })).toThrow();
  });

  it('requires exactly four severities', () => {
    const r = buildRubric();
    expect(() => Rubric.parse({ ...r, severities: r.severities.slice(1) })).toThrow();
  });
});

/**
 * The corpus and the software must not drift apart silently. These tests edit a
 * copy of the corpus and assert the build notices — this is the mechanism §12
 * names as the mitigation for "someone edits a scorecard table in markdown; the
 * app keeps the old dimensions".
 */
describe('drift contract', () => {
  it('builds cleanly from an untouched copy of the corpus', () => {
    const root = copyCorpus();
    temps.push(root);
    expect(() => buildRubric(root)).not.toThrow();
    expect(buildRubric(root).departments).toHaveLength(28);
  });

  it('notices a dimension added to a department file', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'references', '04-motion-system.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      text.replace(
        /\| \*\*Restraint\*\*/,
        '| **Invented Dimension** | nine | three |\n| **Restraint**',
      ),
    );

    const drifted = buildRubric(root);
    expect(drifted.drift.some((d) => d.dimension === 'Invented Dimension')).toBe(true);
    expect(drifted.departments.find((d) => d.id === 6)?.dimensions).toHaveLength(4);
  });

  it('notices a dimension removed from a department file', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'references', '04-motion-system.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(/\| \*\*Restraint\*\*[^\n]*\n/, ''));

    const drifted = buildRubric(root);
    expect(
      drifted.drift.some((d) => d.kind === 'missing-from-department' && d.dimension === 'Restraint'),
    ).toBe(true);
  });

  it('fails the build on an activation glyph it cannot read', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'references', '00-frontend-classification.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('| 46 Advanced Architecture | — |', '| 46 Advanced Architecture | ? |'));

    expect(() => buildRubric(root)).toThrow(/unreadable activation/);
  });

  it('fails the build when a pipeline table loses its reference file', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'SKILL.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('`references/01-strategy-and-direction.md` |', 'TBD |'));

    expect(() => buildRubric(root)).toThrow(/no reference file/);
  });

  it('fails the build when the activation matrix loses a level column', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'references', '00-frontend-classification.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('| 35 Browser Engineering | ● | ● | ● | ● | ● | ● |',
                                     '| 35 Browser Engineering | ● | ● | ● | ● | ● |'));

    expect(() => buildRubric(root)).toThrow();
  });

  it('fails the build when a composition family loses its structures', () => {
    const root = copyCorpus();
    temps.push(root);
    const file = join(root, 'references', 'composition-frameworks.md');
    const text = readFileSync(file, 'utf8');
    const start = text.indexOf('### Family: Radial & Focal');
    const end = text.indexOf('### Family: Line-Driven');
    writeFileSync(file, text.slice(0, start) + '### Family: Radial & Focal (x)\n\n' + text.slice(end));

    expect(() => buildRubric(root)).toThrow(/has no structures/);
  });
});
