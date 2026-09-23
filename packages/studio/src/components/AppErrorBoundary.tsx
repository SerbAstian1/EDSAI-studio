import { Component, type ReactNode } from 'react';
import { ErrorPage } from './ErrorPanel.js';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorPage
        title="The studio could not finish rendering this page"
        description="Your saved work is still on the server. Reload the studio to try again."
        error={this.state.error}
        onRetry={() => location.reload()}
        retryLabel="Reload studio"
      />
    );
  }
}
