// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  EmptyState,
  ErrorBoundary,
  PageError,
  QueryBoundary,
  QuerySection,
  SignedImage,
} from './status';
import { getSignedFileUrl } from '../lib/api';

vi.mock('../lib/api', () => ({ getSignedFileUrl: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(getSignedFileUrl).mockReset();
});

describe('QueryBoundary', () => {
  it('renders loading, error, missing-data and children states', () => {
    const { rerender } = render(
      <QueryBoundary isLoading error={null} data={undefined} loadingLabel="查询中">内容</QueryBoundary>,
    );
    expect(screen.getByText('查询中')).toBeDefined();

    rerender(
      <QueryBoundary isLoading={false} error={new Error('Load failed')} data={undefined} errorLabel="加载失败">内容</QueryBoundary>,
    );
    expect(screen.getByText('加载失败')).toBeDefined();

    rerender(
      <QueryBoundary isLoading={false} error={new Error('Load failed')} data={undefined}>内容</QueryBoundary>,
    );
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();

    rerender(<QueryBoundary isLoading={false} error={null} data={undefined}>内容</QueryBoundary>);
    expect(screen.getByText('数据加载失败')).toBeDefined();

    rerender(<QueryBoundary isLoading={false} error={null} data={{ ok: true }}>内容</QueryBoundary>);
    expect(screen.getByText('内容')).toBeDefined();
  });
});

describe('SignedImage', () => {
  it('renders fallback, loading, signed image and failure states', async () => {
    const { rerender } = render(<SignedImage path={null} alt="影像" fallback={<span>无影像</span>} />);
    expect(screen.getByText('无影像')).toBeDefined();

    vi.mocked(getSignedFileUrl).mockResolvedValue('http://signed/a.png');
    rerender(<SignedImage path="/a.png" alt="影像" />);
    expect(screen.getByText('图片加载中…')).toBeDefined();
    expect(await screen.findByRole('img', { name: '影像' })).toBeDefined();
    expect((screen.getByRole('img', { name: '影像' }) as HTMLImageElement).src).toBe('http://signed/a.png');

    vi.mocked(getSignedFileUrl).mockRejectedValue(new Error('no'));
    rerender(<SignedImage path="/b.png" alt="影像" />);
    expect(await screen.findByText('图片加载中失败')).toBeDefined();
  });
});

describe('QuerySection', () => {
  function fakeQuery(overrides: Record<string, unknown>) {
    return {
      isLoading: false,
      error: null,
      data: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as never;
  }

  it('renders loading and retryable errors', () => {
    render(<QuerySection query={fakeQuery({ isLoading: true })} render={() => <span>内容</span>} />);
    expect(screen.getByText('加载中...')).toBeDefined();

    cleanup();
    const refetch = vi.fn().mockResolvedValue(undefined);
    render(
      <QuerySection
        query={fakeQuery({ error: new Error('Load failed'), refetch })}
        render={() => <span>内容</span>}
      />,
    );
    expect(screen.getByText('该区块加载失败')).toBeDefined();
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders query data through the render prop', () => {
    render(<QuerySection query={fakeQuery({ data: { name: '张三' } })} render={(data) => <span>{String((data as { name?: string })?.name)}</span>} />);
    expect(screen.getByText('张三')).toBeDefined();
  });
});

describe('ErrorBoundary and simple states', () => {
  function Boom(): ReactNode {
    throw new Error('Load failed');
  }

  it('catches child render errors', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面加载失败')).toBeDefined();
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeDefined();
  });

  it('renders children when there is no error', () => {
    render(<ErrorBoundary><span>正常内容</span></ErrorBoundary>);
    expect(screen.getByText('正常内容')).toBeDefined();
  });

  it('normalizes non-Error render failures', () => {
    function BoomString(): ReactNode {
      throw 'boom-string';
    }
    render(
      <ErrorBoundary>
        <BoomString />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面加载失败')).toBeDefined();
  });

  it('falls back to a generic message for non-Error query errors', () => {
    render(
      <QueryBoundary isLoading={false} error="boom-string" data={undefined}>
        内容
      </QueryBoundary>,
    );
    expect(screen.getByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders default labels for PageError, LoadingState and EmptyState', () => {
    render(
      <>
        <PageError message="Load failed" />
        <EmptyState />
      </>,
    );
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();
    expect(screen.getByText('暂无数据')).toBeDefined();
    void waitFor;
  });
});
