import { Component, type ReactNode } from 'react';
import { friendlyError } from '../lib/messages';

export function PageError({ message }: { message: string }) {
  return <p className="error">{friendlyError(message)}</p>;
}

export function LoadingState({ label = '加载中...' }: { label?: string }) {
  return <div className="page-state">{label}</div>;
}

export function EmptyState({ message = '暂无数据' }: { message?: string }) {
  return <div className="table-empty">{message}</div>;
}

export function QueryBoundary({
  isLoading,
  error,
  data,
  loadingLabel,
  errorLabel,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  data?: unknown;
  loadingLabel?: string;
  errorLabel?: string;
  children: ReactNode;
}) {
  if (isLoading) return <LoadingState label={loadingLabel} />;
  if (error) return <PageError message={errorLabel ?? (error instanceof Error ? error.message : String(error))} />;
  if (data === undefined) return <PageError message={errorLabel ?? '数据加载失败'} />;
  return <>{children}</>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page error-state">
          <h1>页面加载失败</h1>
          <p>{friendlyError(this.state.error.message)}</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}
