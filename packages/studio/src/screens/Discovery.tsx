import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, FolderPlus, Play, Trash2, type LucideIcon } from 'lucide-react';
import { api, type OnboardingSummary } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import OverflowMenu, { type MenuItem } from '../components/OverflowMenu.js';
import { ClientIdentity } from '../components/ClientIdentity.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { reportNotice } from '../notices.js';
import { go } from '../components/actions.js';

/**
 * Every onboarding, across every client, in one view.
 *
 * A client's own discovery still lives on their own page — this does not
 * replace that, it sits above it. Answering and accepting an onboarding both
 * still happen from the client it belongs to; this index exists for the
 * moment a person wants to see what is outstanding across the whole studio
 * without opening each client in turn, the same relationship Projects has to
 * a client's own project list.
 */

const STATUS_TONE: Record<OnboardingSummary['status'], string> = {
  draft: 'minor', sent: 'minor', 'in-progress': 'minor', submitted: 'pass', accepted: 'pass',
};

const STATUS_LABEL: Record<OnboardingSummary['status'], string> = {
  draft: 'draft', sent: 'sent', 'in-progress': 'in progress',
  submitted: 'ready to accept', accepted: 'became a project',
};

export default function Discovery(): ReactElement {
  const queryClient = useQueryClient();
  const { data: onboardings, isPending, error, refetch } = useQuery({
    queryKey: ['onboardings'], queryFn: api.allOnboardings,
  });
  const accept = useMutation({
    mutationFn: (id: string) => api.acceptOnboarding(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      go(`#/clients/${result.project.clientId}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteOnboarding(id),
    onSuccess: (result) => {
      // The bare prefix, so the per-client list and this one are both re-read —
      // `['onboardings', id]` alone would leave this very table stale, holding a
      // row for an onboarding that is gone.
      void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      void queryClient.invalidateQueries({ queryKey: ['client', result.clientId] });
      reportNotice('Onboarding deleted. You can now start a fresh one for that client.');
    },
  });

  /**
   * Confirm, then delete.
   *
   * The dialog exists because the destructive-looking action and the destructive
   * action are the same button here otherwise, and because "delete onboarding"
   * reads like "delete client" to anyone who has not read the store. It says
   * plainly what survives.
   */
  const confirmDelete = (o: OnboardingSummary): void => {
    const name = o.clientName ?? 'this client';
    void requestConfirmation({
      title: 'Delete onboarding?',
      message: `This will permanently delete the onboarding data for ${name}.`
        + ' The client and their other projects, documents, assets, invoices and brand'
        + ' information will not be deleted. You can create a new onboarding for this'
        + ' client afterward.',
      confirmLabel: 'Delete onboarding',
    }).then((confirmed) => {
      if (confirmed) remove.mutate(o.id);
    });
  };

  if (isPending) return <p className="muted">Loading discovery…</p>;
  if (error) {
    return <ErrorPanel title="Could not load discovery" error={error} onRetry={() => { void refetch(); }} />;
  }

  const outstanding = onboardings.filter((o) => o.status !== 'accepted').length;

  const itemsFor = (o: OnboardingSummary): MenuItem[] => {
    // Discovery is the client's own answers, so it opens on the tab that shows
    // them rather than the dashboard they are summarised on.
    const open: MenuItem & { icon: LucideIcon } = {
      label: 'Open discovery', icon: Compass, onSelect: () => go(`#/clients/${o.clientId}/strategy`),
    };
    // Present in every state, and last: `OverflowMenu` sorts `danger` items to
    // the bottom on its own, so this lands under the state-specific work rather
    // than beside it. Resetting a client's discovery has to be possible from an
    // accepted onboarding too — that is the brief-the-studio-wrong case.
    const removeItem: MenuItem = {
      label: remove.isPending && remove.variables === o.id ? 'Deleting…' : 'Delete onboarding',
      icon: Trash2,
      danger: true,
      // One at a time, so a second click cannot become a second request.
      disabled: remove.isPending,
      studioOnly: true,
      onSelect: () => confirmDelete(o),
    };
    if (o.status === 'submitted') {
      return [open, { label: 'Turn into a project', icon: FolderPlus, disabled: accept.isPending, studioOnly: true,
        onSelect: () => accept.mutate(o.id) }, removeItem];
    }
    if (o.status === 'accepted' && o.projectId) {
      const projectId = o.projectId;
      return [open, { label: 'Start a run from these answers', icon: Play, studioOnly: true,
        onSelect: () => go(`#/new/${projectId}`) }, removeItem];
    }
    return [open, removeItem];
  };

  return (
    <section className="stack">
      <div className="row">
        <h2>Discovery</h2>
        <span className="muted mono">{onboardings.length}</span>
      </div>

      {onboardings.length === 0 ? (
        <div className="empty">
          <p className="editorial">Nothing sent yet.</p>
          <p>
            An onboarding starts from a client — open one from <a href="#/clients">Clients</a> and
            issue its first discovery link.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            {outstanding === 0
              ? 'Every onboarding here has become a project.'
              : `${outstanding} still outstanding.`}
          </p>
          <table className="stacky">
            <thead>
              <tr>
                <th>Client</th><th>Status</th><th>Progress</th><th>Questions left</th><th>Sent</th><th />
              </tr>
            </thead>
            <tbody>
              {onboardings.map((onboarding) => (
                <tr key={onboarding.id}>
                  <td data-label="Client">
                    <a href={`#/clients/${onboarding.clientId}`}>
                      {/* The mark earns its place here: this table is the one view
                          where a person scans many clients at once looking for
                          the one they mean, and a row of near-identical names
                          with a status column beside them is the hardest kind of
                          thing to read. */}
                      <ClientIdentity
                        size="sm"
                        client={{
                          name: onboarding.clientName ?? onboarding.clientId,
                          ...(onboarding.logoAssetId ? { logoAssetId: onboarding.logoAssetId } : {}),
                        }}
                      />
                    </a>
                  </td>
                  <td data-label="Status">
                    <span className={`pill ${STATUS_TONE[onboarding.status]}`}>
                      {STATUS_LABEL[onboarding.status]}
                    </span>
                  </td>
                  <td data-label="Progress">
                    {onboarding.progress ? (
                      <div className="meter"><i style={{ width: `${onboarding.progress.percent}%` }} /></div>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="muted" data-label="Questions left">
                    {onboarding.progress && onboarding.progress.outstanding.length > 0
                      ? `${onboarding.progress.outstanding.length} question${onboarding.progress.outstanding.length === 1 ? '' : 's'}`
                      : '—'}
                  </td>
                  <td className="muted" data-label="Sent">{onboarding.createdAt.slice(0, 10)}</td>
                  <td className="actions">
                    <OverflowMenu label={`Actions for ${onboarding.clientName ?? 'this discovery'}`}
                                  items={itemsFor(onboarding)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
