import { useEffect, useRef, type ReactElement } from 'react';
import type { Asset, BrandValue } from '../api.js';
import { downloadFile } from './actions.js';

/**
 * What every Brand Hub tool shares: the dials, the brand swatches, the live
 * SVG preview, and export. A tool is a renderer that turns a configuration
 * into an SVG string plus the controls that edit that configuration —
 * everything else is here, once.
 *
 * Export never leaves the browser. The SVG the client sees is the SVG that
 * exports: serialised as-is for SVG, or drawn to a canvas for PNG, with
 * every image inlined first so the file stands on its own.
 */

export const isImageAsset = (a: Asset): boolean =>
  /^image\/(png|webp|jpeg|gif|avif)$/.test(a.contentType);

function hexOf(value: string): string | undefined {
  const m = value.trim().match(/^#([0-9a-f]{6})$/i);
  return m ? `#${m[1]}` : undefined;
}

/** The brand's colours as swatches the dials can pick from. */
export function brandColours(values: readonly BrandValue[]): { name: string; hex: string }[] {
  return values.flatMap((v) => {
    const hex = v.kind === 'color' ? hexOf(v.value) : undefined;
    return hex ? [{ name: v.name, hex }] : [];
  });
}

/** The brand's typefaces, by role where one was given. */
export function brandFonts(values: readonly BrandValue[]): { heading: string; body: string } {
  const fonts = values.filter((v) => v.kind === 'font');
  const byRole = (role: RegExp): string | undefined =>
    fonts.find((f) => role.test(`${f.role ?? ''} ${f.name}`))?.value;
  const first = fonts[0]?.value;
  return {
    heading: byRole(/head|display|title/i) ?? first ?? 'Space Grotesk, sans-serif',
    body: byRole(/body|text|para/i) ?? first ?? 'Inter, sans-serif',
  };
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
}

/** Words onto lines at a character budget, keeping the author's own breaks. */
export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/** An image as a mask filled with a colour: the shape stays, the colour is the brand's. */
export function tintedImage(id: string, href: string, w: number, h: number, tint: string): string {
  return `<mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">`
    + `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></mask>`
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="${tint}" mask="url(#${id})"/>`;
}

/** Every `href="/api/..."` in the SVG replaced by the file's own bytes. */
export async function inlineImages(svg: string): Promise<string> {
  const urls = [...new Set([...svg.matchAll(/href="(\/api\/[^"]+)"/g)].map((m) => m[1] ?? ''))];
  const data = new Map<string, string>();
  for (const url of urls) {
    const blob = await (await fetch(url)).blob();
    data.set(url, await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read a file for export.'));
      reader.readAsDataURL(blob);
    }));
  }
  return svg.replace(/href="(\/api\/[^"]+)"/g, (_, url: string) => `href="${data.get(url) ?? url}"`);
}

export async function exportSvg(svg: string, basename: string): Promise<void> {
  const inlined = await inlineImages(svg);
  const url = URL.createObjectURL(new Blob([inlined], { type: 'image/svg+xml' }));
  downloadFile(url, `${basename}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportPng(svg: string, basename: string, width: number, height: number): Promise<void> {
  const inlined = await inlineImages(svg);
  const url = URL.createObjectURL(new Blob([inlined], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The design could not be drawn for export.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The design could not be encoded as PNG.');
    const out = URL.createObjectURL(png);
    downloadFile(out, `${basename}.png`);
    setTimeout(() => URL.revokeObjectURL(out), 10_000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function safeBasename(name: string, fallback: string): string {
  return (name.trim() || fallback).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

/* --------------------------------------------------------------- controls */

export function Dial({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="dial">
      <span className="row">
        <span className="label">{label}</span>
        <span className="mono muted" style={{ marginLeft: 'auto' }}>{Math.round(value * 100) / 100}{unit ?? ''}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Swatches({ label, colours, value, onChange, allowNone, noneLabel }: {
  label: string; colours: readonly { name: string; hex: string }[]; value: string;
  onChange: (hex: string) => void; allowNone?: boolean; noneLabel?: string;
}): ReactElement {
  return (
    <div className="dial">
      <span className="label">{label}</span>
      <div className="swatch-row" role="radiogroup" aria-label={label}>
        {allowNone && (
          <button type="button" role="radio" aria-checked={value === ''} className={`swatch-pick none${value === '' ? ' on' : ''}`}
                  onClick={() => onChange('')} title="As designed">
            <span className="swatch-pick-label">{noneLabel ?? 'As is'}</span>
          </button>
        )}
        {colours.map((c) => (
          <button key={`${c.name}-${c.hex}`} type="button" role="radio" aria-checked={value === c.hex}
                  className={`swatch-pick${value === c.hex ? ' on' : ''}`} title={`${c.name} ${c.hex}`}
                  onClick={() => onChange(c.hex)}>
            <i style={{ background: c.hex }} aria-hidden="true" />
            <span className="swatch-pick-label">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A row of choices, one lit. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void;
}): ReactElement {
  return (
    <div className="dial">
      <span className="label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
                  className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/** Thumbnails to pick one asset from, with an optional "none". */
export function AssetPicker({ label, assets, value, onChange, allowNone, src }: {
  label: string; assets: readonly Asset[]; value: string; onChange: (id: string) => void;
  allowNone?: boolean; src: (id: string) => string;
}): ReactElement {
  return (
    <div className="dial">
      <span className="label">{label}</span>
      <div className="pattern-picker" role="radiogroup" aria-label={label}>
        {allowNone && (
          <button type="button" role="radio" aria-checked={value === ''} className={`pattern-thumb none${value === '' ? ' on' : ''}`}
                  onClick={() => onChange('')} title="None"><span className="muted" style={{ fontSize: 11 }}>None</span></button>
        )}
        {assets.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={value === a.id}
                  className={`pattern-thumb${value === a.id ? ' on' : ''}`}
                  onClick={() => onChange(a.id)} title={a.filename}>
            <img src={src(a.id)} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The live preview: the SVG string, straight into the page. */
export function Preview({ svg, label, aspect }: { svg: string; label: string; aspect: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = svg; }, [svg]);
  return <div ref={ref} className="pattern-canvas" style={{ aspectRatio: aspect }} aria-label={label} role="img" />;
}
