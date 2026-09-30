import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Palette, Sparkles, Type, LayoutDashboard, Shapes, FolderOpen, BookOpen } from 'lucide-react';
import {
  api,
  type Asset,
  type BrandLayer,
  type BrandProject,
  type BrandValue,
  type Client,
} from '../../api.js';
import { requestConfirmation } from '../../components/ConfirmDialog.js';
import ToolHost from '../../components/ToolHost.js';
import OverflowMenu from '../../components/OverflowMenu.js';
import { AssetLibrary, AssetPreview } from '../hub/AssetLibrary.js';
import { HubOverview } from '../hub/Overview.js';
import { MeasurementStatus } from '../hub/MeasurementStatus.js';
import { canOpenHubTool } from '../hub/model.js';
import '../hub/workspace.css';
import { brandRulesOf, moduleIcon, moduleReady, moduleWaiting } from '../../components/brandModules.js';

/**
 * The client's Brand Hub: the brand as something to keep using.
 *
 * Five rooms. BRAND is the system itself — the measured colours and type the
 * studio settled. ASSETS is every approved file, by kind. CREATE is split into
 * the two halves the studio described, ASSET LAB for making new brand assets
 * and COMPOSER for assembling them. PROJECTS is what the client has made with
 * either. Nothing here is editable except a project; the master brand stays the
 * studio's.
 *
 * **The two halves exist because they answer different questions.** Asset Lab is
 * "give me more of what the brand already has"; Composer is "put what the brand
 * has into something". A client who only needs the second never sees the first,
 * which is the point of the studio choosing per client rather than shipping
 * everyone the same shelf.
 *
 * Only ever rendered when the hub is active — the section does not exist in the
 * rail otherwise, so a client who did not buy one never sees an empty room with
 * a "coming soon" sign on it.
 */

type Room = 'overview' | 'brand' | 'assets' | 'create' | 'projects';

/** The two halves, in the order the studio's module order puts them. */
const LAYERS: { id: BrandLayer; label: string; detail: string }[] = [
  { id: 'asset-lab', label: 'Asset Lab', detail: 'Make more of what the brand already has.' },
  { id: 'composer', label: 'Composer', detail: 'Put the brand into something new.' },
];

function Brand({ values, client }: { values: BrandValue[]; client: Client }): ReactElement {
  const colours = values.filter((v) => v.kind === 'color');
  const type = values.filter((v) => v.kind === 'font');
  const rest = values.filter((v) => v.kind !== 'color' && v.kind !== 'font');
  if (values.length === 0) {
    return (
      <div className="empty">
        <p className="editorial">The system is still being settled.</p>
        <p>Colours and type appear here as the studio finalises them.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      {colours.length > 0 && (
        <section>
          <h3><Palette size={16} aria-hidden="true" /> Colours</h3>
          <div className="hub-swatches">
            {colours.map((c) => (
              <div key={c.name} className="hub-swatch">
                <i style={{ background: c.value }} aria-hidden="true" />
                <strong>{c.name}</strong>
                <span className="mono muted">{c.value}</span>
                {c.role && <span className="muted">{c.role}</span>}
                <MeasurementStatus value={c} />
              </div>
            ))}
          </div>
        </section>
      )}
      {type.length > 0 && (
        <section>
          <h3><Type size={16} aria-hidden="true" /> Typography</h3>
          <div className="hub-type">
            {type.map((t) => (
              <div key={t.name} className="hub-type-sample">
                <span className="hub-type-specimen" style={{ fontFamily: t.value }}>{client.name}</span>
                <strong>{t.name}</strong>
                <span className="muted">{t.value}{t.role ? ` · ${t.role}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section>
          <h3><Layers size={16} aria-hidden="true" /> System</h3>
          <dl className="facts">
            {rest.map((v) => <div key={v.name} className="facts-row"><dt>{v.name}</dt><dd className="mono">{v.value}</dd></div>)}
          </dl>
        </section>
      )}
    </div>
  );
}

export default function BrandHubSection({ client, canWrite }: { client: Client; canWrite: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>();
  const [room, setRoom] = useState<Room>('overview');
  const [editing, setEditing] = useState<{ toolId: string; project?: BrandProject } | undefined>(undefined);

  const hub = useQuery({ queryKey: ['brand-hub', client.id], queryFn: () => api.brandHub(client.id) });
  const values = useQuery({ queryKey: ['brand', client.id], queryFn: () => api.brand(client.id), enabled: hub.data?.enabled === true });
  const assets = useQuery({ queryKey: ['assets', client.id], queryFn: () => api.assets(client.id), enabled: hub.data?.enabled === true });
  const projects = useQuery({ queryKey: ['brand-projects', client.id], queryFn: () => api.brandProjects(client.id), enabled: hub.data?.enabled === true });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBrandProject(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['brand-projects', client.id] }); },
  });

  const modules = (hub.data?.modules ?? []).filter((module) => module.enabled);
  const rules = brandRulesOf(hub.data?.hub?.config.rules);
  const nameOf = (toolId: string): string => modules.find((m) => m.id === toolId)?.name ?? 'Unavailable tool';
  const approved = (assets.data ?? []).filter((a) => a.approved);
  const openTool = (toolId: string, project?: BrandProject): void => {
    if (canOpenHubTool(hub.data?.enabled === true, canWrite, modules, toolId)) {
      setEditing({ toolId, ...(project ? { project } : {}) });
    }
  };

  const rooms: { id: Room; label: string; icon: typeof Palette }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'brand', label: 'Brand guidelines', icon: BookOpen },
    { id: 'assets', label: 'Asset library', icon: Shapes },
    ...(modules.length > 0 ? [{ id: 'create' as Room, label: 'Create', icon: Sparkles }, { id: 'projects' as Room, label: 'Projects', icon: FolderOpen }] : []),
  ];

  if (hub.isPending) return <p className="muted" role="status">Opening your Brand Hub…</p>;
  if (hub.isError) return <div className="empty" role="alert"><p>Your Brand Hub could not be loaded.</p><button type="button" onClick={() => void hub.refetch()}>Try again</button></div>;
  if (!hub.data.enabled) return <div className="empty"><h1>Brand Hub unavailable</h1><p>This workspace is not currently active. Please contact your studio.</p></div>;
  const failedQuery = [values, assets, projects].find((query) => query.isError);
  if (failedQuery) return <div className="empty" role="alert"><p>Part of your workspace could not be loaded. Your saved work has not changed.</p><button type="button" onClick={() => void failedQuery.refetch()}>Try again</button></div>;
  if (values.isPending || assets.isPending || projects.isPending) return <p className="muted" role="status">Loading your brand, assets, and projects…</p>;

  if (editing && !canOpenHubTool(true, canWrite, modules, editing.toolId)) {
    return <div className="empty"><p>This tool is no longer available with your current access.</p><button type="button" onClick={() => setEditing(undefined)}>Back to Brand Hub</button></div>;
  }
  if (editing) {
    const module = modules.find((m) => m.id === editing.toolId);
    return (
      <section className="stack bh-workspace">
        <div>
          <p className="label mono">{module?.name ?? editing.toolId}</p>
          <h1 className="display portal-page-title">{editing.project?.name ?? 'New design'}</h1>
        </div>
        {module && (
          <ToolHost
            toolId={editing.toolId}
            module={module}
            rules={rules}
            clientId={client.id}
            assets={approved}
            values={values.data ?? []}
            project={editing.project}
            onSaved={(saved) => setEditing({ toolId: editing.toolId, project: saved })}
            onClose={() => { setEditing(undefined); setRoom('projects'); }}
          />
        )}
      </section>
    );
  }

  return (
    <section className="stack bh-workspace">
      <header className="bh-heading">
        <div><p className="bh-kicker">{client.name} / BRAND HUB</p><h1>{room === 'overview' ? 'Your brand. All here.' : rooms.find((r) => r.id === room)?.label}</h1><p className="muted">{room === 'overview' ? 'Everything you need to create with confidence.' : 'Your brand system, assets, and approved tools.'}</p></div>
        {canWrite && modules.length > 0 && <button type="button" className="primary" onClick={() => setRoom('create')}><Sparkles size={16} />Create with your brand</button>}
      </header>
      <nav className="tabs bh-tabs" aria-label="Brand Hub">
        {rooms.map((r) => <button key={r.id} type="button" className="tab" aria-current={room === r.id ? 'page' : undefined} onClick={() => setRoom(r.id)}><r.icon size={16} aria-hidden="true" />{r.label}</button>)}
      </nav>
      {room === 'overview' && <HubOverview client={client} values={values.data ?? []} assets={approved} modules={modules} projects={projects.data ?? []} canWrite={canWrite} onRoom={setRoom} onTool={openTool} onAsset={setSelectedAsset} />}

      {room === 'brand' && (values.isPending ? <p className="muted">Loading…</p> : <Brand values={values.data ?? []} client={client} />)}
      {room === 'assets' && (assets.isPending ? <p className="muted">Loading…</p> : <AssetLibrary assets={approved} onSelect={setSelectedAsset} />)}

      {room === 'create' && (
        <div className="stack">
          {LAYERS.map((layer) => {
            // A half the studio gave this client no modules of is not shown at
            // all. An empty room with a heading over nothing reads as a fault.
            const inLayer = modules.filter((m) => m.layer === layer.id);
            if (inLayer.length === 0) return null;
            return (
              <section key={layer.id} className="stack">
                <div>
                  <h3><Sparkles size={16} aria-hidden="true" /> {layer.label}</h3>
                  <p className="muted" style={{ margin: '2px 0 0', maxWidth: '60ch' }}>{layer.detail}</p>
                </div>
                <div className="shelf-tiles">
                  {inLayer.map((m) => {
                    const ready = moduleReady(m.id, approved);
                    const waiting = moduleWaiting(m.id, approved);
                    const Icon = moduleIcon(m.id);
                    return (
                      <button key={m.id} type="button" className={`shelf-tile${ready ? ' linked' : ' empty'}`}
                              disabled={!ready || !canWrite}
                              onClick={() => openTool(m.id)}>
                        <Icon className="shelf-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                        <span className="shelf-label">{m.name}</span>
                        <span className="shelf-meta">
                          {!canWrite ? 'View only on this link' : ready ? m.description : waiting}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {room === 'projects' && (
        projects.isPending ? <p className="muted">Loading…</p>
          : (projects.data ?? []).length === 0
            ? (
              <div className="empty">
                <p className="editorial">Nothing made yet.</p>
                <p>Designs you save in Create live here, ready to reopen.</p>
                {canWrite && <button type="button" className="primary" onClick={() => setRoom('create')}>Make something</button>}
              </div>
            )
            : (
              <table className="stacky">
                <thead><tr><th>Design</th><th>Module</th><th>Last edited</th><th /></tr></thead>
                <tbody>
                  {(projects.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td data-label="Design"><button type="button" className="link" disabled={!canOpenHubTool(true, canWrite, modules, p.toolId)} onClick={() => openTool(p.toolId, p)}><strong>{p.name}</strong></button></td>
                      <td className="muted" data-label="Module">{nameOf(p.toolId)}</td>
                      <td className="muted" data-label="Last edited">{new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                      <td className="actions">
                        <OverflowMenu label={`Actions for ${p.name}`} items={[
                          { label: 'Open', disabled: !canOpenHubTool(true, canWrite, modules, p.toolId), onSelect: () => openTool(p.toolId, p) },
                          { label: 'Delete', danger: true, disabled: !canWrite || remove.isPending,
                            onSelect: () => {
                              void requestConfirmation({
                                title: `Delete ${p.name}?`,
                                message: 'This removes the saved design from the Brand Hub. It cannot be undone.',
                                confirmLabel: 'Delete design',
                              }).then((confirmed) => { if (confirmed) remove.mutate(p.id); });
                            } },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
      )}
      {remove.isError && <p role="alert">The design could not be deleted. Please try again.</p>}
      {selectedAsset && approved.some((a) => a.id === selectedAsset.id) && <AssetPreview asset={selectedAsset} onClose={() => setSelectedAsset(undefined)} />}
      <footer className="bh-footer"><span>YOUR BRAND, WITH INTENTION.</span><span>{client.name} / EDSAI</span></footer>
    </section>
  );
}
