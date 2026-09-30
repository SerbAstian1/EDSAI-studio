import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Asset, BrandValue, Client } from '../src/api.js';
import { canOpenHubTool, filterHubAssets, measurementState, previewable } from '../src/portal/hub/model.js';
import { MeasurementStatus } from '../src/portal/hub/MeasurementStatus.js';
import { HubOverview } from '../src/portal/hub/Overview.js';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1', clientId: 'client-a', digest: 'private-digest', filename: 'Logo.svg', kind: 'logo',
  contentType: 'image/svg+xml', bytes: 2000, approved: true, uploadedAt: '2026-09-01', ...over,
});
const value = (over: Partial<BrandValue> = {}): BrandValue => ({
  clientId: 'client-a', name: 'Primary', kind: 'color', value: '#EB5E28', origin: 'studio',
  sourceRunId: 'private-run', reason: 'private-critique', updatedAt: '2026-09-01', ...over,
});

describe('the integrated Brand Hub', () => {
  it('filters by approval, category and a case-insensitive query without modifying assets', () => {
    const rows = [asset(), asset({ id: 'a2', approved: false }), asset({ id: 'a3', kind: 'document', filename: 'Guide.pdf', collection: 'Essentials' })];
    expect(filterHubAssets(rows).map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(filterHubAssets(rows, ' ESSENTIALS ', 'document').map((a) => a.id)).toEqual(['a3']);
    expect(filterHubAssets(rows, 'Logo', 'document')).toEqual([]);
    expect(rows).toHaveLength(3);
  });
  it('does not treat active SVG or HTML as inline image previews', () => {
    expect(previewable(asset())).toBe(false);
    expect(previewable(asset({ contentType: 'text/html' }))).toBe(false);
    expect(previewable(asset({ contentType: 'image/png' }))).toBe(true);
  });
  it('keeps failures explicit and never infers a pass from a ratio or missing result', () => {
    expect(measurementState(value({ measured: { ratio: 7 } }))).toBe('unmeasured');
    expect(measurementState(value({ measured: { ratio: 3.4, passes: false } }))).toBe('fail');
    expect(measurementState(value({ measured: { ratio: 7, passes: true } }))).toBe('pass');
  });
  it('renders server measurement details without internal provenance', () => {
    const html = renderToStaticMarkup(createElement(MeasurementStatus, { value: value({ measured: { ratio: 3.41, required: 4.5, passes: false, note: 'Against White' } }) }));
    expect(html).toContain('Measured · Fail');
    expect(html).toContain('3.41');
    expect(html).toContain('Against White');
    expect(html).not.toContain('private-run');
    expect(html).not.toContain('private-critique');
  });
  it('closes the tool entry path when the hub, role or module permission changes', () => {
    const modules = [{ id: 'poster', enabled: true }];
    expect(canOpenHubTool(true, true, modules, 'poster')).toBe(true);
    expect(canOpenHubTool(true, false, modules, 'poster')).toBe(false);
    expect(canOpenHubTool(false, true, modules, 'poster')).toBe(false);
    expect(canOpenHubTool(true, true, [{ id: 'poster', enabled: false }], 'poster')).toBe(false);
    expect(canOpenHubTool(true, true, modules, 'unknown')).toBe(false);
  });
  it('uses client data on the overview and presents honest empty states', () => {
    const client: Client = { id: 'client-a', name: 'Actual Client', slug: 'actual-client', status: 'active', createdAt: '2026-09-01', updatedAt: '2026-09-01' };
    const html = renderToStaticMarkup(createElement(HubOverview, { client, values: [], assets: [], modules: [], projects: [], canWrite: false, onRoom: () => {}, onTool: () => {}, onAsset: () => {} }));
    expect(html).toContain('Actual Client');
    expect(html).toContain('Measurements not yet available');
    expect(html).toContain('No approved assets yet');
    expect(html).not.toContain('AW. Design');
    expect(html).not.toContain('Sample workspace');
  });
});
