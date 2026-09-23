import { useEffect, useRef, useSyncExternalStore, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

interface PendingConfirmation extends ConfirmationOptions {
  resolve: (confirmed: boolean) => void;
}

let pending: PendingConfirmation | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): PendingConfirmation | undefined {
  return pending;
}

export function resolveConfirmation(confirmed: boolean): void {
  const active = pending;
  if (!active) return;
  pending = undefined;
  notify();
  active.resolve(confirmed);
}

export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  resolveConfirmation(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    notify();
  });
}

export function ConfirmationDialog(): ReactElement | null {
  const confirmation = useSyncExternalStore(subscribe, current, current);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmation) return;
    cancel.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      resolveConfirmation(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [confirmation]);

  if (!confirmation) return null;

  return (
    <div
      className="confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolveConfirmation(false);
      }}
    >
      <section className="confirmation-dialog" role="alertdialog" aria-modal="true"
               aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
        <AlertTriangle className="confirmation-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <p className="label">Confirm action</p>
          <h2 id="confirmation-title">{confirmation.title}</h2>
          <p id="confirmation-message" className="muted">{confirmation.message}</p>
          <div className="row confirmation-actions">
            <button ref={cancel} type="button" onClick={() => resolveConfirmation(false)}>Cancel</button>
            <button type="button" className="danger-button" onClick={() => resolveConfirmation(true)}>
              {confirmation.confirmLabel ?? 'Delete'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
