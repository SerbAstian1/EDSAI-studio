import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';

export interface ErrorPanelProps {
  title: string;
  error?: unknown;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  backHref?: string;
  backLabel?: string;
  page?: boolean;
}

export function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return undefined;
}

export function ErrorPanel({
  title, error, description, onRetry, retryLabel = 'Try again', backHref, backLabel = 'Go back', page = false,
}: ErrorPanelProps): ReactElement {
  const detail = errorMessage(error);

  return (
    <section className={`error-panel${page ? ' error-page' : ''}`} role={error ? 'alert' : undefined}>
      <AlertCircle className="error-panel-icon" size={24} strokeWidth={1.75} aria-hidden="true" />
      <div>
        <p className="label">Something needs attention</p>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
        {detail && <p className="error-panel-detail">{detail}</p>}
        {(onRetry || backHref) && (
          <div className="row error-panel-actions">
            {onRetry && (
              <button type="button" className="primary" onClick={onRetry}>
                <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
                {retryLabel}
              </button>
            )}
            {backHref && (
              <a className="button-link" href={backHref}>
                <ArrowLeft size={14} strokeWidth={1.9} aria-hidden="true" />
                {backLabel}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function ErrorPage(props: Omit<ErrorPanelProps, 'page'>): ReactElement {
  return <ErrorPanel {...props} page />;
}
