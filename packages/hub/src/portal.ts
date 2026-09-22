import type { ClientFacingValue } from '@edsai/engine';
import { escapeHtml, safeColor, section, STYLE, SCRIPT } from './render.js';

/**
 * The client portal.
 *
 * The brief's instruction was "everything done in the portal", and the word
 * that matters is *everything*: a client should not receive a brand page here
 * and a drive link somewhere else. So this page carries both the brand system
 * and the files, and the files are downloaded from it directly.
 *
 * **Why this is not the hub.** `renderHub` publishes one run as a document: it
 * is keyed to a run, it refuses anything the gate has not cleared, and it is a
 * file you can hand over on a USB stick. The portal is keyed to a *client*, is
 * served live, and has to work on day one — when there are files to send and no
 * run has finished. Both render from the same design system and the same
 * helpers; what differs is what they are about.
 *
 * **What it deliberately does not show.** No origin, no reason, no run id, no
 * unapproved file, no other client. The first three are the studio's business
 * and would turn a client's reference into our changelog. The last two are not
 * a presentation choice at all — `ScopedStore` decides what reaches this
 * function, and this function renders what it is given.
 */

export interface PortalFile {
  id: string;
  filename: string;
  kind: string;
  bytes: number;
  collection?: string;
  description?: string;
}

/** One brand on the positioning chart, already filtered to this session. */
export interface PortalPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  source: 'computed' | 'placed' | 'proposed';
  note?: string;
}

export interface PortalMatrix {
  x: { label: string; low: string; high: string };
  y: { label: string; low: string; high: string };
  points: PortalPoint[];
}

export interface PortalModel {
  clientName: string;
  /** What this session may see, already filtered. Never the whole library. */
  files: PortalFile[];
  brandValues: ClientFacingValue[];
  /** Where they sit against the brands the studio compared them to. */
  matrix?: PortalMatrix;
  /** Set when the session is limited to particular collections. */
  limitedTo?: readonly string[];
  generatedAt: string;
}

/** Bytes as a person reads them — the same rule as the studio's own list. */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the unfiled pile is called. Empty inside the model, so the renderer can
 * tell "the studio named this" from "the studio did not".
 */
const UNFILED = '';

/**
 * Files grouped the way a client looks for them.
 *
 * Alphabetical, with the unfiled pile last. Upload order is the studio's
 * history and means nothing to the person downloading.
 */
export function collections(files: readonly PortalFile[]): [string, PortalFile[]][] {
  const groups = new Map<string, PortalFile[]>();
  for (const file of files) {
    const key = file.collection ?? UNFILED;
    const existing = groups.get(key);
    if (existing) existing.push(file);
    else groups.set(key, [file]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.filename.localeCompare(b.filename));
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === UNFILED) return 1;
    if (b === UNFILED) return -1;
    return a.localeCompare(b);
  });
}

/**
 * The positioning chart, as static SVG.
 *
 * The same distinction the studio sees, kept intact on the way to the client:
 * a **filled** dot was computed from their own answers, a **hollow** one was
 * placed by the studio. Dropping that on the client's copy would be the worst
 * place to drop it — they are the person most likely to mistake a judgement for
 * a finding, and least able to check.
 *
 * No script. The labels are on the chart and the numbers are in the table
 * beneath it, so there is nothing to hover for.
 */
const CHART = 360;
const CHART_PAD = 40;
const CHART_PLOT = CHART - CHART_PAD * 2;

const chartX = (value: number): number => CHART_PAD + (value / 100) * CHART_PLOT;
const chartY = (value: number): number => CHART_PAD + ((100 - value) / 100) * CHART_PLOT;

function renderMatrix(matrix: PortalMatrix): string {
  const points = matrix.points.map((point) => {
    const cx = chartX(point.x);
    const cy = chartY(point.y);
    const computed = point.source === 'computed';
    const flip = point.x > 62;
    return `<circle cx="${cx}" cy="${cy}" r="5"
      fill="${computed ? 'var(--mark)' : 'var(--bg)'}"
      stroke="${computed ? 'var(--bg)' : 'var(--muted)'}" stroke-width="2" />
<text x="${flip ? cx - 11 : cx + 11}" y="${cy + 4}" class="pt"
      text-anchor="${flip ? 'end' : 'start'}">${escapeHtml(point.label)}</text>`;
  }).join('');

  const rows = matrix.points.map((point) => `<tr>
  <td>${escapeHtml(point.label)}</td>
  <td>${Math.round(point.x)}</td>
  <td>${Math.round(point.y)}</td>
  <td>${point.source === 'computed' ? 'Your own answers' : point.source === 'proposed' ? 'Proposed by the studio’s process' : 'Placed by the studio'}</td>
</tr>`).join('');

  return `<figure class="matrix">
<svg viewBox="0 0 ${CHART} ${CHART}" role="img"
     aria-label="${escapeHtml(matrix.x.label)} against ${escapeHtml(matrix.y.label)}">
  <rect x="${CHART_PAD}" y="${CHART_PAD}" width="${CHART_PLOT}" height="${CHART_PLOT}"
        fill="none" stroke="var(--line)" stroke-width="1" />
  <line x1="${chartX(50)}" y1="${CHART_PAD}" x2="${chartX(50)}" y2="${CHART_PAD + CHART_PLOT}"
        stroke="var(--line)" stroke-width="1" />
  <line x1="${CHART_PAD}" y1="${chartY(50)}" x2="${CHART_PAD + CHART_PLOT}" y2="${chartY(50)}"
        stroke="var(--line)" stroke-width="1" />
  <text x="${CHART_PAD}" y="${CHART - 14}" class="pole" text-anchor="start">${escapeHtml(matrix.x.low)}</text>
  <text x="${CHART_PAD + CHART_PLOT}" y="${CHART - 14}" class="pole" text-anchor="end">${escapeHtml(matrix.x.high)}</text>
  <text x="${-(CHART_PAD + CHART_PLOT)}" y="16" class="pole" text-anchor="start" transform="rotate(-90)">${escapeHtml(matrix.y.low)}</text>
  <text x="${-CHART_PAD}" y="16" class="pole" text-anchor="end" transform="rotate(-90)">${escapeHtml(matrix.y.high)}</text>
  ${points}
</svg>
<figcaption>
  <span class="legend"><i class="key computed"></i> From your own answers</span>
  <span class="legend"><i class="key placed"></i> Placed by the studio</span>
</figcaption>
</figure>
<table class="matrix-table">
<thead><tr>
  <th>Brand</th><th>${escapeHtml(matrix.x.label)}</th>
  <th>${escapeHtml(matrix.y.label)}</th><th>Where this came from</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/** Extra portal-only rules, appended to the hub's own stylesheet. */
const PORTAL_STYLE = `
.files{border:1px solid var(--line);border-radius:.5rem;overflow:hidden;margin:.6rem 0 1.4rem}
.file{display:flex;gap:1rem;align-items:baseline;padding:.75rem .9rem;border-bottom:1px solid var(--line);flex-wrap:wrap}
.file:last-child{border-bottom:0}
.file .name{flex:1 1 14rem;min-width:0;word-break:break-word}
.file .size{color:var(--muted);font-size:.85rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.file .desc{flex-basis:100%;color:var(--muted);font-size:.85rem}
a.get{font-size:.9rem;padding:.3rem .7rem;border:1px solid var(--control-line);border-radius:.3rem;text-decoration:none;color:inherit;white-space:nowrap}
a.get:hover{border-color:var(--ink)}
a.get:focus-visible{outline:3px solid #16181d;outline-offset:2px}
.note{color:var(--muted);font-size:.9rem}
.matrix{margin:0 0 1rem;max-width:26rem}
.matrix svg{width:100%;height:auto;display:block}
.matrix .pole{font-size:11px;letter-spacing:.06em;text-transform:uppercase;fill:var(--muted)}
.matrix .pt{font-size:12px;fill:var(--ink)}
.matrix figcaption{display:flex;flex-wrap:wrap;gap:1rem;margin-top:.6rem;font-size:.85rem;color:var(--muted)}
.legend{display:inline-flex;align-items:center;gap:.4rem}
.key{width:10px;height:10px;border-radius:50%;flex:none}
.key.computed{background:var(--mark)}
.key.placed{background:var(--bg);box-shadow:inset 0 0 0 2px var(--muted)}
.matrix-table{width:100%;border-collapse:collapse;font-size:.9rem;margin-bottom:1rem}
.matrix-table th,.matrix-table td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid var(--line)}
.matrix-table th{font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:500}
/* The hub opens with a brief, so its first heading needs the breathing room.
   This page opens straight onto the files, and that space reads as an error. */
main{padding-top:.5rem}
main > section:first-of-type > h2{margin-top:.75rem}
@media (prefers-color-scheme:dark){a.get:focus-visible{outline-color:#e9ebef}}`;

export function renderPortal(model: PortalModel): string {
  // A heading per collection, except when there is only one group: a lone
  // "Everything else" under a section already called Files is a label that
  // tells the reader nothing, and the first version of this page rendered
  // "Files → Files".
  const grouped = collections(model.files);
  const files = grouped.map(([name, group]) => `${
    grouped.length > 1 ? `<h3>${escapeHtml(name === UNFILED ? 'Everything else' : name)}</h3>` : ''
  }
<div class="files">${group.map((file) => `<div class="file">
  <span class="name">${escapeHtml(file.filename)}</span>
  <span class="size">${escapeHtml(readableSize(file.bytes))}</span>
  <a class="get" href="/api/assets/${escapeHtml(file.id)}/download" download>Download</a>
  ${file.description ? `<span class="desc">${escapeHtml(file.description)}</span>` : ''}
</div>`).join('')}</div>`).join('');

  // The same swatch markup the hub uses, and the same rule: a value carries
  // what it measures, or it carries nothing. Nothing is asserted here that the
  // engine did not compute.
  const colours = model.brandValues
    .filter((value) => value.kind === 'color')
    .map((value) => {
      // A value the style allow-list rejects gets no chip. Painting it
      // `transparent` would show the client a white square beside a name and
      // let them believe that is the colour — quietly wrong is worse here than
      // visibly incomplete, and this page's whole claim is that it does not
      // assert what it cannot show.
      const paintable = safeColor(value.value) !== 'transparent'
        || value.value.trim().toLowerCase() === 'transparent';
      return `<div class="swatch">
  ${paintable ? `<div class="chip" style="background:${safeColor(value.value)}"></div>` : ''}
  <div class="swatch-body">
    <div class="name">${escapeHtml(value.name)}</div>
    ${value.role ? `<div class="role">${escapeHtml(value.role)}</div>` : ''}
    <button class="copy" type="button" data-value="${escapeHtml(value.value)}">${escapeHtml(value.value)}</button>
    ${paintable ? '' : '<div class="role">This value is not a colour this page can show. '
      + 'Ask the studio to check it.</div>'}
    ${value.note
      ? `<div class="target ${value.passes === false ? 'is-fail' : 'is-pass'}">
           <div class="target-body"><span class="against">${escapeHtml(value.note)}</span></div>
         </div>`
      : ''}
  </div>
</div>`;
    }).join('');

  const type = model.brandValues
    .filter((value) => value.kind === 'font' || value.kind === 'size')
    .map((value) => `<li><strong>${escapeHtml(value.name)}</strong> — ` +
      `<code>${escapeHtml(value.value)}</code>${
        value.role ? ` · ${escapeHtml(value.role)}` : ''}</li>`).join('');

  const fileCount = model.files.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.clientName)}</title>
<meta name="robots" content="noindex">
<style>${STYLE}${PORTAL_STYLE}</style>
</head>
<body>
<header><div class="wrap">
<h1>${escapeHtml(model.clientName)}</h1>
<p class="meta">Your brand and your files. ${
  fileCount === 0 ? 'No files yet.' : `${fileCount} file${fileCount === 1 ? '' : 's'} to download.`
}${model.limitedTo && model.limitedTo.length > 0
  ? ` This link opens ${model.limitedTo.map(escapeHtml).join(', ')}.`
  : ''}</p>
</div></header>
<main>
${section('files', 'Files', files || (fileCount === 0
  ? '<p class="note">Nothing has been shared with you yet. It will appear here when it is ready — there is no other place to look.</p>'
  : ''))}
${section('position', 'Where you sit', model.matrix && model.matrix.points.length > 0
  ? renderMatrix(model.matrix) : '')}
${section('colour', 'Colour', colours ? `<div class="swatches">${colours}</div>` : '')}
${section('type', 'Typography', type ? `<ul>${type}</ul>` : '')}
<footer>
This page is your copy of record. Every colour on it carries what it was measured
against, and every file on it is one the studio released to you deliberately.
If a link stops working, ask for a new one — that is expected, not a fault.
</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
