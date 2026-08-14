// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewRowActions } from './ReviewRowActions';
import { reviewAction } from './api';
import type { PurchaseRow } from './types';

vi.mock('./api', () => ({ reviewAction: vi.fn() }));

function makeRow(reviewStatus = 'PENDING'): PurchaseRow {
  return { id: 'po-1', reviewStatus } as unknown as PurchaseRow;
}

function renderActions(reviewStatus = 'PENDING') {
  return render(
    <ReviewRowActions
      row={makeRow(reviewStatus)}
      reviewing={false}
      setReviewing={vi.fn()}
      reload={vi.fn()}
      showToast={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

describe('ReviewRowActions', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(reviewAction).mockReset();
  });

  it('guards against a second review click while one is in flight', async () => {
    let resolveAction: (() => void) | undefined;
    vi.mocked(reviewAction).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveAction = resolve;
      });
    });
    renderActions('PENDING');
    const submit = screen.getByRole('button', { name: '提交审核' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(reviewAction).toHaveBeenCalledTimes(1);
    resolveAction?.();
    await waitFor(() => expect(reviewAction).toHaveBeenCalledTimes(1));
  });

  it('submits rejection through the guarded entry', async () => {
    vi.mocked(reviewAction).mockResolvedValue(undefined);
    renderActions('SUBMITTED');
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    const input = await screen.findByPlaceholderText('驳回原因');
    fireEvent.change(input, { target: { value: '缺货' } });
    fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
    await waitFor(() => {
      expect(reviewAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'po-1',
        'reject',
        '已驳回',
        { reason: '缺货' },
      );
    });
  });
});
