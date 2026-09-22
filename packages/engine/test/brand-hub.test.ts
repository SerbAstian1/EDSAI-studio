import { describe, expect, it } from 'vitest';
import { BRAND_TOOLS, assetsInConfiguration, hubEnabled } from '../src/brand-hub.js';

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
