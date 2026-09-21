import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * Settings.
 *
 * Only what the application actually has is shown. The spec's fuller settings —
 * AI providers, storage, portal domains, team, sessions — need systems that do
 * not exist, and rendering disabled fields for them would be decoration.
 *
 * The access card reads the running process rather than stating a fixed
 * paragraph, because a static "this app has no authentication" note is
 * exactly the kind of thing that goes stale the day someone builds real
 * sessions and nobody remembers to come back and edit the one screen that
 * said otherwise. It did, here, until this was fixed. The account card is
 * new for the same reason from the other direction: a signed-in person had
 * no way to change their own name or password anywhere in the application.
 */

function AccountCard({ name, email }: { name: string; email: string }): ReactElement {
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const saveName = useMutation({
    mutationFn: () => api.updateAccount({ name: draftName.trim() }),
    onSuccess: () => {
      setEditingName(false);
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const savePassword = useMutation({
    mutationFn: () => api.updateAccount({ currentPassword, newPassword }),
    onSuccess: () => {
      setChangingPassword(false); setCurrentPassword(''); setNewPassword('');
    },
  });

  return (
    <div className="card stack">
      <span className="label">Your account</span>

      {editingName ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); saveName.mutate(); }}>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
                 aria-label="Name" style={{ maxWidth: 260 }} required />
          <button className="primary" type="submit" disabled={!draftName.trim() || saveName.isPending}>
            {saveName.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEditingName(false); setDraftName(name); }}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row">
          <div>
            <strong>{name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>{email}</div>
          </div>
          <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setEditingName(true)}>
            Edit name
          </button>
        </div>
      )}
      {saveName.error && <p className="err">{(saveName.error as Error).message}</p>}

      {changingPassword ? (
        <form
          className="stack" style={{ gap: 'calc(var(--step) * 2)' }}
          onSubmit={(e) => { e.preventDefault(); savePassword.mutate(); }}
        >
          <label className="field">
            <span className="label">Current password</span>
            <input type="password" value={currentPassword}
                   onChange={(e) => setCurrentPassword(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">New password</span>
            <div className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={newPassword}
                     onChange={(e) => setNewPassword(e.target.value)}
                     autoComplete="new-password" minLength={12} required />
              <button type="button" className="password-toggle"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>At least 12 characters.</span>
          </label>
          {savePassword.error && <p className="err">{(savePassword.error as Error).message}</p>}
          <div className="row">
            <button className="primary" type="submit"
                    disabled={!currentPassword || newPassword.length < 12 || savePassword.isPending}>
              {savePassword.isPending ? 'Saving…' : 'Change password'}
            </button>
            <button type="button" onClick={() => {
              setChangingPassword(false); setCurrentPassword(''); setNewPassword('');
            }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setChangingPassword(true)}>Change password</button>
      )}
    </div>
  );
}

export default function Settings(): ReactElement {
  const { data: rubric } = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: api.health });
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.session });

  return (
    <section className="stack">
      <h2>Settings</h2>

      {session?.user && <AccountCard name={session.user.name} email={session.user.email} />}

      <div className="card">
        <span className="label">Corpus</span>
        <p style={{ marginTop: 8 }}>
          {rubric
            ? `${rubric.departments.length} departments, ${rubric.universalDimensions.length} universal dimensions.`
            : 'Loading the rubric…'}
        </p>
        <p className="muted">
          The markdown corpus is canonical. The typed rubric is derived from it and validated
          in CI, so a scorecard edited in markdown that the parser does not follow fails the
          build rather than shipping a rubric that disagrees with the document.
        </p>
      </div>

      <div className="card">
        <span className="label">Access</span>
        {health?.authDisabled ? (
          <>
            <p style={{ marginTop: 8 }}>
              <strong>Sign-in is disabled.</strong> Every request to this server is treated as
              the studio owner — set by <span className="mono">EDSAI_DISABLE_AUTH</span> on the
              process, a convenience for one person running their own studio locally.
            </p>
            <p className="muted">
              A real session and password still exist underneath — the server prints them once
              at startup — so turning the flag back off does not lock anyone out. This mode
              also means a client portal session redeemed while it is on is silently upgraded
              to the owner's own access; testing what a client's link actually restricts needs
              the flag off.
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 8 }}>
              <strong>Sign-in is required.</strong> Sessions are cookie-based (HttpOnly,
              SameSite), passwords are hashed with scrypt and never stored, and every
              state-changing request is checked against the origin it came from.
            </p>
            <p className="muted">
              A client's own portal link is a separate, narrower kind of session — scoped to
              one client and a role chosen when the link was issued, enforced the same way for
              every route rather than hidden in the interface.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
