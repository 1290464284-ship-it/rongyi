// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientsPage } from './PatientsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

function renderPatientsAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><PatientsPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const patientList = {
  items: [{
    id: 'p1',
    code: 'P001',
    name: '张三',
    gender: 'MALE',
    phone: '13800000000',
    wechatId: 'wx_zhang',
    preferredContact: 'WECHAT',
    contactNote: '下午联系',
    birthDate: '1990-01-01',
    source: 'WALK_IN',
    active: true,
    allergies: ['青霉素'],
  }],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe('PatientsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists patients and creates a new patient after duplicate checks', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ ...patientList, total: 2 });
    render(<PatientsPage />, { wrapper });
    expect(await screen.findByText('张三')).toBeDefined();

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P002' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李四' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13900000000' } });
    fireEvent.change(screen.getByLabelText('微信号'), { target: { value: 'wx_lisi' } });
    fireEvent.change(screen.getByLabelText('首选联系方式'), { target: { value: 'WECHAT' } });
    fireEvent.change(screen.getByLabelText('联系方式备注'), { target: { value: '周末联系' } });
    fireEvent.change(screen.getByLabelText('过敏史（每行一条）'), { target: { value: '花生\n鸡蛋' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      code: 'P002',
      name: '李四',
      phone: '13900000000',
      wechatId: 'wx_lisi',
      preferredContact: 'WECHAT',
      contactNote: '周末联系',
      allergies: ['花生', '鸡蛋'],
      active: true,
      source: 'WALK_IN',
    });
    expect(await screen.findByText('患者档案已创建')).toBeDefined();
  });

  it('blocks duplicate phone or code before saving', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P001' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '重复' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('手机号或患者编号已存在，请检查后重试')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
  });

  it('edits and deletes a patient', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      // 编辑打开时 onEditLoad 从详情接口拉取完整值（列表 idCard 已掩码）
      .mockResolvedValueOnce({ ...patientList.items[0], idCard: '110101199001011234' })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    // 详情加载完成后按钮才从「加载中...」恢复为「保存」
    fireEvent.change(await screen.findByLabelText('姓名'), { target: { value: '张三改' } });
    expect((screen.getByLabelText('身份证号') as HTMLInputElement).value).toBe('110101199001011234');
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    const updateCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/resources/patients/p1' && (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
      name: '张三改',
      phone: '13800000000',
      allergies: ['青霉素'],
    });
    expect(await screen.findByText('患者档案已更新')).toBeDefined();

    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('患者档案已删除')).toBeDefined();
  });

  it('prefills multiline fields when editing', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ ...patientList.items[0], idCard: '110101199001011234' })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    await screen.findByText('保存');
    expect((screen.getByLabelText('过敏史（每行一条）') as HTMLTextAreaElement).value).toBe('青霉素');
    expect((screen.getByLabelText('患者编号') as HTMLInputElement).value).toBe('P001');
    fireEvent.change(screen.getByLabelText('过敏史（每行一条）'), { target: { value: '青霉素\n阿司匹林' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    const updateCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/resources/patients/p1' && (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
      allergies: ['青霉素', '阿司匹林'],
    });
    expect(await screen.findByText('患者档案已更新')).toBeDefined();
  });

  it('excludes the edited patient from duplicate checks', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ ...patientList.items[0], idCard: '110101199001011234' })
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    await screen.findByText('保存');
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(screen.queryByText('手机号或患者编号已存在，请检查后重试')).toBeNull();
    expect(await screen.findByText('患者档案已更新')).toBeDefined();
  });

  it('reads the initial search from the URL query', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(patientList);
    renderPatientsAt(['/?q=张三']);

    expect(await screen.findByText('张三')).toBeDefined();
    expect((screen.getByLabelText('搜索患者') as HTMLInputElement).value).toBe('张三');
  });

  it('does not delete when the confirmation is cancelled', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(patientList);
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('取消'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows an error when the duplicate check fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockRejectedValueOnce(new Error('check failed'));
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P099' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '测试' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13900000099' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/patients',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submits every remaining patient form field', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ ...patientList, total: 2 });
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P010' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '王五' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13700000000' } });
    fireEvent.change(screen.getByLabelText('性别'), { target: { value: 'FEMALE' } });
    fireEvent.change(screen.getByLabelText('出生日期'), { target: { value: '1992-02-03' } });
    fireEvent.change(screen.getByLabelText('身份证号'), { target: { value: 'ID-1' } });
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: '上海' } });
    fireEvent.change(screen.getByLabelText('职业'), { target: { value: '教师' } });
    fireEvent.change(screen.getByLabelText('来源'), { target: { value: 'ONLINE' } });
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: '/avatar.png' } });
    fireEvent.change(screen.getByLabelText('过敏史（每行一条）'), { target: { value: '花生\n鸡蛋' } });
    fireEvent.change(screen.getByLabelText('既往病史（每行一条）'), { target: { value: '糖尿病\n高血压' } });
    fireEvent.change(screen.getByLabelText('用药史（每行一条）'), { target: { value: '阿司匹林' } });
    fireEvent.change(screen.getByLabelText('全身疾病（每行一条）'), { target: { value: '糖尿病' } });
    fireEvent.change(screen.getByLabelText('标签（每行一条）'), { target: { value: 'VIP,老客户' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '每周复诊' } });
    fireEvent.click(screen.getByLabelText('启用档案'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      code: 'P010',
      name: '王五',
      gender: 'FEMALE',
      phone: '13700000000',
      birthDate: '1992-02-03',
      idCard: 'ID-1',
      address: '上海',
      occupation: '教师',
      source: 'ONLINE',
      avatar: '/avatar.png',
      allergies: ['花生', '鸡蛋'],
      medicalHistory: ['糖尿病', '高血压'],
      medicationHistory: ['阿司匹林'],
      systemicDiseases: ['糖尿病'],
      tags: ['VIP', '老客户'],
      remark: '每周复诊',
      active: false,
    });
    expect(await screen.findByText('患者档案已创建')).toBeDefined();
  });

  it('shows the save fallback when the duplicate check fails with an empty message', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockRejectedValueOnce(new Error(''));
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P099' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '测试' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('保存失败')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/patients',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders fallback labels for unknown gender, contact, source and inactive patients', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [{
        id: 'p-x',
        code: 'P-X',
        name: '特殊',
        gender: 'X',
        preferredContact: 'FAX',
        source: 'IMPORT',
        active: false,
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPatientsAt(['/']);
    expect(await screen.findByText('特殊')).toBeDefined();
    expect(screen.getByText('X')).toBeDefined();
    expect(screen.getByText('FAX')).toBeDefined();
    expect(screen.getByText('IMPORT')).toBeDefined();
    expect(screen.getByText('否')).toBeDefined();
  });

  it('skips the duplicate check when neither phone nor code is provided', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ ...patientList, total: 2 });
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '无名氏' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
    });
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('pageSize=10'), expect.anything());
    expect(await screen.findByText('患者档案已创建')).toBeDefined();
  });

  it('blocks duplicates by code alone and joins string allergy history', async () => {
    const stringPatient = {
      ...patientList.items[0],
      allergies: '青霉素,阿司匹林',
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: [stringPatient], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [stringPatient], total: 1, page: 1, pageSize: 10 });
    renderPatientsAt(['/']);
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P001' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '重复' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('手机号或患者编号已存在，请检查后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByText('编辑'));
    expect((screen.getByLabelText('过敏史（每行一条）') as HTMLTextAreaElement).value).toBe('青霉素,阿司匹林');
  });

  it('renders unknown gender, contact and source labels with inactive status', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [{
        id: 'p9',
        code: 'C9',
        name: '未知患者',
        gender: 'X',
        preferredContact: undefined,
        source: 'X',
        active: false,
        phone: null,
        wechatId: null,
        birthDate: null,
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<PatientsPage />, { wrapper });
    expect(await screen.findByText('未知患者')).toBeDefined();
    expect(screen.getAllByText('X')).toHaveLength(2);
    expect(screen.getAllByText('电话').length).toBeGreaterThan(1);
    expect(screen.getByText('否')).toBeDefined();
  });

  it('edits a sparse patient with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [{
        id: 'p9',
        code: null,
        name: null,
        gender: null,
        phone: null,
        wechatId: null,
        preferredContact: null,
        contactNote: null,
        birthDate: null,
        idCard: null,
        address: null,
        occupation: null,
        source: null,
        active: null,
        avatar: null,
        allergies: null,
        medicalHistory: null,
        medicationHistory: null,
        systemicDiseases: null,
        tags: null,
        remark: null,
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<PatientsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('患者编号') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('性别') as HTMLSelectElement).value).toBe('UNKNOWN');
    expect((screen.getByLabelText('来源') as HTMLSelectElement).value).toBe('WALK_IN');
    expect((screen.getByLabelText('启用档案') as HTMLInputElement).checked).toBe(false);
  });
});
