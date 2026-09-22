import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Download, FlipHorizontal2, Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import { api, type Asset, type BrandProject, type BrandValue } from '../api.js';
import {
  Dial, Preview, Swatches, brandColours, exportPng, exportSvg, isImageAsset, safeBasename, tintedImage,
} from './toolkit.js';

/**
 * Illustration Builder: parts the studio drew, arranged by the client.
 *
 * The studio uploads illustration parts as approved files — a character,
 * three poses, a few objects, a background — grouped by collection
 * ("Characters", "Objects", "Backgrounds"). The client adds parts to a
 * scene and, for each one, decides where it sits, how big, which way it
 * faces, how it is turned and which brand colour it wears. That is every
 * control there is. Nothing is drawn, nothing is edited, and the parts on
 * the canvas are always the files the studio approved.
 */

export const CANVAS = 1200;
/** A part at scale 1 spans a quarter of the canvas. */
const UNIT = CANVAS / 4;

export interface Layer {
  assetId: string; x: number; y: number; scale: number; rotation: number; flip: boolean; tint: string;
}
export interface IllustrationConfiguration { background: string; layers: Layer[] }

export function partsFor(assets: readonly Asset[]): Asset[] {
  return assets.filter((a) => a.approved && a.kind === 'illustration' && isImageAsset(a));
}

/** The SVG for one scene. Pure, so preview and export cannot differ. */
export function illustrationSvg(config: IllustrationConfiguration, src: (id: string) => string): string {
  const layers = config.layers.map((l, i) => {
    const size = UNIT * l.scale;
    const cx = l.x * CANVAS;
    const cy = l.y * CANVAS;
    const transform = `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${l.rotation}) scale(${l.flip ? -1 : 1} 1) translate(${(-size / 2).toFixed(1)} ${(-size / 2).toFixed(1)})`;
    const body = l.tint
      ? tintedImage(`t${i}`, src(l.assetId), size, size, l.tint)
      : `<image href="${src(l.assetId)}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
    return `<g transform="${transform}">${body}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`
    + `<rect width="${CANVAS}" height="${CANVAS}" fill="${config.background}"/>`
    + layers.join('')
    + `</svg>`;
}

export default function IllustrationBuilder({ clientId, assets, values, project, onSaved, onClose }: {
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  project: BrandProject | undefined;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const parts = useMemo(() => partsFor(assets), [assets]);
  const colours = useMemo(() => brandColours(values), [values]);
  const groups = useMemo(() => {
    const by = new Map<string, Asset[]>();
    for (const p of parts) {
      const key = p.collection?.trim() || 'Parts';
      by.set(key, [...(by.get(key) ?? []), p]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [parts]);

  const initial = (): IllustrationConfiguration => {
    const saved = project?.configuration as Partial<IllustrationConfiguration> | undefined;
    return {
      background: saved?.background ?? colours.find((c) => /back|cream|paper|light/i.test(c.name))?.hex ?? colours[0]?.hex ?? '#ffffff',
      layers: (saved?.layers ?? []).filter((l) => parts.some((p) => p.id === l.assetId)),
    };
  };
  const [config, setConfig] = useState<IllustrationConfiguration>(initial);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [name, setName] = useState(project?.name ?? '');
  const [saveAs, setSaveAs] = useState(false);
  const [exporting, setExporting] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const svg = useMemo(() => illustrationSvg(config, api.downloadPath), [config]);
  const current = selected === undefined ? undefined : config.layers[selected];

  const setLayer = (index: number, patch: Partial<Layer>): void =>
    setConfig((c) => ({ ...c, layers: c.layers.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  const add = (asset: Asset): void => {
    if (config.layers.length >= 24) return;
    // Backgrounds fill the frame; anything else lands mid-canvas, slightly
    // offset so a second copy is visibly a second copy.
    const isBackground = /back|ground|scene/i.test(asset.collection ?? '');
    const n = config.layers.length;
    const layer: Layer = isBackground
      ? { assetId: asset.id, x: 0.5, y: 0.5, scale: 4, rotation: 0, flip: false, tint: '' }
      : { assetId: asset.id, x: 0.5 + ((n % 5) - 2) * 0.06, y: 0.55 + ((n % 3) - 1) * 0.06, scale: 1, rotation: 0, flip: false, tint: '' };
    setConfig((c) => ({ ...c, layers: isBackground ? [layer, ...c.layers] : [...c.layers, layer] }));
    setSelected(isBackground ? 0 : n);
  };
  const remove = (index: number): void => {
    setConfig((c) => ({ ...c, layers: c.layers.filter((_, i) => i !== index) }));
    setSelected(undefined);
  };
  const move = (index: number, delta: number): void => {
    const to = index + delta;
    if (to < 0 || to >= config.layers.length) return;
    setConfig((c) => {
      const layers = [...c.layers];
      const [item] = layers.splice(index, 1);
      if (item) layers.splice(to, 0, item);
      return { ...c, layers };
    });
    setSelected(to);
  };
  const shuffle = (): void => {
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.scale >= 4 ? l : {
        ...l,
        x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7,
        scale: 0.6 + Math.random() * 1.2, rotation: Math.round((Math.random() - 0.5) * 40),
        flip: Math.random() < 0.5,
      })),
    }));
  };

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const title = name.trim() || 'Scene';
      if (project && !asNew) return api.updateBrandProject(project.id, { name: title, configuration: config });
      return api.createBrandProject(clientId, { toolId: 'illustration-builder', name: title, configuration: config });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['brand-projects', clientId] });
      setSaveAs(false);
      onSaved(saved);
    },
    onError: (e) => setError((e as Error).message),
  });

  const doExport = async (format: 'png' | 'svg'): Promise<void> => {
    setExporting(format);
    setError(undefined);
    try {
      const base = safeBasename(name, 'scene');
      if (format === 'svg') await exportSvg(svg, base);
      else await exportPng(svg, base, CANVAS, CANVAS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(undefined);
    }
  };

  if (parts.length === 0) {
    return (
      <div className="empty">
        <p className="editorial">No illustration parts yet.</p>
        <p>The studio adds the characters, objects and backgrounds it drew to your files; then they can be arranged here.</p>
        <button type="button" onClick={onClose}>Back</button>
      </div>
    );
  }

  const nameOf = (id: string): string => parts.find((p) => p.id === id)?.filename.replace(/\.[^.]+$/, '') ?? id;

  return (
    <div className="pattern-studio">
      <div className="pattern-preview">
        <Preview svg={svg} label="Scene preview" aspect="1 / 1" />
        <div className="row pattern-actions">
          <button type="button" onClick={shuffle} disabled={config.layers.length === 0}><Shuffle size={14} aria-hidden="true" /> Shuffle</button>
          <span style={{ marginLeft: 'auto' }} className="row">
            <button type="button" disabled={Boolean(exporting) || config.layers.length === 0} onClick={() => void doExport('png')}>
              <Download size={14} aria-hidden="true" /> {exporting === 'png' ? 'Exporting…' : 'PNG'}
            </button>
            <button type="button" disabled={Boolean(exporting) || config.layers.length === 0} onClick={() => void doExport('svg')}>
              <Download size={14} aria-hidden="true" /> {exporting === 'svg' ? 'Exporting…' : 'SVG'}
            </button>
          </span>
        </div>

        {/* The scene's parts, back to front. Selecting one brings its dials up on the right. */}
        {config.layers.length > 0 && (
          <ol className="layer-list" aria-label="Parts in the scene">
            {config.layers.map((l, i) => (
              <li key={i} className={selected === i ? 'on' : ''}>
                <button type="button" className="layer-pick" onClick={() => setSelected(i)} aria-pressed={selected === i}>
                  <img src={api.downloadPath(l.assetId)} alt="" />
                  <span>{nameOf(l.assetId)}</span>
                </button>
                <span className="row" style={{ gap: 2 }}>
                  <button type="button" className="overflow-button row" aria-label="Send back" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                  <button type="button" className="overflow-button row" aria-label="Bring forward" disabled={i === config.layers.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                  <button type="button" className="overflow-button row" aria-label="Remove from scene" onClick={() => remove(i)}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="pattern-controls stack">
        <label className="field">
          <span className="label">Design name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning scene" />
        </label>

        {groups.map(([group, items]) => (
          <div key={group} className="dial">
            <span className="label">Add {group.toLowerCase()}</span>
            <div className="pattern-picker">
              {items.map((p) => (
                <button key={p.id} type="button" className="pattern-thumb" title={`Add ${p.filename}`}
                        onClick={() => add(p)}>
                  <img src={api.downloadPath(p.id)} alt="" />
                  <Plus className="pattern-thumb-plus" size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ))}

        {current && selected !== undefined ? (
          <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span className="label">{nameOf(current.assetId)}</span>
            <Dial label="Size" value={current.scale} min={0.1} max={4} step={0.05} onChange={(v) => setLayer(selected, { scale: v })} />
            <Dial label="Across" value={current.x} min={-0.25} max={1.25} step={0.01} onChange={(v) => setLayer(selected, { x: v })} />
            <Dial label="Down" value={current.y} min={-0.25} max={1.25} step={0.01} onChange={(v) => setLayer(selected, { y: v })} />
            <Dial label="Turn" value={current.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => setLayer(selected, { rotation: v })} />
            <button type="button" onClick={() => setLayer(selected, { flip: !current.flip })} aria-pressed={current.flip}>
              <FlipHorizontal2 size={14} aria-hidden="true" /> {current.flip ? 'Facing left' : 'Facing right'}
            </button>
            {colours.length > 0 && (
              <Swatches label="Colour" colours={colours} value={current.tint} onChange={(hex) => setLayer(selected, { tint: hex })} allowNone noneLabel="As drawn" />
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Add a part, then select it in the list to place it.</p>
        )}

        {colours.length > 0 && (
          <Swatches label="Background" colours={colours} value={config.background} onChange={(hex) => setConfig((c) => ({ ...c, background: hex }))} />
        )}

        {error && <p className="err">{error}</p>}

        <div className="row" style={{ marginTop: 'auto' }}>
          <button type="button" className="primary" disabled={save.isPending || config.layers.length === 0} onClick={() => save.mutate(false)}>
            <Save size={14} aria-hidden="true" /> {save.isPending ? 'Saving…' : project ? 'Save' : 'Save scene'}
          </button>
          {project && !saveAs && (
            <button type="button" onClick={() => setSaveAs(true)}><Copy size={14} aria-hidden="true" /> Duplicate</button>
          )}
          {saveAs && <button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Save as a copy</button>}
          <button type="button" className="link" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
      </aside>
    </div>
  );
}
