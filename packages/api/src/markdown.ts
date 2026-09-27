import { escapeHtml } from '@edsai/hub';

/**
 * The small Markdown subset a department writes, as HTML for a print route.
 *
 * The studio renders the same subset as React elements in
 * `components/Markdown.tsx`; this is the server's half of one pair, so a page
 * that reads one way on screen and another in the client's PDF is not
 * possible. Both are deliberately small: a full renderer is a dependency with
 * its own ideas about what HTML is, and every one of those ideas is a way for
 * a transcript to become script.
 *
 * So nothing here produces a tag the source did not ask for. Every character
 * that reaches the output has been through `escapeHtml` first, which is the
 * whole safety argument: the tokenisers below match on the raw line and emit
 * only their own literal tags around escaped text.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;
const RULE = /^(-{3,}|\*{3,})\s*$/;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*[^*\n]+\*(?![\w*])|_[^_\n]+_)/g;

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  const paragraph: string[] = [];
  let i = 0;

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
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
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const level = Math.min(heading[1]?.length ?? 1, 6);
      blocks.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      i += 1;
      continue;
    }

    if (RULE.test(line)) { flush(); blocks.push('<hr>'); i += 1; continue; }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const ordered = NUMBERED.test(line);
      const re = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i] ?? '')) {
        items.push(`<li>${inline(lines[i]?.match(re)?.[1] ?? '')}</li>`);
        i += 1;
      }
      blocks.push(ordered
        ? `<ol>${items.join('')}</ol>`
        : `<ul>${items.join('')}</ul>`);
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push(lines[i]?.match(QUOTE)?.[1] ?? '');
        i += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    if (line.trim() === '') { flush(); i += 1; continue; }

    paragraph.push(line.trim());
    i += 1;
  }
  flush();

  return blocks.join('\n');
}

/** Bold, italic, code and links inside one line. */
function inline(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out += escapeHtml(text.slice(last, index));
    const token = match[0];
    if (token.startsWith('**')) out += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else if (token.startsWith('`')) out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (token.startsWith('[')) {
      // The URL is matched against `https?://` before it gets here, so it is
      // escaped as a value and never trusted as markup.
      const label = token.slice(1, token.indexOf(']'));
      out += `<a href="${escapeHtml(match[2] ?? '')}" rel="noreferrer">${escapeHtml(label)}</a>`;
    } else out += `<em>${escapeHtml(token.slice(1, -1))}</em>`;
    last = index + token.length;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}
