import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type OnboardingSummary } from '../api.js';

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
  const { data: onboardings, isPending, error } = useQuery({
    queryKey: ['onboardings'], queryFn: api.allOnboardings,
  });

  if (isPending) return <p className="muted">Loading discovery…</p>;
  if (error) return <p className="err">Could not load discovery. {(error as Error).message}</p>;

  const outstanding = onboardings.filter((o) => o.status !== 'accepted').length;

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
          <table>
            <thead>
              <tr>
                <th>Client</th><th>Status</th><th>Progress</th><th>Outstanding</th><th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {onboardings.map((onboarding) => (
                <tr key={onboarding.id}>
                  <td>
                    <a href={`#/clients/${onboarding.clientId}`}>
                      <strong>{onboarding.clientName ?? onboarding.clientId}</strong>
                    </a>
                  </td>
                  <td>
                    <span className={`pill ${STATUS_TONE[onboarding.status]}`}>
                      {STATUS_LABEL[onboarding.status]}
                    </span>
                  </td>
                  <td style={{ minWidth: 140 }}>
                    {onboarding.progress ? (
                      <div className="meter"><i style={{ width: `${onboarding.progress.percent}%` }} /></div>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="muted">
                    {onboarding.progress && onboarding.progress.outstanding.length > 0
                      ? onboarding.progress.outstanding.join(', ')
                      : '—'}
                  </td>
                  <td className="muted">{onboarding.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
