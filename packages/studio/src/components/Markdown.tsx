import { Fragment, type ReactElement, type ReactNode } from 'react';

/**
 * Markdown, the small subset a department writes, as React elements.
 *
 * Department outputs and briefs are Markdown, and until now the studio showed
 * them as raw text — headings as `##`, bold as asterisks. A full renderer
 * would turn that text into HTML, and text a model wrote is not text this
 * page should inject as HTML. So this builds elements directly: headings,
 * paragraphs, bullet and numbered lists, blockquotes, code, bold, italic,
 * links. Anything it does not recognise is shown as the text it is.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;
const RULE = /^(-{3,}|\*{3,})\s*$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Bold, italic, code and links inside a line. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*[^*\n]+\*(?![\w*])|_[^_\n]+_)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith('**')) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      out.push(<a key={key++} href={match[2]} target="_blank" rel="noreferrer">{label}</a>);
    } else out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, className }: { text: string; className?: string | undefined }): ReactElement {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={key++}>{inline(paragraph.join(' '))}</p>);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) { code.push(lines[i] ?? ''); i += 1; }
      i += 1;
      blocks.push(<pre key={key++}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const level = Math.min(heading[1]?.length ?? 1, 6);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={key++}>{inline(heading[2] ?? '')}</Tag>);
      i += 1;
      continue;
    }

    if (RULE.test(line)) { flush(); blocks.push(<hr key={key++} />); i += 1; continue; }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const ordered = NUMBERED.test(line);
      const re = ordered ? NUMBERED : BULLET;
      const items: ReactNode[] = [];
      while (i < lines.length && re.test(lines[i] ?? '')) {
        items.push(<li key={items.length}>{inline((lines[i] ?? '').match(re)?.[1] ?? '')}</li>);
        i += 1;
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').match(QUOTE)?.[1] ?? '');
        i += 1;
      }
      blocks.push(<blockquote key={key++}><Markdown text={quoted.join('\n')} /></blockquote>);
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      flush();
      const cells = (row: string): string[] =>
        (row.match(TABLE_ROW)?.[1] ?? '').split('|').map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? '')) { rows.push(cells(lines[i] ?? '')); i += 1; }
      blocks.push(
        <table key={key++}>
          <thead><tr>{head.map((h, n) => <th key={n}>{inline(h)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, n) => <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c)}</td>)}</tr>)}
          </tbody>
        </table>,
      );
      continue;
    }

    if (line.trim() === '') { flush(); i += 1; continue; }

    paragraph.push(line.trim());
    i += 1;
  }
  flush();

  return <div className={`markdown${className ? ` ${className}` : ''}`}>{blocks.map((b, n) => <Fragment key={n}>{b}</Fragment>)}</div>;
}

/**
 * The `## Summary` section of a department's body, if it wrote one.
 *
 * Every department is asked to open with one. Where it did not — an older
 * run, a model that ignored the instruction — the opening of the body stands
 * in, cut at a paragraph, so the reader gets *something* rather than a blank.
 */
export function summaryOf(body: string): { text: string; isSummary: boolean } {
  const normalised = body.replace(/\r\n/g, '\n');
  // `$(?![\s\S])` is end-of-text; a plain `$` under the `m` flag would stop
  // the lazy capture at the first line break.
  const match = normalised.match(/^##\s+Summary[ \t]*\n([\s\S]*?)(?=\n#{1,6}\s|$(?![\s\S]))/m);
  if (match?.[1]?.trim()) return { text: match[1].trim(), isSummary: true };
  const paragraphs = normalised.split(/\n\s*\n/).filter((p) => p.trim());
  let out = '';
  for (const p of paragraphs) {
    if (out.length + p.length > 700) break;
    out += (out ? '\n\n' : '') + p;
  }
  return { text: out || normalised.slice(0, 700), isSummary: false };
}
