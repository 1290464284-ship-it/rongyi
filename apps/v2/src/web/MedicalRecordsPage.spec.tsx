// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MedicalRecordsPage } from './MedicalRecordsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/medicalRecords?page=1&pageSize=50') {
      return { items: [{ id: 'r-1', patientId: 'p-1', doctorId: 'd-1', category: 'GENERAL', diagnosis: '龋齿', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    if (path === '/resources/visits?page=1&pageSize=100') {
      return { items: [{ id: 'v-1' }], total: 1, page: 1, pageSize: 100 };
    }
    return {};
  });
}

describe('MedicalRecordsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists and creates medical records with a linked visit', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    expect(await screen.findByText('龋齿')).toBeDefined();

    fireEvent.click(screen.getByText('新建病历'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('关联就诊'), { target: { value: 'v-1' } });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '牙周炎' } });
    fireEvent.change(screen.getByLabelText('涉及牙位（逗号分隔）'), { target: { value: '11, 21' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'r-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/medicalRecords', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/medicalRecords');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      visitId: 'v-1',
      diagnosis: '牙周炎',
      teethInvolved: ['11', '21'],
      isTemplate: false,
      status: 'DRAFT',
    });
    expect(await screen.findByText('病历已创建')).toBeDefined();
  });

  it('validates required fields', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');
    fireEvent.click(screen.getByText('新建病历'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者和医生')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/medicalRecords', expect.objectContaining({ method: 'POST' }));
  });
});
