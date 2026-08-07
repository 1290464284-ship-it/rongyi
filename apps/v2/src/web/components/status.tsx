import { Component, useEffect, useState, type ReactNode } from 'react';
import { type UseQueryResult } from '@tanstack/react-query';
import { getSignedFileUrl } from '../lib/api';
import { errorMessage, friendlyError } from '../lib/messages';

export function PageError({ message }: { message: string }) {
  return <p className="error">{friendlyError(message)}</p>;
}

export function LoadingState({ label = '加载中...' }: { label?: string }) {
  return (
    <div className="page-state skeleton-state">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-block">
        <div className="skeleton-line w60" />
        <div className="skeleton-line w90" />
        <div className="skeleton-line w75" />
        <div className="skeleton-line w40" />
      </div>
    </div>
  );
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

/**
 * S-L8：需要鉴权的文件图片。`<img>` 无法携带 Authorization 头，
 * 组件先用带会话的请求向 /files/:name/sign 换取短期签名 URL 再渲染；
 * 无 path 时渲染 fallback，换取失败时显示占位错误。
 */
export function SignedImage({
  path,
  alt,
  className,
  fallback = null,
  loadingLabel = '图片加载中…',
}: {
  path?: string | null;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  loadingLabel?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // 渲染期调整：path 变化时复位异步状态，避免 effect 内同步 setState 级联渲染
  const [currentPath, setCurrentPath] = useState<string | null | undefined>(path);
  if (currentPath !== path) {
    setCurrentPath(path);
    setUrl(null);
    setFailed(false);
  }

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void getSignedFileUrl(path)
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return <>{fallback}</>;
  if (failed) return <span className="error">{loadingLabel.replace('…', '失败')}</span>;
  if (!url) return <span className="imaging-thumb-loading">{loadingLabel}</span>;
  return <img className={className} src={url} alt={alt} />;
}

/**
 * H1 分区渲染：按单个查询独立渲染区块。
 * 任一子查询失败只降级该区块（"该区块加载失败 + 重试"），不影响页面其余部分。
 */
export function QuerySection<T>({
  query,
  render,
}: {
  query: UseQueryResult<T, Error>;
  render: (data: T | undefined) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState label="加载中..." />;
  if (query.error) {
    return (
      <div className="query-section-error">
        <p className="error">该区块加载失败</p>
        <PageError message={errorMessage(query.error, '数据加载失败')} />
        <button type="button" onClick={() => void query.refetch()}>重试</button>
      </div>
    );
  }
  return <>{render(query.data)}</>;
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
