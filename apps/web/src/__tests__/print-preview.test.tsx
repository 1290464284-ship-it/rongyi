/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PrintPreviewPage from '@/modules/system/print/PrintPreviewPage';

vi.mock('@/lib/api/system/print', () => ({
  useTemplates: vi.fn(),
  useTemplate: vi.fn(),
  useUpdateTemplate: vi.fn(),
  useSetDefaultTemplate: vi.fn(),
  usePreviewTemplate: vi.fn(),
  useRenderPrescription: vi.fn(),
  useRenderReceipt: vi.fn(),
  useRenderTreatmentPlan: vi.fn(),
  useRenderClinicReport: vi.fn(),
  useRenderCephalometricReport: vi.fn(),
  getTemplates: vi.fn(),
  getTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  setDefault: vi.fn(),
  previewTemplate: vi.fn(),
  renderPrescription: vi.fn(),
  renderReceipt: vi.fn(),
  renderTreatmentPlan: vi.fn(),
  renderClinicReport: vi.fn(),
  renderCephalometricReport: vi.fn(),
}));

vi.mock('@/lib/utils/toast-service', () => ({
  toastService: {
    success: vi.fn(),
    error: vi.fn(),
    createError: vi.fn(),
    updateError: vi.fn(),
    deleteError: vi.fn(),
  },
}));

import {
  usePreviewTemplate,
  useRenderPrescription,
  useRenderReceipt,
  useRenderTreatmentPlan,
  useRenderClinicReport,
  useRenderCephalometricReport,
  useTemplates,
} from '@/lib/api/system/print';

function renderWithProviders(initialEntries: string[] = ['/print-preview']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <PrintPreviewPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SAMPLE_HTML =
  '<html><body><h1>测试打印内容</h1><p>这是一段示例HTML</p></body></html>';

const MOCK_TEMPLATES = [
  {
    id: '1',
    code: 'PRESCRIPTION',
    name: '标准处方笺模板',
    type: 'prescription' as const,
    paperSize: 'A4' as const,
    isDefault: true,
    content: '',
    createdAt: '2024-01-01',
  },
  {
    id: '2',
    code: 'RECEIPT_V1',
    name: '收费凭证模板',
    type: 'receipt' as const,
    paperSize: 'RECEIPT' as const,
    isDefault: true,
    content: '',
    createdAt: '2024-01-01',
  },
];

describe('PrintPreviewPage F16 打印预览页面', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (useTemplates as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: MOCK_TEMPLATES,
      isLoading: false,
    });

    const mockMutation = () => ({
      mutateAsync: vi.fn().mockResolvedValue(SAMPLE_HTML),
      isPending: false,
    });

    (usePreviewTemplate as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
    (useRenderReceipt as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
    (useRenderTreatmentPlan as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
    (useRenderClinicReport as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
    (useRenderCephalometricReport as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockMutation
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F16.1 默认打开 PrintPreviewPage（无 query）→ 渲染 5 个卡片入口', () => {
    renderWithProviders();

    expect(screen.getByText('打印预览')).toBeInTheDocument();
    expect(screen.getByText('处方笺')).toBeInTheDocument();
    expect(screen.getByText('收费凭证')).toBeInTheDocument();
    expect(screen.getByText('治疗计划')).toBeInTheDocument();
    expect(screen.getByText('诊所月报')).toBeInTheDocument();
    expect(screen.getByText('头影报告')).toBeInTheDocument();

    const cards = document.querySelectorAll('div.rounded-lg.border.border-border.bg-white.shadow-sm');
    expect(cards.length).toBeGreaterThanOrEqual(5);

    const cardTitles = ['处方笺', '收费凭证', '治疗计划', '诊所月报', '头影报告'];
    cardTitles.forEach((title) => {
      const heading = screen.getByText(title);
      const card = heading.closest('div.rounded-lg.border.border-border.bg-white.shadow-sm');
      expect(card).toBeInTheDocument();
    });
  });

  it('F16.2 ?type=template&code=PRESCRIPTION → 调用 previewTemplate，iframe srcdoc 注入 HTML 非空', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue(SAMPLE_HTML);
    (usePreviewTemplate as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    renderWithProviders(['/print-preview?type=template&code=PRESCRIPTION']);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        code: 'PRESCRIPTION',
        sampleContext: expect.any(Object),
      });
    });

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="print-preview"]');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('srcdoc');
      const srcdoc = iframe?.getAttribute('srcdoc') || '';
      expect(srcdoc.length).toBeGreaterThan(0);
      expect(srcdoc).toContain('测试打印内容');
    });
  });

  it('F16.3 SampleContext textarea 修改后点击「预览」→ POST 到 preview 带 sampleContext body', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue(SAMPLE_HTML);
    (usePreviewTemplate as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    renderWithProviders(['/print-preview?type=template&code=PRESCRIPTION']);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();

    const modifiedContext = JSON.stringify(
      {
        prescriptionSample: {
          patientName: '测试修改患者',
          patientAge: 99,
          patientGender: '女',
          diagnosis: '测试诊断',
          medicines: [],
          doctorName: '测试医生',
          date: '2024-08-02',
          clinicName: '测试诊所',
        },
      },
      null,
      2
    );

    fireEvent.change(textarea, { target: { value: modifiedContext } });

    const callCountBeforeClear = mockMutateAsync.mock.calls.length;
    mockMutateAsync.mockClear();

    const allPreviewButtons = screen.getAllByRole('button', { name: /预览/ });
    const bottomPreviewButton = allPreviewButtons[allPreviewButtons.length - 1];
    expect(bottomPreviewButton).toBeInTheDocument();
    fireEvent.click(bottomPreviewButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });

    const calls = mockMutateAsync.mock.calls;
    const lastCall = calls[calls.length - 1];
    const callArg = lastCall[0];
    expect(callArg).toMatchObject({
      code: 'PRESCRIPTION',
      sampleContext: {
        prescriptionSample: {
          patientName: '测试修改患者',
          patientAge: 99,
        },
      },
    });
  });

  it('F16.4 工具条「打印」按钮 → 调用 window.print() 1 次（spy）', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue(SAMPLE_HTML);
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    renderWithProviders(['/print-preview?type=prescription&id=RX001']);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith('RX001');
    });

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="print-preview"]');
      expect(iframe).toBeInTheDocument();
      const srcdoc = iframe?.getAttribute('srcdoc') || '';
      expect(srcdoc.length).toBeGreaterThan(0);
    });

    const printButton = screen.getByRole('button', { name: /打印$/ });
    expect(printButton).toBeInTheDocument();
    expect(printButton).not.toBeDisabled();

    fireEvent.click(printButton);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('F16.5 工具条「下载」→ Blob 下载 + 文件名 prescription-xxx.html 正确', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue(SAMPLE_HTML);
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    const createElementSpy = vi.spyOn(document, 'createElement');
    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:http://localhost/test-blob-url');
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    renderWithProviders(['/print-preview?type=prescription&id=RX001']);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith('RX001');
    });

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="print-preview"]');
      expect(iframe).toBeInTheDocument();
      const srcdoc = iframe?.getAttribute('srcdoc') || '';
      expect(srcdoc.length).toBeGreaterThan(0);
    });

    const downloadButton = screen.getByRole('button', { name: /下载 HTML/ });
    expect(downloadButton).toBeInTheDocument();
    expect(downloadButton).not.toBeDisabled();

    fireEvent.click(downloadButton);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    const mockAnchorCalls = createElementSpy.mock.results.filter(
      (r) => r.value.tagName === 'A'
    );
    expect(mockAnchorCalls.length).toBeGreaterThan(0);
    const anchor = mockAnchorCalls[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('prescription-RX001.html');

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('F16.6 A4/A5 切换 → 预览容器 class 变化 a4-preview → a5-preview', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue(SAMPLE_HTML);
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    renderWithProviders(['/print-preview?type=prescription&id=RX001']);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith('RX001');
    });

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="print-preview"]');
      expect(iframe).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(document.querySelector('.a4-preview')).toBeInTheDocument();
    });
    expect(document.querySelector('.a5-preview')).not.toBeInTheDocument();

    const allSelects = screen.getAllByRole('combobox');
    const paperSelect = allSelects.find(sel => {
      const options = Array.from((sel as HTMLSelectElement).options);
      return options.some(opt => opt.value === 'A4') &&
             options.some(opt => opt.value === 'A5');
    });
    expect(paperSelect).toBeDefined();
    expect(paperSelect).toBeInTheDocument();

    fireEvent.change(paperSelect!, { target: { value: 'A5' } });

    await waitFor(() => {
      const a5Container = document.querySelector('.a5-preview');
      expect(a5Container).toBeInTheDocument();
    });

    expect(document.querySelector('.a4-preview')).not.toBeInTheDocument();
  });

  it('F16.7 接口 500 → 显示错误 Alert，包含具体错误信息，不 crash', async () => {
    const errorMessage = '数据库连接失败，无法加载处方数据';
    const mockMutateAsync = vi
      .fn()
      .mockRejectedValue({
        response: {
          status: 500,
          data: { message: errorMessage },
        },
        message: 'Request failed with status code 500',
      });
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    expect(() => {
      renderWithProviders(['/print-preview?type=prescription&id=RX001']);
    }).not.toThrow();

    await waitFor(() => {
      const alertContainer = screen.getByText(errorMessage);
      expect(alertContainer).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();

    expect(
      screen.queryByText('正在生成预览...')
    ).not.toBeInTheDocument();
  });

  it('F16.8 无权限 403 → 显示「权限不足，无法打印」提示', async () => {
    const mockMutateAsync = vi
      .fn()
      .mockRejectedValue({
        response: { status: 403 },
        message: 'Request failed with status code 403',
      });
    (useRenderPrescription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    renderWithProviders(['/print-preview?type=prescription&id=RX001']);

    await waitFor(() => {
      expect(
        screen.getByText('权限不足，无法打印')
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });
});
