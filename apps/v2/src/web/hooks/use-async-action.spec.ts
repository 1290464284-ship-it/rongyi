// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsyncAction } from './use-async-action';

describe('useAsyncAction', () => {
  it('guards concurrent runs and resets busy state', async () => {
    let resolveAction: ((value: string) => void) | undefined;
    const { result } = renderHook(() => useAsyncAction());

    let first: Promise<string | undefined> | undefined;
    act(() => {
      first = result.current.run(() => new Promise<string>((resolve) => { resolveAction = resolve; }));
    });
    expect(result.current.busy).toBe(true);

    let second: Promise<string | undefined> | undefined;
    act(() => {
      second = result.current.run(() => Promise.resolve('second'));
    });
    await expect(second).resolves.toBeUndefined();

    await act(async () => {
      resolveAction?.('first');
      await expect(first).resolves.toBe('first');
    });
    expect(result.current.busy).toBe(false);
  });
});
