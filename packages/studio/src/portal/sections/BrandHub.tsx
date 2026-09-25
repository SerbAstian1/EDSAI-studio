import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, Image as ImageIcon, Layers, LayoutTemplate, Palette, PenTool, Type, type LucideIcon } from 'lucide-react';
import { api, type Asset, type BrandProject, type BrandValue, type Client } from '../../api.js';
import { requestConfirmation } from '../../components/ConfirmDialog.js';
import ToolHost, { toolReady } from '../../components/ToolHost.js';
import OverflowMenu from '../../components/OverflowMenu.js';
import { downloadFile } from '../../components/actions.js';

/**
 * The client's Brand Hub: the brand as something to keep using.
 *
 * Four rooms. BRAND is the system itself — the measured colours and type
 * the studio settled. ASSETS is every approved file, by kind. CREATE is the
 * tools this hub offers. PROJECTS is what the client has made with them.
 * Nothing here is editable except a project; the master brand stays the
 * studio's.
 *
 * Only ever rendered when the hub is active — the section does not exist
 * in the rail otherwise, so a client who did not buy one never sees an
 * empty room with a "coming soon" sign on it.
 */

type Room = 'brand' | 'assets' | 'create' | 'projects';

const ASSET_GROUPS: { label: string; kinds: Asset['kind'][] }[] = [
  { label: 'Logos', kinds: ['logo'] },
  { label: 'Patterns & textures', kinds: ['pattern', 'texture'] },
  { label: 'Illustrations & icons', kinds: ['illustration', 'icon'] },
  { label: 'Photography', kinds: ['photography'] },
  { label: 'Type', kinds: ['font'] },
  { label: 'Guidelines & documents', kinds: ['guideline', 'document', 'presentation'] },
  { label: 'Templates', kinds: ['template'] },
  { label: 'Other', kinds: ['video', 'other'] },
];

const isImage = (a: Asset): boolean => /^image\/(png|webp|jpeg|gif|avif)$/.test(a.contentType);

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

function Assets({ assets }: { assets: Asset[] }): ReactElement {
  const groups = ASSET_GROUPS
    .map((g) => ({ ...g, items: assets.filter((a) => g.kinds.includes(a.kind)) }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) {
    return (
      <div className="empty">
        <p className="editorial">No files approved yet.</p>
        <p>Logos, patterns and the rest land here as the studio approves them.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      {groups.map((g) => (
        <section key={g.label}>
          <h3>{g.label} <span className="muted mono" style={{ fontWeight: 400 }}>{g.items.length}</span></h3>
          <div className="hub-assets">
            {g.items.map((a) => (
              <button key={a.id} type="button" className="hub-asset"
                      onClick={() => downloadFile(api.downloadPath(a.id), a.filename)} title={`Download ${a.filename}`}>
                <span className="hub-asset-thumb">
                  {isImage(a)
                    ? <img src={api.downloadPath(a.id)} alt="" loading="lazy" />
                    : <ImageIcon size={22} strokeWidth={1.5} aria-hidden="true" />}
                </span>
                <span className="hub-asset-name">{a.filename}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function BrandHubSection({ client, canWrite }: { client: Client; canWrite: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const [room, setRoom] = useState<Room>('brand');
  const [editing, setEditing] = useState<{ toolId: string; project?: BrandProject } | undefined>(undefined);

  const hub = useQuery({ queryKey: ['brand-hub', client.id], queryFn: () => api.brandHub(client.id) });
  const values = useQuery({ queryKey: ['brand', client.id], queryFn: () => api.brand(client.id) });
  const assets = useQuery({ queryKey: ['assets', client.id], queryFn: () => api.assets(client.id) });
  const projects = useQuery({ queryKey: ['brand-projects', client.id], queryFn: () => api.brandProjects(client.id) });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBrandProject(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['brand-projects', client.id] }); },
  });

  const tools = hub.data?.tools ?? [];
  const approved = (assets.data ?? []).filter((a) => a.approved);
  const TOOL_ICONS: Record<string, LucideIcon> = {
    'pattern-studio': Grid3x3, 'illustration-builder': PenTool, 'social-post': LayoutTemplate, poster: LayoutTemplate,
  };
  const logo = approved.find((a) => a.kind === 'logo' && isImage(a));

  const rooms: { id: Room; label: string }[] = [
    { id: 'brand', label: 'Brand' },
    { id: 'assets', label: 'Assets' },
    ...(tools.length > 0 ? [{ id: 'create' as Room, label: 'Create' }, { id: 'projects' as Room, label: 'Projects' }] : []),
  ];

  if (editing) {
    return (
      <section className="stack">
        <div>
          <p className="label mono">{tools.find((t) => t.id === editing.toolId)?.name ?? editing.toolId}</p>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>{editing.project?.name ?? 'New design'}</h1>
        </div>
        <ToolHost
          toolId={editing.toolId}
          clientId={client.id}
          assets={approved}
          values={values.data ?? []}
          project={editing.project}
          onSaved={(saved) => setEditing({ toolId: editing.toolId, project: saved })}
          onClose={() => { setEditing(undefined); setRoom('projects'); }}
        />
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="hub-hero">
        {logo && <img className="hub-logo" src={api.downloadPath(logo.id)} alt="" />}
        <div>
          <p className="label mono">Your brand</p>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>{client.name}</h1>
          <p className="muted" style={{ maxWidth: '56ch' }}>
            A digital space for everything to do with your brand — the system, the files, and the tools to keep using them.
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="Brand Hub">
        {rooms.map((r) => (
          <button key={r.id} type="button" className="tab" aria-current={room === r.id ? 'page' : undefined}
                  onClick={() => setRoom(r.id)}>{r.label}</button>
        ))}
      </nav>

      {room === 'brand' && (values.isPending ? <p className="muted">Loading…</p> : <Brand values={values.data ?? []} client={client} />)}
      {room === 'assets' && (assets.isPending ? <p className="muted">Loading…</p> : <Assets assets={approved} />)}

      {room === 'create' && (
        <div className="stack">
          <p className="muted">What would you like to make?</p>
          <div className="shelf-tiles">
            {tools.map((t) => {
              const ready = toolReady(t.id, approved);
              const Icon = TOOL_ICONS[t.id] ?? Grid3x3;
              return (
                <button key={t.id} type="button" className={`shelf-tile${ready ? ' linked' : ' empty'}`}
                        disabled={!ready || !canWrite}
                        onClick={() => setEditing({ toolId: t.id })}>
                  <Icon className="shelf-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                  <span className="shelf-label">{t.name}</span>
                  <span className="shelf-meta">
                    {!canWrite ? 'View only on this link' : ready ? t.description : 'Waiting for approved files to work from'}
                  </span>
                </button>
              );
            })}
          </div>
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
                <thead><tr><th>Design</th><th>Tool</th><th>Last edited</th><th /></tr></thead>
                <tbody>
                  {(projects.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td data-label="Design"><button type="button" className="link" onClick={() => setEditing({ toolId: p.toolId, project: p })}><strong>{p.name}</strong></button></td>
                      <td className="muted" data-label="Tool">{tools.find((t) => t.id === p.toolId)?.name ?? p.toolId}</td>
                      <td className="muted" data-label="Last edited">{new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                      <td className="actions">
                        <OverflowMenu label={`Actions for ${p.name}`} items={[
                          { label: 'Open', onSelect: () => setEditing({ toolId: p.toolId, project: p }) },
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
    </section>
  );
}
