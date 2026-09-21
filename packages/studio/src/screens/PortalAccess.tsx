import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PortalKey } from '../api.js';

/**
 * Who can open this client's portal.
 *
 * A portal link is not a password, and that is a decision with a cost rather
 * than a free convenience. A client receives brand files a handful of times a
 * year; an account they must create, remember and reset is a barrier in front
 * of work they have already paid for. So the link is the credential.
 *
 * What that costs is stated on this screen rather than buried: **anyone holding
 * the link is that client.** Three things bound it, and all three are visible
 * here — an expiry, one-click revocation, and a count of every time the link
 * was used. The count is the part that earns its place: a designer who sees a
 * link opened forty times two months after the job ended can act on that.
 *
 * The token is shown once, at the moment of issue. There is no route that
 * returns it again, so a lost link is reissued rather than looked up — which is
 * an action the client can see.
 */

const ROLES: { value: string; label: string; detail: string }[] = [
  {
    value: 'viewer', label: 'Everything approved, read-only',
    detail: 'Their whole brand and every file you have released. Nothing to reply with.',
  },
  {
    value: 'editor', label: 'Everything approved, and can reply',
    detail: 'The usual choice for the client themselves — messages, feedback and files, '
      + 'in both directions.',
  },
  {
    value: 'limited', label: 'Only certain collections',
    detail: 'For a contractor or an agency who should see the logos and nothing else.',
  },
];

function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

/** What to say about a link, in one line, without making the reader do maths. */
export function describeKey(key: PortalKey, now = Date.now()): string {
  const left = daysUntil(key.expiresAt, now);
  const life = left === 0 ? 'expires today' : `${left} day${left === 1 ? '' : 's'} left`;
  if (key.uses === 0) return `Never opened · ${life}`;
  const times = key.uses === 1 ? 'Opened once' : `Opened ${key.uses} times`;
  return `${times} · ${life}`;
}

export default function PortalAccess({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('editor');
  const [collections, setCollections] = useState('');
  const [issued, setIssued] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys, isPending, error } = useQuery({
    queryKey: ['portal-keys', clientId], queryFn: () => api.portalKeys(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['portal-keys', clientId] });
  };

  const issue = useMutation({
    mutationFn: () => api.issuePortalKey(clientId, {
      label: label.trim(),
      role,
      ...(role === 'limited'
        ? { collections: collections.split(',').map((c) => c.trim()).filter(Boolean) }
        : {}),
    }),
    onSuccess: (result) => {
      setIssued({ label: label.trim(), url: `${location.origin}${result.link.path}` });
      setCopied(false);
      setLabel(''); setCollections('');
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => api.revokePortalKey(clientId, keyId),
    onSuccess: invalidate,
  });

  const needsCollections = role === 'limited' && collections.trim() === '';

  return (
    <section className="stack">
      <h3 style={{ margin: 0 }}>Portal access</h3>
      <p className="muted">
        A link opens this client's portal — their brand and every file you have approved.
        There is no password to set up and nothing for them to remember. The trade is that
        whoever holds the link is them, so each one expires, can be withdrawn, and counts
        its own use.
      </p>

      {issued && (
        <div className="card stack">
          <span className="label">Link for {issued.label}</span>
          <p className="mono" style={{ fontSize: 13, wordBreak: 'break-all', margin: 0 }}>
            {issued.url}
          </p>
          <div className="row">
            <button
              className="primary" type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.url)
                  .then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" onClick={() => setIssued(null)}>Done</button>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Copy it now. It is shown once and cannot be recovered — if it is lost, issue
            another and revoke this one.
          </p>
        </div>
      )}

      <form
        className="card stack"
        onSubmit={(e) => { e.preventDefault(); issue.mutate(); }}
      >
        <label className="field">
          <span className="label">Who is this link for</span>
          <input
            value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Ada at Morrow" required
          />
        </label>

        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          <span className="label">What it opens</span>
          {ROLES.map((option) => (
            <label key={option.value} className="choice">
              <input
                type="radio" name="portal-role" value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="why">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>

        {role === 'limited' && (
          <label className="field">
            <span className="label">Which collections</span>
            <input
              value={collections} onChange={(e) => setCollections(e.target.value)}
              placeholder="Logos, Fonts"
            />
            <span className="muted">
              Comma separated, matching the collections on the files above. A link with
              none opens nothing, so it is refused rather than issued.
            </span>
          </label>
        )}

        {issue.error && <p className="err">{(issue.error as Error).message}</p>}

        <div className="row">
          <button
            className="primary" type="submit"
            disabled={!label.trim() || needsCollections || issue.isPending}
          >
            {issue.isPending ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </form>

      {isPending && <p className="muted">Loading links…</p>}
      {error && <p className="err">Could not load links. {(error as Error).message}</p>}

      {keys && keys.length > 0 && (
        <table className="stacky">
          <thead><tr><th>Given to</th><th>Opens</th><th>Use</th><th /></tr></thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td data-label="Given to"><strong>{key.label}</strong></td>
                <td className="muted" data-label="Opens">
                  {key.role === 'limited'
                    ? (key.collections ?? []).join(', ') || 'nothing'
                    : 'Everything approved'}
                </td>
                <td className="muted" data-label="Use">{describeKey(key)}</td>
                <td>
                  <button
                    type="button" disabled={revoke.isPending}
                    onClick={() => revoke.mutate(key.id)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revoke.error && <p className="err">{(revoke.error as Error).message}</p>}
    </section>
  );
}
