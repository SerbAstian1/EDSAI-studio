import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OnboardingSummary } from '../api.js';

/**
 * The studio's side of onboarding.
 *
 * The invite link is shown once, at the moment it is created, because only its
 * digest is stored — the same rule as a session token. If it is lost, a new one
 * is issued, which is an action the client can see; recovering the old one would
 * mean the database held something that could open the form.
 */
export function OnboardingPanel({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data: onboardings, isPending } = useQuery({
    queryKey: ['onboardings', clientId], queryFn: () => api.onboardings(clientId),
  });

  const [link, setLink] = useState<string | undefined>();

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['onboardings', clientId] });
    void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
  };

  const start = useMutation({
    mutationFn: () => api.startOnboarding(clientId),
    onSuccess: (result) => {
      setLink(`${location.origin}/#${result.invite.path}`);
      invalidate();
    },
  });

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptOnboarding(id),
    onSuccess: invalidate,
  });

  if (isPending) return <p className="muted">Loading onboarding…</p>;

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Onboarding</h3>
        <button style={{ marginLeft: 'auto' }} onClick={() => start.mutate()}
                disabled={start.isPending}>
          {start.isPending ? 'Creating…' : 'New onboarding link'}
        </button>
      </div>

      {link && (
        <div className="card" style={{ marginBottom: 0 }}>
          <span className="label">Send this to the client</span>
          <p className="mono" style={{ fontSize: 13, wordBreak: 'break-all', margin: '8px 0' }}>
            {link}
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            Shown once. Only its fingerprint is stored, so it cannot be looked up later —
            issue a new link instead. They will not need an account.
          </p>
        </div>
      )}

      {(onboardings ?? []).length === 0 ? (
        <p className="muted">
          No onboarding yet. The flow asks about rooms, shop windows and what happens when
          someone asks the price — it settles eight of the eleven directions, and leaves the
          other three for you to draft.
        </p>
      ) : (
        <div className="stack">
          {(onboardings ?? []).map((onboarding: OnboardingSummary) => (
            <div className="card" key={onboarding.id} style={{ marginBottom: 0 }}>
              <div className="row">
                <span className={`pill ${onboarding.status === 'accepted' ? 'pass' : 'minor'}`}>
                  {onboarding.status}
                </span>
                <span className="muted mono" style={{ fontSize: 12 }}>{onboarding.id}</span>
                {onboarding.status === 'submitted' && (
                  <button className="primary" style={{ marginLeft: 'auto' }}
                          onClick={() => accept.mutate(onboarding.id)}
                          disabled={accept.isPending}>
                    Turn into a project
                  </button>
                )}
              </div>

              {onboarding.progress && (
                <div style={{ marginTop: 12 }}>
                  <div className="meter"><i style={{ width: `${onboarding.progress.percent}%` }} /></div>
                  <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                    {onboarding.progress.answered} of {onboarding.progress.required} answered ·
                    {' '}{onboarding.progress.axesDecided} of 8 directions settled
                    {onboarding.progress.outstanding.length > 0
                      && ` · outstanding: ${onboarding.progress.outstanding.join(', ')}`}
                  </p>
                </div>
              )}

              {onboarding.projectId && (
                <p className="muted" style={{ fontSize: 13 }}>
                  Became project <span className="mono">{onboarding.projectId}</span>.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {(start.error || accept.error) && (
        <p className="err">{((start.error ?? accept.error) as Error).message}</p>
      )}
    </div>
  );
}
