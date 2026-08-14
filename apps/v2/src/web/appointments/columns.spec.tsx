// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { appointmentColumns } from './columns';
import type { AppointmentRow } from './types';

describe('appointments/columns', () => {
  afterEach(() => {
    cleanup();
  });

  function renderActions(overrides: { disabled?: boolean } = {}) {
    const onTransition = vi.fn();
    const columns = appointmentColumns({ onTransition, onEdit: vi.fn(), onDelete: vi.fn(), ...overrides });
    const actions = columns.find((entry) => entry.key === 'actions');
    render(<>{actions?.render?.({ id: 'a1', status: 'BOOKED' } as AppointmentRow)}</>);
    return { onTransition };
  }

  it('ignores status changes while the row actions are disabled', () => {
    const { onTransition } = renderActions({ disabled: true });
    fireEvent.change(screen.getByLabelText('变更预约状态'), { target: { value: 'ARRIVED' } });
    expect(onTransition).not.toHaveBeenCalled();
  });

  it('resets to the placeholder without transitioning when the placeholder is selected', () => {
    const { onTransition } = renderActions();
    fireEvent.change(screen.getByLabelText('变更预约状态'), { target: { value: '' } });
    expect(onTransition).not.toHaveBeenCalled();
  });

  it('forwards a non-empty status change to onTransition', () => {
    const { onTransition } = renderActions();
    fireEvent.change(screen.getByLabelText('变更预约状态'), { target: { value: 'ARRIVED' } });
    expect(onTransition).toHaveBeenCalledWith('a1', 'ARRIVED');
  });
});
