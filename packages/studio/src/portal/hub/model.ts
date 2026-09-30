import type { Asset, BrandValue } from '../../api.js';

/** Only files already released to this client belong in the workspace. */
export function filterHubAssets(assets: readonly Asset[], query = '', kind = 'all'): Asset[] {
  const needle = query.trim().toLocaleLowerCase();
  return assets.filter((asset) => asset.approved
    && (kind === 'all' || asset.kind === kind)
    && (!needle || [asset.filename, asset.collection, asset.description].some((text) => text?.toLocaleLowerCase().includes(needle))));
}

export const previewable = (asset: Asset): boolean => /^image\/(png|jpeg|webp|gif|avif)$/.test(asset.contentType);
export function readableBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function measurementState(value: BrandValue): 'pass' | 'fail' | 'unmeasured' {
  if (value.measured?.passes === false) return 'fail';
  if (value.measured?.passes === true) return 'pass';
  return 'unmeasured';
}

/** Permission changes must close an already-open editor, not just disable its tile. */
export function canOpenHubTool(enabled: boolean, canWrite: boolean, modules: readonly { id: string; enabled: boolean }[], toolId: string): boolean {
  return enabled && canWrite && modules.some((module) => module.id === toolId && module.enabled);
}
