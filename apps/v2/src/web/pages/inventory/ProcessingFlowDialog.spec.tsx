// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProcessingFlowDialog } from './ProcessingFlowDialog';
import type { ProcessingOrderStepRow, ProcessingRow } from '../../processing-orders/types';

describe('ProcessingFlowDialog', () => {
  afterEach(() => cleanup());

  const target = { id: 'proc-1', number: 'PO-001' } as ProcessingRow;

  function step(status: string): ProcessingOrderStepRow {
    return {
      id: 'step-1',
      stepName: '打磨',
      status: status as ProcessingOrderStepRow['status'],
      sortOrder: 1,
    };
  }

  function renderDialog(overrides: Partial<Parameters<typeof ProcessingFlowDialog>[0]> = {}) {
    return render(
      <ProcessingFlowDialog
        target={target}
        steps={[step('PENDING')]}
        loading={false}
        busy={false}
        error={null}
        onClose={vi.fn()}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        {...overrides}
      />,
    );
  }

  it('falls back to the raw status for unknown step statuses', () => {
    renderDialog({ steps: [step('WEIRD')] });
    expect(screen.getByText('WEIRD')).toBeDefined();
  });

  it('renders loading and error states', () => {
    const { rerender } = renderDialog({ steps: [], loading: true });
    expect(screen.getByText('流程加载中...')).toBeDefined();

    rerender(
      <ProcessingFlowDialog
        target={target}
        steps={[]}
        loading={false}
        busy={false}
        error="加载失败"
        onClose={vi.fn()}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText('加载失败')).toBeDefined();
  });

  it('advances the flow and adjusts a step status', () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onAdvance, onAdjust });
    fireEvent.click(screen.getByRole('button', { name: '推进' }));
    expect(onAdvance).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('调整打磨'), { target: { value: 'DONE' } });
    expect(onAdjust).toHaveBeenCalled();
  });
});
