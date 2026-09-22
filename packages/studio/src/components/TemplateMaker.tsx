import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Save } from 'lucide-react';
import { api, type Asset, type BrandProject, type BrandValue } from '../api.js';
import {
  AssetPicker, Dial, Preview, Segmented, Swatches, brandColours, brandFonts, escapeXml, exportPng,
  isImageAsset, safeBasename, wrap,
} from './toolkit.js';

/**
 * Smart templates: Social Post Maker and Poster Maker are one tool at two
 * sizes.
 *
 * What the client edits: the headline, the body, the call to action, which
 * approved photograph sits behind, and which of the studio's artworks sits
 * over it. What the client chooses from a short list: where the words sit
 * (top, centre, bottom), left or centred, which corner the logo takes.
 * What the client never touches: the typefaces, which are the brand's; the
 * colours, which come from the palette; the logo file itself; the margins
 * and the scale of the type, which are the layout's.
 *
 * That split is the whole point. The studio designs the artwork and the
 * system; the tool lets the words change.
 */

export type Format = 'social-post' | 'poster';
const SIZES: Record<Format, { w: number; h: number; label: string }> = {
  'social-post': { w: 1080, h: 1080, label: 'Square post' },
  poster: { w: 1200, h: 1800, label: 'Poster' },
};

export interface TemplateConfiguration {
  templateAssetId: string; photoAssetId: string; logoAssetId: string;
  headline: string; body: string; cta: string;
  layout: 'top' | 'centre' | 'bottom'; align: 'left' | 'centre';
  logoCorner: 'none' | 'tl' | 'tr' | 'bl' | 'br';
  background: string; textColor: string; accent: string; scrim: number;
}

/** The SVG for one configuration. Pure, so preview and export cannot differ. */
export function templateSvg(
  format: Format, config: TemplateConfiguration, fonts: { heading: string; body: string },
  src: (id: string) => string,
): string {
  const { w, h } = SIZES[format];
  const margin = Math.round(w * 0.08);
  const headSize = Math.round(w * (format === 'poster' ? 0.075 : 0.07));
  const bodySize = Math.round(w * 0.028);
  const ctaSize = Math.round(w * 0.026);
  const headLines = wrap(config.headline, Math.round((w - margin * 2) / (headSize * 0.52)));
  const bodyLines = wrap(config.body, Math.round((w - margin * 2) / (bodySize * 0.5)));
  const lineHead = headSize * 1.05;
  const lineBody = bodySize * 1.45;
  const gap = bodySize;
  const ctaH = ctaSize * 2.4;
  const block = (config.headline ? headLines.length * lineHead : 0)
    + (config.body ? gap + bodyLines.length * lineBody : 0)
    + (config.cta ? gap * 1.5 + ctaH : 0);
  const top = config.layout === 'top' ? margin
    : config.layout === 'centre' ? (h - block) / 2
      : h - margin - block;
  const anchor = config.align === 'centre' ? 'middle' : 'start';
  const x = config.align === 'centre' ? w / 2 : margin;

  const parts: string[] = [];
  parts.push(`<rect width="${w}" height="${h}" fill="${config.background}"/>`);
  if (config.photoAssetId) {
    parts.push(`<image href="${src(config.photoAssetId)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`);
    if (config.scrim > 0) parts.push(`<rect width="${w}" height="${h}" fill="#000000" opacity="${config.scrim}"/>`);
  }
  if (config.templateAssetId) {
    parts.push(`<image href="${src(config.templateAssetId)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`);
  }

  let y = top;
  if (config.headline) {
    parts.push(`<text x="${x}" y="${y + headSize * 0.85}" font-family="${escapeXml(fonts.heading)}" font-size="${headSize}" font-weight="700" fill="${config.textColor}" text-anchor="${anchor}" letter-spacing="${-headSize * 0.02}">`
      + headLines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHead}">${escapeXml(l)}</tspan>`).join('')
      + `</text>`);
    y += headLines.length * lineHead;
  }
  if (config.body) {
    y += gap;
    parts.push(`<text x="${x}" y="${y + bodySize * 0.9}" font-family="${escapeXml(fonts.body)}" font-size="${bodySize}" fill="${config.textColor}" text-anchor="${anchor}">`
      + bodyLines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineBody}">${escapeXml(l)}</tspan>`).join('')
      + `</text>`);
    y += bodyLines.length * lineBody;
  }
  if (config.cta) {
    y += gap * 1.5;
    const padX = ctaSize * 1.2;
    const textW = config.cta.length * ctaSize * 0.58 + padX * 2;
    const bx = config.align === 'centre' ? w / 2 - textW / 2 : margin;
    parts.push(`<rect x="${bx}" y="${y}" width="${textW}" height="${ctaH}" rx="${ctaH / 2}" fill="${config.accent}"/>`);
    parts.push(`<text x="${bx + textW / 2}" y="${y + ctaH / 2 + ctaSize * 0.35}" font-family="${escapeXml(fonts.body)}" font-size="${ctaSize}" font-weight="600" fill="${config.background}" text-anchor="middle">${escapeXml(config.cta)}</text>`);
  }

  if (config.logoAssetId && config.logoCorner !== 'none') {
    const size = Math.round(w * 0.12);
    const lx = config.logoCorner.endsWith('l') ? margin : w - margin - size;
    const ly = config.logoCorner.startsWith('t') ? margin : h - margin - size;
    parts.push(`<image href="${src(config.logoAssetId)}" x="${lx}" y="${ly}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

export default function TemplateMaker({ format, clientId, assets, values, project, onSaved, onClose }: {
  format: Format;
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  project: BrandProject | undefined;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const size = SIZES[format];
  const approved = useMemo(() => assets.filter((a) => a.approved && isImageAsset(a)), [assets]);
  const templates = approved.filter((a) => a.kind === 'template');
  const photos = approved.filter((a) => a.kind === 'photography');
  const logos = approved.filter((a) => a.kind === 'logo');
  const colours = useMemo(() => brandColours(values), [values]);
  const fonts = useMemo(() => brandFonts(values), [values]);

  const initial = (): TemplateConfiguration => {
    const s = project?.configuration as Partial<TemplateConfiguration> | undefined;
    const dark = colours.find((c) => /char|black|ink|dark|text/i.test(c.name))?.hex ?? '#14161a';
    const light = colours.find((c) => /cream|paper|white|light|back/i.test(c.name))?.hex ?? '#ffffff';
    const accent = colours.find((c) => /accent|ember|orange|primary|brand/i.test(c.name))?.hex ?? colours[0]?.hex ?? dark;
    return {
      templateAssetId: s?.templateAssetId ?? templates[0]?.id ?? '',
      photoAssetId: s?.photoAssetId ?? '',
      logoAssetId: s?.logoAssetId ?? logos[0]?.id ?? '',
      headline: s?.headline ?? 'A headline worth reading',
      body: s?.body ?? '',
      cta: s?.cta ?? '',
      layout: s?.layout ?? 'bottom', align: s?.align ?? 'left',
      logoCorner: s?.logoCorner ?? (logos[0] ? 'tl' : 'none'),
      background: s?.background ?? light, textColor: s?.textColor ?? dark, accent: s?.accent ?? accent,
      scrim: s?.scrim ?? 0.3,
    };
  };
  const [config, setConfig] = useState<TemplateConfiguration>(initial);
  const [name, setName] = useState(project?.name ?? '');
  const [saveAs, setSaveAs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const set = (patch: Partial<TemplateConfiguration>): void => setConfig((c) => ({ ...c, ...patch }));

  const svg = useMemo(() => templateSvg(format, config, fonts, api.downloadPath), [format, config, fonts]);

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const title = name.trim() || config.headline.slice(0, 60) || size.label;
      if (project && !asNew) return api.updateBrandProject(project.id, { name: title, configuration: config });
      return api.createBrandProject(clientId, { toolId: format, name: title, configuration: config });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['brand-projects', clientId] });
      setSaveAs(false);
      onSaved(saved);
    },
    onError: (e) => setError((e as Error).message),
  });

  const doExport = async (): Promise<void> => {
    setExporting(true);
    setError(undefined);
    try { await exportPng(svg, safeBasename(name || config.headline, format), size.w, size.h); }
    catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  };

  return (
    <div className="pattern-studio">
      <div className="pattern-preview">
        <Preview svg={svg} label={`${size.label} preview`} aspect={`${size.w} / ${size.h}`} />
        <div className="row pattern-actions">
          <span className="muted" style={{ fontSize: 13 }}>{size.w} × {size.h} px · type and colours are the brand's</span>
          <button type="button" style={{ marginLeft: 'auto' }} disabled={exporting} onClick={() => void doExport()}>
            <Download size={14} aria-hidden="true" /> {exporting ? 'Exporting…' : 'PNG'}
          </button>
        </div>
      </div>

      <aside className="pattern-controls stack">
        <label className="field">
          <span className="label">Design name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch post" />
        </label>
        <label className="field">
          <span className="label">Headline</span>
          <input value={config.headline} maxLength={140} onChange={(e) => set({ headline: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Body</span>
          <textarea rows={3} value={config.body} maxLength={400} onChange={(e) => set({ body: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Call to action</span>
          <input value={config.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} placeholder="Shop the range" />
        </label>

        <Segmented label="Words sit" value={config.layout} onChange={(v) => set({ layout: v })}
                   options={[{ id: 'top', label: 'Top' }, { id: 'centre', label: 'Centre' }, { id: 'bottom', label: 'Bottom' }]} />
        <Segmented label="Aligned" value={config.align} onChange={(v) => set({ align: v })}
                   options={[{ id: 'left', label: 'Left' }, { id: 'centre', label: 'Centred' }]} />

        {templates.length > 0 && (
          <AssetPicker label="Artwork" assets={templates} value={config.templateAssetId} allowNone
                       onChange={(id) => set({ templateAssetId: id })} src={api.downloadPath} />
        )}
        {photos.length > 0 && (
          <>
            <AssetPicker label="Photograph" assets={photos} value={config.photoAssetId} allowNone
                         onChange={(id) => set({ photoAssetId: id })} src={api.downloadPath} />
            {config.photoAssetId && (
              <Dial label="Darken photo" value={config.scrim} min={0} max={0.8} step={0.05} onChange={(v) => set({ scrim: v })} />
            )}
          </>
        )}
        {logos.length > 0 && (
          <>
            <AssetPicker label="Logo" assets={logos} value={config.logoAssetId} allowNone
                         onChange={(id) => set({ logoAssetId: id, logoCorner: id ? (config.logoCorner === 'none' ? 'tl' : config.logoCorner) : 'none' })} src={api.downloadPath} />
            {config.logoAssetId && (
              <Segmented label="Logo corner" value={config.logoCorner} onChange={(v) => set({ logoCorner: v })}
                         options={[{ id: 'tl', label: '↖' }, { id: 'tr', label: '↗' }, { id: 'bl', label: '↙' }, { id: 'br', label: '↘' }, { id: 'none', label: 'None' }]} />
            )}
          </>
        )}

        {colours.length > 0 ? (
          <>
            <Swatches label="Words" colours={colours} value={config.textColor} onChange={(hex) => set({ textColor: hex })} />
            <Swatches label="Button" colours={colours} value={config.accent} onChange={(hex) => set({ accent: hex })} />
            <Swatches label="Background" colours={colours} value={config.background} onChange={(hex) => set({ background: hex })} />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Colours follow the brand palette once the studio has set one.</p>
        )}

        {error && <p className="err">{error}</p>}

        <div className="row" style={{ marginTop: 'auto' }}>
          <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate(false)}>
            <Save size={14} aria-hidden="true" /> {save.isPending ? 'Saving…' : project ? 'Save' : 'Save design'}
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
