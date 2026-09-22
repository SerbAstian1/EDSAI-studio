import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, RotateCcw, Save, Shuffle } from 'lucide-react';
import { api, type Asset, type BrandProject, type BrandValue, type PatternConfiguration } from '../api.js';
import {
  AssetPicker, Dial, DialGrid, Stage, Swatches, Workspace, brandColours, exportPng, exportSvg,
  isImageAsset, safeBasename, tintedImage,
} from './toolkit.js';

/**
 * Pattern Studio: the first Brand Hub tool.
 *
 * A client picks one of the studio's approved patterns and turns a few
 * dials — how big, how far apart, how tilted, how faint, in which brand
 * colour, on which brand background. That is the whole tool, on purpose:
 * every control moves inside the system the studio built, so nothing a
 * client can do here leaves the brand.
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

export default function PatternStudio({ clientId, assets, values, project, onSaved, onClose }: {
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  /** Reopening an existing design; absent for a new one. */
  project: BrandProject | undefined;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const patterns = useMemo(() => assets.filter(tileable), [assets]);
  const colours = useMemo(() => brandColours(values), [values]);
  const fallbackBackground = colours[0]?.hex ?? '#ffffff';

  const initial = (): PatternConfiguration => {
    const saved = project?.configuration as Partial<PatternConfiguration> | undefined;
    return {
      assetId: saved?.assetId ?? patterns[0]?.id ?? '',
      background: saved?.background ?? fallbackBackground,
      ...DEFAULTS,
      ...(saved ? {
        scale: saved.scale ?? DEFAULTS.scale, spacing: saved.spacing ?? DEFAULTS.spacing,
        rotation: saved.rotation ?? DEFAULTS.rotation, opacity: saved.opacity ?? DEFAULTS.opacity,
        tint: saved.tint ?? '', offsetX: saved.offsetX ?? 0, offsetY: saved.offsetY ?? 0,
      } : {}),
    };
  };
  const [config, setConfig] = useState<PatternConfiguration>(initial);
  const [name, setName] = useState(project?.name ?? '');
  const [saveAs, setSaveAs] = useState(false);
  const [exporting, setExporting] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const set = (patch: Partial<PatternConfiguration>): void => setConfig((c) => ({ ...c, ...patch }));

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

  const doExport = async (format: 'png' | 'svg'): Promise<void> => {
    if (!asset) return;
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

  const randomise = (): void => {
    const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
    set({
      scale: 60 + Math.round(Math.random() * 260),
      spacing: Math.round(Math.random() * 80),
      rotation: [0, 0, 15, 30, 45, -15, -30, 90][Math.floor(Math.random() * 8)] ?? 0,
      opacity: 0.6 + Math.round(Math.random() * 40) / 100,
      offsetX: Math.round(Math.random() * 10) / 10,
      offsetY: Math.round(Math.random() * 10) / 10,
      ...(colours.length > 0 ? {
        tint: Math.random() < 0.5 ? '' : pick(colours)?.hex ?? '',
        background: pick(colours)?.hex ?? config.background,
      } : {}),
    });
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
        <button type="button" onClick={randomise}><Shuffle size={14} aria-hidden="true" /> Randomise</button>
        <button type="button" onClick={() => setConfig(initial())}><RotateCcw size={14} aria-hidden="true" /> Reset</button>
        <span style={{ marginLeft: 'auto' }} className="row">
          <button type="button" disabled={Boolean(exporting)} onClick={() => void doExport('png')}>
            <Download size={14} aria-hidden="true" /> {exporting === 'png' ? 'Exporting…' : 'PNG'}
          </button>
          <button type="button" disabled={Boolean(exporting)} onClick={() => void doExport('svg')}>
            <Download size={14} aria-hidden="true" /> {exporting === 'svg' ? 'Exporting…' : 'SVG'}
          </button>
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

        <DialGrid>
          <Dial label="Scale" value={config.scale} min={16} max={600} step={2} unit="px" onChange={(v) => set({ scale: v })} />
          <Dial label="Spacing" value={config.spacing} min={0} max={400} step={2} unit="px" onChange={(v) => set({ spacing: v })} />
          <Dial label="Rotation" value={config.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ rotation: v })} />
          <Dial label="Opacity" value={config.opacity} min={0} max={1} step={0.01} onChange={(v) => set({ opacity: v })} />
          <Dial label="Shift across" value={config.offsetX} min={0} max={1} step={0.05} onChange={(v) => set({ offsetX: v })} />
          <Dial label="Shift down" value={config.offsetY} min={0} max={1} step={0.05} onChange={(v) => set({ offsetY: v })} />
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
