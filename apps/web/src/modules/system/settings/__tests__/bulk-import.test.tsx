/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCSV, toObjects, detectDelimiter } from '@/lib/utils/csv-parser';

describe('F15.1 parseCSV 基础解析', () => {
  it('解析 "a,b\\n1,2\\n3,4" → 3 行 2 列正确', () => {
    const result = parseCSV('a,b\n1,2\n3,4');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['a', 'b']);
    expect(result[1]).toEqual(['1', '2']);
    expect(result[2]).toEqual(['3', '4']);
  });

  it('处理 \\r\\n 换行符', () => {
    const result = parseCSV('a,b\r\n1,2\r\n3,4');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['a', 'b']);
    expect(result[1]).toEqual(['1', '2']);
    expect(result[2]).toEqual(['3', '4']);
  });
});

describe('F15.2 parseCSV 引号处理', () => {
  it('处理引号 \'"a,b",c\\n"x""y",z\' → 第一行 [\'a,b\',\'c\']；第二行 [\'x"y\',\'z\']', () => {
    const result = parseCSV('"a,b",c\n"x""y",z');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['a,b', 'c']);
    expect(result[1]).toEqual(['x"y', 'z']);
  });

  it('处理字段内换行', () => {
    const result = parseCSV('"line1\nline2",value');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['line1\nline2', 'value']);
  });
});

describe('F15.3 parseCSV 空文件', () => {
  it('空文件 → [[]]，不 crash', () => {
    expect(parseCSV('')).toEqual([[]]);
  });

  it('仅空白字符串', () => {
    expect(parseCSV('   ')).toEqual([['   ']]);
  });
});

describe('TSV 解析与 delimiter 检测', () => {
  it('parseCSV 支持 Tab 分隔符', () => {
    const result = parseCSV('a\tb\n1\t2', '\t');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['a', 'b']);
    expect(result[1]).toEqual(['1', '2']);
  });

  it('detectDelimiter 正确识别 .tsv', () => {
    expect(detectDelimiter('data.tsv')).toBe('\t');
    expect(detectDelimiter('data.csv')).toBe(',');
    expect(detectDelimiter('data.txt')).toBe(',');
    expect(detectDelimiter('DATA.TSV')).toBe('\t');
  });
});

describe('toObjects 列映射', () => {
  it('将 header + rows 转为对象数组', () => {
    const header = ['name', 'age'];
    const rows = [
      ['Alice', '30'],
      ['Bob', '25'],
    ];
    const result = toObjects(header, rows);
    expect(result).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('缺失列填充为空字符串', () => {
    const header = ['a', 'b', 'c'];
    const rows = [['1']];
    const result = toObjects(header, rows);
    expect(result[0]).toEqual({ a: '1', b: '', c: '' });
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

const mockGetTemplate = vi.fn();
const mockRunImport = vi.fn();

vi.mock('@/lib/api/system/bulk-import', () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  runImport: (...args: unknown[]) => mockRunImport(...args),
  useBulkImportTemplate: vi.fn(),
  useRunBulkImport: vi.fn(),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}));

import BulkImportPage from '../BulkImportPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BulkImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('F15.4 默认 Tab 患者 → 下载模板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [
        { key: 'name', label: '姓名', required: true, example: '张三' },
        { key: 'phone', label: '手机号', required: true, example: '13800138000' },
        { key: 'gender', label: '性别', example: '男' },
      ],
    });
  });

  it('默认 Tab 为患者导入', () => {
    renderWithProviders();
    expect(screen.getByText('患者导入')).toBeInTheDocument();
  });

  it('【下载模板】调 GET /system/bulk-import/template?type=patient', async () => {
    renderWithProviders();
    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockGetTemplate).toHaveBeenCalledWith('patient');
    });
  });

  it('按钮 Disabled 时 loading', async () => {
    let resolveTemplate: (v: unknown) => void;
    mockGetTemplate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTemplate = resolve;
        }),
    );
    renderWithProviders();
    const btn = screen.getByTestId('download-template-btn') as HTMLButtonElement;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(btn.disabled).toBe(true);
    });
    resolveTemplate!({ type: 'patient', columns: [] });
  });
});

describe('F15.5 选择 CSV 解析成功 → 预览表格', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [
        { key: 'name', label: '姓名', required: true },
        { key: 'phone', label: '手机号', required: true },
      ],
    });
  });

  it('上传 CSV → 预览表格渲染 10 行；表头列名正确；必填列标 *', async () => {
    renderWithProviders();

    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockGetTemplate).toHaveBeenCalled());

    const dropZone = screen.getByTestId('drop-zone');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

    const csvRows = ['name,phone'];
    for (let i = 1; i <= 15; i++) {
      csvRows.push(`患者${i},1380000000${i % 10}`);
    }
    const csvContent = csvRows.join('\r\n');
    const file = new File([csvContent], 'patients.csv', { type: 'text/csv' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const table = screen.getByTestId('preview-table');
      expect(table).toBeInTheDocument();
    });

    expect(screen.getByText('姓名')).toBeInTheDocument();
    expect(screen.getByText('手机号')).toBeInTheDocument();

    const stars = screen.getAllByText('*');
    expect(stars.length).toBeGreaterThanOrEqual(2);

    const previewRows = screen.getAllByTestId('preview-table')[0].querySelectorAll('tbody tr');
    expect(previewRows.length).toBe(10);
  });
});

describe('F15.6 dryRun 默认 true → 开始校验', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [
        { key: 'name', label: '姓名', required: true },
        { key: 'phone', label: '手机号', required: true },
      ],
    });
    mockRunImport.mockResolvedValue({
      type: 'patient',
      dryRun: true,
      total: 2,
      successCount: 2,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
      durationMs: 50,
    });
  });

  it('dryRun 默认 true → 【开始校验】调 runImport body dryRun=true', async () => {
    renderWithProviders();

    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockGetTemplate).toHaveBeenCalled());

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['name,phone\r\n张三,13800138000\r\n李四,13900139000'], 'p.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('preview-table')).toBeInTheDocument();
    });

    const dryRunCheckbox = screen.getByTestId('dry-run-checkbox').querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(dryRunCheckbox.checked).toBe(true);

    const validateBtn = screen.getByTestId('validate-btn');
    await userEvent.click(validateBtn);

    await waitFor(() => {
      expect(mockRunImport).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
          type: 'patient',
        }),
      );
    });
  });
});

describe('F15.7 校验后 failedCount>0 → 结果面板失败行表格', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [
        { key: 'name', label: '姓名', required: true },
        { key: 'phone', label: '手机号', required: true },
      ],
    });
    mockRunImport.mockResolvedValue({
      type: 'patient',
      dryRun: true,
      total: 3,
      successCount: 1,
      failedCount: 2,
      skippedCount: 0,
      errors: [
        {
          rowNumber: 2,
          field: 'phone',
          errorCode: 'INVALID_PHONE',
          message: '手机号格式不正确，请输入 11 位数字',
        },
        {
          rowNumber: 3,
          field: 'name',
          errorCode: 'REQUIRED',
          message: '姓名为必填项，不能为空',
        },
      ],
    });
  });

  it('校验后 failedCount>0 → 结果面板显示失败行表格；error message 中文可读', async () => {
    renderWithProviders();

    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockGetTemplate).toHaveBeenCalled());

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['name,phone\r\n张三,138\r\n,13900139000\r\n王五,137'], 'p.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => screen.getByTestId('preview-table'));

    const validateBtn = screen.getByTestId('validate-btn');
    await userEvent.click(validateBtn);

    await waitFor(() => {
      expect(screen.getByTestId('kpi-success')).toBeInTheDocument();
    });

    expect(screen.getByTestId('kpi-success').textContent).toContain('1');
    expect(screen.getByTestId('kpi-failed').textContent).toContain('2');

    const errorTable = screen.getByTestId('error-table');
    expect(errorTable).toBeInTheDocument();

    expect(screen.getByText('手机号格式不正确，请输入 11 位数字')).toBeInTheDocument();
    expect(screen.getByText('姓名为必填项，不能为空')).toBeInTheDocument();
    expect(screen.getByText('INVALID_PHONE')).toBeInTheDocument();
    expect(screen.getByText('REQUIRED')).toBeInTheDocument();
  });
});

describe('F15.8 校验通过 failedCount=0 → 正式导入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [
        { key: 'name', label: '姓名', required: true },
        { key: 'phone', label: '手机号', required: true },
      ],
    });
    mockRunImport
      .mockResolvedValueOnce({
        type: 'patient',
        dryRun: true,
        total: 2,
        successCount: 2,
        failedCount: 0,
        skippedCount: 0,
        errors: [],
        durationMs: 30,
      })
      .mockResolvedValueOnce({
        type: 'patient',
        dryRun: false,
        total: 2,
        successCount: 2,
        failedCount: 0,
        skippedCount: 0,
        errors: [],
        durationMs: 120,
        importedIds: [101, 102],
      });
  });

  it('校验通过 failedCount=0 → 【正式导入】按钮显示；点击后调 runImport(dryRun=false)；success Toast', async () => {
    renderWithProviders();

    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockGetTemplate).toHaveBeenCalled());

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['name,phone\r\n张三,13800138000\r\n李四,13900139000'], 'p.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => screen.getByTestId('preview-table'));

    const validateBtn = screen.getByTestId('validate-btn');
    await userEvent.click(validateBtn);

    await waitFor(() => {
      expect(screen.getByTestId('import-btn')).toBeInTheDocument();
    });

    const importBtn = screen.getByTestId('import-btn');
    await userEvent.click(importBtn);

    await waitFor(() => {
      expect(mockRunImport).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          dryRun: false,
          type: 'patient',
        }),
      );
    });

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('导入成功'),
      );
    });
  });
});

describe('F15.9 库存 Tab：autoCreateDrug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'inventory' as const,
      columns: [
        { key: 'sku', label: 'SKU编码', required: true },
        { key: 'qty', label: '数量', required: true },
      ],
    });
    mockRunImport.mockResolvedValue({
      type: 'inventory',
      dryRun: true,
      total: 1,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
    });
  });

  it('库存 Tab：autoCreateDrug 勾选中 → body autoCreateDrug=true', async () => {
    renderWithProviders();

    const inventoryTab = screen.getByText('库存导入');
    await userEvent.click(inventoryTab);

    const btn = screen.getByTestId('download-template-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockGetTemplate).toHaveBeenCalledWith('inventory'));

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['sku,qty\r\nSKU001,10'], 'i.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => screen.getByTestId('preview-table'));

    const autoCreateCheckbox = screen.getByTestId(
      'auto-create-drug-checkbox',
    ) as HTMLInputElement;
    expect(autoCreateCheckbox.checked).toBe(false);
    await userEvent.click(autoCreateCheckbox);
    expect(autoCreateCheckbox.checked).toBe(true);

    const validateBtn = screen.getByTestId('validate-btn');
    await userEvent.click(validateBtn);

    await waitFor(() => {
      expect(mockRunImport).toHaveBeenCalledWith(
        expect.objectContaining({
          autoCreateDrug: true,
          type: 'inventory',
        }),
      );
    });
  });
});

describe('F15.10 不接受 .xlsx 文件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue({
      type: 'patient' as const,
      columns: [{ key: 'name', label: '姓名', required: true }],
    });
  });

  it('不接受 .xlsx 文件 → 显示 Alert「请另存为 CSV UTF-8 再上传」', async () => {
    renderWithProviders();

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['fake binary content'], 'patients.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const alert = screen.getByTestId('excel-alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain('请另存为 CSV UTF-8 再上传');
    });

    expect(screen.queryByTestId('preview-table')).not.toBeInTheDocument();
  });
});
