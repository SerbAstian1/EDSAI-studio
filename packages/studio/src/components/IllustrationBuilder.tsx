import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Download, FlipHorizontal2, Library, Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import { api, type Asset, type BrandModule, type BrandProject, type BrandRules, type BrandValue } from '../api.js';
import {
  Dial, DialGrid, Stage, Swatches, Workspace, brandColours, exportPng, exportSvg, isImageAsset,
  renderPng, safeBasename, tintedImage,
} from './toolkit.js';

import { PresetChoices, withPreset } from './BrandControls.js';
import { allowedColors, presetsFor } from './brandModules.js';
import { filesIntoLibrary, saveToLibrary } from './brandLibrary.js';

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
 *
 * Where the studio has locked a placement control it is shown greyed rather
 * than removed, because a part sitting somewhere the client cannot explain is
 * worse than one sitting somewhere the studio chose. Presets move the whole
 * arrangement at once.
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

export default function IllustrationBuilder({ clientId, assets, values, project, module, rules, onSaved, onClose }: {
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  project: BrandProject | undefined;
  /** What the studio decided this module may offer. */
  module: BrandModule;
  /** The brand's standing colour, type and export rules. */
  rules: BrandRules;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const parts = useMemo(() => partsFor(assets), [assets]);
  // The brand's rules first, the measured palette as the fallback: a designer who
  // named three colours means three.
  const allowed = useMemo(() => allowedColors(rules, values), [rules, values]);
  const colours = useMemo(() => {
    const named = allowed.hexes.map((hex) => ({ name: hex.toUpperCase(), hex }));
    return named.length > 0 ? named : brandColours(values);
  }, [allowed.hexes, values]);
  const groups = useMemo(() => {
    const by = new Map<string, Asset[]>();
    for (const p of parts) {
      const key = p.collection?.trim() || 'Parts';
      by.set(key, [...(by.get(key) ?? []), p]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [parts]);

  // The preset is state *before* `initial` rather than after, because `initial`
  // runs during the very first render and reads it. Declared below, it would be
  // in its temporal dead zone and the tool would throw on open.
  const { defaultPreset } = presetsFor(module);
  const [presetId, setPresetId] = useState<string | undefined>(defaultPreset);

  const initial = (): IllustrationConfiguration => {
    const saved = project?.configuration as Partial<IllustrationConfiguration> | undefined;
    const base = {
      background: saved?.background ?? colours.find((c) => /back|cream|paper|light/i.test(c.name))?.hex ?? colours[0]?.hex ?? '#ffffff',
      layers: (saved?.layers ?? []).filter((l) => parts.some((p) => p.id === l.assetId)),
    };
    // A preset is applied on open, so a scene made under the studio's chosen
    // arrangement reopens in it.
    return withPreset(module, base, presetId);
  };
  const [config, setConfig] = useState<IllustrationConfiguration>(initial);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [name, setName] = useState(project?.name ?? '');
  const [saveAs, setSaveAs] = useState(false);
  const [exporting, setExporting] = useState<string | undefined>(undefined);
  // The library row this session created, so the button reads "Filed" instead
  // of quietly making a second copy of the same design.
  const [filed, setFiled] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  /** Choose a preset: the studio's values land, then anything the client kept. */
  const choosePreset = (id: string): void => {
    setPresetId(id);
    setConfig((c) => withPreset(module, c, id));
  };
  /** Whether the studio has taken this control away behind a preset. */
  const held = (id: string): boolean => module.locked.includes(id);

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
  /**
   * Move every part at once.
   *
   * A locked placement control is left alone rather than moved and put back:
   * a shuffle that quietly overrides a value the studio set is the exact
   * failure the presets exist to prevent, and a background at scale 4 has
   * always been left alone because it *is* the scene.
   */
  const shuffle = (): void => {
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => {
        if (l.scale >= 4) return l;
        const next: Layer = { ...l };
        if (!held('x')) next.x = 0.15 + Math.random() * 0.7;
        if (!held('y')) next.y = 0.15 + Math.random() * 0.7;
        if (!held('scale')) next.scale = 0.6 + Math.random() * 1.2;
        if (!held('rotation')) next.rotation = Math.round((Math.random() - 0.5) * 40);
        if (!held('flip')) next.flip = Math.random() < 0.5;
        return next;
      }),
    }));
  };
  /** Whether the studio has fixed the arrangement, which disables Shuffle. */
  const placedHeld = (): boolean => ['x', 'y', 'scale', 'rotation', 'flip'].some(held);

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

  const doExport = async (format: string): Promise<void> => {
    // The module's export list has already had the brand's rules applied to it
    // by the server, so an empty list is the only thing that can be refused.
    if (format !== 'png' && format !== 'svg') return;
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

  /**
   * File this scene into the brand's library, so a finished illustration can
   * become a part Pattern Studio tiles with, rather than a file that only ever
   * lived on somebody's desktop.
   */
  const doFile = async (): Promise<void> => {
    if (config.layers.length === 0) return;
    setExporting('library');
    setError(undefined);
    try {
      const blob = await renderPng(svg, CANVAS, CANVAS);
      const result = await saveToLibrary({
        clientId, toolId: module.id, kind: 'illustration', format: 'png', blob,
        filename: `${safeBasename(name, 'scene')}.png`,
        width: CANVAS, height: CANVAS,
        ...(project ? { projectId: project.id } : {}),
        ...(presetId ? { presetId } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['brand-assets', clientId] });
      void queryClient.invalidateQueries({ queryKey: ['assets', clientId] });
      setFiled(result.design.id);
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

  const stage = (
    <Stage svg={svg} label="Scene preview" width={CANVAS} height={CANVAS} actions={(
      <>
        <button type="button" onClick={shuffle} disabled={config.layers.length === 0 || placedHeld()}><Shuffle size={14} aria-hidden="true" /> Shuffle</button>
        <span style={{ marginLeft: 'auto' }} className="row">
          {filesIntoLibrary(module) && (
            <button type="button" disabled={Boolean(exporting) || filed !== undefined || config.layers.length === 0}
                    onClick={() => void doFile()}>
              <Library size={14} aria-hidden="true" />
              {exporting === 'library' ? 'Filing…' : filed ? 'Filed' : 'Add to library'}
            </button>
          )}
          {module.exports.map((format) => (
            <button key={format} type="button" disabled={Boolean(exporting) || config.layers.length === 0}
                    onClick={() => void doExport(format)}>
              <Download size={14} aria-hidden="true" /> {exporting === format ? 'Exporting…' : format.toUpperCase()}
            </button>
          ))}
        </span>
      </>
    )} />
  );

  const panel = (
    <>
        <label className="field">
          <span className="label">Design name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning scene" />
        </label>

        <PresetChoices module={module} presetId={presetId} onChange={choosePreset}
                       name={`illustration-builder-${clientId}`} />

        {/* The scene's parts, back to front. Selecting one brings its dials up. */}
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
            <DialGrid>
              <Dial label="Size" value={current.scale} min={0.1} max={4} step={0.05} locked={held('scale')} onChange={(v) => setLayer(selected, { scale: v })} />
              <Dial label="Turn" value={current.rotation} min={-180} max={180} step={1} unit="°" locked={held('rotation')} onChange={(v) => setLayer(selected, { rotation: v })} />
              <Dial label="Across" value={current.x} min={-0.25} max={1.25} step={0.01} locked={held('x')} onChange={(v) => setLayer(selected, { x: v })} />
              <Dial label="Down" value={current.y} min={-0.25} max={1.25} step={0.01} locked={held('y')} onChange={(v) => setLayer(selected, { y: v })} />
            </DialGrid>
            <button type="button" disabled={held('flip')} onClick={() => setLayer(selected, { flip: !current.flip })} aria-pressed={current.flip}>
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
    </>
  );

  const footer = (
        <div className="row">
          <button type="button" className="primary" disabled={save.isPending || config.layers.length === 0} onClick={() => save.mutate(false)}>
            <Save size={14} aria-hidden="true" /> {save.isPending ? 'Saving…' : project ? 'Save' : 'Save scene'}
          </button>
          {project && !saveAs && (
            <button type="button" onClick={() => setSaveAs(true)}><Copy size={14} aria-hidden="true" /> Duplicate</button>
          )}
          {saveAs && <button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Save as a copy</button>}
        </div>
  );

  return <Workspace title="Illustration Builder" name={name} onClose={onClose} stage={stage} panel={panel} footer={footer} />;
}
