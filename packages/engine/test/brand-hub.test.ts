import { describe, expect, it } from 'vitest';
import {
  BRAND_TOOLS, BrandAsset, BrandHub, assetsInBrandAsset, assetsInConfiguration, applyPreset,
  allowedColors, allowedExports, allowedFonts, colorAllowed, dnaHas, hubEnabled, lockedParams,
  moduleAllowed, paramEditable, presetsFor, resolveLayer, resolveModules, toolsInLayer,
} from '../src/brand-hub.js';

/**
 * The tool registry and the one function that keeps every tool honest:
 * naming the files a configuration refers to, so the API can check each
 * one is the client's own and approved before anything is saved.
 */

describe('brand tools', () => {
  it('every tool listed is built', () => {
    expect(BRAND_TOOLS.every((t) => t.available)).toBe(true);
    expect(BRAND_TOOLS.map((t) => t.id)).toEqual(['pattern-studio', 'illustration-builder', 'social-post', 'poster']);
  });

  it('a hub is enabled only when active', () => {
    const base = { clientId: 'c', tools: [], createdAt: '', updatedAt: '' };
    expect(hubEnabled(undefined)).toBe(false);
    expect(hubEnabled({ ...base, status: 'draft' })).toBe(false);
    expect(hubEnabled({ ...base, status: 'suspended' })).toBe(false);
    expect(hubEnabled({ ...base, status: 'active' })).toBe(true);
  });

  it('every tool names a capability the DNA is allowed to carry, and a layer', () => {
    // The two halves of the hub, and the visual system each module serves.
    expect(toolsInLayer('asset-lab').map((t) => t.id)).toEqual(['pattern-studio', 'illustration-builder']);
    expect(toolsInLayer('composer').map((t) => t.id)).toEqual(['social-post', 'poster']);
  });
});

describe('what a configuration refers to', () => {
  it('names the pattern', () => {
    expect(assetsInConfiguration('pattern-studio', {
      assetId: 'a1', scale: 100, spacing: 0, rotation: 0, opacity: 1, tint: '', background: '#ffffff', offsetX: 0, offsetY: 0,
    })).toEqual(['a1']);
  });

  it('names every layer of a scene', () => {
    const layer = (assetId: string) => ({ assetId, x: 0.5, y: 0.5, scale: 1, rotation: 0, flip: false, tint: '' });
    expect(assetsInConfiguration('illustration-builder', {
      background: '#ffffff', layers: [layer('bg'), layer('hero'), layer('hero')],
    })).toEqual(['bg', 'hero', 'hero']);
  });

  it('names the artwork, photograph and logo of a template, skipping the empty slots', () => {
    const config = {
      templateAssetId: 't1', photoAssetId: '', logoAssetId: 'l1',
      headline: 'Hi', body: '', cta: '', layout: 'bottom', align: 'left', logoCorner: 'tl',
      background: '#ffffff', textColor: '#000000', accent: '#eb5e28', scrim: 0.3,
    };
    expect(assetsInConfiguration('social-post', config)).toEqual(['t1', 'l1']);
    expect(assetsInConfiguration('poster', config)).toEqual(['t1', 'l1']);
  });

  it('refuses a shape that is not the tool’s own', () => {
    expect(assetsInConfiguration('pattern-studio', { assetId: 'a1' })).toBeUndefined();
    expect(assetsInConfiguration('illustration-builder', { background: 'red', layers: [] })).toBeUndefined();
    expect(assetsInConfiguration('social-post', { headline: 'x' })).toBeUndefined();
    expect(assetsInConfiguration('illustration-builder', {
      background: '#ffffff', layers: [{ assetId: 'a', x: 9, y: 0, scale: 1, rotation: 0, flip: false, tint: '' }],
    })).toBeUndefined();
  });
});

/* ------------------------------------------------------------ brand DNA */

/** A hub with a brand that has these systems and these tools switched on. */
function hub(systems: string[], tools: string[], modules: Record<string, unknown> = {}, rules: Record<string, unknown> = {}) {
  return BrandHub.parse({
    clientId: 'c', status: 'active', tools, dna: { systems }, config: { modules, rules },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('brand DNA', () => {
  it('a brand that has declared nothing carries nothing', () => {
    expect(dnaHas({ systems: [] }, 'pattern')).toBe(false);
    expect(dnaHas(undefined, 'pattern')).toBe(false);
  });

  it('knows which systems it has, and refuses the ones it does not', () => {
    expect(dnaHas({ systems: ['pattern', 'riso'] }, 'pattern')).toBe(true);
    expect(dnaHas({ systems: ['pattern', 'riso'] }, 'halftone')).toBe(false);
  });

  it('survives a row written before a hub had any way to say this', () => {
    // What a pre-DNA hub parses to: no systems, which is a real brand with
    // nothing declared rather than a broken row.
    const legacy = BrandHub.parse({ clientId: 'c', tools: ['pattern-studio'], createdAt: '', updatedAt: '' });
    expect(legacy.dna.systems).toEqual([]);
    expect(dnaHas(legacy.dna, 'pattern')).toBe(false);
  });
});

/* --------------------------------------------------------------- locking */

describe('what a client may not change', () => {
  it('freezes the parameters a tool marks preset-only, before anyone configures anything', () => {
    // scale, spacing, offsetX, offsetY. Not rotation or opacity, which the
    // studio already opened up.
    expect(lockedParams('pattern-studio', undefined))
      .toEqual(['scale', 'spacing', 'offsetX', 'offsetY']);
  });

  it('locks a parameter the designer names, and unlocks one they open up', () => {
    // `scale` is preset-only and gets opened up; `rotation` was open and gets
    // frozen. Both lists are applied, so the result is neither one alone.
    const config = { presets: [], locked: ['rotation'], unlocked: ['scale'], order: 0 };
    expect(lockedParams('pattern-studio', config)).toEqual(['spacing', 'rotation', 'offsetX', 'offsetY']);
  });

  it('lets the deliberate act win when a parameter is both locked and unlocked', () => {
    // A designer who lists a parameter in both means "open this one", and an
    // id in `unlocked` is the later decision.
    const config = { presets: [], locked: ['scale'], unlocked: ['scale'], order: 0 };
    expect(lockedParams('pattern-studio', config)).toEqual(['spacing', 'offsetX', 'offsetY']);
  });

  it('ignores a lock on a parameter the tool does not have', () => {
    // Otherwise removing a dial in a later release leaves it frozen forever,
    // and nobody can find the setting that froze it.
    const config = { presets: [], locked: ['dial-from-2027'], unlocked: [], order: 0 };
    expect(lockedParams('pattern-studio', config)).toEqual(['scale', 'spacing', 'offsetX', 'offsetY']);
  });

  it('locks nothing for a tool it has never heard of', () => {
    expect(lockedParams('grain-fx', { presets: [], locked: ['a'], unlocked: [], order: 0 })).toEqual([]);
  });

  it('answers the same question per parameter', () => {
    const config = { presets: [], locked: [], unlocked: [], order: 0 };
    expect(paramEditable('pattern-studio', 'scale', config)).toBe(false);
    expect(paramEditable('pattern-studio', 'rotation', config)).toBe(true);
  });
});

/* --------------------------------------------------------------- presets */

describe('applying a preset', () => {
  const config = {
    order: 0,
    locked: [], unlocked: [],
    presets: [{ id: 'heavy', label: 'Heavy', values: { scale: 200, spacing: 0.5, rotation: 0 } }],
  };

  it('fills in what the client did not choose', () => {
    expect(applyPreset('pattern-studio', { opacity: 0.8 }, 'heavy', config))
      .toEqual({ opacity: 0.8, scale: 200, spacing: 0.5, rotation: 0 });
  });

  it('puts back the locked value the client sent anyway', () => {
    // The whole point of locking: it is enforced where the value arrives, not
    // only by not drawing the input.
    expect(applyPreset('pattern-studio', { scale: 9000 }, 'heavy', config))
      .toEqual({ scale: 200, spacing: 0.5, rotation: 0 });
  });

  it('keeps a change to a parameter that is not locked', () => {
    expect(applyPreset('pattern-studio', { rotation: 45 }, 'heavy', config).rotation).toBe(45);
  });

  it('uses the first preset when the caller names none, and changes nothing when there are none', () => {
    expect(applyPreset('pattern-studio', { opacity: 1 }, undefined, config).scale).toBe(200);
    expect(applyPreset('pattern-studio', { opacity: 1 }, 'deleted', config).scale).toBe(200);
    expect(applyPreset('pattern-studio', { opacity: 1 }, undefined, undefined)).toEqual({ opacity: 1 });
  });

  it('never returns the object it was given', () => {
    const configuration = { opacity: 1 };
    expect(applyPreset('pattern-studio', configuration, undefined, undefined)).not.toBe(configuration);
  });

  it('falls back to the first preset when the default one has been deleted', () => {
    expect(presetsFor({ ...config, defaultPreset: 'gone' }).defaultPreset).toBe('heavy');
    expect(presetsFor({ ...config, defaultPreset: 'gone' }).presets).toHaveLength(1);
    expect(presetsFor({ ...config, defaultPreset: 'heavy' }).defaultPreset).toBe('heavy');
    expect(presetsFor(undefined)).toEqual({ presets: [], defaultPreset: undefined });
  });
});

/* ----------------------------------------------------------------- rules */

describe('what the brand allows', () => {
  const measured = [
    { kind: 'color', value: '#EB5E28' },
    { kind: 'color', value: '#1C1917' },
    { kind: 'font', value: 'Söhne' },
  ];

  it('uses the colours the designer named, in their order', () => {
    const rules = { colors: ['#000000'], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [] };
    expect(allowedColors(rules, measured).hexes).toEqual(['#000000']);
  });

  it('falls back to the whole measured palette, rather than to no colours at all', () => {
    // A hub with no rules must not render an empty swatch row, which would
    // read as a broken brand rather than an unrestricted one.
    const rules = { colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [] };
    expect(allowedColors(rules, measured).hexes).toEqual(['#eb5e28', '#1c1917']);
    expect(allowedFonts(rules, measured).families).toEqual(['Söhne']);
  });

  it('refuses a colour outside the brand, and accepts it only when told to', () => {
    const rules = { colors: ['#000000'], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [] };
    expect(colorAllowed('#000000', rules, measured)).toBe(true);
    expect(colorAllowed('#000001', rules, measured)).toBe(false);
    expect(colorAllowed('#000001', { ...rules, allowCustomColor: true }, measured)).toBe(true);
  });

  it('narrows the export formats by intersection, not by replacement', () => {
    // A rule naming a format the tool cannot produce must not invent it.
    const rules = { colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: ['svg', 'pdf'] };
    expect(allowedExports('pattern-studio', rules)).toEqual(['svg']);
    expect(allowedExports('social-post', rules)).toEqual([]);
    expect(allowedExports('unknown-tool', rules)).toEqual([]);
  });

  it('leaves the formats of a tool alone when no rule names any', () => {
    const rules = { colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [] };
    expect(allowedExports('pattern-studio', rules)).toEqual(['png', 'svg']);
  });
});

/* ------------------------------------------------------------- resolution */

describe('resolving modules for an audience', () => {
  const all = hub(['pattern', 'illustration', 'template'],
    ['pattern-studio', 'illustration-builder', 'social-post', 'poster']);

  it('gives the studio every module, including any that are not built', () => {
    const modules = resolveModules(all, 'studio');
    expect(modules).toHaveLength(BRAND_TOOLS.length);
    expect(modules.every((m) => m.enabled)).toBe(true);
  });

  it('gives a client only what is switched on', () => {
    const modules = resolveModules(hub(['pattern'], ['pattern-studio']), 'portal');
    expect(modules.map((m) => m.id)).toEqual(['pattern-studio']);
  });

  it('lets the DNA of a brand have the last word over the tool list', () => {
    // Enabled by the studio, but this brand has no pattern system, so there is
    // nothing for the tool to be a variation of. The switch is necessary and
    // not sufficient.
    const modules = resolveModules(hub(['template'], ['pattern-studio']), 'portal');
    expect(modules).toEqual([]);
  });

  it('lets an undescribed brand through on the tool list alone', () => {
    // Every hub that existed before the DNA did reads as a brand with no
    // systems, and reading that as "therefore nothing" would empty the Create
    // room of every existing client the day this shipped. The DNA starts
    // governing the moment somebody describes the brand.
    const undescribed = BrandHub.parse({
      clientId: 'c', status: 'active', tools: ['pattern-studio', 'poster'], createdAt: '', updatedAt: '',
    });
    expect(undescribed.dna.systems).toEqual([]);
    expect(resolveModules(undescribed, 'portal').map((m) => m.id))
      .toEqual(['pattern-studio', 'poster']);
  });

  it('refuses a tool list naming something the registry has never heard of', () => {
    // The gate is the schema, not the resolver: a hub cannot even record a
    // switch for a tool that does not exist, so there is no stored state that
    // could offer a client something the studio cannot see.
    expect(BrandHub.safeParse({
      clientId: 'c', tools: ['grain-fx'], createdAt: '', updatedAt: '',
    }).success).toBe(false);
    expect(moduleAllowed(hub(['grain'], []), 'grain-fx', 'studio')).toBe(false);
  });

  it('orders by what the designer set, falling back to the registry', () => {
    const modules = resolveModules(
      hub(['pattern', 'illustration', 'template'], ['pattern-studio', 'social-post', 'poster'], {
        'poster': { order: 0 }, 'pattern-studio': { order: 1 }, 'social-post': { order: 2 },
      }),
      'portal',
    );
    expect(modules.map((m) => m.id)).toEqual(['poster', 'pattern-studio', 'social-post']);
  });

  it('separates the two layers for a screen that shows them apart', () => {
    expect(resolveLayer(all, 'asset-lab').map((m) => m.id))
      .toEqual(['pattern-studio', 'illustration-builder']);
    expect(resolveLayer(all, 'composer').map((m) => m.id)).toEqual(['social-post', 'poster']);
  });

  it('resolves a hub that does not exist as a hub with nothing on', () => {
    expect(resolveModules(undefined, 'portal')).toEqual([]);
    expect(resolveModules(undefined, 'studio').every((m) => !m.enabled)).toBe(true);
  });

  it('answers the same question server-side that the screen answered', () => {
    // The gate that has to exist outside the UI, because a hidden button is not
    // authorization: a client who types a tool id into a request gets refused
    // exactly as one who cannot see the button is.
    const enabled = hub(['pattern'], ['pattern-studio']);
    expect(moduleAllowed(enabled, 'pattern-studio', 'portal')).toBe(true);
    expect(moduleAllowed(enabled, 'poster', 'portal')).toBe(false);
    expect(moduleAllowed(enabled, 'poster', 'studio')).toBe(true);
    expect(moduleAllowed(undefined, 'pattern-studio', 'portal')).toBe(false);
  });

  it('carries the locks and the narrowed formats through to the screen', () => {
    const modules = resolveModules(
      hub(['pattern'], ['pattern-studio'], {}, { exports: ['svg'] }),
      'portal',
    );
    expect(modules[0]?.exports).toEqual(['svg']);
    expect(modules[0]?.locked).toEqual(['scale', 'spacing', 'offsetX', 'offsetY']);
  });
});

/* -------------------------------------------------------- generated assets */

describe('a design kept in the shared library', () => {
  const design = {
    id: 'ba1', clientId: 'c', assetId: 'a1', toolId: 'pattern-studio', kind: 'pattern',
    format: 'png', createdBy: 'u1', createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('needs no optional field to be a design', () => {
    expect(BrandAsset.parse(design).format).toBe('png');
  });

  it('names the file, and the file it was made from', () => {
    expect(assetsInBrandAsset(BrandAsset.parse(design))).toEqual(['a1']);
    expect(assetsInBrandAsset(BrandAsset.parse({ ...design, sourceAssetId: 'a0' })))
      .toEqual(['a1', 'a0']);
  });

  it('refuses a tool that is not in the registry, and an id that is not an id', () => {
    expect(BrandAsset.safeParse({ ...design, toolId: 'grain-fx' }).success).toBe(false);
    expect(BrandAsset.safeParse({ ...design, clientId: '' }).success).toBe(false);
    expect(BrandAsset.safeParse({ ...design, width: 0 }).success).toBe(false);
  });
});
