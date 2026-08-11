// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordFormFields } from './RecordFormFields';
import { apiRequest } from '../lib/api';
import { emptyForm, type RecordForm } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/doctors') return [{ id: 'doc-1', name: '张医生' }];
    if (path === '/resources/visits?page=1&pageSize=100') {
      return { items: [{ id: 'visit-1' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path.startsWith('/resources/patients?')) {
      return { items: [{ id: 'patient-1', name: '李患者' }], total: 1, page: 1, pageSize: 100 };
    }
    return {};
  });
}

describe('RecordFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders doctor and visit options and updates every editable field', async () => {
    mockApi();
    let form: RecordForm = { ...emptyForm, patientId: 'patient-1' };
    const update = vi.fn((patch: Partial<RecordForm>) => {
      form = { ...form, ...patch };
    });
    render(<RecordFormFields form={form} update={update} />, { wrapper });

    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('doc-1');
      expect((screen.getByRole('option', { name: 'visit-1' }) as HTMLOptionElement).value).toBe('visit-1');
    });

    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'doc-1' } });
    expect(update).toHaveBeenCalledWith({ doctorId: 'doc-1' });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '初诊' } });
    expect(update).toHaveBeenCalledWith({ category: '初诊' });
    fireEvent.click(screen.getByLabelText('作为模板'));
    expect(update).toHaveBeenCalledWith({ isTemplate: true });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿' } });
    expect(update).toHaveBeenCalledWith({ diagnosis: '龋齿' });
  });

  it('renders empty states when lookups return no data', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    const update = vi.fn();
    render(<RecordFormFields form={emptyForm} update={update} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBe(1);
    });
    expect(screen.getByLabelText('诊断')).toBeDefined();
  });

  it('updates every remaining editable field', async () => {
    mockApi();
    let form: RecordForm = { ...emptyForm, patientId: 'patient-1' };
    const update = vi.fn((patch: Partial<RecordForm>) => {
      form = { ...form, ...patch };
    });
    render(<RecordFormFields form={form} update={update} />, { wrapper });

    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('doc-1');
    });

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    expect(update).toHaveBeenCalledWith({ patientId: 'patient-1' });
    fireEvent.change(screen.getByLabelText('关联就诊'), { target: { value: 'visit-1' } });
    expect(update).toHaveBeenCalledWith({ visitId: 'visit-1' });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '初诊' } });
    expect(update).toHaveBeenCalledWith({ category: '初诊' });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'SUBMITTED' } });
    expect(update).toHaveBeenCalledWith({ status: 'SUBMITTED' });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '牙痛三天' } });
    expect(update).toHaveBeenCalledWith({ chiefComplaint: '牙痛三天' });
    fireEvent.change(screen.getByLabelText('现病史'), { target: { value: '夜间加重' } });
    expect(update).toHaveBeenCalledWith({ presentIllness: '夜间加重' });
    fireEvent.change(screen.getByLabelText('既往史'), { target: { value: '无' } });
    expect(update).toHaveBeenCalledWith({ pastHistory: '无' });
    fireEvent.change(screen.getByLabelText('过敏史'), { target: { value: '青霉素' } });
    expect(update).toHaveBeenCalledWith({ allergyHistory: '青霉素' });
    fireEvent.change(screen.getByLabelText('检查所见'), { target: { value: '深龋' } });
    expect(update).toHaveBeenCalledWith({ examination: '深龋' });
    fireEvent.change(screen.getByLabelText('治疗计划'), { target: { value: '充填' } });
    expect(update).toHaveBeenCalledWith({ treatmentPlan: '充填' });
    fireEvent.change(screen.getByLabelText(/涉及牙位/), { target: { value: '16' } });
    expect(update).toHaveBeenCalledWith({ teethInvolved: '16' });
    fireEvent.change(screen.getByLabelText(/图片 URL/), { target: { value: 'a.jpg' } });
    expect(update).toHaveBeenCalledWith({ images: 'a.jpg' });
    fireEvent.change(screen.getByLabelText('签名'), { target: { value: '张医生' } });
    expect(update).toHaveBeenCalledWith({ signature: '张医生' });
  });
});
