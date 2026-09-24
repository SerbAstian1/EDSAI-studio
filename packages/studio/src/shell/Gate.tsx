import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { LoadingOverlay } from '../components/LoadingOverlay.js';

/**
 * Sign-in, and the studio's own first run.
 *
 * Two screens rather than one, decided by the server: `/api/health` reports
 * whether any user exists, and that boolean is the whole answer — it never says
 * who, because a public endpoint that enumerates accounts is an account
 * enumeration endpoint whatever it is called.
 *
 * The session itself is an HttpOnly cookie this code cannot read. That is the
 * point: nothing here holds a credential, so an injected script has nothing to
 * steal from the page.
 */
export function Gate({ children }: { children: ReactElement }): ReactElement {
  const client = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false });
  const session = useQuery({
    queryKey: ['session'], queryFn: api.session, retry: false,
    enabled: health.data !== undefined && !health.data.needsSetup,
  });

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const enter = useMutation({
    mutationFn: () => (health.data?.needsSetup
      ? api.setup(name, email, password)
      : api.signIn(email, password)),
    onSuccess: () => { void client.invalidateQueries(); },
  });

  if (health.isPending || (health.data?.needsSetup === false && session.isPending)) {
    return <LoadingOverlay label="Connecting to the studio…" />;
  }

  if (health.error) {
    return (
      <div className="content">
        <div className="card">
          <h2>The studio API is not reachable</h2>
          <p className="muted">{(health.error as Error).message}</p>
          <p className="muted">
            Start it with <span className="mono">edsai serve</span>. This page recovers on its own.
          </p>
        </div>
      </div>
    );
  }

  if (session.data?.principal) return children;

  const setup = health.data?.needsSetup === true;

  return (
    <div className="gate-screen">
      <form
        className="gate-card"
        onSubmit={(event) => { event.preventDefault(); enter.mutate(); }}
      >
        <p className="label">{setup ? 'First run' : 'EDS AI Studio'}</p>
        <p className="editorial">
          {setup ? 'Let’s set up your studio.' : 'Sign in to the studio.'}
        </p>

        {setup && (
          <label className="field">
            <span className="label">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   autoComplete="name" required />
          </label>
        )}

        <label className="field">
          <span className="label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 autoComplete="username" required />
        </label>

        <label className="field">
          <span className="label">Password</span>
          <div className="password-field">
            <input type={showPassword ? 'text' : 'password'} value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   autoComplete={setup ? 'new-password' : 'current-password'} required
                   minLength={setup ? 12 : undefined} />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {setup && <span className="muted" style={{ fontSize: 13 }}>
            At least 12 characters. It is hashed with scrypt and never stored.
          </span>}
        </label>

        {enter.error && <p className="err">{(enter.error as Error).message}</p>}

        <button className="primary" type="submit" disabled={enter.isPending}>
          {enter.isPending ? 'Working…' : setup ? 'Create the studio' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
