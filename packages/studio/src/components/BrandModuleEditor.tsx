import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight, Lock, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { BrandModule, BrandModuleConfig, BrandParameter, BrandPreset } from '../api.js';

/**
 * What a designer decides about one module: the presets a client chooses
 * between, and which dials they may still turn.
 *
 * **This is the screen the product principle is built on.** A designer defines
 * possibilities; a client creates inside them. So the primary control here is
 * not a number field — it is a list of *named* presets, each one holding the
 * exact values behind it, which is the shape the brief asks for:
 *
 *     Subtle    Intensity 10  Scale 0.5  Opacity 12%
 *     Standard  Intensity 23  Scale 0.8  Opacity 18%
 *     Heavy     Intensity 38  Scale 1.1  Opacity 26%
 *
 * A client then sees three radio buttons and a design that cannot leave the
 * system. Adding a dial to a tool in a later release does not widen this: a
 * parameter is locked unless the designer opens it.
 */

/** An empty module configuration, so an unconfigured module needs no special case. */
export function emptyModuleConfig(): BrandModuleConfig {
  return { presets: [], locked: [], unlocked: [] };
}

/** The module's configuration, or an empty one. */
export function moduleConfigOf(
  config: Record<string, BrandModuleConfig> | undefined,
  toolId: string,
): BrandModuleConfig {
  const found = config?.[toolId];
  return { ...emptyModuleConfig(), ...found };
}

/**
 * Whether a client may turn one parameter.
 *
 * Three things can hold a parameter, and the order is the decision:
 * `unlocked` first, because a designer who has deliberately opened something is
 * overriding everything, then the tool's own `presetOnly` flags, then the
 * designer's `locked` list.
 *
 * **`unlocked` beating `presetOnly` is the point of having `presetOnly` at all.**
 * A parameter the tool put behind a preset is one the tool's authors judged a
 * client would get wrong — and the studio, who signed off the brand, is
 * entitled to disagree. The editor offers exactly that: "held by the tool —
 * presets only, until you open it". Without this ordering that checkbox would
 * do nothing, and a control that claims to open something and does not is worse
 * than no control at all.
 */
export function isLocked(
  module: BrandModule,
  paramId: string,
  config: BrandModuleConfig,
): boolean {
  if (config.unlocked.includes(paramId)) return false;
  const presetOnly = module.parameters.some((p) => p.id === paramId && p.presetOnly);
  return presetOnly || config.locked.includes(paramId);
}

/** Move a parameter into or out of the locked list, from either direction. */
export function setLocked(
  config: BrandModuleConfig,
  paramId: string,
  locked: boolean,
): BrandModuleConfig {
  const without = (list: string[]): string[] => list.filter((id) => id !== paramId);
  if (locked) return { ...config, locked: [...without(config.locked), paramId], unlocked: without(config.unlocked) };
  return { ...config, locked: without(config.locked), unlocked: [...without(config.unlocked), paramId] };
}

/** Add a preset with a name and no values yet, which the designer then fills in. */
export function addPreset(config: BrandModuleConfig, label: string): BrandModuleConfig {
  const trimmed = label.trim();
  if (!trimmed) return config;
  const id = trimmed.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || `preset-${config.presets.length + 1}`;
  if (config.presets.some((p) => p.id === id)) return config;
  const preset: BrandPreset = { id, label: trimmed.slice(0, 60), values: {} };
  return {
    ...config,
    presets: [...config.presets, preset],
    // The first preset a designer writes is almost always the one they mean, so
    // it becomes the default rather than leaving a new module with no default.
    defaultPreset: config.defaultPreset ?? id,
  };
}

/** Write one parameter's value into a preset. */
export function setPresetValue(
  config: BrandModuleConfig,
  presetId: string,
  paramId: string,
  value: number | string | boolean,
): BrandModuleConfig {
  return {
    ...config,
    presets: config.presets.map((p) => (p.id === presetId
      ? { ...p, values: { ...p.values, [paramId]: value } }
      : p)),
  };
}

/**
 * Remove a preset, and the default that pointed at it.
 *
 * A default left pointing at a deleted preset would leave every client on a dead
 * selection, so it falls to the first one that remains — and to no key at all
 * when none do, which `presetsFor` reads as "no default" rather than as an id
 * naming nothing.
 */
export function removePreset(config: BrandModuleConfig, presetId: string): BrandModuleConfig {
  const presets = config.presets.filter((p) => p.id !== presetId);
  const { defaultPreset, ...rest } = config;
  return {
    ...rest,
    presets,
    ...(defaultPreset === presetId && presets[0] ? { defaultPreset: presets[0].id } : {}),
  };
}

export default function BrandModuleEditor({ module, config, onChange, disabled }: {
  module: BrandModule;
  config: BrandModuleConfig;
  onChange: (config: BrandModuleConfig) => void;
  disabled?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const lockedCount = module.parameters.filter((p) => isLocked(module, p.id, config)).length;

  if (!module.available) {
    return (
      <div className="card">
        <div className="row">
          <span className="label">{module.name}</span>
          <span className="pill minor" style={{ marginLeft: 'auto' }}>not built yet</span>
        </div>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{module.description}</p>
      </div>
    );
  }

  return (
    <div className="card stack">
      <button type="button" className="module-config-head" aria-expanded={open}
              onClick={() => setOpen((o) => !o)} disabled={disabled}>
        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <span className="label">{module.name}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {config.presets.length > 0
            ? `${config.presets.length} preset${config.presets.length === 1 ? '' : 's'}`
            : 'no presets yet'}
          {' · '}
          <Lock size={11} aria-hidden="true" /> {lockedCount} of {module.parameters.length} held
        </span>
      </button>

      {open && (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{module.description}</p>

          {/* Presets: the named choices a client gets instead of number fields. */}
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Presets the client chooses between</span>
            {config.presets.length === 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                None yet. With no presets a client gets the tool&apos;s own dials, which is how this
                module has always worked.
              </p>
            )}
            {config.presets.map((preset) => (
              <div key={preset.id} className="preset-row">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <label className="choice">
                    <input
                      type="radio"
                      name={`${module.id}-default`}
                      checked={config.defaultPreset === preset.id}
                      disabled={disabled}
                      onChange={() => onChange({ ...config, defaultPreset: preset.id })}
                    />
                    <span><strong>{preset.label}</strong><span className="why">opens on this</span></span>
                  </label>
                  <button
                    type="button"
                    className="overflow-button row"
                    style={{ marginLeft: 'auto' }}
                    aria-label={`Remove the ${preset.label} preset`}
                    disabled={disabled}
                    onClick={() => onChange(removePreset(config, preset.id))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
                <div className="preset-values">
                  {module.parameters.map((param) => (
                    <PresetValue
                      key={param.id}
                      module={module}
                      param={param}
                      presetId={preset.id}
                      config={config}
                      disabled={disabled ?? false}
                      onChange={(next) => onChange(setPresetValue(config, preset.id, param.id, next))}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="row">
              <input
                value={newName}
                placeholder="Subtle, Standard, Heavy…"
                aria-label="Name for a new preset"
                maxLength={60}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  onChange(addPreset(config, newName));
                  setNewName('');
                }}
              />
              <button
                type="button"
                disabled={disabled || newName.trim() === ''}
                onClick={() => { onChange(addPreset(config, newName)); setNewName(''); }}
              >
                Add preset
              </button>
            </div>
          </div>

          {/* Parameters: what the client may still turn by hand. */}
          <div className="stack" style={{ gap: 8 }}>
            <span className="label"><SlidersHorizontal size={12} aria-hidden="true" /> Controls the client may turn</span>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              A held control is shown to the client greyed rather than hidden — they can see the value
              the studio chose, and cannot reach for a number field to undo it. Presets change every
              held control at once.
            </p>
            {module.parameters.map((param) => {
              const locked = isLocked(module, param.id, config);
              const forced = param.presetOnly && !config.unlocked.includes(param.id);
              return (
                <label key={param.id} className={`choice${forced ? '' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!locked}
                    disabled={disabled || forced}
                    onChange={(e) => onChange(setLocked(config, param.id, !e.target.checked))}
                  />
                  <span>
                    <strong>{param.label}</strong>
                    {forced
                      ? <span className="why">held by the tool — presets only, until you open it</span>
                      : <span className="why">{param.control}{param.presetOnly ? ' · behind a preset' : ''}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One parameter's value inside one preset.
 *
 * A number gets a number field, a choice gets the choices, a text or colour
 * gets a field. The control follows the parameter's declared kind so a designer
 * is filling in the same thing the client will later choose between, rather
 * than typing a number into a box that means "this many pixels".
 */
function PresetValue({ module, param, presetId, config, disabled, onChange }: {
  module: BrandModule;
  param: BrandParameter;
  presetId: string;
  config: BrandModuleConfig;
  disabled?: boolean;
  onChange: (value: number | string | boolean) => void;
}): ReactElement | null {
  const preset = config.presets.find((p) => p.id === presetId);
  if (!preset) return null;
  const current = preset.values[param.id];
  if (param.control === 'choice') {
    const choices = CHOICES[param.id];
    if (!choices) return null;
    return (
      <label className="preset-value">
        <span className="label">{param.label}</span>
        <select
          value={typeof current === 'string' ? current : choices[0]?.id ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
    );
  }
  if (param.control === 'dial') {
    return (
      <label className="preset-value">
        <span className="label">{param.label}</span>
        <input
          type="number"
          value={typeof current === 'number' ? current : ''}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label className="preset-value">
      <span className="label">{param.label}</span>
      <input
        type={param.control === 'colour' ? 'color' : 'text'}
        value={typeof current === 'string' ? current : ''}
        placeholder={param.control === 'colour' ? '#000000' : '—'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * The choices a `choice` parameter offers, per tool.
 *
 * A code list rather than configuration, for the same reason the tool registry
 * is one: a set of arrangements is a property of the tool, and the studio picks
 * *which* of them a client gets by locking the control or not.
 */
const CHOICES: Record<string, { id: string; label: string }[]> = {
  layout: [{ id: 'top', label: 'Top' }, { id: 'centre', label: 'Centre' }, { id: 'bottom', label: 'Bottom' }],
  align: [{ id: 'left', label: 'Left' }, { id: 'centre', label: 'Centred' }],
  logoCorner: [
    { id: 'none', label: 'None' }, { id: 'tl', label: 'Top left' }, { id: 'tr', label: 'Top right' },
    { id: 'bl', label: 'Bottom left' }, { id: 'br', label: 'Bottom right' },
  ],
};
