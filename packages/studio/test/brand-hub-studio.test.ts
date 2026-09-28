import { describe, expect, it } from 'vitest';
import {
  allowedColors, applyPreset, brandRulesOf, paramEditable, presetsFor, servedByBrand,
} from '../src/components/brandModules.js';
import { withPreset, presetLabel } from '../src/components/BrandControls.js';
import {
  addPreset, emptyModuleConfig, isLocked, moduleConfigOf, removePreset, setLocked, setPresetValue,
} from '../src/components/BrandModuleEditor.js';
import { addColor, removeColor } from '../src/components/BrandRulesEditor.js';
import { capabilityBuilt, dnaDescribed, dnaLabel, toggleSystem } from '../src/components/BrandDnaEditor.js';
import { filesIntoLibrary } from '../src/components/brandLibrary.js';
import type { BrandDna, BrandModule, BrandModuleConfig, BrandRules, BrandValue } from '../src/api.js';

const VALUE = (name: string, value: string, kind: BrandValue['kind'] = 'color'): BrandValue =>
  ({ clientId: 'acme', name, value, kind } as BrandValue);

const module = (over: Partial<BrandModule> = {}): BrandModule => ({
  id: 'pattern-studio', name: 'Pattern Studio', description: 'Tiles the brand.',
  layer: 'asset-lab', capability: 'pattern', available: true, requires: [],
  exports: ['png'], enabled: true, locked: ['scale'],
  parameters: [
    { id: 'scale', label: 'Scale', control: 'dial', presetOnly: false },
    { id: 'intensity', label: 'Intensity', control: 'dial', presetOnly: false },
    { id: 'opacity', label: 'Opacity', control: 'dial', presetOnly: true },
  ],
  presets: [
    { id: 'subtle', label: 'Subtle', values: { scale: 0.5, intensity: 10, opacity: 12 } },
    { id: 'heavy', label: 'Heavy', values: { scale: 1.1, intensity: 38, opacity: 26 } },
  ],
  defaultPreset: 'subtle',
  order: 0,
  ...over,
});

const dna = (systems: BrandDna['systems'] = []): BrandDna => ({ systems });

describe('the presets a client is offered', () => {
  it('reads the ones the designer wrote', () => {
    const { presets, defaultPreset } = presetsFor(module());
    expect(presets.map((p) => p.label)).toEqual(['Subtle', 'Heavy']);
    expect(defaultPreset).toBe('subtle');
  });

  it('has none at all for a module nobody configured, which is not an error', () => {
    expect(presetsFor(module({ presets: [], defaultPreset: undefined }))).toEqual({ presets: [], defaultPreset: undefined });
  });

  it('falls back to the first preset when the default was deleted', () => {
    // A designer who removes "Standard" should not leave every client on a dead
    // selection, and the screen must agree with the authorization about it.
    expect(presetsFor(module({ defaultPreset: 'gone' })).defaultPreset).toBe('subtle');
  });
});

describe('whether a client may change a parameter', () => {
  it('locks what the module locked and what the tool put behind a preset', () => {
    const m = module({ locked: ['scale'] });
    expect(paramEditable(m, 'intensity')).toBe(true);
    expect(paramEditable(m, 'scale')).toBe(false);
    expect(isLocked(m, 'opacity', emptyModuleConfig())).toBe(true);
  });

  it('lets a designer open a parameter, and opening wins over both lists', () => {
    const config: BrandModuleConfig = { ...emptyModuleConfig(), locked: ['scale'], unlocked: ['scale'] };
    expect(isLocked(module(), 'scale', config)).toBe(false);
  });

  it('lets a designer open one the tool put behind a preset', () => {
    const config: BrandModuleConfig = { ...emptyModuleConfig(), unlocked: ['opacity'] };
    expect(isLocked(module(), 'opacity', config)).toBe(false);
  });
});

describe('applying a preset', () => {
  it('writes the preset values in', () => {
    expect(withPreset(module(), { name: 'sk' } as never, 'heavy')).toEqual({ name: 'sk', scale: 1.1, intensity: 38, opacity: 26 });
  });

  it('leaves the configuration alone when there is no such preset', () => {
    expect(withPreset(module(), { intensity: 1 } as never, 'nope')).toEqual({ intensity: 1 });
  });

  it('writes locked parameters from the preset last, which is what makes a lock hold', () => {
    // A `scale` of 900 already sitting in the configuration must not survive.
    expect((withPreset(module(), { scale: 900 } as Record<string, unknown>, 'heavy') as Record<string, unknown>).scale)
      .toBe(1.1);
  });

  it('names the client-facing choices plainly', () => {
    expect(presetLabel(module(), 'heavy')).toBe('Heavy');
    expect(presetLabel(module(), 'nope')).toBe('Custom');
  });
});

describe('the merge the server does on save', () => {
  it('keeps a client dial that moved after choosing Heavy', () => {
    // A client who turns a dial after picking a preset expects it to stay put.
    expect(applyPreset(module(), { intensity: 22 }, 'heavy').intensity).toBe(22);
  });

  it('discards a client dial on a parameter the studio locked', () => {
    expect(applyPreset(module(), { scale: 900 }, 'heavy').scale).toBe(1.1);
  });

  it('falls back to the first preset when the row names one that is gone', () => {
    expect(applyPreset(module(), {}, 'gone').intensity).toBe(10);
  });

  it('copies rather than mutating, when there is nothing to apply', () => {
    const bare = module({ presets: [], defaultPreset: undefined, locked: [] });
    const configuration = { a: 1 };
    const merged = applyPreset(bare, configuration, undefined);
    expect(merged).toEqual(configuration);
    expect(merged).not.toBe(configuration);
  });
});

describe('a designer building presets', () => {
  it('makes the first one written the default, rather than leaving a dead selection', () => {
    expect(addPreset(emptyModuleConfig(), 'Subtle').defaultPreset).toBe('subtle');
  });

  it('turns a name into an id, and refuses an empty one or a duplicate', () => {
    expect(addPreset(emptyModuleConfig(), '  Heavy Duty!  ').presets[0]?.id).toBe('heavy-duty');
    expect(addPreset(emptyModuleConfig(), '   ')).toEqual(emptyModuleConfig());
    const once = addPreset(emptyModuleConfig(), 'Subtle');
    expect(addPreset(once, 'subtle').presets).toHaveLength(1);
  });

  it('records a value against a preset without disturbing the others', () => {
    const config = addPreset(addPreset(emptyModuleConfig(), 'Subtle'), 'Heavy');
    const next = setPresetValue(config, 'heavy', 'intensity', 38);
    expect(next.presets.find((p) => p.id === 'heavy')?.values.intensity).toBe(38);
    expect(next.presets.find((p) => p.id === 'subtle')?.values).toEqual({});
  });

  it('moves the default when the preset it named is removed', () => {
    const config = addPreset(addPreset(emptyModuleConfig(), 'Subtle'), 'Heavy');
    expect(removePreset(config, 'subtle').defaultPreset).toBe('heavy');
  });

  it('leaves no default key at all when the last preset goes', () => {
    const one = addPreset(emptyModuleConfig(), 'Subtle');
    const gone = removePreset(one, 'subtle');
    expect(gone.presets).toEqual([]);
    expect('defaultPreset' in gone).toBe(false);
  });

  it('touches a parameter in one list at a time', () => {
    const locked = setLocked(emptyModuleConfig(), 'scale', true);
    expect(locked.locked).toEqual(['scale']);
    expect(setLocked(locked, 'scale', false).locked).toEqual([]);
    // Unlocking also records the opening, so it survives a later lock.
    expect(setLocked(locked, 'scale', false).unlocked).toEqual(['scale']);
  });
});

describe('reading a module configuration off a hub', () => {
  it('gives an unconfigured module an empty one rather than undefined', () => {
    expect(moduleConfigOf(undefined, 'pattern-studio')).toEqual(emptyModuleConfig());
    expect(moduleConfigOf({}, 'poster')).toEqual(emptyModuleConfig());
  });

  it('keeps a saved module configuration', () => {
    const saved: BrandModuleConfig = { presets: [{ id: 'a', label: 'A', values: {} }], locked: [], unlocked: [] };
    expect(moduleConfigOf({ 'pattern-studio': saved }, 'pattern-studio').presets[0]?.label).toBe('A');
  });
});

describe('the rules a generator obeys', () => {
  it('are unrestricted by default, which is what keeps every existing hub working', () => {
    expect(brandRulesOf(undefined)).toEqual({
      colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [], logos: {},
    });
  });

  it('keeps a half-sent rule from erasing the rest', () => {
    const rules = brandRulesOf({ colors: ['#EB5E28'] });
    expect(rules.colors).toEqual(['#EB5E28']);
    expect(rules.exports).toEqual([]);
  });

  it('normalises a hex and refuses one that is not a hex', () => {
    expect(addColor(brandRulesOf(undefined), ' #EB5E28 ').colors).toEqual(['#eb5e28']);
    expect(addColor(brandRulesOf(undefined), 'rebeccapurple').colors).toEqual([]);
    expect(addColor(brandRulesOf(undefined), '#FFF').colors).toEqual([]);
  });

  it('does not allow the same colour twice', () => {
    const once = addColor(brandRulesOf(undefined), '#eb5e28');
    expect(addColor(once, '#EB5E28').colors).toEqual(['#eb5e28']);
  });

  it('removes a colour from the allowlist', () => {
    const rules = addColor(brandRulesOf(undefined), '#eb5e28');
    expect(removeColor(rules, '#eb5e28').colors).toEqual([]);
  });
});

describe('the colours a generator is offered', () => {
  it('is the measured palette when the designer named none', () => {
    expect(allowedColors(undefined, [
      VALUE('Ember', '#EB5E28'), VALUE('Charcoal', '#14161A'), VALUE('Body', '16px', 'size'),
    ])).toEqual({ hexes: ['#eb5e28', '#14161a'], allowCustom: false });
  });

  it('is the list the designer named, when they named one', () => {
    const rules: BrandRules = brandRulesOf({ colors: ['#14161a'] });
    expect(allowedColors(rules, [VALUE('Ember', '#EB5E28')]).hexes).toEqual(['#14161a']);
  });

  it('only reaches outside the brand when a designer asks for it', () => {
    const rules: BrandRules = brandRulesOf({ colors: ['#14161a'], allowCustomColor: true });
    expect(allowedColors(rules, []).allowCustom).toBe(true);
  });
});

describe('the brand description', () => {
  it('is undescribed until a system is named, and gates nothing in that state', () => {
    expect(dnaDescribed(dna())).toBe(false);
    expect(dnaDescribed(dna(['pattern']))).toBe(true);
    // The whole backwards-compatibility story: an undescribed brand keeps
    // every module it had.
    expect(servedByBrand([], 'pattern')).toBe(true);
    expect(servedByBrand(undefined, 'pattern')).toBe(true);
  });

  it('gates a described brand to what it actually has', () => {
    expect(servedByBrand(['pattern'], 'pattern')).toBe(true);
    expect(servedByBrand(['pattern'], 'illustration')).toBe(false);
  });

  it('adds and removes a system, keeping the order it was read in', () => {
    expect(toggleSystem(['pattern'], 'illustration')).toEqual(['pattern', 'illustration']);
    expect(toggleSystem(['pattern', 'illustration'], 'pattern')).toEqual(['illustration']);
  });

  it('marks a capability with a tool built, and still names the rest', () => {
    expect(capabilityBuilt('pattern')).toBe(true);
    // Grain is listed and unclickable: a designer recording a grain-led brand
    // today should find it there when the Grain FX ships.
    expect(capabilityBuilt('grain')).toBe(false);
    expect(dnaLabel('duotone')).toBe('Duotone');
  });
});

describe('what may be filed into the brand library', () => {
  it('is the Asset Lab, because that is the layer that feeds the next thing', () => {
    // A pattern or an illustration is an input to another module, so a client
    // who makes one can go on using it.
    expect(filesIntoLibrary(module({ layer: 'asset-lab' }))).toBe(true);
  });

  it('is not a finished composition, which nothing can build on', () => {
    // A social post or a poster is an end point. Tiling one into a pattern
    // would produce exactly the wrong thing, so these keep the download button
    // and are left out rather than filling the library with dead files.
    expect(filesIntoLibrary(module({ id: 'social-post', layer: 'composer' }))).toBe(false);
    expect(filesIntoLibrary(module({ id: 'poster', layer: 'composer' }))).toBe(false);
  });
});
