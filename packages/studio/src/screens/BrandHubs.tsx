import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pause, Play, Users } from 'lucide-react';
import { api, type BrandHubSummary } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import OverflowMenu from '../components/OverflowMenu.js';
import { go } from '../components/actions.js';

/**
 * Every Brand Hub in the studio, in one place.
 *
 * A hub belongs to a client and is set up from that client's own page;
 * this is the studio-wide view of them — which clients have one, whether
 * it is on, what it offers, and what has been made inside it. The same
 * relationship Projects has to a client's own project list.
 */

const TOOL_NAMES: Record<string, string> = {
  'pattern-studio': 'Pattern Studio', 'illustration-builder': 'Illustration Builder',
  'social-post': 'Social Post', poster: 'Poster',
};

const STATUS_TONE: Record<BrandHubSummary['status'], string> = {
  draft: 'minor', active: 'pass', suspended: 'major', archived: 'minor',
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function BrandHubs(): ReactElement {
  const queryClient = useQueryClient();
  const { data: hubs, isPending, error, refetch } = useQuery({ queryKey: ['brand-hubs'], queryFn: api.brandHubs });
  const set = useMutation({
    mutationFn: (input: { clientId: string; status: BrandHubSummary['status'] }) =>
      api.setBrandHub(input.clientId, { status: input.status }),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: ['brand-hubs'] });
      void queryClient.invalidateQueries({ queryKey: ['brand-hub', input.clientId] });
    },
  });

  if (isPending) return <p className="muted">Loading Brand Hubs…</p>;
  if (error) {
    return <ErrorPanel title="Could not load Brand Hubs" error={error} onRetry={() => { void refetch(); }} />;
  }

  const live = hubs.filter((h) => h.enabled).length;
  const designs = hubs.reduce((n, h) => n + h.designs, 0);

  return (
    <section className="stack">
      <div className="row">
        <h2>Brand Hub</h2>
        <span className="muted mono">{hubs.length}</span>
        {hubs.length > 0 && (
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {live} live · {designs} design{designs === 1 ? '' : 's'} made
          </span>
        )}
      </div>
      <p className="muted" style={{ maxWidth: '60ch' }}>
        The optional place a client keeps using the brand after handover — the approved files,
        the system, and tools that make variations of what you designed. Set one up from a
        client's own Brand Hub tab; it appears here.
      </p>

      {hubs.length === 0 ? (
        <div className="empty">
          <p className="editorial">No client has a Brand Hub yet.</p>
          <p>
            Most clients never need one. For a client who bought it, open their page, go to the
            Brand Hub tab and press <strong>Set up a Brand Hub</strong>.
          </p>
          <a href="#/clients"><button type="button">Go to clients</button></a>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Client</th><th>Status</th><th>Tools</th><th>Files</th><th>Designs</th><th>Latest</th><th /></tr>
          </thead>
          <tbody>
            {hubs.map((hub) => (
              <tr key={hub.clientId}>
                <td>
                  <a href={`#/clients/${hub.clientId}/hub`}><strong>{hub.clientName}</strong></a>
                  <div className="muted" style={{ fontSize: 12 }}>{hub.brandValues} brand values · updated {when(hub.updatedAt)}</div>
                </td>
                <td><span className={`pill ${STATUS_TONE[hub.status]}`}>{hub.status}</span></td>
                <td className="muted">{hub.tools.map((t) => TOOL_NAMES[t] ?? t).join(', ') || '—'}</td>
                <td className="mono">{hub.approvedAssets}</td>
                <td className="mono">{hub.designs}</td>
                <td className="muted">
                  {hub.recent[0] ? `${hub.recent[0].name} · ${when(hub.recent[0].updatedAt)}` : '—'}
                </td>
                <td className="actions">
                  <OverflowMenu label={`Actions for ${hub.clientName}'s Brand Hub`} items={[
                    { label: 'Open Brand Hub', icon: ExternalLink, onSelect: () => go(`#/clients/${hub.clientId}/hub`) },
                    hub.status === 'active'
                      ? { label: 'Suspend', icon: Pause, disabled: set.isPending,
                          onSelect: () => set.mutate({ clientId: hub.clientId, status: 'suspended' }) }
                      : { label: 'Activate', icon: Play, disabled: set.isPending,
                          onSelect: () => set.mutate({ clientId: hub.clientId, status: 'active' }) },
                    { label: 'Open client', icon: Users, onSelect: () => go(`#/clients/${hub.clientId}`) },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
