// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemberCardQuoteDialog } from './MemberCardQuoteDialog';
import { apiRequest } from '../../lib/api';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

describe('MemberCardQuoteDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('submits a zero base total when the amount input is left empty', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ applied: true, total: 0, discount: 0, annualRemaining: 50000 });
    const showToast = vi.fn();
    render(<MemberCardQuoteDialog open cardId="mc-1" onClose={vi.fn()} showToast={showToast} />);
    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/mc-1/quote', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/member-cards/mc-1/quote');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({ baseTotal: 0 });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    const showToast = vi.fn();
    render(<MemberCardQuoteDialog open cardId="mc-1" onClose={vi.fn()} showToast={showToast} />);
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '-5' } });
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('请输入有效金额', 'error');
    });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('renders the no-discount message when the quote is not applicable', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ applied: false });
    render(<MemberCardQuoteDialog open cardId="mc-1" onClose={vi.fn()} showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '100' } });
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByText('该卡无折扣方案')).toBeDefined();
  });

  it('reports quote failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    const showToast = vi.fn();
    render(<MemberCardQuoteDialog open cardId="mc-1" onClose={vi.fn()} showToast={showToast} />);
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '100' } });
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('报价试算失败', 'error');
    });
  });
});
