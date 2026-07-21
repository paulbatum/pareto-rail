import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Headline shown in the fallback panel. */
  title?: string;
  /** Supporting line under the headline. */
  message?: string;
  /** Label for the reload button. */
  actionLabel?: string;
};

type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('Unhandled error in UI:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.title ?? 'Something went wrong.';
    const message = this.props.message
      ?? 'This part of the page ran into a problem. Reloading usually clears it up.';
    const actionLabel = this.props.actionLabel ?? 'Reload';

    return (
      <section className="page-panel">
        <p className="eyebrow">Error</p>
        <h1>{title}</h1>
        <p className="lede">{message}</p>
        <button type="button" className="button primary" onClick={() => location.reload()}>{actionLabel}</button>
      </section>
    );
  }
}
