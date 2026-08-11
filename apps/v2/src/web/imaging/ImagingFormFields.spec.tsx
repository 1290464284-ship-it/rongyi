// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImagingFormFields } from './ImagingFormFields';
import { apiRequest } from '../lib/api';
import { emptyForm, type ImagingForm } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const categories = [
  { id: 'cat-1', name: '全景' },
  { id: 'cat-2', name: '侧位' },
];

describe('ImagingFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders categories, phases and updates form fields', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'doc-1', name: '张医生' }]);
    let form: ImagingForm = { ...emptyForm, patientId: 'patient-1' };
    const update = vi.fn((patch: Partial<ImagingForm>) => {
      form = { ...form, ...patch };
    });
    render(
      <ImagingFormFields
        form={form}
        update={update}
        file={null}
        setFile={vi.fn()}
        categories={categories}
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('doc-1');
    });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'cat-2' } });
    expect(update).toHaveBeenCalledWith({ categoryId: 'cat-2' });
    fireEvent.change(screen.getByLabelText('阶段'), { target: { value: 'IN_PROGRESS' } });
    expect(update).toHaveBeenCalledWith({ phase: 'IN_PROGRESS' });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '初诊全景' } });
    expect(update).toHaveBeenCalledWith({ title: '初诊全景' });
  });

  it('shows an upload preview and removes the selected file', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    const setFile = vi.fn();
    const file = new File(['x'], 'scan.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 2048 });
    render(
      <ImagingFormFields
        form={emptyForm}
        update={vi.fn()}
        file={file}
        setFile={setFile}
        categories={categories}
      />,
      { wrapper },
    );

    expect(await screen.findByText('scan.png')).toBeDefined();
    expect(screen.getByText('2.0 KB')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '移除 scan.png' }));
    expect(setFile).toHaveBeenCalledWith(null);
  });

  it('renders empty categories when none are provided', () => {
    render(
      <ImagingFormFields
        form={emptyForm}
        update={vi.fn()}
        file={null}
        setFile={vi.fn()}
        categories={[]}
      />,
      { wrapper },
    );
    expect((screen.getByLabelText('分类') as HTMLSelectElement).options.length).toBe(1);
  });

  it('updates patient, doctor, type, description, takenAt and remark', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'doc-1', name: '张医生' }];
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'patient-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    let form: ImagingForm = emptyForm;
    const update = vi.fn((patch: Partial<ImagingForm>) => {
      form = { ...form, ...patch };
    });
    render(<ImagingFormFields form={form} update={update} file={null} setFile={vi.fn()} categories={categories} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('doc-1');
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    expect(update).toHaveBeenCalledWith({ patientId: 'patient-1' });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'doc-1' } });
    expect(update).toHaveBeenCalledWith({ doctorId: 'doc-1' });
    fireEvent.change(screen.getByLabelText('影像类型'), { target: { value: 'XRAY' } });
    expect(update).toHaveBeenCalledWith({ type: 'XRAY' });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '全景片' } });
    expect(update).toHaveBeenCalledWith({ description: '全景片' });
    fireEvent.change(screen.getByLabelText('拍摄时间'), { target: { value: '2026-08-10T10:30' } });
    expect(update).toHaveBeenCalledWith({ takenAt: '2026-08-10T10:30' });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '复查' } });
    expect(update).toHaveBeenCalledWith({ remark: '复查' });
  });

  it('sets and clears the selected file', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [];
      if (path.startsWith('/resources/patients?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      return {};
    });
    const setFile = vi.fn();
    render(<ImagingFormFields form={emptyForm} update={vi.fn()} file={null} setFile={setFile} categories={categories} />, { wrapper });
    const file = new File(['x'], 'scan.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('图片文件'), { target: { files: [file] } });
    expect(setFile).toHaveBeenCalledWith(file);
    fireEvent.change(screen.getByLabelText('图片文件'), { target: { files: [] } });
    expect(setFile).toHaveBeenCalledWith(null);
  });

  it('falls back to ids for doctors and categories without names', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'doc-9' }]);
    render(
      <ImagingFormFields
        form={emptyForm}
        update={vi.fn()}
        file={null}
        setFile={vi.fn()}
        categories={[{ id: 'cat-9', name: null }]}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect((screen.getByRole('option', { name: 'doc-9' }) as HTMLOptionElement).value).toBe('doc-9');
    });
    expect((screen.getByRole('option', { name: 'cat-9' }) as HTMLOptionElement).value).toBe('cat-9');
  });

  it('keeps the doctor list empty when the doctors endpoint returns no data', async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);
    render(
      <ImagingFormFields
        form={emptyForm}
        update={vi.fn()}
        file={null}
        setFile={vi.fn()}
        categories={categories}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBe(1);
    });
  });
});
