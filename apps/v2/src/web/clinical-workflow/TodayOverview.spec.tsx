// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayOverview } from './TodayOverview';

describe('TodayOverview', () => {
  it('renders totals, truncated notices, unknown statuses, and null field fallbacks', () => {
    render(<TodayOverview
      data={{
        date: '2026-08-05',
        totals: { registrations: 2, appointments: 1, inProgressVisits: 0 },
        truncated: { registrations: true, appointments: true },
        registrations: [{ id: 'r1', patientId: 'p1', status: 'WEIRD', registeredAt: null }],
        appointments: [{ id: 'a1', patientName: '患者甲', doctorId: 'd1', status: null, startTime: null }],
      }}
    />);
    expect(screen.getByText('WEIRD')).toBeDefined();
    expect(screen.getByText('未分配医生')).toBeDefined();
    expect(screen.getByText(/挂号超过 100 条/)).toBeDefined();
    expect(screen.getByText(/预约超过 100 条/)).toBeDefined();
    expect(screen.getByText(/2026-08-05/)).toBeDefined();
  });

  it('renders empty lists when data is missing', () => {
    render(<TodayOverview data={null} />);
    expect(screen.getByText('今日暂无挂号')).toBeDefined();
    expect(screen.getByText('今日暂无预约')).toBeDefined();
  });
});
