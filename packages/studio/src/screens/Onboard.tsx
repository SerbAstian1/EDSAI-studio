import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscoveryForm } from '../api.js';
import { DiscoveryQuestions } from '../components/DiscoveryQuestions.js';

/**
 * The client-facing discovery flow.
 *
 * The questions themselves live in `DiscoveryQuestions` now, shared with the
 * studio's own in-session copy of this form (see `OnboardingPanel.tsx`) —
 * this file is only the public, token-authenticated half: fetching by a
 * capability token instead of a session, and the three screens either side of
 * the questions (opening, a bad link, and the thank-you) that only make sense
 * for a stranger arriving from an emailed link.
 */

const get = async (token: string): Promise<DiscoveryForm> => {
  const res = await fetch(`/api/onboard/${token}`);
  if (!res.ok) throw new Error((await res.json() as { message: string }).message);
  return res.json() as Promise<DiscoveryForm>;
};

const put = async (token: string, payload: unknown): Promise<unknown> => {
  const res = await fetch(`/api/onboard/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json() as { message: string }).message);
  return res.json();
};

export default function Onboard({ token }: { token: string }): ReactElement {
  const client = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['onboard', token], queryFn: () => get(token), retry: false,
  });

  const save = useMutation({
    mutationFn: (payload: unknown) => put(token, payload),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['onboard', token] }); },
  });

  if (isPending) return <div className="onboard"><p className="muted">Opening…</p></div>;
  if (error) {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <p className="editorial">This link is not open.</p>
          <p className="muted">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (data.status === 'submitted' || data.status === 'accepted') {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <p className="label">{data.clientName}</p>
          <p className="editorial">That’s everything. Thank you.</p>
          <p className="muted">
            {data.progress.axesDecided >= 8
              ? 'Your answers are with the studio, and they settled every direction we needed from you.'
              : `Your answers are with the studio. They settled ${data.progress.axesDecided} of the eight directions we needed.`}
            {' '}The last three are ours to draft — you’ll be asked to confirm them rather than
            write them, because confirming a sentence is far easier than composing one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard">
      <DiscoveryQuestions
        data={data}
        onAnswer={(questionId, value) => save.mutate({ questionId, value })}
        onSubmit={() => save.mutate({ submit: true })}
        saving={save.isPending}
        saveError={save.error as Error | undefined}
      />
    </div>
  );
}
