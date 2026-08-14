// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProcessingSettleDialog } from './ProcessingSettleDialog';
import { apiRequest } from '../../lib/api';
import type { ProcessingRow } from '../../processing-orders/types';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

describe('ProcessingSettleDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('guards against duplicate settles while one is pending', async () => {
    let resolveSettle: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => { resolveSettle = resolve; }));
    const onSettled = vi.fn();
    render(
      <ProcessingSettleDialog
        target={{ id: 'proc-1', totalFee: 1000 } as ProcessingRow}
        reload={vi.fn().mockResolvedValue(undefined)}
        onSettled={onSettled}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />,
    );
    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/processing-orders/proc-1/settle');
      expect(calls).toHaveLength(1);
    });
    resolveSettle({ ok: true });
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalled();
    });
  });

  it('validates an empty settle amount', async () => {
    const showToast = vi.fn();
    render(
      <ProcessingSettleDialog
        target={{ id: 'proc-1', totalFee: null } as unknown as ProcessingRow}
        reload={vi.fn()}
        onSettled={vi.fn()}
        onClose={vi.fn()}
        showToast={showToast}
      />,
    );
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('请输入有效的结算金额（需大于 0）', 'error');
    });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('reports settle failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    const showToast = vi.fn();
    render(
      <ProcessingSettleDialog
        target={{ id: 'proc-1', totalFee: 1000 } as ProcessingRow}
        reload={vi.fn().mockResolvedValue(undefined)}
        onSettled={vi.fn()}
        onClose={vi.fn()}
        showToast={showToast}
      />,
    );
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('结算失败', 'error');
    });
  });
});
