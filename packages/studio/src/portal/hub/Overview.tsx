import { BookOpen, Layers, Palette, Shapes, ShieldCheck, Sparkles } from 'lucide-react';
import type { Asset, BrandModule, BrandProject, BrandValue, Client } from '../../api.js';
import { api } from '../../api.js';
import { moduleIcon, moduleReady, moduleWaiting } from '../../components/brandModules.js';
import { AssetCard } from './AssetLibrary.js';
import { measurementState, previewable } from './model.js';

export function HubOverview({ client, values, assets, modules, projects, canWrite, onRoom, onTool, onAsset }: {
  client: Client; values: readonly BrandValue[]; assets: readonly Asset[]; modules: readonly BrandModule[];
  projects: readonly BrandProject[]; canWrite: boolean;
  onRoom: (room: 'brand' | 'assets' | 'create' | 'projects') => void;
  onTool: (id: string) => void; onAsset: (asset: Asset) => void;
}) {
  const colours = values.filter((v) => v.kind === 'color');
  const fonts = values.filter((v) => v.kind === 'font');
  const failed = colours.filter((v) => measurementState(v) === 'fail').length;
  const measured = colours.filter((v) => measurementState(v) !== 'unmeasured').length;
  const logo = assets.find((a) => a.kind === 'logo' && previewable(a));
  const recent = [...assets].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 3);
  return <div className="stack bh-overview">
    <div className="bh-overview-grid">
      <section className="bh-brand-card"><div className="bh-kicker">YOUR BRAND AT A GLANCE <span>BRAND SYSTEM</span></div>
        <div className="bh-brand-mark">{logo ? <img src={api.downloadPath(logo.id)} alt={client.name} /> : <h2>{client.name}</h2>}</div>
        <div className="bh-brand-footer"><span>One identity.<br />Everything you need to use it.</span><span>BRAND HUB</span></div>
      </section>
      <section className="bh-foundations"><div className="bh-section-title"><h2>Brand foundations</h2><Layers size={18} /></div>
        <span className="bh-badge">Your current brand system</span><p className="bh-foundation-heading">A focused system.<br />Room to make it yours.</p>
        {colours.length ? <div className="bh-palette">{colours.slice(0, 6).map((v) => <button key={v.name} type="button" style={{ background: v.value }} aria-label={`${v.name}: ${v.value}. View guidelines`} title={`${v.name} · ${v.value}`} onClick={() => onRoom('brand')} />)}</div> : <p className="bh-meta">Your palette will appear when it is ready.</p>}
        <div className="bh-type-summary"><span>Typography</span><strong>{fonts.length ? fonts.slice(0, 2).map((v) => v.value).join(' + ') : 'Not shared yet'}</strong></div>
        <button type="button" className="link" onClick={() => onRoom('brand')}>Explore brand guidelines <BookOpen size={15} /></button>
      </section>
    </div>
    <div className="bh-stats">
      <div><Shapes size={20} /><span><strong>{assets.length}</strong> Brand assets<small>Approved for your workspace</small></span></div>
      <div><Palette size={20} /><span><strong>{colours.length}</strong> Brand colours<small>{measured} with pass/fail measurements</small></span></div>
      <div><Sparkles size={20} /><span><strong>{modules.length}</strong> Creative tools<small>{projects.length} saved projects</small></span></div>
      <button type="button" onClick={() => onRoom('brand')}><ShieldCheck size={20} /><span>{failed ? `${failed} colour checks need attention` : measured ? 'Review colour measurements' : 'Measurements not yet available'}<small>View pairing details</small></span></button>
    </div>
    <div className="bh-section-title"><h2>Brand essentials <span className="bh-meta">{assets.length}</span></h2><button type="button" className="link" onClick={() => onRoom('assets')}>View all assets</button></div>
    {recent.length ? <div className="bh-assets">{recent.map((asset) => <AssetCard key={asset.id} asset={asset} onSelect={onAsset} />)}</div> : <div className="empty"><p>No approved assets yet. Your files will appear here when they are ready.</p></div>}
    <div className="bh-section-title"><h2>Your creative toolkit</h2><span className="bh-meta">Built around your brand.</span></div>
    {modules.length ? <div className="bh-tool-list">{modules.map((module) => { const Icon = moduleIcon(module.id); const ready = moduleReady(module.id, assets); return <button key={module.id} type="button" className="bh-tool" disabled={!canWrite || !ready} onClick={() => onTool(module.id)}><span className="bh-tool-icon"><Icon size={24} /></span><span><strong>{module.name}</strong><span className="bh-meta">{!canWrite ? 'View-only access on this link' : ready ? module.description : moduleWaiting(module.id, assets)}</span></span><span className="bh-tool-open">Open tool</span></button>; })}</div> : <div className="empty"><p>Your studio has not enabled any creative tools for this workspace.</p></div>}
  </div>;
}
