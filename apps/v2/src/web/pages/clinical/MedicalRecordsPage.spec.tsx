// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MedicalRecordsPage } from './MedicalRecordsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/medicalRecords?page=1&pageSize=50') {
      return {
        items: [
          {
            id: 'r-1',
            patientId: 'p-1',
            doctorId: 'd-1',
            category: 'GENERAL',
            diagnosis: '龋齿',
            status: 'DRAFT',
            editRequestStatus: 'PENDING',
            editRequestReason: '诊断有误',
            proposedContentJson: JSON.stringify({ diagnosis: '龋齿修正', teethInvolved: ['11'] }),
          },
          {
            id: 'r-2',
            patientId: 'p-2',
            doctorId: 'd-1',
            category: 'GENERAL',
            diagnosis: '牙髓炎',
            status: null,
            editRequestStatus: 'NONE',
            teethInvolved: ['11', '21'],
            images: ['a.jpg', 'b.jpg'],
          },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
      };
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

  it('submits an edit request with proposed content', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    await waitFor(() => {
      expect(screen.getByLabelText('修改原因')).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText('修改原因'), { target: { value: '诊断有误，请修正' } });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿（修正）' } });
    fireEvent.click(screen.getByText('提交申请'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/medical-records/r-1/edit-request', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/medical-records/r-1/edit-request');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      reason: '诊断有误，请修正',
      proposedContent: { diagnosis: '龋齿（修正）' },
    });
    expect(await screen.findByText('修改申请已提交')).toBeDefined();
  });

  it('reviews a pending edit request and approves it', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getByText('审核'));
    expect(await screen.findByText('申请原因：诊断有误')).toBeDefined();
    expect(screen.getByText('diagnosis: 龋齿修正')).toBeDefined();
    expect(screen.getByText('teethInvolved: 11')).toBeDefined();

    fireEvent.click(screen.getByText('通过'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/medical-records/r-1/edit-request/review', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/medical-records/r-1/edit-request/review');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ approve: true });
    expect(await screen.findByText('已通过修改申请')).toBeDefined();
  });

  it('rejects a pending edit request with a review note', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getByText('审核'));
    fireEvent.change(screen.getByLabelText('审核意见'), { target: { value: '证据不足' } });
    fireEvent.click(screen.getByText('驳回'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/medical-records/r-1/edit-request/review', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/medical-records/r-1/edit-request/review' && (options as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ approve: false, reviewNote: '证据不足' });
    expect(await screen.findByText('已驳回修改申请')).toBeDefined();
  });

  it('requires a reason before submitting an edit request', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    fireEvent.click(screen.getByText('提交申请'));

    expect(await screen.findByText('请填写修改原因')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/medical-records/r-1/edit-request',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders the review button only for pending edit requests', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');
    expect(screen.getAllByText('申请修改').length).toBe(2);
    expect(screen.getAllByText('审核').length).toBe(1);
  });

  it('edits a medical record with a prefilled form', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('编辑')[0]);
    await waitFor(() => {
      expect((screen.getByLabelText('诊断') as HTMLTextAreaElement).value).toBe('龋齿');
    });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿（更新）' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'r-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/medicalRecords/r-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/medicalRecords/r-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ patientId: 'p-1', doctorId: 'd-1', diagnosis: '龋齿（更新）' });
    expect(await screen.findByText('病历已更新')).toBeDefined();
  });

  it('deletes a medical record after confirmation', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('删除')[0]);
    fireEvent.click(await screen.findByText('确认删除'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/medicalRecords/r-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('病历已删除')).toBeDefined();
  });

  it('prefills an edit request with arrays and a fallback status', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('牙髓炎');

    fireEvent.click(screen.getAllByText('申请修改')[1]);
    await waitFor(() => {
      expect((screen.getByLabelText('涉及牙位（逗号分隔）') as HTMLInputElement).value).toBe('11, 21');
    });
    expect((screen.getByLabelText('图片 URL（逗号分隔）') as HTMLInputElement).value).toBe('a.jpg, b.jpg');
    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('DRAFT');
  });

  it('shows an error toast when the edit request fails', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/medical-records/r-1/edit-request') throw new Error('');
      return base?.(path, init);
    });
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    await screen.findByLabelText('修改原因');
    fireEvent.change(screen.getByLabelText('修改原因'), { target: { value: '需要修正' } });
    fireEvent.click(screen.getByText('提交申请'));
    expect(await screen.findByText('提交失败')).toBeDefined();
  });

  it('shows an error toast when the review fails', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/medical-records/r-1/edit-request/review') throw new Error('');
      return base?.(path, init);
    });
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getByText('审核'));
    await screen.findByText('申请原因：诊断有误');
    fireEvent.click(screen.getByText('通过'));
    expect(await screen.findByText('审核失败')).toBeDefined();
  });

  it('cancels the edit request dialog', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    await screen.findByLabelText('修改原因');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('修改原因')).toBeNull();
    });
  });

  it('reports create, update and delete failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/resources/medicalRecords') throw new Error('');
      if (method === 'PATCH' && path === '/resources/medicalRecords/r-1') throw new Error('');
      if (method === 'DELETE' && path === '/resources/medicalRecords/r-1') throw new Error('');
      return base?.(path, init);
    });
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getByText('新建病历'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建病历失败')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getAllByText('编辑')[0]);
    await screen.findByLabelText('诊断');
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿（更新）' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('更新病历失败')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getAllByText('删除')[0]);
    fireEvent.click(await screen.findByText('确认删除'));
    expect(await screen.findByText('删除病历失败')).toBeDefined();
  });

  it('submits an edit request with every field changed', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[1]);
    await screen.findByLabelText('修改原因');
    fireEvent.change(screen.getByLabelText('修改原因'), { target: { value: '补充完整信息' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'ORTHO' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'APPROVED' } });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '主诉更新' } });
    fireEvent.change(screen.getByLabelText('现病史'), { target: { value: '现病史更新' } });
    fireEvent.change(screen.getByLabelText('既往史'), { target: { value: '既往史更新' } });
    fireEvent.change(screen.getByLabelText('过敏史'), { target: { value: '过敏史更新' } });
    fireEvent.change(screen.getByLabelText('检查所见'), { target: { value: '检查所见更新' } });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '诊断更新' } });
    fireEvent.change(screen.getByLabelText('治疗计划'), { target: { value: '治疗计划更新' } });
    fireEvent.change(screen.getByLabelText('涉及牙位（逗号分隔）'), { target: { value: '12, 22' } });
    fireEvent.change(screen.getByLabelText('图片 URL（逗号分隔）'), { target: { value: 'c.jpg, d.jpg' } });
    fireEvent.change(screen.getByLabelText('签名'), { target: { value: '张医生' } });
    fireEvent.click(screen.getByText('提交申请'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/medical-records/r-2/edit-request', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/medical-records/r-2/edit-request');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.proposedContent).toMatchObject({
      category: 'ORTHO',
      status: 'APPROVED',
      chiefComplaint: '主诉更新',
      presentIllness: '现病史更新',
      pastHistory: '既往史更新',
      allergyHistory: '过敏史更新',
      examination: '检查所见更新',
      diagnosis: '诊断更新',
      treatmentPlan: '治疗计划更新',
      teethInvolved: ['12', '22'],
      images: ['c.jpg', 'd.jpg'],
      signature: '张医生',
    });
    expect(await screen.findByText('修改申请已提交')).toBeDefined();
  });

  it('closes the edit and review dialogs through their close paths', async () => {
    mockData();
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    await screen.findByLabelText('修改原因');
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('修改原因')).toBeNull();
    });

    fireEvent.click(screen.getByText('审核'));
    await screen.findByText('申请原因：诊断有误');
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('申请原因：诊断有误')).toBeNull();
    });

    fireEvent.click(screen.getByText('审核'));
    await screen.findByText('申请原因：诊断有误');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByText('申请原因：诊断有误')).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/medical-records/r-1/edit-request/review', expect.anything());
  });

  it('ignores a second submit while the edit request is in flight', async () => {
    mockData();
    let resolveRequest: (value: unknown) => void = () => undefined;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/medical-records/r-1/edit-request') {
        return await new Promise((resolve) => { resolveRequest = resolve; });
      }
      return base?.(path, init);
    });
    render(<MedicalRecordsPage />, { wrapper });
    await screen.findByText('龋齿');

    fireEvent.click(screen.getAllByText('申请修改')[0]);
    await screen.findByLabelText('修改原因');
    fireEvent.change(screen.getByLabelText('修改原因'), { target: { value: '需要修正' } });
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const editCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/medical-records/r-1/edit-request' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(editCalls).toHaveLength(1);
    resolveRequest({ id: 'r-1' });
    expect(await screen.findByText('修改申请已提交')).toBeDefined();
  });

  it('renders doctor fallback ids when names are missing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/medicalRecords?page=1&pageSize=50') {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-9' }];
      if (path === '/resources/visits?page=1&pageSize=100') {
        return { items: [{ id: 'v-1' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<MedicalRecordsPage />, { wrapper });
    fireEvent.click(await screen.findByText('新建病历'));
    await waitFor(() => {
      const options = Array.from((screen.getByLabelText('医生') as HTMLSelectElement).options).map((option) => option.textContent);
      expect(options).toContain('d-9');
    });
  });
});
