import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
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

/* -------------------------------------------------------------- workspace */

/**
 * A tool takes the whole screen while it is open: a bar across the top, the
 * stage on the left, the dials on the right, and nothing underneath to
 * scroll to. The stage zooms and pans; the panel scrolls inside itself; the
 * page behind does not move. Escape closes.
 */
export function Workspace({ title, name, onClose, stage, panel, footer }: {
  title: string; name: string; onClose: () => void;
  stage: ReactNode; panel: ReactNode; footer: ReactNode;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) onClose();
    };
    addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  return (
    <div className="tool" role="dialog" aria-label={title}>
      <div className="tool-bar">
        <span className="label">{title}</span>
        <strong className="tool-bar-name">{name || 'Untitled'}</strong>
        <button type="button" className="overflow-button bar" style={{ marginLeft: 'auto' }} aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="tool-body">
        <div className="tool-stage-wrap">{stage}</div>
        <aside className="tool-panel">
          <div className="tool-panel-scroll stack">{panel}</div>
          <div className="tool-panel-footer">{footer}</div>
        </aside>
      </div>
    </div>
  );
}

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/**
 * The live preview, zoomable: fits the stage at 100%, zooms with the
 * buttons, ⌘/Ctrl + wheel or a pinch, and +/−/0 on the keyboard; drags to
 * pan once zoomed in. The SVG string goes straight into the page, and it
 * is the same string that exports.
 */
export function Stage({ svg, label, width, height, actions }: {
  svg: string; label: string; width: number; height: number; actions?: ReactNode;
}): ReactElement {
  const wrap = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 400, h: 400 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | undefined>(undefined);

  useEffect(() => { if (art.current) art.current.innerHTML = svg; }, [svg]);

  // Fit is the size at which the whole design shows with a margin; 100% means that.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = (): void => {
      const pad = 32;
      const W = el.clientWidth - pad * 2;
      const H = el.clientHeight - pad * 2;
      const s = Math.min(W / width, H / height);
      setFit({ w: Math.max(80, width * s), h: Math.max(80, height * s) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const clamp = (z: number): number => Math.min(4, Math.max(0.25, z));
  const step = (dir: 1 | -1): void => setZoom((z) => {
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001);
    const value = clamp(next ?? z);
    if (value <= 1) setPan({ x: 0, y: 0 });
    return value;
  });
  const reset = (): void => { setZoom(1); setPan({ x: 0, y: 0 }); };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => {
          const value = clamp(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
          if (value <= 1) setPan({ x: 0, y: 0 });
          return value;
        });
      } else if (zoom > 1) {
        e.preventDefault();
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1); }
    else if (e.key === '-') { e.preventDefault(); step(-1); }
    else if (e.key === '0') { e.preventDefault(); reset(); }
  };

  return (
    <div className="tool-stage-col">
      <div
        ref={wrap}
        className={`tool-stage${zoom > 1 ? ' zoomed' : ''}${drag.current ? ' dragging' : ''}`}
        tabIndex={0}
        aria-label={`${label}. Zoom ${Math.round(zoom * 100)}%. Press + or - to zoom, 0 to fit.`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
        }}
        onPointerUp={() => { drag.current = undefined; }}
        onPointerCancel={() => { drag.current = undefined; }}
      >
        <div
          className="tool-art"
          style={{ width: fit.w, height: fit.h, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div ref={art} className="tool-art-svg" role="img" aria-label={label} />
        </div>
        <div className="tool-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => step(-1)} aria-label="Zoom out" title="Zoom out (−)"><ZoomOut size={14} aria-hidden="true" /></button>
          <button type="button" className="tool-zoom-level" onClick={reset} title="Fit (0)">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => step(1)} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={14} aria-hidden="true" /></button>
          <button type="button" onClick={reset} aria-label="Fit to screen" title="Fit (0)"><Maximize2 size={14} aria-hidden="true" /></button>
        </div>
      </div>
      {actions && <div className="row tool-actions">{actions}</div>}
    </div>
  );
}

/** Two dials side by side: the panel is short when the dials are. */
export function DialGrid({ children }: { children: ReactNode }): ReactElement {
  return <div className="dial-grid">{children}</div>;
}
