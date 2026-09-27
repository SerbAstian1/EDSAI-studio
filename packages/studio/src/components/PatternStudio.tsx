import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Library, RotateCcw, Save, Shuffle } from 'lucide-react';
import { api, type Asset, type BrandModule, type BrandProject, type BrandRules, type BrandValue, type PatternConfiguration } from '../api.js';
import {
  AssetPicker, Dial, DialGrid, Stage, Swatches, Workspace, brandColours, exportPng, exportSvg,
  renderPng,
  isImageAsset, safeBasename, tintedImage,
} from './toolkit.js';
import { PresetChoices, withPreset } from './BrandControls.js';
import { allowedColors, presetsFor } from './brandModules.js';
import { filesIntoLibrary, saveToLibrary } from './brandLibrary.js';
import type { ToolProps } from './brandModules.js';

/**
 * Pattern Studio: the first Brand Hub tool.
 *
 * A client picks one of the studio's approved patterns and turns a few
 * dials — how big, how far apart, how tilted, how faint, in which brand
 * colour, on which brand background. That is the whole tool, on purpose:
 * every control moves inside the system the studio built, so nothing a
 * client can do here leaves the brand.
 *
 * **What the brand's configuration changes, and what it does not.** A
 * parameter the studio has locked is not shown as a disabled dial but left off
 * the panel entirely, reachable only by choosing one of the designer's
 * presets; a parameter the studio deliberately opened up is a dial as it always
 * was. A hub nobody has configured yet shows every dial, because a module with
 * no configuration has to behave exactly as it did before presets existed.
 *
 * What is saved is the configuration, not the picture, so a project opens
 * again with every dial where it was left; export is a separate act.
 */

export const CANVAS = 1200;

export const DEFAULTS: Omit<PatternConfiguration, 'assetId' | 'background'> = {
  scale: 160, spacing: 24, rotation: 0, opacity: 1, tint: '', offsetX: 0, offsetY: 0,
};

/** The asset kinds a pattern can be tiled from, and only image files among them. */
const TILEABLE = new Set<Asset['kind']>(['pattern', 'texture', 'illustration', 'icon', 'logo']);
export function tileable(asset: Asset): boolean {
  return asset.approved && TILEABLE.has(asset.kind) && isImageAsset(asset);
}

/** The SVG for one configuration. Pure, so preview and export cannot differ. */
export function patternSvg(config: PatternConfiguration, imageHref: string): string {
  const cell = config.scale + config.spacing;
  const ox = (config.offsetX * cell).toFixed(1);
  const oy = (config.offsetY * cell).toFixed(1);
  const tile = config.tint
    ? tintedImage('m', imageHref, config.scale, config.scale, config.tint)
    : `<image href="${imageHref}" x="0" y="0" width="${config.scale}" height="${config.scale}" preserveAspectRatio="xMidYMid meet"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`
    + `<defs><pattern id="p" patternUnits="userSpaceOnUse" width="${cell}" height="${cell}" `
    + `patternTransform="translate(${ox} ${oy}) rotate(${config.rotation} ${CANVAS / 2} ${CANVAS / 2})">${tile}</pattern></defs>`
    + `<rect width="${CANVAS}" height="${CANVAS}" fill="${config.background}"/>`
    + `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#p)" opacity="${config.opacity}"/>`
    + `</svg>`;
}

export default function PatternStudio({ clientId, assets, values, project, module, rules, onSaved, onClose }: {
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  /** Reopening an existing design; absent for a new one. */
  project: BrandProject | undefined;
  /** What the studio decided this module may offer. */
  module: BrandModule;
  /** The brand's standing colour, type and export rules. */
  rules: BrandRules;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const patterns = useMemo(() => assets.filter(tileable), [assets]);
  // The brand's own rules, not the whole measured palette: a designer who named
  // three colours means three, and the fallback is the palette they measured.
  const { defaultPreset } = presetsFor(module);
  const [presetId, setPresetId] = useState<string | undefined>(defaultPreset);
  const allowed = useMemo(() => allowedColors(rules, values), [rules, values]);
  const colours = useMemo(() => {
    const named = allowed.hexes.length > 0
      ? allowed.hexes.map((hex) => ({ name: hex.toUpperCase(), hex }))
      : [];
    return named.length > 0 ? named : brandColours(values);
  }, [allowed.hexes, values]);
  const fallbackBackground = colours[0]?.hex ?? '#ffffff';
  /** Whether the studio has taken scale and spacing away behind a preset. */
  const sized = useMemo(
    () => ['scale', 'spacing', 'offsetX', 'offsetY'].some((id) => module.locked.includes(id)),
    [module],
  );

  const initial = (): PatternConfiguration => {
    const saved = project?.configuration as Partial<PatternConfiguration> | undefined;
    const base = {
      assetId: saved?.assetId ?? patterns[0]?.id ?? '',
      background: saved?.background ?? fallbackBackground,
      ...DEFAULTS,
      ...(saved ? {
        scale: saved.scale ?? DEFAULTS.scale, spacing: saved.spacing ?? DEFAULTS.spacing,
        rotation: saved.rotation ?? DEFAULTS.rotation, opacity: saved.opacity ?? DEFAULTS.opacity,
        tint: saved.tint ?? '', offsetX: saved.offsetX ?? 0, offsetY: saved.offsetY ?? 0,
      } : {}),
    };
    // A preset is applied on open, so a design made under "Heavy" reopens
    // heavy, and a locked dial comes back holding the studio's value.
    return withPreset(module, base, presetId);
  };
  const [config, setConfig] = useState<PatternConfiguration>(initial);
  const [name, setName] = useState(project?.name ?? '');
  const [saveAs, setSaveAs] = useState(false);
  const [exporting, setExporting] = useState<string | undefined>(undefined);
  // The id of the library row this session created, so the button can say
  // "Filed" rather than offering the same action twice and quietly making two
  // copies of the same design.
  const [filed, setFiled] = useState<string | undefined>(undefined);

  const [error, setError] = useState<string | undefined>(undefined);
  const set = (patch: Partial<PatternConfiguration>): void => setConfig((c) => ({ ...c, ...patch }));

  /** Choose a preset: the studio's values land, then anything the client kept. */
  const choosePreset = (id: string): void => {
    setPresetId(id);
    setConfig((c) => withPreset(module, c, id));
  };

  const asset = patterns.find((p) => p.id === config.assetId);
  const svg = useMemo(() => (asset ? patternSvg(config, api.downloadPath(asset.id)) : ''), [config, asset]);

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const title = name.trim() || `${asset?.filename.replace(/\.[^.]+$/, '') ?? 'Pattern'} design`;
      if (project && !asNew) return api.updateBrandProject(project.id, { name: title, configuration: config });
      return api.createBrandProject(clientId, { toolId: 'pattern-studio', name: title, configuration: config });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['brand-projects', clientId] });
      setSaveAs(false);
      onSaved(saved);
    },
    onError: (e) => setError((e as Error).message),
  });

  const doExport = async (format: string): Promise<void> => {
    if (!asset) return;
    // The module's export list has already had the brand's rules applied to it
    // by the server, so an empty list is the only thing that can be refused.
    if (format !== 'png' && format !== 'svg') return;
    setExporting(format);
    setError(undefined);
    try {
      const base = safeBasename(name, 'pattern');
      if (format === 'svg') await exportSvg(svg, base);
      else await exportPng(svg, base, CANVAS, CANVAS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(undefined);
    }
  };

  /**
   * File this pattern into the brand's library, so the rest of the hub can work
   * from it. The loop the Asset Lab exists for, and the reason a pattern is a
   * different act from a poster: this one becomes an input to the next thing.
   */
  const doFile = async (): Promise<void> => {
    if (!asset) return;
    setExporting('library');
    setError(undefined);
    try {
      const blob = await renderPng(svg, CANVAS, CANVAS);
      const result = await saveToLibrary({
        clientId, toolId: module.id, kind: 'pattern', format: 'png', blob,
        filename: `${safeBasename(name, 'pattern')}.png`,
        width: CANVAS, height: CANVAS,
        sourceAssetId: asset.id,
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

  /**
   * Move everything at once — for a client who wants a different pattern and
   * not a specific one.
   *
   * A locked dial is left out of the shuffle rather than moved and put back,
   * because "randomise" that quietly overrides a value the studio set is the
   * exact failure the presets exist to prevent.
   */
  const randomise = (): void => {
    const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
    const free = (id: string): boolean => !module.locked.includes(id);
    const patch: Partial<PatternConfiguration> = {};
    if (free('scale')) patch.scale = 60 + Math.round(Math.random() * 260);
    if (free('spacing')) patch.spacing = Math.round(Math.random() * 80);
    if (free('rotation')) patch.rotation = [0, 0, 15, 30, 45, -15, -30, 90][Math.floor(Math.random() * 8)] ?? 0;
    if (free('opacity')) patch.opacity = 0.6 + Math.round(Math.random() * 40) / 100;
    if (free('offsetX')) patch.offsetX = Math.round(Math.random() * 10) / 10;
    if (free('offsetY')) patch.offsetY = Math.round(Math.random() * 10) / 10;
    if (colours.length > 0) {
      if (free('tint')) patch.tint = Math.random() < 0.5 ? '' : pick(colours)?.hex ?? '';
      if (free('background')) patch.background = pick(colours)?.hex ?? config.background;
    }
    set(patch);
  };

  if (patterns.length === 0) {
    return (
      <div className="empty">
        <p className="editorial">No pattern to work with yet.</p>
        <p>The studio adds approved patterns to your files; once one is there, this is where it comes alive.</p>
        <button type="button" onClick={onClose}>Back</button>
      </div>
    );
  }

  const stage = (
    <Stage svg={svg} label="Pattern preview" width={CANVAS} height={CANVAS} actions={(
      <>
        <button type="button" onClick={randomise} disabled={sized} title={sized ? 'Randomise is set by the studio’s presets' : undefined}>
          <Shuffle size={14} aria-hidden="true" /> Randomise
        </button>
        <button type="button" onClick={() => { setPresetId(defaultPreset); setConfig(initial()); }}>
          <RotateCcw size={14} aria-hidden="true" /> Reset
        </button>
        <span style={{ marginLeft: 'auto' }} className="row">
          {filesIntoLibrary(module) && (
            <button type="button" disabled={Boolean(exporting) || filed !== undefined} onClick={() => void doFile()}>

              <Library size={14} aria-hidden="true" />
              {exporting === 'library' ? 'Filing…' : filed ? 'Filed' : 'Add to library'}
            </button>
          )}
          {module.exports.map((format) => (
            <button key={format} type="button" disabled={Boolean(exporting)} onClick={() => void doExport(format)}>
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer wrap" />
        </label>

        <AssetPicker label="Pattern" assets={patterns} value={config.assetId}
                     onChange={(id) => set({ assetId: id })} src={api.downloadPath} />

        <PresetChoices module={module} presetId={presetId} onChange={choosePreset}
                       name={`pattern-studio-${clientId}`} />

        <DialGrid>
          <Dial label="Scale" value={config.scale} min={16} max={600} step={2} unit="px"
                locked={module.locked.includes('scale')} onChange={(v) => set({ scale: v })} />
          <Dial label="Spacing" value={config.spacing} min={0} max={400} step={2} unit="px"
                locked={module.locked.includes('spacing')} onChange={(v) => set({ spacing: v })} />
          <Dial label="Rotation" value={config.rotation} min={-180} max={180} step={1} unit="°"
                locked={module.locked.includes('rotation')} onChange={(v) => set({ rotation: v })} />
          <Dial label="Opacity" value={config.opacity} min={0} max={1} step={0.01}
                locked={module.locked.includes('opacity')} onChange={(v) => set({ opacity: v })} />
          <Dial label="Shift across" value={config.offsetX} min={0} max={1} step={0.05}
                locked={module.locked.includes('offsetX')} onChange={(v) => set({ offsetX: v })} />
          <Dial label="Shift down" value={config.offsetY} min={0} max={1} step={0.05}
                locked={module.locked.includes('offsetY')} onChange={(v) => set({ offsetY: v })} />
        </DialGrid>
        {colours.length > 0 ? (
          <>
            <Swatches label="Colour" colours={colours} value={config.tint} onChange={(hex) => set({ tint: hex })} allowNone />
            <Swatches label="Background" colours={colours} value={config.background} onChange={(hex) => set({ background: hex })} />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            Colour and background follow the brand palette once the studio has set one.
          </p>
        )}

        {error && <p className="err">{error}</p>}
    </>
  );

  const footer = (
        <div className="row">
          <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate(false)}>
            <Save size={14} aria-hidden="true" /> {save.isPending ? 'Saving…' : project ? 'Save' : 'Save design'}
          </button>
          {project && !saveAs && (
            <button type="button" onClick={() => setSaveAs(true)}>
              <Copy size={14} aria-hidden="true" /> Duplicate
            </button>
          )}
          {saveAs && (
            <button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Save as a copy</button>
          )}
        </div>
  );

  return <Workspace title="Pattern Studio" name={name} onClose={onClose} stage={stage} panel={panel} footer={footer} />;
}
