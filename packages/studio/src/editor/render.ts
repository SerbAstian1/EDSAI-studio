import type { CanvasDocument, CanvasImageProperties, CanvasNode } from '../api.js';
import { escapeXml, wrap } from '../components/toolkit.js';
import { paintOrder } from './document.js';

/**
 * A design, as SVG.
 *
 * **One renderer, and it is the product.** The canvas shows this string and the
 * export writes this string, so §37's "the exported artwork visually matches the
 * editor" is not a thing to test for — it is a thing that cannot fail, because
 * there is no second rendering path to disagree with the first. The selection
 * box, the guides and the marquee are deliberately *not* in here: they live in an
 * overlay beside it, which is why dragging a handle does not put a blue outline
 * into the exported file.
 *
 * **Everything is SVG 1.1 and CSS basics.** No filter that renders in a browser
 * and disappears when the string is rasterised, because the whole export story
 * is "draw this string to a canvas at N times the size". A feature that cannot
 * survive that journey is a feature that would export wrong, which is worse than
 * a feature that was never offered.
 */

const num = (value: number): string => (Math.round(value * 100) / 100).toString();

/** The `preserveAspectRatio` each fit mode means, for an `<image>`. */
const FIT: Record<CanvasImageProperties['fit'], string> = {
  fill: 'none',
  contain: 'xMidYMid meet',
  cover: 'xMidYMid slice',
};

/** The blend modes a node can be composited with, as CSS. */
const BLEND_CSS = 'mix-blend-mode:';

/* ------------------------------------------------------------------ effects */

/**
 * The filter chain for one node, or nothing.
 *
 * Blur before shadow, which is the order `filter: blur() drop-shadow()` applies
 * them in CSS, so a node with both looks the same here as it would in a
 * stylesheet. `color-interpolation-filters` is set because the SVG default is
 * linearRGB and a shadow computed in linear space is visibly lighter than one
 * computed in sRGB — the difference between a shadow and no shadow at all.
 */
function filterFor(node: CanvasNode, defs: string[]): string | undefined {
  const { blur, shadow } = node.effects;
  if (blur <= 0 && !shadow.enabled) return undefined;
  const id = `fx-${node.id}`;
  const steps: string[] = [];
  if (blur > 0) steps.push(`<feGaussianBlur stdDeviation="${num(blur / 2)}"/>`);
  if (shadow.enabled) {
    steps.push(
      `<feDropShadow dx="${num(shadow.x)}" dy="${num(shadow.y)}" stdDeviation="${num(shadow.blur / 2)}"`
      + ` flood-color="${escapeXml(shadow.color)}" flood-opacity="${num(shadow.opacity)}"/>`,
    );
  }
  defs.push(
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${steps.join('')}</filter>`,
  );
  return `url(#${id})`;
}

/**
 * Brightness, contrast and saturation, as three primitives.
 *
 * Contrast as a linear slope with the intercept that puts 50% grey back where it
 * was — the textbook `c·x + (0.5 - 0.5c)` — so turning contrast up darkens the
 * shadows rather than only brightening the highlights. Always emitted, even at
 * 1, so a neutral adjustment is an identity transform rather than the absence of
 * one; a document that renders differently depending on whether a filter element
 * happens to be present is not a document that exports reliably.
 */
function adjustmentFilter(props: CanvasImageProperties, id: string, defs: string[]): string {
  const { brightness, contrast, saturation } = props.adjustments;
  const offset = 0.5 - 0.5 * contrast;
  const slope = num(brightness * contrast);
  const intercept = num(brightness * offset);
  const channel = (): string =>
    `<feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>`
    + `<feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>`
    + `<feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>`;
  const filterId = `adj-${id}`;
  defs.push(
    `<filter id="${filterId}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feColorMatrix type="saturate" values="${num(saturation)}"/>`
    + `<feComponentTransfer>${channel()}</feComponentTransfer>`
    + '</filter>',
  );
  return `url(#${filterId})`;
}

/* ------------------------------------------------------------------- pieces */

/** A rounded clipping path, for the two node kinds that can have corners. */
function clipFor(id: string, x: number, y: number, width: number, height: number, radius: number, defs: string[]): string {
  const clipId = `clip-${id}`;
  const r = Math.min(radius, width / 2, height / 2);
  defs.push(
    r > 0
      ? `<clipPath id="${clipId}"><rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${num(r)}"/></clipPath>`
      : `<clipPath id="${clipId}"><rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"/></clipPath>`,
  );
  return `url(#${clipId})`;
}

/**
 * Words onto lines, sized to the node's width.
 *
 * **A measurement, not a layout.** SVG has no line breaker, and the editor has to
 * agree with the exporter exactly — so the same estimate is used by both, and it
 * is the same one the rest of the hub's tools make. What this gives up (a line
 * that ends a millimetre early on a very wide node) is worth far less than two
 * renderers disagreeing about where the lines fell.
 */
export function textLines(text: string, width: number, fontSize: number, letterSpacing: number): string[] {
  const perChar = fontSize * 0.52 * (1 + letterSpacing);
  const maxChars = Math.max(1, Math.floor(width / Math.max(1, perChar)));
  return wrap(text, maxChars);
}

/** A text node, as `<text>`. */
function renderText(node: Extract<CanvasNode, { type: 'text' }>): string {
  const p = node.properties;
  const words = p.transform === 'uppercase' ? p.text.toUpperCase()
    : p.transform === 'lowercase' ? p.text.toLowerCase() : p.text;
  const lines = textLines(words, node.width, p.fontSize, p.letterSpacing);
  const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
  const at = p.align === 'center' ? node.x + node.width / 2
    : p.align === 'right' ? node.x + node.width : node.x;
  const advance = p.fontSize * p.lineHeight;
  // The first baseline sits on the ascent rather than on the top edge, so a
  // single line of 48px type looks like 48px type rather than like a 48px box.
  let baseline = node.y + p.fontSize * 0.82;
  const body = lines.map((line) => {
    const span = `<tspan x="${num(at)}" y="${num(baseline)}">${escapeXml(line)}</tspan>`;
    baseline += advance;
    return span;
  }).join('');

  return `<text font-family="${escapeXml(p.fontFamily)}" font-weight="${p.fontWeight}" font-size="${num(p.fontSize)}"`
    + ` letter-spacing="${num(p.fontSize * p.letterSpacing)}" text-anchor="${anchor}"`
    + ` fill="${escapeXml(p.color)}" xml:space="preserve">${body}</text>`;
}

/** A picture, clipped to its box, with the file's adjustments applied. */
function renderImage(
  node: Extract<CanvasNode, { type: 'image' }>, href: string, defs: string[],
): string {
  const p = node.properties;
  const clip = clipFor(node.id, node.x, node.y, node.width, node.height, p.cornerRadius, defs);
  return `<g clip-path="${clip}">`
    + `<image href="${escapeXml(href)}" x="${num(node.x)}" y="${num(node.y)}"`
    + ` width="${num(node.width)}" height="${num(node.height)}"`
    + ` preserveAspectRatio="${FIT[p.fit]}" filter="${adjustmentFilter(p, node.id, defs)}"/>`
    + '</g>';
}

/**
 * An illustration part: a picture that may be flipped and knocked into a colour.
 *
 * The tint is a mask rather than a fill, so the *shape* of the part is kept and
 * only its colour changes. That is what the Illustration Builder already does
 * and what keeps an illustration looking like the drawing it came from rather
 * than like a silhouette of it.
 */
function renderIllustration(
  node: Extract<CanvasNode, { type: 'illustration' }>, href: string, defs: string[],
): string {
  const p = node.properties;
  const clip = clipFor(node.id, node.x, node.y, node.width, node.height, p.cornerRadius, defs);
  const image = `<image href="${escapeXml(href)}" x="${num(node.x)}" y="${num(node.y)}"`
    + ` width="${num(node.width)}" height="${num(node.height)}"`
    + ` preserveAspectRatio="${FIT[p.fit]}"/>`;
  // The flip is a mirror about the box's own centre line, so a part that is
  // flipped in the editor is flipped in the file by the same amount — not about
  // the artboard's origin, which is what a bare `scale(-1 1)` would do.
  const flip = p.flip
    ? ` transform="translate(${num(2 * (node.x + node.width / 2))} 0) scale(-1 1)"`
    : '';
  if (!p.tint) return `<g clip-path="${clip}"${flip}>${image}</g>`;

  const maskId = `tint-${node.id}`;
  defs.push(
    `<mask id="${maskId}" style="mask-type:alpha" maskUnits="userSpaceOnUse"`
    + ` x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}">${image}</mask>`,
  );
  return `<g clip-path="${clip}"${flip}>`
    + `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}"`
    + ` fill="${escapeXml(p.tint)}" mask="url(#${maskId})"/>`
    + '</g>';
}

/**
 * A tiled pattern, or a texture.
 *
 * **The two are one element with different knobs**, so they are one function.
 * A pattern names a tile size and a colour wash; a texture names a scale, its own
 * opacity and its own blend, because a texture is *meant* to sit under things
 * while a pattern is meant to be the thing. The wash is multiplied inside the
 * tile, so the pattern's colour reads as ink on the artwork rather than as a
 * rectangle of colour over it.
 */
function renderPattern(
  node: Extract<CanvasNode, { type: 'pattern' | 'texture' }>,
  href: string,
  defs: string[],
): string {
  const tile = node.type === 'pattern' ? node.properties.tile : node.properties.scale;
  const rotation = node.type === 'pattern' ? node.properties.rotation : 0;
  const offsetX = node.type === 'pattern' ? node.properties.offsetX : 0;
  const offsetY = node.type === 'pattern' ? node.properties.offsetY : 0;
  const washColour = node.properties.color;
  const washBlend = node.type === 'texture' ? node.properties.blend : 'multiply';
  const washAlpha = node.type === 'texture' ? node.properties.opacity : 1;
  const id = `tile-${node.id}`;
  const transform = rotation === 0 && offsetX === 0 && offsetY === 0
    ? ''
    : ` patternTransform="rotate(${num(rotation)}) translate(${(offsetX * tile).toFixed(2)} ${(offsetY * tile).toFixed(2)})"`;
  const wash = washColour
    ? `<rect width="${num(tile)}" height="${num(tile)}" fill="${escapeXml(washColour)}"`
    + ` style="${BLEND_CSS}${washBlend}"/>`
    : '';
  defs.push(
    `<pattern id="${id}" width="${num(tile)}" height="${num(tile)}" patternUnits="userSpaceOnUse"${transform}>`
    + `<image href="${escapeXml(href)}" width="${num(tile)}" height="${num(tile)}" preserveAspectRatio="xMidYMid slice"/>`
    + wash
    + '</pattern>',
  );
  const clip = clipFor(node.id, node.x, node.y, node.width, node.height, 0, defs);
  const alpha = washAlpha < 1 ? ` opacity="${num(washAlpha)}"` : '';
  return `<g clip-path="${clip}"${alpha}>`
    + `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" fill="url(#${id})"/>`
    + '</g>';
}

/** A vector primitive. */
function renderShape(node: Extract<CanvasNode, { type: 'shape' }>): string {
  const p = node.properties;
  const x = num(node.x);
  const y = num(node.y);
  const w = num(node.width);
  const h = num(node.height);
  const stroke = p.strokeWidth > 0
    ? ` stroke="${escapeXml(p.stroke)}" stroke-width="${num(p.strokeWidth)}"`
    : '';
  const common = `fill="${escapeXml(p.fill)}"${stroke}`;
  switch (p.shape) {
    case 'ellipse':
      return `<ellipse cx="${num(node.x + node.width / 2)}" cy="${num(node.y + node.height / 2)}" rx="${num(node.width / 2)}" ry="${num(node.height / 2)}" ${common}/>`;
    case 'line':
      return `<line x1="${x}" y1="${y}" x2="${num(node.x + node.width)}" y2="${num(node.y + node.height)}" ${common}/>`;
    case 'arrow':
      return `<line x1="${x}" y1="${y}" x2="${num(node.x + node.width)}" y2="${num(node.y + node.height)}" ${common}`
        + ` marker-end="url(#arrow-${node.id})"/>`;
    case 'polygon': {
      const points = p.points.length >= 6 ? p.points : [0.5, 0, 1, 0.38, 0.81, 1, 0.19, 1, 0, 0.38];
      const pairs: string[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        pairs.push(`${num(node.x + (points[i] ?? 0) * node.width)},${num(node.y + (points[i + 1] ?? 0) * node.height)}`);
      }
      return `<polygon points="${pairs.join(' ')}" ${common}/>`;
    }
    case 'rounded-rectangle':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${num(Math.min(p.cornerRadius, node.width / 2, node.height / 2))}" ${common}/>`;
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/>`;
  }
}

/** The arrowhead an arrow shape needs, drawn once into the defs. */
function arrowHead(node: Extract<CanvasNode, { type: 'shape' }>, defs: string[]): void {
  const size = Math.max(6, Math.min(24, node.properties.strokeWidth * 3 || 12));
  const id = `arrow-${node.id}`;
  defs.push(
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${num(size)}" markerHeight="${num(size)}" orient="auto-start-reverse">`
    + `<path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXml(node.properties.fill)}"/></marker>`,
  );
}

/* ------------------------------------------------------------------ the node */

/**
 * One node, wrapped in the group that carries its placement and effects.
 *
 * The group is unconditional even when it transforms nothing. A `<g>` that is
 * sometimes there and sometimes not is a thing every renderer downstream has to
 * ask about, and one extra empty element costs nothing.
 */
function renderNode(node: CanvasNode, href: (assetId: string) => string, defs: string[]): string {
  if (node.hidden) return '';
  const source = 'assetId' in node.properties ? href(node.properties.assetId) : '';
  let body: string;
  switch (node.type) {
    case 'text': body = renderText(node); break;
    case 'shape': if (node.properties.shape === 'arrow') arrowHead(node, defs); body = renderShape(node); break;
    case 'image': body = source ? renderImage(node, source, defs) : renderMissing(node); break;
    case 'logo': {
      // A logo is a picture that is never cropped, never recoloured and never
      // stretched — so it is drawn as an image with those three turned off, and
      // the distortion the inspector reports stays visible instead of being
      // quietly corrected on the way to the export.
      const asImage: Extract<CanvasNode, { type: 'image' }> = {
        ...node,
        type: 'image',
        properties: {
          ...node.properties,
          fit: 'contain',
          cornerRadius: 0,
          adjustments: { brightness: 1, contrast: 1, saturation: 1 },
        },
      };
      body = source ? renderImage(asImage, source, defs) : renderMissing(node);
      break;
    }
    case 'illustration': body = source ? renderIllustration(node, source, defs) : renderMissing(node); break;
    case 'pattern':
    case 'texture': body = source ? renderPattern(node, source, defs) : ''; break;
    case 'group': body = ''; break;
  }

  const { opacity, blend } = node.effects;
  const style = blend === 'normal' ? '' : ` style="${BLEND_CSS}${blend}"`;
  const alpha = opacity >= 1 ? '' : ` opacity="${num(opacity)}"`;
  const transform = node.rotation === 0
    ? ''
    : ` transform="rotate(${num(node.rotation)} ${num(node.x + node.width / 2)} ${num(node.y + node.height / 2)})"`;
  const filter = filterFor(node, defs);
  const effects = `${alpha}${filter ? ` filter="${filter}"` : ''}`;

  return `<g id="n-${node.id}" data-node="${node.id}"${transform}${effects}${style}>${body}</g>`;
}

/**
 * A layer whose file has gone.
 *
 * **Visible, and honest.** A design that referenced an asset which was later
 * deleted still has to open (§62: a missing asset must not crash the editor), and
 * a silent gap would look like a mistake in the design rather than in the
 * library. So the layer keeps its place, keeps its size, and says so.
 */
function renderMissing(node: CanvasNode): string {
  const label = node.name;
  return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}"`
    + ' fill="none" stroke="#B3B7BD" stroke-width="2" stroke-dasharray="8 6"/>'
    + `<text x="${num(node.x + 12)}" y="${num(node.y + 22)}" font-family="Inter, sans-serif" font-size="13"`
    + ` fill="#8B9199">${escapeXml(`${label} — file missing`)}</text>`;
}

/* --------------------------------------------------------------- the design */

/**
 * The whole design as an SVG string.
 *
 * `href` is injected rather than imported so the same string works in two
 * places: the editor hands it a route to the API, and the export hands it a
 * data URL. Nothing here reaches for a URL of its own, which is what lets one
 * function serve both.
 */
export function designSvg(
  doc: CanvasDocument,
  href: (assetId: string) => string,
): string {
  const { width, height, background } = doc.artboard;
  const defs: string[] = [];
  const body = paintOrder(doc).map((node) => renderNode(node, href, defs)).join('');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`;
  const defsBlock = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
  const ground = `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`;
  return head + defsBlock + ground + body + '</svg>';
}

/**
 * A structured export file name.
 *
 * §50: `{client}-{design}-{format}-{w}x{h}.{ext}`. The client comes first because
 * that is the word a studio sorts by, the size is in the name because two
 * exports of the same design at 1× and 2× sitting in one folder with one name
 * between them is how the wrong one gets posted.
 */
export function exportName(
  client: string, name: string, format: string, width: number, height: number,
): string {
  const slug = (value: string, fallback: string): string =>
    (value.trim() || fallback).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback;
  return `${slug(client, 'client')}-${slug(name, 'design')}-${format}-${width}x${height}`;
}
