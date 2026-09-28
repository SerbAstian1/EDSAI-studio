import type { ReactElement } from 'react';
import { Lock, TriangleAlert } from 'lucide-react';
import type { Asset, BrandRules, CanvasDocument, CanvasNode } from '../api.js';
import { logoRuleOf } from '../components/brandModules.js';
import { assetHref } from './useEditor.js';
import { BLEND_LABELS, distortionOf, SHAPE_PRESETS } from './document.js';
import { issuesForNode, type Verdict } from './brandCheck.js';
import {
  AreaField, ChoiceField, ColorField, Group, NumberField, Readout, Row, SelectField,
  SliderField, TextField, ToggleField,
} from './fields.js';

/**
 * The panel on the right: what is selected, and what can be done to it.
 *
 * **One section per concern, and the same sections every time.** Position and
 * size are always here; then whatever this layer's own type allows; then effects;
 * then the brand's verdict. A designer who has used the panel once knows where
 * everything is, which is the only way a panel this dense stays usable — and it
 * is why a logo has no fill control rather than a disabled one.
 *
 * **The union does the work.** The compiler refuses to render `fontSize` for a
 * picture or a fill for a logo, so the type-specific sections are written per
 * node type and cannot drift out of step with the document model.
 */

export interface InspectorProps {
  doc: CanvasDocument;
  nodes: readonly CanvasNode[];
  assets: readonly Asset[];
  rules: BrandRules;
  verdict: Verdict;
  /** The hexes a designer may put on the sheet, as swatches. */
  swatches: readonly string[];
  /** False when the brand has said no other colour may be reached. */
  allowCustomColor: boolean;
  fonts: readonly string[];
  allowCustomFont: boolean;
  onPatch: (ids: string[], label: string, change: (node: CanvasNode) => CanvasNode) => void;
  onArtboard: (patch: Partial<CanvasDocument['artboard']>) => void;
}

export default function Inspector(props: InspectorProps): ReactElement {
  const { doc, nodes, assets, rules, verdict, swatches, allowCustomColor, fonts, allowCustomFont, onPatch, onArtboard } = props;

  /**
   * Nothing selected: the canvas is the subject, so the canvas is what is shown.
   *
   * The brand verdict still appears, because "is this design on brand" is a
   * question about the whole design and it is most often asked with nothing
   * selected.
   */
  if (nodes.length === 0) {
    return (
      <div className="cv-inspector">
        <Group title="Canvas">
          <Row>
            <NumberField label="Width" value={doc.artboard.width} min={16} max={8000} unit="px"
              onChange={(width) => onArtboard({ width })} />
            <NumberField label="Height" value={doc.artboard.height} min={16} max={8000} unit="px"
              onChange={(height) => onArtboard({ height })} />
          </Row>
          <ColorField label="Background" value={doc.artboard.background} swatches={swatches}
            allowCustom={allowCustomColor} onChange={(background) => onArtboard({ background })} />
        </Group>
        <DesignVerdict verdict={verdict} />
      </div>
    );
  }

  const one = nodes.length === 1 ? nodes[0] : undefined;
  const ids = nodes.map((node) => node.id);
  const locked = one?.locked === true;
  const patch = (label: string, change: (node: CanvasNode) => CanvasNode): void => onPatch(ids, label, change);

  /**
   * **Geometry is one layer at a time.**
   *
   * Setting `x` on four selected layers would stack them all on one edge, and the
   * number shown would be neither where they are nor where they would go. So the
   * fields are off, and they say why — a disabled control with no reason reads as
   * a broken one.
   */
  const geometry = one !== undefined;

  return (
    <div className="cv-inspector">
      <Group title={one ? one.name : `${nodes.length} layers selected`}>
        {one ? (
          <TextField label="Layer name" value={one.name} wide
            onChange={(name) => patch('Rename', (node) => ({ ...node, name: name.slice(0, 80) || node.name }))} />
        ) : (
          <p className="cv-note">Select one layer to set its position, size and type.</p>
        )}
      </Group>

      <Group title="Position and size">
        <Row>
          <NumberField label="X" value={one?.x ?? 0} unit="px" disabled={!geometry || locked}
            onChange={(x) => patch('Move', (node) => ({ ...node, x }))} />
          <NumberField label="Y" value={one?.y ?? 0} unit="px" disabled={!geometry || locked}
            onChange={(y) => patch('Move', (node) => ({ ...node, y }))} />
        </Row>
        <Row>
          <NumberField label="Width" value={one?.width ?? 0} min={1} unit="px" disabled={!geometry || locked}
            onChange={(width) => patch('Resize', (node) => ({ ...node, width }))} />
          <NumberField label="Height" value={one?.height ?? 0} min={1} unit="px" disabled={!geometry || locked}
            onChange={(height) => patch('Resize', (node) => ({ ...node, height }))} />
        </Row>
        <Row>
          <NumberField label="Rotation" value={Math.round(one?.rotation ?? 0)} min={-360} max={360} unit="°" disabled={!geometry || locked}
            onChange={(rotation) => patch('Rotate', (node) => ({ ...node, rotation }))} />
          {one?.type === 'logo' ? (
            <Readout
              label="Distortion"
              tone={distortionOf(one, one.properties.sourceAspect) > 1.02 ? 'bad' : 'good'}
              value={`${Math.round(distortionOf(one, one.properties.sourceAspect) * 100)}%`}
            />
          ) : null}
        </Row>
        <Row>
          <ToggleField label="Locked" value={one?.locked ?? false}
            hint="A locked layer cannot be moved, restyled or deleted."
            onChange={(on) => patch(on ? 'Lock' : 'Unlock', (node) => ({ ...node, locked: on }))} />
          <ToggleField label="Hidden" value={one?.hidden ?? false}
            hint="A hidden layer is saved but not drawn or exported."
            onChange={(on) => patch(on ? 'Hide' : 'Show', (node) => ({ ...node, hidden: on }))} />
        </Row>
      </Group>

      {one ? (
        <TypeSection
          node={one}
          assets={assets}
          rules={rules}
          swatches={swatches}
          allowCustomColor={allowCustomColor}
          fonts={fonts}
          allowCustomFont={allowCustomFont}
          locked={locked}
          onPatch={onPatch}
        />
      ) : null}

      {one ? (
        <EffectsSection node={one} swatches={swatches} allowCustomColor={allowCustomColor}
          locked={locked} onPatch={onPatch} />
      ) : null}

      <VerdictSection nodes={nodes} verdict={verdict} onPatch={onPatch} />
    </div>
  );
}

/* ---------------------------------------------------------- type-specific */

function TypeSection(props: {
  node: CanvasNode;
  assets: readonly Asset[];
  rules: BrandRules;
  swatches: readonly string[];
  allowCustomColor: boolean;
  fonts: readonly string[];
  allowCustomFont: boolean;
  locked: boolean;
  onPatch: InspectorProps['onPatch'];
}): ReactElement {
  const { node, assets, rules, swatches, allowCustomColor, fonts, allowCustomFont, locked, onPatch } = props;
  const id = node.id;
  const set = (label: string, change: (node: CanvasNode) => CanvasNode): void => onPatch([id], label, change);

  switch (node.type) {
    case 'text': {
      const p = node.properties;
      // The current family is always offered, even if the brand has since stopped
      // naming it, so a designer opening an old design is not shown a select whose
      // value is not in it.
      const families = [...new Set([...fonts, p.fontFamily])];
      return (
        <Group title="Type">
          <AreaField label="Text" value={p.text} rows={3} disabled={locked}
            onChange={(text) => set('Edit text', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, text } } : n)} />
          <SelectField label="Typeface" value={p.fontFamily}
            options={families.map((family) => ({ id: family, label: family }))}
            disabled={locked || !allowCustomFont}
            onChange={(fontFamily) => set('Typeface', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, fontFamily } } : n)} />
          {!allowCustomFont ? (
            <p className="cv-note"><Lock size={12} /> This brand allows its own type only.</p>
          ) : null}
          <Row>
            <NumberField label="Size" value={p.fontSize} min={4} max={600} unit="px" disabled={locked}
              onChange={(fontSize) => set('Type size', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, fontSize } } : n)} />
            <NumberField label="Weight" value={p.fontWeight} min={100} max={900} step={100} disabled={locked}
              onChange={(fontWeight) => set('Type weight', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, fontWeight } } : n)} />
          </Row>
          <Row>
            <NumberField label="Line height" value={p.lineHeight} min={0.5} max={4} step={0.05} disabled={locked}
              onChange={(lineHeight) => set('Line height', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, lineHeight } } : n)} />
            <NumberField label="Tracking" value={p.letterSpacing} min={-0.4} max={2} step={0.01} disabled={locked}
              onChange={(letterSpacing) => set('Tracking', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, letterSpacing } } : n)} />
          </Row>
          <ChoiceField label="Alignment" value={p.align} disabled={locked}
            options={[{ id: 'left', label: 'Left' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right' }]}
            onChange={(align) => set('Alignment', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, align } } : n)} />
          <ChoiceField label="Capitalisation" value={p.transform} disabled={locked}
            options={[{ id: 'none', label: 'As typed' }, { id: 'uppercase', label: 'UPPER' }, { id: 'lowercase', label: 'lower' }]}
            onChange={(transform) => set('Capitalisation', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, transform } } : n)} />
          <ColorField label="Colour" value={p.color} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
            onChange={(color) => set('Colour', (n) => n.type === 'text' ? { ...n, properties: { ...n.properties, color } } : n)} />
        </Group>
      );
    }

    case 'shape': {
      const p = node.properties;
      return (
        <Group title="Shape">
          <ChoiceField label="Kind" value={p.shape} disabled={locked}
            options={SHAPE_PRESETS.map((preset) => ({ id: preset.kind, label: preset.label }))}
            onChange={(shape) => set('Shape', (n) => n.type === 'shape' ? { ...n, properties: { ...n.properties, shape } } : n)} />
          <ColorField label="Fill" value={p.fill} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
            onChange={(fill) => set('Fill', (n) => n.type === 'shape' ? { ...n, properties: { ...n.properties, fill } } : n)} />
          <ColorField label="Stroke" value={p.stroke} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
            onChange={(stroke) => set('Stroke', (n) => n.type === 'shape' ? { ...n, properties: { ...n.properties, stroke } } : n)} />
          <NumberField label="Stroke width" value={p.strokeWidth} min={0} max={200} unit="px" disabled={locked}
            onChange={(strokeWidth) => set('Stroke width', (n) => n.type === 'shape' ? { ...n, properties: { ...n.properties, strokeWidth } } : n)} />
          {/* Only the rounded rectangle has a corner to set; the others are
              exactly the same shape whatever this number says. */}
          {p.shape === 'rounded-rectangle' ? (
            <NumberField label="Corner radius" value={p.cornerRadius} min={0} max={2000} unit="px" disabled={locked}
              onChange={(cornerRadius) => set('Corner radius', (n) => n.type === 'shape' ? { ...n, properties: { ...n.properties, cornerRadius } } : n)} />
          ) : null}
        </Group>
      );
    }

    case 'image': {
      const p = node.properties;
      return (
        <Group title="Picture">
          <FilePreview assetId={p.assetId} assets={assets} />
          <ChoiceField label="Fit" value={p.fit} disabled={locked}
            options={[
              { id: 'cover', label: 'Fill', hint: 'Fills the box, cropping the overflow.' },
              { id: 'contain', label: 'Fit', hint: 'Fits the whole picture inside the box.' },
              { id: 'fill', label: 'Stretch', hint: 'Fills the box exactly, distorting the picture.' },
            ]}
            onChange={(fit) => set('Fit', (n) => n.type === 'image' ? { ...n, properties: { ...n.properties, fit } } : n)} />
          <NumberField label="Corner radius" value={p.cornerRadius} min={0} max={2000} unit="px" disabled={locked}
            onChange={(cornerRadius) => set('Corner radius', (n) => n.type === 'image' ? { ...n, properties: { ...n.properties, cornerRadius } } : n)} />
          <SliderField label="Brightness" value={p.adjustments.brightness} min={0} max={2} disabled={locked}
            onChange={(brightness) => set('Brightness', (n) => n.type === 'image' ? { ...n, properties: { ...n.properties, adjustments: { ...n.properties.adjustments, brightness } } } : n)} />
          <SliderField label="Contrast" value={p.adjustments.contrast} min={0} max={2} disabled={locked}
            onChange={(contrast) => set('Contrast', (n) => n.type === 'image' ? { ...n, properties: { ...n.properties, adjustments: { ...n.properties.adjustments, contrast } } } : n)} />
          <SliderField label="Saturation" value={p.adjustments.saturation} min={0} max={2} disabled={locked}
            onChange={(saturation) => set('Saturation', (n) => n.type === 'image' ? { ...n, properties: { ...n.properties, adjustments: { ...n.properties.adjustments, saturation } } } : n)} />
        </Group>
      );
    }

    case 'illustration': {
      const p = node.properties;
      const rule = logoRuleOf(rules, p.assetId);
      return (
        <Group title="Illustration">
          <FilePreview assetId={p.assetId} assets={assets} />
          <ChoiceField label="Fit" value={p.fit} disabled={locked}
            options={[{ id: 'contain', label: 'Fit' }, { id: 'cover', label: 'Fill' }, { id: 'fill', label: 'Stretch' }]}
            onChange={(fit) => set('Fit', (n) => n.type === 'illustration' ? { ...n, properties: { ...n.properties, fit } } : n)} />
          <ToggleField label="Tint applied" value={p.tint !== ''} disabled={locked}
            hint="A tint keeps the shape of the drawing and changes only its colour."
            onChange={(on) => set('Tint', (n) => n.type === 'illustration' ? { ...n, properties: { ...n.properties, tint: on ? firstSwatch(swatches) : '' } } : n)} />
          {p.tint !== '' ? (
            <ColorField label="Tint" value={p.tint} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
              onChange={(tint) => set('Tint', (n) => n.type === 'illustration' ? { ...n, properties: { ...n.properties, tint } } : n)} />
          ) : null}
          <ToggleField label="Flip" value={p.flip} disabled={locked}
            onChange={(flip) => set('Flip', (n) => n.type === 'illustration' ? { ...n, properties: { ...n.properties, flip } } : n)} />
          {rule ? (
            <p className="cv-note"><Lock size={12} /> The brand has rules for this file; see the brand check below.</p>
          ) : null}
        </Group>
      );
    }

    case 'logo': {
      const p = node.properties;
      const rule = logoRuleOf(rules, p.assetId);
      const skew = distortionOf(node, p.sourceAspect);
      return (
        <Group title="Logo">
          <FilePreview assetId={p.assetId} assets={assets} />
          <Readout label="File size" value={`${p.naturalWidth} × ${p.naturalHeight}`} />
          <Readout label="Distortion" tone={skew > 1.02 ? 'bad' : 'good'} value={`${Math.round(skew * 100)}% of its own shape`} />
          {rule?.minWidth !== undefined ? (
            <Readout label="Brand minimum" tone={node.width < rule.minWidth ? 'bad' : 'good'} value={`${rule.minWidth}px wide`} />
          ) : null}
          {rule && !rule.allowDistortion && skew > 1.02 ? (
            <p className="cv-note cv-note--bad">
              <TriangleAlert size={12} /> The brand does not allow this mark to be stretched.
            </p>
          ) : null}
          {/*
            The variant is the brand's own name for this mark, and it is the key
            the rules are written against — a studio that has written "dark
            background, 120px minimum" needs to know which mark is on the sheet.
          */}
          <TextField label="Variant name" value={p.variant} disabled={locked}
            onChange={(variant) => set('Variant', (n) => n.type === 'logo' ? { ...n, properties: { ...n.properties, variant: variant.slice(0, 60) || 'primary' } } : n)} />
        </Group>
      );
    }

    case 'pattern': {
      const p = node.properties;
      return (
        <Group title="Pattern">
          <FilePreview assetId={p.assetId} assets={assets} />
          <NumberField label="Tile size" value={p.tile} min={8} max={2000} unit="px" disabled={locked}
            onChange={(tile) => set('Tile size', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, tile } } : n)} />
          <Row>
            <NumberField label="Tile rotation" value={p.rotation} min={-180} max={180} unit="°" disabled={locked}
              onChange={(rotation) => set('Pattern rotation', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, rotation } } : n)} />
            <NumberField label="Offset X" value={p.offsetX} min={-1} max={1} step={0.05} disabled={locked}
              onChange={(offsetX) => set('Pattern offset', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, offsetX } } : n)} />
          </Row>
          <NumberField label="Offset Y" value={p.offsetY} min={-1} max={1} step={0.05} disabled={locked}
            onChange={(offsetY) => set('Pattern offset', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, offsetY } } : n)} />
          <ToggleField label="Colour wash on" value={p.color !== ''} disabled={locked}
            hint="Multiplied into the tile, so the pattern reads as ink on the artwork."
            onChange={(on) => set('Colour wash', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, color: on ? firstSwatch(swatches) : '' } } : n)} />
          {p.color !== '' ? (
            <ColorField label="Colour wash" value={p.color} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
              onChange={(color) => set('Colour wash', (n) => n.type === 'pattern' ? { ...n, properties: { ...n.properties, color } } : n)} />
          ) : null}
        </Group>
      );
    }

    case 'texture': {
      const p = node.properties;
      return (
        <Group title="Texture">
          <FilePreview assetId={p.assetId} assets={assets} />
          <NumberField label="Scale" value={p.scale} min={8} max={2000} unit="px" disabled={locked}
            onChange={(scale) => set('Texture scale', (n) => n.type === 'texture' ? { ...n, properties: { ...n.properties, scale } } : n)} />
          <SliderField label="Strength" value={p.opacity} min={0} max={1} disabled={locked}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(opacity) => set('Texture strength', (n) => n.type === 'texture' ? { ...n, properties: { ...n.properties, opacity } } : n)} />
          <ChoiceField label="Blend" value={p.blend} disabled={locked}
            options={blendOptions()}
            onChange={(blend) => set('Texture blend', (n) => n.type === 'texture' ? { ...n, properties: { ...n.properties, blend } } : n)} />
          <ToggleField label="Colour wash on" value={p.color !== ''} disabled={locked}
            onChange={(on) => set('Colour wash', (n) => n.type === 'texture' ? { ...n, properties: { ...n.properties, color: on ? firstSwatch(swatches) : '' } } : n)} />
          {p.color !== '' ? (
            <ColorField label="Colour wash" value={p.color} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
              onChange={(color) => set('Colour wash', (n) => n.type === 'texture' ? { ...n, properties: { ...n.properties, color } } : n)} />
          ) : null}
        </Group>
      );
    }

    case 'group':
      return (
        <Group title="Group">
          <p className="cv-note">
            A group holds layers and moves them together. It has no appearance of its own.
          </p>
        </Group>
      );
  }
}

/** A thumbnail of the file a layer points at, and its name. */
function FilePreview({ assetId, assets }: { assetId: string; assets: readonly Asset[] }): ReactElement {
  const asset = assets.find((entry) => entry.id === assetId);
  return (
    <div className="cv-file-preview">
      <span className="cv-file-preview__thumb">
        {/* A missing file gets no src, so the browser shows the broken-image mark
            rather than a request the server will refuse anyway. */}
        {asset ? <img src={assetHref(asset.id, asset.kind)} alt="" loading="lazy" /> : null}
      </span>
      <span className="cv-file-preview__name">
        {asset?.filename ?? 'Not in this client’s library'}
        {asset && !asset.approved ? <span className="cv-file-preview__flag">not approved</span> : null}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- effects */

function EffectsSection(props: {
  node: CanvasNode;
  swatches: readonly string[];
  allowCustomColor: boolean;
  locked: boolean;
  onPatch: InspectorProps['onPatch'];
}): ReactElement {
  const { node, swatches, allowCustomColor, locked, onPatch } = props;
  const id = node.id;
  const set = (label: string, change: (node: CanvasNode) => CanvasNode): void => onPatch([id], label, change);
  const e = node.effects;
  return (
    <Group title="Effects">
      <SliderField label="Opacity" value={e.opacity} min={0} max={1} disabled={locked}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(opacity) => set('Opacity', (node) => ({ ...node, effects: { ...node.effects, opacity } }))} />
      <SliderField label="Blur" value={e.blur} min={0} max={200} disabled={locked}
        format={(value) => `${Math.round(value)}px`}
        onChange={(blur) => set('Blur', (node) => ({ ...node, effects: { ...node.effects, blur } }))} />
      <ChoiceField label="Blend" value={e.blend} disabled={locked} options={blendOptions()}
        onChange={(blend) => set('Blend', (node) => ({ ...node, effects: { ...node.effects, blend } }))} />
      <ToggleField label="Shadow" value={e.shadow.enabled} disabled={locked}
        onChange={(on) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, enabled: on } } }))} />
      {e.shadow.enabled ? (
        <>
          <Row>
            <NumberField label="Shadow X" value={e.shadow.x} min={-400} max={400} unit="px" disabled={locked}
              onChange={(x) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, x } } }))} />
            <NumberField label="Shadow Y" value={e.shadow.y} min={-400} max={400} unit="px" disabled={locked}
              onChange={(y) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, y } } }))} />
          </Row>
          <NumberField label="Shadow blur" value={e.shadow.blur} min={0} max={200} unit="px" disabled={locked}
            onChange={(blur) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, blur } } }))} />
          <ColorField label="Shadow colour" value={e.shadow.color} swatches={swatches} allowCustom={allowCustomColor} disabled={locked}
            onChange={(color) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, color } } }))} />
          <SliderField label="Shadow strength" value={e.shadow.opacity} min={0} max={1} disabled={locked}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(opacity) => set('Shadow', (node) => ({ ...node, effects: { ...node.effects, shadow: { ...node.effects.shadow, opacity } } }))} />
        </>
      ) : null}
    </Group>
  );
}

/* ----------------------------------------------------------------- verdict */

function VerdictSection(props: {
  nodes: readonly CanvasNode[];
  verdict: Verdict;
  onPatch: InspectorProps['onPatch'];
}): ReactElement | null {
  const { nodes, verdict, onPatch } = props;
  const one = nodes.length === 1 ? nodes[0] : undefined;
  const mine = one ? issuesForNode(verdict, one.id) : [];
  if (mine.length === 0) return null;

  /**
   * Carry out a fix the check itself proposed.
   *
   * **The hex or the family is captured before the closure**, because the action
   * is narrowed here and a closure body sees the wide union again — and because
   * the read-out of a brand check is only useful if acting on it is one click.
   */
  const apply = (issue: (typeof mine)[number]): void => {
    const action = issue.action;
    if (!action || !one) return;
    if (action.kind === 'brand-color') {
      const hex = action.hex;
      onPatch([one.id], 'Use a brand colour', (node) => (
        node.type === 'text' ? { ...node, properties: { ...node.properties, color: hex } }
          : node.type === 'shape' ? { ...node, properties: { ...node.properties, fill: hex } }
            : node.type === 'illustration' ? { ...node, properties: { ...node.properties, tint: hex } }
              : node.type === 'pattern' ? { ...node, properties: { ...node.properties, color: hex } }
                : node.type === 'texture' ? { ...node, properties: { ...node.properties, color: hex } }
                  : node
      ));
      return;
    }
    const family = action.family;
    onPatch([one.id], 'Use a brand typeface', (node) => (node.type === 'text'
      ? { ...node, properties: { ...node.properties, fontFamily: family } }
      : node));
  };

  return (
    <Group title="Brand check" tone="brand">
      {mine.map((issue, index) => (
        <div key={`${issue.title}-${index}`} className={`cv-issue cv-issue--${issue.level}`}>
          <p className="cv-issue__title"><TriangleAlert size={13} />{issue.title}</p>
          <p className="cv-issue__detail">{issue.detail}</p>
          <p className="cv-issue__fix">{issue.fix}</p>
          {issue.action ? (
            <button type="button" className="cv-issue__action" onClick={() => apply(issue)}>
              {issue.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </Group>
  );
}

/** The whole-design verdict, for when there is no layer selected to attach it to. */
function DesignVerdict({ verdict }: { verdict: Verdict }): ReactElement {
  if (verdict.issues.length === 0) {
    return (
      <Group title="Brand check" tone="brand">
        <p className="cv-issue cv-issue--ok">Every layer on this design is inside the brand.</p>
      </Group>
    );
  }
  return (
    <Group title="Brand check" tone="brand">
      {/*
        The issues without a layer — "more than one logo on the sheet" — are
        about the design and can only be listed here. The ones about a layer are
        shown when that layer is selected, which is where a fix can be carried
        out; repeating them here would be the same sentence twice.
      */}
      {verdict.issues.filter((issue) => issue.nodeId === undefined).map((issue, index) => (
        <div key={`${issue.title}-${index}`} className={`cv-issue cv-issue--${issue.level}`}>
          <p className="cv-issue__title"><TriangleAlert size={13} />{issue.title}</p>
          <p className="cv-issue__detail">{issue.detail}</p>
          <p className="cv-issue__fix">{issue.fix}</p>
        </div>
      ))}
      <p className="cv-note">
        {verdict.errors} to fix and {verdict.warnings} to look at. Select a layer to see its own.
      </p>
    </Group>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The blend modes, from the one list the document model and the renderer share. */
function blendOptions(): { id: keyof typeof BLEND_LABELS; label: string }[] {
  return (Object.keys(BLEND_LABELS) as (keyof typeof BLEND_LABELS)[]).map((id) => ({ id, label: BLEND_LABELS[id] }));
}

/**
 * The colour a wash or a tint starts at.
 *
 * The brand's own first colour when there is one, and a neutral when there is
 * not — because "turn on a colour wash" with no brand palette should give a
 * designer something visible to change, not a layer that silently does nothing.
 */
function firstSwatch(swatches: readonly string[]): string {
  return swatches[0] ?? '#EB5E28';
}
