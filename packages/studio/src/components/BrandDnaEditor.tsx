import { useState, type ReactElement } from 'react';
import { Dna } from 'lucide-react';
import { BRAND_CAPABILITIES, type BrandCapability, type BrandDna } from '../api.js';

/**
 * What this brand *is*, as the set of visual systems it is built from.
 *
 * **The designer fills this in once, by describing the identity.** The modules a
 * client receives are then derived from it rather than chosen from a list of
 * everything EDSAI could have built, which is the whole claim of the Brand Hub:
 * a hub is a brand turned into software, and two clients should not receive the
 * same software.
 *
 * **Most capabilities have no tool built, and that is the correct state.** They
 * are shown greyed and unclickable, because a grain-led identity may eventually
 * get a Grain FX, and a designer recording "this brand is grain-led" today
 * should not have to remember it in a year. Naming a capability grants nothing;
 * only a tool in the next panel below can do that.
 *
 * An undescribed brand — no systems at all — gates nothing, which is what keeps
 * every hub that existed before this did keep working.
 */

const LABELS: Record<BrandCapability, string> = {
  pattern: 'Pattern',
  illustration: 'Illustration',
  photography: 'Photography',
  typography: 'Typography',
  grain: 'Grain',
  noise: 'Noise',
  halftone: 'Halftone',
  duotone: 'Duotone',
  riso: 'Riso printing',
  photocopy: 'Photocopy',
  distress: 'Distress',
  paper: 'Paper texture',
  metal: 'Metal',
  glass: 'Glass',
  gradient: 'Gradient',
  'light-shadow': 'Light & shadow',
  shape: 'Shapes',
  icon: 'Icons',
  frame: 'Frames',
  sticker: 'Stickers',
  collage: 'Collage',
  'type-fx': 'Type effects',
  'three-d': '3D',
  template: 'Templates',
};

/**
 * The capabilities something can be built out of, split by whether a tool
 * exists for them yet.
 *
 * `BUILT` is not a claim that the tool is switched on for anybody — it is that
 * the module exists, so ticking one of these has a visible consequence below.
 */
const BUILT: readonly BrandCapability[] = ['pattern', 'illustration', 'template', 'typography', 'photography'];

export function dnaLabel(capability: BrandCapability): string {
  return LABELS[capability] ?? capability;
}

/** Whether a capability has a tool built, and so whether naming it does anything yet. */
export function capabilityBuilt(capability: BrandCapability): boolean {
  return BUILT.includes(capability);
}

/** Whether a brand has been described at all, which is the honest default. */
export function dnaDescribed(dna: BrandDna | undefined): boolean {
  return (dna?.systems.length ?? 0) > 0;
}

/**
 * Add or remove a system, keeping the list in the order shown so the designer
 * reads their own answer back the same way every time.
 */
export function toggleSystem(systems: readonly BrandCapability[], capability: BrandCapability): BrandCapability[] {
  return systems.includes(capability)
    ? systems.filter((s) => s !== capability)
    : [...systems, capability];
}

export default function BrandDnaEditor({ dna, onChange, disabled }: {
  dna: BrandDna;
  onChange: (dna: BrandDna) => void;
  disabled?: boolean;
}): ReactElement {
  const [note, setNote] = useState(dna.note ?? '');
  const described = dnaDescribed(dna);
  const groups: { label: string; capabilities: BrandCapability[] }[] = [
    { label: 'Identity systems', capabilities: ['pattern', 'illustration', 'typography', 'photography', 'template'] },
    { label: 'Print and surface', capabilities: ['riso', 'halftone', 'duotone', 'photocopy', 'distress', 'grain', 'noise', 'paper'] },
    { label: 'Material and light', capabilities: ['metal', 'glass', 'gradient', 'light-shadow', 'three-d'] },
    { label: 'Components', capabilities: ['shape', 'icon', 'frame', 'sticker', 'collage', 'type-fx'] },
  ];

  return (
    <div className="card stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="label"><Dna size={13} aria-hidden="true" /> What this brand is</span>
        {described
          ? <span className="pill minor">{dna.systems.length} system{dna.systems.length === 1 ? '' : 's'}</span>
          : <span className="pill minor">not described yet</span>}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Tick the visual systems this identity is built from. The tools below narrow to what the
        brand actually has — a pattern-led identity gets Pattern Studio, a photographic one gets
        Photo Treatment, and a minimal one may get nothing at all. Nothing here is shown to the
        client.
      </p>

      {groups.map((group) => (
        <fieldset key={group.label} className="dna-group">
          <legend className="label">{group.label}</legend>
          <div className="dna-row">
            {group.capabilities.map((capability) => {
              const built = capabilityBuilt(capability);
              const on = dna.systems.includes(capability);
              return (
                <label key={capability} className={`choice dna-chip${built ? '' : ' soon'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={() => onChange({ ...dna, systems: toggleSystem(dna.systems, capability) })}
                  />
                  <span>{dnaLabel(capability)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <label className="field">
        <span className="label">Note to self (optional)</span>
        <textarea
          rows={2}
          maxLength={600}
          value={note}
          placeholder="Riso-inspired, heavy grain, one orange. Nothing gradients."
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (dna.note ?? '')) onChange({ ...dna, ...(note ? { note } : {}) });
          }}
        />
      </label>
    </div>
  );
}
