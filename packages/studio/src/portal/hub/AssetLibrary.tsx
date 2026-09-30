import { useEffect, useId, useRef, useState } from 'react';
import { Download, File, Grid2X2, List, Search, X } from 'lucide-react';
import { api, type Asset } from '../../api.js';
import { downloadFile } from '../../components/actions.js';
import { filterHubAssets, previewable, readableBytes } from './model.js';

export function AssetCard({ asset, onSelect }: { asset: Asset; onSelect: (asset: Asset) => void }) {
  return <button type="button" className="bh-asset" onClick={() => onSelect(asset)}>
    <span className="bh-asset-art">{previewable(asset) ? <img src={api.downloadPath(asset.id)} alt="" loading="lazy" /> : <File size={42} strokeWidth={1} aria-hidden="true" />}
      <span className="bh-file-kind">{asset.kind}</span>
    </span>
    <span className="bh-asset-caption"><span><strong>{asset.filename}</strong><span className="bh-meta">{asset.collection ?? 'Brand library'} · {readableBytes(asset.bytes)}</span></span><Download size={16} aria-hidden="true" /></span>
  </button>;
}

export function AssetPreview({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);
  return <dialog className="bh-preview" ref={dialog} aria-labelledby={title} onCancel={onClose}>
    <div className="bh-section-title"><h2 id={title}>{asset.filename}</h2><button type="button" autoFocus aria-label="Close asset preview" onClick={onClose}><X size={18} /></button></div>
    <div className="bh-preview-art">{previewable(asset) ? <img src={api.downloadPath(asset.id)} alt={asset.description ?? asset.filename} /> : <><File size={48} /><p>Download this file to view it in its original format.</p></>}</div>
    {asset.description && <p>{asset.description}</p>}
    <dl className="facts"><div className="facts-row"><dt>Format</dt><dd>{asset.contentType}</dd></div><div className="facts-row"><dt>Size</dt><dd>{readableBytes(asset.bytes)}</dd></div><div className="facts-row"><dt>Added</dt><dd>{new Date(asset.uploadedAt).toLocaleDateString()}</dd></div></dl>
    <button type="button" className="primary" onClick={() => downloadFile(api.downloadPath(asset.id), asset.filename)}><Download size={16} />Download asset</button>
  </dialog>;
}

export function AssetLibrary({ assets, onSelect }: { assets: readonly Asset[]; onSelect: (asset: Asset) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [list, setList] = useState(false);
  const kinds = [...new Set(assets.filter((a) => a.approved).map((a) => a.kind))].sort();
  const matches = filterHubAssets(assets, query, kind);
  return <section className="stack">
    <div className="bh-library-toolbar">
      <label className="bh-search"><Search size={16} aria-hidden="true" /><input aria-label="Search brand assets" type="search" placeholder="Search your brand assets…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select aria-label="Asset category" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All assets</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select>
      <div className="bh-view-switch"><button type="button" aria-label="Grid view" aria-pressed={!list} onClick={() => setList(false)}><Grid2X2 size={18} /></button><button type="button" aria-label="List view" aria-pressed={list} onClick={() => setList(true)}><List size={18} /></button></div>
    </div>
    <p className="bh-meta" role="status">{matches.length} {matches.length === 1 ? 'asset' : 'assets'} · Approved for your brand</p>
    {matches.length ? <div className={`bh-assets${list ? ' is-list' : ''}`}>{matches.map((asset) => <AssetCard key={asset.id} asset={asset} onSelect={onSelect} />)}</div> : <div className="empty"><p className="editorial">{assets.length ? 'No matching assets.' : 'Your collection is on its way.'}</p><p>{assets.length ? 'Try a different name or category.' : 'Files appear here when the studio releases them to you.'}</p>{(query || kind !== 'all') && <button type="button" onClick={() => { setQuery(''); setKind('all'); }}>Clear filters</button>}</div>}
  </section>;
}
