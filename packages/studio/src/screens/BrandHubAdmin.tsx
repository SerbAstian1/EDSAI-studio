import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, Power, Save } from 'lucide-react';
import {
  api,
  type BrandDna,
  type BrandHubConfig,
  type BrandHubStatus,
  type BrandModuleConfig,
  type BrandProject,
} from '../api.js';

import { ErrorPanel } from '../components/ErrorPanel.js';
import ToolHost from '../components/ToolHost.js';
import BrandDnaEditor, { dnaDescribed } from '../components/BrandDnaEditor.js';
import BrandModuleEditor, { moduleConfigOf } from '../components/BrandModuleEditor.js';
import BrandRulesEditor from '../components/BrandRulesEditor.js';
import { brandRulesOf, moduleIcon, servedByBrand } from '../components/brandModules.js';

/**
 * The studio's side of a client's Brand Hub.
 *
 * Four decisions live here and nowhere else: whether the client has a hub at
 * all, what the brand *is*, which modules that buys them, and what those
 * modules let them change. Everything the hub *shows* — colours, type, files —
 * is managed where it already was (the Brand tab, the Files panel), because a
 * second place to approve a file is a second place for it to be wrong.
 *
 * The order of the screen is the order of the argument. A designer describes
 * the brand first, because the description is what narrows the modules; they
 * configure the modules second, because presets and locks only mean something
 * against a module; the rules come last, because they are the floor under both
 * rather than a per-module decision.
 *
 * A hub starts as a draft: it exists, the studio can fill it and try the tools
 * as the client would, and the client sees nothing until it is switched to
 * active.
 */

const STATUS: { id: BrandHubStatus; label: string; detail: string }[] = [
  { id: 'draft', label: 'Draft', detail: 'Set up here; the client does not see it yet.' },
  { id: 'active', label: 'Active', detail: 'The client has a Brand Hub in their portal.' },
  { id: 'suspended', label: 'Suspended', detail: 'Hidden from the client for now; nothing is lost.' },
  { id: 'archived', label: 'Archived', detail: 'Closed. Kept for the record.' },
];

/** The whole hub config as it stands, with the rules defaulted so a save is never partial. */
function configOf(hub: { config?: Partial<BrandHubConfig> } | undefined): BrandHubConfig {
  return {
    modules: hub?.config?.modules ?? {},
    rules: brandRulesOf(hub?.config?.rules),
  };
}

/** The DNA as it stands, tolerating a hub written before the field existed. */
function dnaOf(hub: { dna?: Partial<BrandDna> } | undefined): BrandDna {
  const note = hub?.dna?.note;
  return { systems: hub?.dna?.systems ?? [], ...(note ? { note } : {}) };
}

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
    mutationFn: (input: { status?: BrandHubStatus; tools?: string[]; dna?: Partial<BrandDna>; config?: BrandHubConfig }) =>
      api.setBrandHub(clientId, input),
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
  const modules = hub.data.modules;
  const described = dnaDescribed(dnaOf(record));
  const config = configOf(record);
  const rules = config.rules;
  const approved = (assets.data ?? []).filter((a) => a.approved);
  const brandValues = values.data ?? [];
  const busy = set.isPending;

  // Which modules the description actually buys. Computed here as well as on
  // the server so the studio can see a module go quiet the moment a system is
  // unticked, rather than only after a save.
  const systems = dnaOf(record).systems;
  const served = modules.filter((m) => servedByBrand(systems, m.capability));
  const unserved = modules.length - served.length;

  const toggleTool = (id: string): void => {
    const next = record?.tools.includes(id) ? record.tools.filter((t) => t !== id) : [...(record?.tools ?? []), id];
    set.mutate({ tools: next });
  };
  const saveDna = (dna: BrandDna): void => { set.mutate({ dna }); };
  const saveModule = (toolId: string, next: BrandModuleConfig): void => {
    set.mutate({ config: { ...config, modules: { ...config.modules, [toolId]: next } } });
  };
  const saveRules = (next: BrandHubConfig['rules']): void => {
    set.mutate({ config: { ...config, rules: next } });
  };

  if (trying) {
    const module = modules.find((m) => m.id === trying.toolId);
    return (
      <section className="stack">
        <div className="row">
          <h3 style={{ margin: 0 }}>{module?.name ?? trying.toolId} — as the client sees it</h3>
          <span className="muted">Designs saved here appear in their Projects too.</span>
        </div>
        {module && (
          <ToolHost
            toolId={trying.toolId}
            module={module}
            rules={rules}
            clientId={clientId}
            assets={approved}
            values={brandValues}
            project={trying.project}
            onSaved={(saved) => setTrying({ toolId: trying.toolId, project: saved })}
            onClose={() => setTrying(undefined)}
          />
        )}
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
          <button type="button" className="primary" disabled={busy}
                  onClick={() => set.mutate({ status: 'draft', tools: [] })}>
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
                   disabled={busy} onChange={() => set.mutate({ status: s.id })} />
            <span><strong>{s.label}</strong><span className="why">{s.detail}</span></span>
          </label>
        ))}
      </div>

      {/* Step one: what the brand is. Everything below is a consequence of this. */}
      <BrandDnaEditor dna={dnaOf(record)} onChange={saveDna} disabled={busy} />

      {/* Step two: the modules the description bought, and what each lets a client do. */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="label">Modules this client gets</span>
          {described && <span className="pill minor">narrowed by the description above</span>}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          A tool makes variations of what you designed — it never draws. Pattern Studio works from
          approved pattern, texture, illustration, icon or logo images; Illustration Builder from
          approved illustration parts; the post and poster makers from approved template artwork,
          photographs and logos. Colours and type follow the Brand tab and the rules below.
        </span>
        {modules.map((m) => {
          const gated = described && !m.enabled && !record.tools.includes(m.id);
          return (
            <div key={m.id} className="stack" style={{ gap: 8 }}>
              <label className="choice" style={{ opacity: m.available ? 1 : 0.6 }}>
                <input
                  type="checkbox"
                  checked={record.tools.includes(m.id)}
                  disabled={!m.available || busy}
                  onChange={() => toggleTool(m.id)}
                />
                <span>
                  <strong>{m.name}</strong>
                  {!m.available && <span className="pill minor" style={{ marginLeft: 8 }}>not built yet</span>}
                  {gated && <span className="pill minor" style={{ marginLeft: 8 }}>this brand has no {m.capability} yet</span>}
                  <span className="why">{m.description}</span>
                </span>
              </label>
              {m.available && record.tools.includes(m.id) && (
                <BrandModuleEditor
                  module={m}
                  config={moduleConfigOf(config.modules, m.id)}
                  onChange={(next) => saveModule(m.id, next)}
                  disabled={busy}
                />
              )}
            </div>
          );
        })}
        {unserved > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {unserved} module{unserved === 1 ? '' : 's'} the brand does not have, and so cannot have. Tick the
            matching system above to make {unserved === 1 ? 'it' : 'them'} available.
          </span>
        )}
      </div>

      {/* Step three: the floor under every module. */}
      <BrandRulesEditor rules={rules} values={brandValues} onChange={saveRules} disabled={busy} />

      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="label">Try it as the client</span>
          <span className="row" style={{ marginLeft: 'auto' }}>
            {served
              .filter((m) => m.available && record.tools.includes(m.id))
              .map((m) => {
                const Icon = moduleIcon(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => setTrying({ toolId: m.id })}>
                    <Icon size={14} aria-hidden="true" /> {m.name}
                  </button>
                );
              })}
          </span>
        </div>
        {(projects.data ?? []).length > 0 ? (
          <table className="stacky">
            <thead><tr><th>Design</th><th>Module</th><th>Made by</th><th>Last edited</th></tr></thead>
            <tbody>
              {(projects.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td data-label="Design">
                    <button type="button" className="link"
                            onClick={() => setTrying({ toolId: p.toolId, project: p })}>
                      <strong>{p.name}</strong>
                    </button>
                  </td>
                  <td className="muted" data-label="Module">
                    <Grid3x3 size={12} aria-hidden="true" /> {modules.find((m) => m.id === p.toolId)?.name ?? p.toolId}
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }} data-label="Made by">{p.createdBy}</td>
                  <td className="muted" data-label="Last edited">
                    {new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No designs saved yet — by the client or by you.</p>
        )}
      </div>

      {busy && (
        <p className="muted row" style={{ justifyContent: 'center' }} aria-live="polite">
          <Save size={13} aria-hidden="true" /> Saving…
        </p>
      )}
    </section>
  );
}
