// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

// ReactDOM 引导是模块级副作用：用 vi.hoisted 收集 onApiReady 回调与 createRoot 容器，
// 动态 import 一次即可覆盖 bootstrap 的 4 条语句（queryClient 创建 / onApiReady 注册 /
// 回调体内的 invalidateQueries / createRoot().render()）。
const { readyHandlers, roots } = vi.hoisted(() => ({
  readyHandlers: [] as Array<() => void>,
  roots: [] as unknown[],
}));

vi.mock('react-dom/client', () => {
  const createRoot = (container: unknown) => {
    roots.push(container);
    return { render: () => {} };
  };
  return { default: { createRoot }, createRoot };
});

vi.mock('./lib/api', () => ({
  onApiReady: (callback: () => void) => {
    readyHandlers.push(callback);
    return () => {};
  },
}));

vi.mock('./App', () => ({
  default: () => <div>AppStub</div>,
}));

describe('main bootstrap', () => {
  afterEach(() => {
    readyHandlers.length = 0;
    roots.length = 0;
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('boots the React tree and registers the API-ready invalidate hook', async () => {
    const rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);

    await import('./main');

    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(rootEl);
    expect(readyHandlers).toHaveLength(1);

    // 触发 API 就绪回调，覆盖 queryClient.invalidateQueries()
    readyHandlers[0]?.();
  });
});
