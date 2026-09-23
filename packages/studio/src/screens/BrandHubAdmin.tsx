import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Grid3x3, Power } from 'lucide-react';
import { api, type BrandHubStatus, type BrandProject } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import ToolHost from '../components/ToolHost.js';

/**
 * The studio's side of a client's Brand Hub.
 *
 * Three decisions live here and nowhere else: whether the client has a hub
 * at all, which tools it offers, and whether it is currently on. Everything
 * the hub *shows* — colours, type, files — is managed where it already was
 * (the Brand tab, the Files panel), because a second place to approve a
 * file is a second place for it to be wrong.
 *
 * A hub starts as a draft: it exists, the studio can fill it and try the
 * tools as the client would, and the client sees nothing until it is
 * switched to active.
 */

const STATUS: { id: BrandHubStatus; label: string; detail: string }[] = [
  { id: 'draft', label: 'Draft', detail: 'Set up here; the client does not see it yet.' },
  { id: 'active', label: 'Active', detail: 'The client has a Brand Hub in their portal.' },
  { id: 'suspended', label: 'Suspended', detail: 'Hidden from the client for now; nothing is lost.' },
  { id: 'archived', label: 'Archived', detail: 'Closed. Kept for the record.' },
];

export default function BrandHubAdmin({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const hub = useQuery({ queryKey: ['brand-hub', clientId], queryFn: () => api.brandHub(clientId) });
  const values = useQuery({ queryKey: ['brand', clientId], queryFn: () => api.brand(clientId) });
  const assets = useQuery({ queryKey: ['assets', clientId], queryFn: () => api.assets(clientId) });
  const projects = useQuery({ queryKey: ['brand-projects', clientId], queryFn: () => api.brandProjects(clientId) });
  const [trying, setTrying] = useState<{ toolId: string; project?: BrandProject } | undefined>(undefined);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brand-hub', clientId] });
    void queryClient.invalidateQueries({ queryKey: ['brand-projects', clientId] });
  };
  const set = useMutation({
    mutationFn: (input: { status?: BrandHubStatus; tools?: string[] }) => api.setBrandHub(clientId, input),
    onSuccess: refresh,
  });

  if (hub.isPending) return <p className="muted">Loading Brand Hub…</p>;
  if (hub.error || values.error || assets.error || projects.error) {
    return (
      <ErrorPanel
        title="Could not load the Brand Hub"
        error={hub.error ?? values.error ?? assets.error ?? projects.error}
        onRetry={() => {
          void hub.refetch();
          void values.refetch();
          void assets.refetch();
          void projects.refetch();
        }}
      />
    );
  }

  const record = hub.data.hub;
  const enabledTools = record?.tools ?? [];
  const toggleTool = (id: string): void => {
    const next = enabledTools.includes(id) ? enabledTools.filter((t) => t !== id) : [...enabledTools, id];
    set.mutate({ tools: next });
  };

  if (trying) {
    return (
      <section className="stack">
        <div className="row">
          <h3 style={{ margin: 0 }}>{hub.data.tools.find((t) => t.id === trying.toolId)?.name ?? trying.toolId} — as the client sees it</h3>
          <span className="muted">Designs saved here appear in their Projects too.</span>
        </div>
        <ToolHost
          toolId={trying.toolId}
          clientId={clientId}
          assets={(assets.data ?? []).filter((a) => a.approved)}
          values={values.data ?? []}
          project={trying.project}
          onSaved={(saved) => setTrying({ toolId: trying.toolId, project: saved })}
          onClose={() => setTrying(undefined)}
        />
      </section>
    );
  }

  if (!record) {
    return (
      <section className="stack">
        <div className="row">
          <h3 style={{ margin: 0 }}>Brand Hub</h3>
          <span className="pill minor">not set up</span>
        </div>
        <div className="empty">
          <p className="editorial">This client has no Brand Hub.</p>
          <p>
            A Brand Hub is the optional place a client keeps using the brand after handover —
            the approved files, the system, and tools like Pattern Studio. Most clients do not
            have one; set it up only for a client who bought it.
          </p>
          <button type="button" className="primary" disabled={set.isPending}
                  onClick={() => set.mutate({ status: 'draft', tools: ['pattern-studio'] })}>
            <Power size={14} aria-hidden="true" /> Set up a Brand Hub
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Brand Hub</h3>
        <span className={`pill ${record.status === 'active' ? 'pass' : 'minor'}`}>{record.status}</span>
        <span className="muted mono" style={{ marginLeft: 'auto' }}>
          {hub.data.approvedAssets ?? 0} approved files · {hub.data.brandValues ?? 0} brand values
        </span>
      </div>

      <div className="card stack">
        <span className="label">Status</span>
        {STATUS.map((s) => (
          <label key={s.id} className="choice">
            <input type="radio" name="hub-status" value={s.id} checked={record.status === s.id}
                   disabled={set.isPending} onChange={() => set.mutate({ status: s.id })} />
            <span><strong>{s.label}</strong><span className="why">{s.detail}</span></span>
          </label>
        ))}
      </div>

      <div className="card stack">
        <span className="label">Tools this client gets</span>
        {hub.data.tools.map((t) => (
          <label key={t.id} className="choice" style={{ opacity: t.available ? 1 : 0.6 }}>
            <input type="checkbox" checked={t.enabled} disabled={!t.available || set.isPending}
                   onChange={() => toggleTool(t.id)} />
            <span>
              <strong>{t.name}</strong>{!t.available && <span className="pill minor" style={{ marginLeft: 8 }}>not built yet</span>}
              <span className="why">{t.description}</span>
            </span>
          </label>
        ))}
        <span className="muted" style={{ fontSize: 13 }}>
          A tool makes variations of what you designed — it never draws. Pattern Studio works from
          approved pattern, texture, illustration, icon or logo images; Illustration Builder from
          approved illustration parts (group them by collection: Characters, Objects, Backgrounds);
          the post and poster makers from approved template artwork, photographs and logos. Colours
          and type follow the Brand tab.
        </span>
      </div>

      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="label">Try it as the client</span>
          <span className="row" style={{ marginLeft: 'auto' }}>
            {hub.data.tools.filter((t) => t.available && enabledTools.includes(t.id)).map((t) => (
              <button key={t.id} type="button" onClick={() => setTrying({ toolId: t.id })}>
                <Eye size={14} aria-hidden="true" /> {t.name}
              </button>
            ))}
          </span>
        </div>
        {(projects.data ?? []).length > 0 ? (
          <table>
            <thead><tr><th>Design</th><th>Tool</th><th>Made by</th><th>Last edited</th></tr></thead>
            <tbody>
              {(projects.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td><button type="button" className="link" onClick={() => setTrying({ toolId: p.toolId, project: p })}><strong>{p.name}</strong></button></td>
                  <td className="muted"><Grid3x3 size={12} aria-hidden="true" /> {p.toolId}</td>
                  <td className="muted mono" style={{ fontSize: 12 }}>{p.createdBy}</td>
                  <td className="muted">{new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No designs saved yet — by the client or by you.</p>
        )}
      </div>
    </section>
  );
}
