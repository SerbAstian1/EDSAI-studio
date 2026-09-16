import { describe, expect, it } from 'vitest';
import { definitionBullets, plain, section, tables } from '../src/markdown.js';

describe('plain', () => {
  it('strips the emphasis the corpus uses for style', () => {
    expect(plain('**Bold**')).toBe('Bold');
    expect(plain('`code`')).toBe('code');
    expect(plain('*italic*')).toBe('italic');
    expect(plain('[label](path.md)')).toBe('label');
  });

  it('leaves prose with no markup alone', () => {
    expect(plain('Rule of Thirds')).toBe('Rule of Thirds');
  });
});

describe('tables', () => {
  const md = [
    '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |',
    '', 'prose', '',
    '| C |', '|---|', '| 5 |',
  ].join('\n');

  it('finds every table in document order', () => {
    const found = tables(md);
    expect(found).toHaveLength(2);
    expect(found[0]?.headers).toEqual(['A', 'B']);
    expect(found[1]?.headers).toEqual(['C']);
  });

  it('keeps rows as cells, not raw text', () => {
    expect(tables(md)[0]?.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('ignores a pipe line with no divider under it', () => {
    expect(tables('| not | a table |\njust prose')).toHaveLength(0);
  });

  it('tolerates rows without leading and trailing pipes', () => {
    const found = tables('| A | B |\n|---|---|\n| x | y |');
    expect(found[0]?.rows[0]).toEqual(['x', 'y']);
  });
});

describe('section', () => {
  const md = '# Top\nintro\n\n## One\nalpha\n\n### Nested\nbeta\n\n## Two\ngamma';

  it('returns a section body up to the next heading of the same level', () => {
    expect(section(md, 'One')).toContain('alpha');
    expect(section(md, 'One')).toContain('beta');
    expect(section(md, 'One')).not.toContain('gamma');
  });

  it('matches case-insensitively, because the corpus capitalises inconsistently', () => {
    expect(section(md, 'one')).toContain('alpha');
  });

  it('accepts a pattern', () => {
    expect(section(md, /^Tw/)).toContain('gamma');
  });

  it('returns undefined for a heading that is not there', () => {
    expect(section(md, 'Missing')).toBeUndefined();
  });
});

describe('definitionBullets', () => {
  it('reads "- **Name** — description" pairs', () => {
    const got = definitionBullets('- **Symmetry** — both halves mirror\n- **Contrast** — pushed far apart');
    expect(got).toEqual([
      ['Symmetry', 'both halves mirror'],
      ['Contrast', 'pushed far apart'],
    ]);
  });

  it('ignores bullets with no bolded name', () => {
    expect(definitionBullets('- just a bullet')).toEqual([]);
  });
});
