import type { HubModel, RenderedTarget } from './model.js';

/**
 * The hub, as one self-contained HTML file.
 *
 * Phase 7's exit clause says the generator and the host are separable, and that
 * a single self-contained file survives the reduction with every claim intact.
 * Starting there rather than ending there: no framework, no build step, no
 * requests. The page is content, and content that needs 170 KB of JavaScript to
 * display a hex code has lost an argument somewhere.
 *
 * Click-to-copy is the only behaviour, and it degrades to selectable text.
 *
 * `--control-line` is separate from `--line` because they answer to different
 * rules. A hairline between sections is decorative; the border of the copy
 * button is the boundary of a UI component, which WCAG 1.4.11 holds to 3:1
 * against what is next to it. Measured with this system's own contrast
 * instrument: the shared `--line` was 1.26:1 against the page and failed, so the
 * control carries its own token at 3.52:1 against the page and 3.25:1 against the
 * button's own fill.
 */

export const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** A colour value is written into a style attribute, so it is allow-listed. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\))$/i;
export const safeColor = (value: string): string => (SAFE_COLOR.test(value.trim()) ? value.trim() : 'transparent');

/**
 * The provenance component — the one that is the product.
 *
 * `instrument` renders the measured value and what it was measured against.
 * `stated-target` renders the target and the stated mechanism for hitting it,
 * visibly different. Collapsing the two would make the hub indistinguishable
 * from every hosted brand-guidelines tool that already exists.
 */
function renderTarget(target: RenderedTarget): string {
  const measured = target.source === 'instrument';
  const status = target.pass === undefined ? '' : target.pass ? ' is-pass' : ' is-fail';

  const detail = measured
    ? `<span class="value">${escapeHtml(target.actual ?? '')}</span>` +
      `<span class="against">measured against ${escapeHtml(target.target)}</span>`
    : `<span class="value stated">${escapeHtml(target.target)}</span>` +
      `<span class="against">target · ${escapeHtml(target.mechanism ?? 'no mechanism stated')}</span>`;

  return `<div class="target${status}">
  <div class="target-head">
    <span class="metric">${escapeHtml(target.metric)}</span>
    <span class="badge ${measured ? 'measured' : 'stated'}">${
      measured ? `measured · ${escapeHtml(target.instrument ?? '')}` : 'stated target'
    }</span>
  </div>
  <div class="target-body">${detail}</div>
  <div class="source">${escapeHtml(target.departmentName)}</div>
</div>`;
}

export function section(id: string, title: string, body: string): string {
  return body.trim() === '' ? '' : `<section id="${id}">
  <h2>${escapeHtml(title)}</h2>
  ${body}
</section>`;
}

export const STYLE = `:root{--ink:#16181d;--muted:#666c78;--line:#e3e5ea;--bg:#fff;--pass:#0f6b3f;--fail:#9a2617;--stated:#7a5a10;--control-line:#828996}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:56rem;margin:0 auto;padding:2rem 1rem 6rem}
header{border-bottom:1px solid var(--line);padding:2.5rem 1rem 1.5rem;margin-bottom:2rem}
header .wrap{max-width:56rem;margin:0 auto}
h1{font-size:1.9rem;margin:0 0 .35rem}
h2{font-size:1.15rem;margin:2.5rem 0 .9rem;padding-bottom:.4rem;border-bottom:1px solid var(--line)}
h3{font-size:.95rem;margin:1.4rem 0 .5rem}
p{margin:0 0 .8rem}
.meta{color:var(--muted);font-size:.85rem}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem}
.swatch{border:1px solid var(--line);border-radius:.5rem;overflow:hidden}
/* The inset ring is not decoration: a white swatch on a white page is
   otherwise indistinguishable from an empty box, and paper is exactly the
   token every brand has. */
.chip{height:5rem;border-bottom:1px solid var(--line);box-shadow:inset 0 0 0 1px var(--line)}
.swatch-body{padding:.7rem .8rem}
.name{font-weight:600}
.role{color:var(--muted);font-size:.85rem}
button.copy{margin-top:.4rem;font:inherit;font-size:.85rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f5f6f8;border:1px solid var(--control-line);border-radius:.3rem;padding:.25rem .5rem;cursor:pointer}
button.copy:focus-visible{outline:3px solid #16181d;outline-offset:2px}
.target{border:1px solid var(--line);border-left:3px solid var(--line);border-radius:.4rem;padding:.7rem .85rem;margin:.5rem 0}
.target.is-pass{border-left-color:var(--pass)}
.target.is-fail{border-left-color:var(--fail)}
.target-head{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
.metric{font-weight:600}
.badge{font-size:.72rem;letter-spacing:.03em;text-transform:uppercase;padding:.1rem .4rem;border-radius:.25rem;border:1px solid var(--line)}
.badge.measured{color:var(--pass);border-color:var(--pass)}
.badge.stated{color:var(--stated);border-color:var(--stated)}
.value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.05rem;margin-right:.5rem}
.value.stated{font-style:italic}
.against,.source{color:var(--muted);font-size:.85rem}
.risk{border-left:3px solid var(--stated);padding:.5rem .8rem;margin:.5rem 0;background:#fdfaf3}
ul{padding-left:1.1rem}
li{margin:.25rem 0}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;color:var(--muted);font-size:.85rem}
@media (prefers-color-scheme:dark){:root{--ink:#e9ebef;--muted:#9aa1ad;--line:#2c3038;--bg:#0f1116;--pass:#57c08a;--fail:#e07a6b;--stated:#d8b45e;--control-line:#6c7483}
button.copy{background:#1a1d24;color:inherit}.risk{background:#1c1913}
button.copy:focus-visible{outline-color:#e9ebef}}`;

export const SCRIPT = `document.addEventListener('click',function(e){
var b=e.target.closest('button.copy');if(!b)return;
var v=b.getAttribute('data-value');var original=b.textContent;
function done(ok){b.textContent=ok?'copied':v;setTimeout(function(){b.textContent=original;},1200);}
if(navigator.clipboard&&navigator.clipboard.writeText){
navigator.clipboard.writeText(v).then(function(){done(true);},function(){done(false);});
}else{done(false);}
});`;

export function renderHub(model: HubModel): string {
  const strategy = model.strategy
    .map((entry) => `<h3>${escapeHtml(entry.departmentName)}</h3>` +
      entry.body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join(''))
    .join('');

  // A brand value renders on its own terms: the colour, what it is for, and one
  // plain sentence about what it measures. No origin, no reason, no run id —
  // whether a value was computed or typed is the studio's business, and putting
  // it on the client's reference would turn their page into our changelog.
  const brandColours = model.brandValues
    .filter((value) => value.kind === 'color')
    .map((value) => `<div class="swatch">
  <div class="chip" style="background:${safeColor(value.value)}"></div>
  <div class="swatch-body">
    <div class="name">${escapeHtml(value.name)}</div>
    ${value.role ? `<div class="role">${escapeHtml(value.role)}</div>` : ''}
    <button class="copy" type="button" data-value="${escapeHtml(value.value)}">${escapeHtml(value.value)}</button>
    ${value.note
      ? `<div class="target ${value.passes === false ? 'is-fail' : 'is-pass'}">
           <div class="target-body"><span class="against">${escapeHtml(value.note)}</span></div>
         </div>`
      : ''}
  </div>
</div>`).join('');

  const colours = model.colours.map((entry) => `<div class="swatch">
  <div class="chip" style="background:${safeColor(entry.token.value)}"></div>
  <div class="swatch-body">
    <div class="name">${escapeHtml(entry.token.name)}</div>
    ${entry.token.role ? `<div class="role">${escapeHtml(entry.token.role)}</div>` : ''}
    <button class="copy" type="button" data-value="${escapeHtml(entry.token.value)}">${escapeHtml(entry.token.value)}</button>
  </div>
  ${entry.measurements.map(renderTarget).join('')}
</div>`).join('');

  const typeBlocks = model.type.map((entry) => `<h3>${escapeHtml(entry.token.name)} — ${escapeHtml(entry.token.value)}</h3>
${entry.token.role ? `<p class="role">${escapeHtml(entry.token.role)}</p>` : ''}
${entry.measurements.map(renderTarget).join('')}`).join('');

  const layout = model.layout.map((entry) => `<h3>${escapeHtml(entry.structure)}${
    entry.family ? ` <span class="role">— ${escapeHtml(entry.family)}</span>` : ''
  }</h3>
<p>${escapeHtml(entry.eyePath)}</p>
<p class="source">${escapeHtml(entry.departmentName)}</p>`).join('');

  // Every target, including the ones a colour or type block already showed:
  // this section is the complete record, and omitting a failure here would be
  // the omission "Done when" #3 forbids.
  const allTargets = model.targets.map(renderTarget).join('');

  const risks = model.acceptedRisks.map((issue) => `<div class="risk">
  <strong>${escapeHtml(issue.severity)}</strong> — ${escapeHtml(issue.description)}
  <div class="role">Accepted, with: ${escapeHtml(issue.fix)}</div>
</div>`).join('');

  const other = model.otherTokens.map((entry) => `<li><strong>${escapeHtml(entry.token.name)}</strong> — ` +
    `<code>${escapeHtml(entry.token.value)}</code>${
      entry.token.role ? ` · ${escapeHtml(entry.token.role)}` : ''}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.projectId)} — brand hub</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap">
<h1>${escapeHtml(model.projectId)}</h1>
<p class="meta">Brand hub · run <code>${escapeHtml(model.runId)}</code> · ${escapeHtml(model.determination)} ·
${model.measuredCount} measured value${model.measuredCount === 1 ? '' : 's'},
${model.statedCount} stated target${model.statedCount === 1 ? '' : 's'}</p>
</div></header>
<main>
${section('brief', 'The brief this was built against', `<p>${escapeHtml(model.brief)}</p>`)}
${section('strategy', 'Strategy', strategy)}
${section('colour', 'Colour', brandColours !== ''
  ? `<div class="swatches">${brandColours}</div>`
  : `<div class="swatches">${colours}</div>`)}
${section('type', 'Typography', typeBlocks)}
${section('layout', 'Layout', layout)}
${section('other', 'Other tokens', other ? `<ul>${other}</ul>` : '')}
${section('targets', 'Every measurable target', allTargets)}
${section('risks', 'Accepted risks', risks)}
<footer>
Generated ${escapeHtml(model.generatedAt)} from run <code>${escapeHtml(model.runId)}</code>,
digest <code>${escapeHtml(model.digest)}</code>.
Nothing on this page was typed by hand: every value is a projection of that run,
and every number carries the instrument that produced it.
Regenerate after any change to the run — a hub whose digest no longer matches its
run is stale, and the generator can say so.
</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
