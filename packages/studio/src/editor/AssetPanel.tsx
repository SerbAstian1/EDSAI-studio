import { useMemo, useState, type ReactElement } from 'react';
import { Grid3x3, PenTool, Search, Shapes, Sparkles, Type, Image as ImageIcon, Lock } from 'lucide-react';
import type { Asset, BrandValue, CanvasNode } from '../api.js';
import { api } from '../api.js';
import { Disclosure } from './fields.js';
import { brandColours, brandFonts, isImageAsset } from '../components/toolkit.js';
import type { Tool } from './CanvasStage.js';

/**
 * The client's own files, and nothing else.
 *
 * **Only approved files reach this panel at all** — the hub filters the list
 * before it arrives, so there is no "unapproved" section to forget to hide. That
 * is the whole reason the filter lives where it does: a panel that had to
 * remember to exclude unapproved files would be one refactor away from offering a
 * client's unapproved logo to another client.
 *
 * **Grouped by kind, because the kind is what the canvas does with it.** A flat
 * alphabetical list of forty files would make a designer read filenames to work
 * out which of them is the logo; four labelled shelves of thumbnails does not.
 */

const SHELVES: readonly { kind: Asset['kind']; label: string; places: CanvasNode['type'][]; note: string }[] = [
  { kind: 'logo', label: 'Logos', places: ['logo'], note: 'Placed at the file’s own proportions. The brand may set rules for these.' },
  { kind: 'photography', label: 'Photography', places: ['image'], note: 'The client’s own pictures. Nothing is generated here.' },
  { kind: 'illustration', label: 'Illustrations', places: ['illustration'], note: 'Can be knocked into a brand colour without losing the drawing.' },
  { kind: 'pattern', label: 'Patterns', places: ['pattern'], note: 'Tiled across the sheet, with an optional colour wash.' },
  { kind: 'texture', label: 'Textures', places: ['texture'], note: 'Laid under the design at a low opacity, the way paper is.' },
  { kind: 'icon', label: 'Icons', places: ['image'], note: '' },
];

const SHELF_ICON: Record<string, typeof Sparkles> = {
  logo: Sparkles, photography: ImageIcon, illustration: PenTool, pattern: Grid3x3, texture: Grid3x3, icon: Shapes,
};

export interface AssetPanelProps {
  assets: readonly Asset[];
  values: readonly BrandValue[];
  /** The stage's current tool, so the two quick actions show which one is armed. */
  tool: Tool;
  onPlace: (kind: CanvasNode['type'], asset: Asset) => void;
  onAddText: () => void;
  onAddShape: () => void;
  lockedFor: (kind: CanvasNode['type']) => boolean;
}

export default function AssetPanel(props: AssetPanelProps): ReactElement {
  const { assets, values, tool, onPlace, onAddText, onAddShape, lockedFor } = props;
  const [search, setSearch] = useState('');

  const shelves = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const match = (asset: Asset): boolean => needle === ''
      || asset.filename.toLowerCase().includes(needle)
      || (asset.description ?? '').toLowerCase().includes(needle)
      || (asset.collection ?? '').toLowerCase().includes(needle);
    return SHELVES
      .map((shelf) => ({ ...shelf, files: assets.filter((a) => a.kind === shelf.kind && match(a)) }))
      .filter((shelf) => shelf.files.length > 0);
  }, [assets, search]);

  const colours = useMemo(() => brandColours(values), [values]);
  const fonts = useMemo(() => brandFonts(values), [values]);
  const others = useMemo(
    () => assets.filter((a) => !SHELVES.some((s) => s.kind === a.kind) && isImageAsset(a)),
    [assets],
  );

  return (
    <div className="cv-library">
      <div className="cv-library__search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          value={search}
          placeholder="Find a file"
          aria-label="Find a file in the library"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/*
        The two things that are not files, first.

        Type and shapes have no file behind them, and a designer reaching for a
        headline should not have to notice that the library contains no headline.
      */}
      <div className="cv-quick">
        <button type="button" className={`cv-quick__item${tool === 'text' ? ' is-on' : ''}`}
          disabled={lockedFor('text')} onClick={onAddText}
          title={lockedFor('text') ? 'This brand does not allow other type.' : 'Add a text layer'}>
          <Type size={16} /><span>Text</span>
        </button>
        <button type="button" className={`cv-quick__item${tool === 'shape' ? ' is-on' : ''}`}
          disabled={lockedFor('shape')} onClick={onAddShape}
          title={lockedFor('shape') ? 'This brand does not allow other shapes.' : 'Add a shape'}>
          <Shapes size={16} /><span>Shape</span>
        </button>
      </div>

      {colours.length > 0 ? (
        <Disclosure title="Brand colours" count={colours.length}>
          <div className="cv-shelf__colours">
            {colours.map((colour) => (
              <span key={colour.hex} className="cv-colour-chip" title={`${colour.name} ${colour.hex}`}>
                <span className="cv-colour-chip__swatch" style={{ background: colour.hex }} />
                <span className="mono">{colour.hex.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </Disclosure>
      ) : null}

      {fonts.heading || fonts.body ? (
        <Disclosure title="Brand type" count={new Set([fonts.heading, fonts.body]).size}>
          <ul className="cv-fonts">
            <li style={{ fontFamily: fonts.heading }}>{fonts.heading}<span>display</span></li>
            <li style={{ fontFamily: fonts.body }}>{fonts.body}<span>body</span></li>
          </ul>
        </Disclosure>
      ) : null}

      {shelves.map((shelf) => {
        const Icon = SHELF_ICON[shelf.kind] ?? Sparkles;
        return (
          <Disclosure key={shelf.kind} title={shelf.label} count={shelf.files.length}>
            {shelf.note ? <p className="cv-shelf__note">{shelf.note}</p> : null}
            <div className="cv-shelf">
              {shelf.files.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="cv-file"
                  disabled={lockedFor(shelf.places[0]!)}
                  title={lockedFor(shelf.places[0]!) ? 'This brand does not allow this kind of layer.' : `Place ${asset.filename}`}
                  onClick={() => onPlace(shelf.places[0]!, asset)}
                >
                  <span className="cv-file__thumb">
                    <img src={api.downloadPath(asset.id)} alt="" loading="lazy" />
                  </span>
                  <span className="cv-file__name">{asset.filename}</span>
                  {asset.approved ? null : <Lock size={11} className="cv-file__lock" />}
                </button>
              ))}
            </div>
            <p className="cv-shelf__icon-note"><Icon size={12} /> {shelf.places.length > 1 ? `Placed as ${shelf.places.join(' or ')}.` : ''}</p>
          </Disclosure>
        );
      })}

      {others.length > 0 ? (
        <Disclosure title="Other files" count={others.length}>
          <div className="cv-shelf">
            {others.map((asset) => (
              <button key={asset.id} type="button" className="cv-file" onClick={() => onPlace('image', asset)}>
                <span className="cv-file__thumb"><img src={api.downloadPath(asset.id)} alt="" loading="lazy" /></span>
                <span className="cv-file__name">{asset.filename}</span>
              </button>
            ))}
          </div>
        </Disclosure>
      ) : null}

      {shelves.length === 0 && others.length === 0 ? (
        <p className="cv-empty">
          {assets.length === 0
            ? 'This client has no approved files yet. Upload and approve some in the asset lab, then come back.'
            : `Nothing matches “${search.trim()}”.`}
        </p>
      ) : null}
    </div>
  );
}
