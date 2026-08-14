// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TodayOverview } from './TodayOverview';

describe('TodayOverview', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('falls back to an empty status label for null registration statuses', () => {
    render(
      <TodayOverview
        data={{
          totals: { registrations: 1, appointments: 0, inProgressVisits: 0 },
          registrations: [{ id: 'r1', patientName: '患者甲', status: null, registeredAt: '2026-08-05T00:00:00.000Z' }],
          appointments: [],
        }}
      />,
    );
    expect(screen.getByText('患者甲')).toBeDefined();
    expect(screen.getByText('今日暂无预约')).toBeDefined();
  });
});
