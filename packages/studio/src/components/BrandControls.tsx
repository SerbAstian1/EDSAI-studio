import type { ReactElement } from 'react';
import type { BrandModule } from '../api.js';
import { presetValues, presetsFor } from './brandModules.js';

/**
 * The control that replaces a number field.
 *
 * **This is the whole argument for handing a Brand Hub to a client, made into
 * one component.** A designer decides that grain comes in Subtle, Standard and
 * Heavy, with exact intensity, scale and opacity behind each name; a client
 * picks a name. A client who could reach `intensity` directly would eventually
 * produce a 34 the studio never signed off, and would not know it was wrong.
 *
 * So a parameter the brand has locked is not rendered disabled — it is not
 * rendered at all. A disabled dial is an invitation; a radio group of names is
 * a decision. Where a module has presets, the presets are the parameter's only
 * affordance, and where it has none the tool's own control shows as it always
 * did, because a hub the studio never configured has to keep working.
 */

/** One preset as a radio: a name, and whatever the designer put behind it. */
export function PresetChoices({ module, presetId, onChange, name }: {
  module: BrandModule;
  /** The selected preset. `undefined` when the module has none configured. */
  presetId: string | undefined;
  onChange: (presetId: string) => void;
  /** Unique per module, so two modules' groups are not one group to a screen reader. */
  name: string;
}): ReactElement | null {
  const { presets } = presetsFor(module);
  if (presets.length === 0) return null;
  return (
    <div className="dial">
      <span className="label">{PRESET_LABEL[module.id] ?? 'Style'}</span>
      <div className="segmented" role="radiogroup" aria-label={`${module.name} style`}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={preset.id === presetId}
            className={preset.id === presetId ? 'on' : ''}
            onClick={() => onChange(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the preset row is called for each tool, so it is not "Style" everywhere. */
const PRESET_LABEL: Record<string, string> = {
  'pattern-studio': 'Scale and spacing',
  'illustration-builder': 'Arrangement',
  'social-post': 'Layout',
  poster: 'Layout',
};

/**
 * What a client calls the design they are looking at.
 *
 * A designer's name when there is one — "Heavy" is the studio's word, and a
 * client who chose it should see it named — and "Custom" otherwise, which is
 * the honest label for a design that has drifted off every preset rather than
 * the default preset's name.
 */
export function presetLabel(module: BrandModule, presetId: string | undefined): string {
  return presetsFor(module).presets.find((p) => p.id === presetId)?.label ?? 'Custom';
}

/**
 * A dial a client is allowed to turn, or nothing at all.
 *
 * Returning `null` rather than a disabled input is the decision this component
 * exists to make: a locked parameter is not reachable, and the only reason it
 * changes value is a preset, whose values are applied over the top of whatever
 * the client changed.
 */
export function BrandDial({ module, paramId, children }: {
  module: BrandModule;
  paramId: string;
  children: ReactElement | null;
}): ReactElement | null {
  if (module.locked.includes(paramId)) return null;
  return children ?? null;
}

/**
 * Apply a preset to a configuration, on the way into a tool's state.
 *
 * Called on open and on every preset change, so switching from "Subtle" to
 * "Heavy" visibly moves the design rather than only affecting the next save.
 * Locked parameters are written from the preset last, which is the order that
 * makes a lock hold against a value already sitting in the configuration.
 *
 * Generic in the configuration's own type, and constrained only to `object`
 * rather than to an index signature, because a tool's configuration is a named
 * interface and not a bag of keys. The preset only ever adds and overwrites, so
 * the result is the same type it was given.
 */
export function withPreset<T extends object>(
  module: BrandModule,
  configuration: T,
  presetId: string | undefined,
): T {
  const preset = presetsFor(module).presets.find((p) => p.id === presetId);
  if (!preset) return configuration;
  const merged: Record<string, unknown> = { ...configuration, ...presetValues(module, preset.id) };
  for (const id of module.locked) {
    const value = preset.values[id];
    if (value !== undefined) merged[id] = value;
  }
  return merged as T;
}
