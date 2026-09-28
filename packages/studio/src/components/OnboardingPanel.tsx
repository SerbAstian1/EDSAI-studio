import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, type OnboardingSummary } from '../api.js';
import { DiscoveryQuestions } from './DiscoveryQuestions.js';
import OverflowMenu, { type MenuItem } from './OverflowMenu.js';
import { requestConfirmation } from './ConfirmDialog.js';
import { StudioOnly } from '../viewMode.js';
import { reportNotice } from '../notices.js';

/**
 * The studio's side of onboarding.
 *
 * The invite link is shown once, at the moment it is created, because only its
 * digest is stored — the same rule as a session token. If it is lost, a new one
 * is issued, which is an action the client can see; recovering the old one would
 * mean the database held something that could open the form.
 *
 * The link is still the way to hand this to a client — nothing about that
 * changed. What is new is that answering it no longer requires the link: a
 * card can be opened right here and answered from inside the studio's own
 * session, for the call where the client says the answer out loud instead of
 * typing it themselves.
 */

/** The one onboarding open for answering inline, or none. */
function InlineDiscovery({ onboardingId, onDone }: { onboardingId: string; onDone: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['discovery', onboardingId], queryFn: () => api.discoveryForm(onboardingId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['discovery', onboardingId] });
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
  };

  const answer = useMutation({
    mutationFn: (input: { questionId: string; value: unknown }) =>
      api.answerDiscovery(onboardingId, input.questionId, input.value),
    onSuccess: invalidate,
  });

  const submit = useMutation({
    mutationFn: () => api.submitDiscovery(onboardingId),
    onSuccess: () => { invalidate(); onDone(); },
  });

  if (isPending) return <p className="muted">Opening…</p>;
  if (error) return <p className="err">{(error as Error).message}</p>;

  if (data.status === 'submitted' || data.status === 'accepted') {
    return <p className="muted">Every question here has an answer. Turn it into a project above.</p>;
  }

  return (
    <div className="stack">
      <DiscoveryQuestions
        data={data}
        onAnswer={(questionId, value) => answer.mutate({ questionId, value })}
        onSubmit={() => submit.mutate()}
        saving={answer.isPending || submit.isPending}
        saveError={(answer.error ?? submit.error) as Error | undefined}
        submitLabel="Mark complete"
      />
    </div>
  );
}

export function OnboardingPanel({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data: onboardings, isPending } = useQuery({
    queryKey: ['onboardings', clientId], queryFn: () => api.onboardings(clientId),
  });
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => api.client(clientId) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  const [link, setLink] = useState<string | undefined>();
  const [answering, setAnswering] = useState<string | undefined>();

  const invalidate = (): void => {
    // The bare key, not `['onboardings', clientId]` — invalidation only
    // reaches queries whose key the given key is a *prefix* of, so the
    // narrower key would leave the studio-wide Discovery view's `['onboardings']`
    // cache entry stale after an answer, a submit or an accept.
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
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

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteOnboarding(id),
    onSuccess: (result, id) => {
      // The card answering itself on this one would be left rendering a form
      // for an onboarding that no longer exists — the write's 404 fires against
      // a query the panel still holds. Closing it here is the redirect this
      // surface needs; the panel stays where it is, which is the client's
      // overview, so there is nowhere to navigate to.
      setAnswering((current) => (current === id ? undefined : current));
      invalidate();
      reportNotice(
        `Onboarding deleted. You can now start a fresh one for ${client.data?.client.name ?? 'this client'}.`,
      );
      void result;
    },
  });

  /**
   * Confirm, then delete — never on the menu click.
   *
   * The dialog says what survives, because the question behind this action is
   * always "does this delete the client?". It does not: the client, their
   * projects, documents, files, invoices and brand are all still there, and only
   * the onboarding and its answers are going.
   */
  const confirmDelete = (onboarding: OnboardingSummary): void => {
    const name = client.data?.client.name ?? onboarding.clientName ?? 'this client';
    void requestConfirmation({
      title: 'Delete onboarding?',
      message: `This will permanently delete the onboarding data for ${name}.`
        + ' The client and their other projects, documents, assets, invoices and brand'
        + ' information will not be deleted. You can create a new onboarding for this'
        + ' client afterward.',
      confirmLabel: 'Delete onboarding',
    }).then((confirmed) => {
      if (confirmed) remove.mutate(onboarding.id);
    });
  };

  if (isPending) return <p className="muted">Loading onboarding…</p>;

  const menuFor = (onboarding: OnboardingSummary): MenuItem[] => [{
    // In-flight, so the state is legible in the menu rather than only as a
    // disabled row the person has already opened.
    label: remove.isPending && remove.variables === onboarding.id
      ? 'Deleting…' : 'Delete onboarding',
    icon: Trash2,
    danger: true,
    // One delete at a time: a second click cannot produce a second request.
    disabled: remove.isPending,
    onSelect: () => confirmDelete(onboarding),
  }];

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Onboarding</h3>
        <StudioOnly>
          <button style={{ marginLeft: 'auto' }} onClick={() => start.mutate()}
                  disabled={start.isPending}>
            {start.isPending ? 'Creating…' : 'New onboarding link'}
          </button>
        </StudioOnly>
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
                {(onboarding.status === 'draft' || onboarding.status === 'sent'
                  || onboarding.status === 'in-progress') && (
                  <StudioOnly>
                    <button onClick={() => setAnswering((id) => id === onboarding.id ? undefined : onboarding.id)}>
                      {answering === onboarding.id ? 'Close' : 'Answer here'}
                    </button>
                  </StudioOnly>
                )}
                {onboarding.status === 'submitted' && (
                  <StudioOnly>
                    <button className="primary"
                            onClick={() => accept.mutate(onboarding.id)}
                            disabled={accept.isPending}>
                      Turn into a project
                    </button>
                  </StudioOnly>
                )}
                {/* Destructive, so it is in the overflow rather than on the card:
                    a reset is a thing you go looking for, not a thing a card
                    offers you next to the work. It is the only thing on the right
                    of this row, so the `auto` margin lives here alone — three of
                    them would split the free space three ways. */}
                <StudioOnly>
                  <span style={{ marginLeft: 'auto' }}>
                    <OverflowMenu label="Actions for this onboarding" size="bar"
                                  items={menuFor(onboarding)} />
                  </span>
                </StudioOnly>
              </div>

              {onboarding.progress && (
                <div style={{ marginTop: 12 }}>
                  <div className="meter"><i style={{ width: `${onboarding.progress.percent}%` }} /></div>
                  <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                    {onboarding.progress.answered} of {onboarding.progress.required} answered ·
                    {' '}{onboarding.progress.axesDecided} of 8 directions settled
                    {onboarding.progress.outstanding.length > 0
                      && ` · ${onboarding.progress.outstanding.length} question${onboarding.progress.outstanding.length === 1 ? '' : 's'} left`}
                  </p>
                </div>
              )}

              {onboarding.projectId && (
                <p className="muted row" style={{ fontSize: 13, gap: 8 }}>
                  <span>
                    Became the project{' '}
                    <strong>{projectName.get(onboarding.projectId) ?? onboarding.projectId}</strong>.
                  </span>
                  {/* The answers are the brief: a run started from here carries them. */}
                  <StudioOnly>
                    <a href={`#/new/${onboarding.projectId}`}>
                      <button type="button">Start a run from these answers</button>
                    </a>
                  </StudioOnly>
                </p>
              )}

              {answering === onboarding.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <InlineDiscovery
                    onboardingId={onboarding.id}
                    onDone={() => setAnswering(undefined)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <StudioOnly>
        {(start.error || accept.error) && (
          <p className="err">{((start.error ?? accept.error) as Error).message}</p>
        )}
      </StudioOnly>
    </div>
  );
}
