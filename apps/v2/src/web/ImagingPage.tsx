import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

type ImagingRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  type?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  takenAt?: string | null;
};

interface ImagingForm {
  patientId: string;
  doctorId: string;
  type: string;
  title: string;
  description: string;
  takenAt: string;
  remark: string;
}

const emptyForm: ImagingForm = {
  patientId: '',
  doctorId: '',
  type: '',
  title: '',
  description: '',
  takenAt: '',
  remark: '',
};

export function ImagingPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ImagingForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiOrigin, setApiOrigin] = useState('');

  const patients = useQuery({
    queryKey: ['imaging-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const doctors = useQuery({
    queryKey: ['imaging-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['imaging'],
    queryFn: () => apiRequest<Page<ImagingRow>>('/resources/imaging?page=1&pageSize=50'),
  });

  useEffect(() => {
    let cancelled = false;
    void getApiOrigin().then((origin) => {
      if (!cancelled) setApiOrigin(origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !form.patientId || !form.doctorId || !form.title) {
      showToast('请选择患者、医生并填写影像标题', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const imageUrl = file ? (await uploadFile(file)).url : undefined;
      await apiRequest('/resources/imaging', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          doctorId: form.doctorId,
          type: form.type || 'UNKNOWN',
          title: form.title,
          description: form.description || undefined,
          imageUrl: imageUrl ?? '',
          takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : undefined,
          remark: form.remark || undefined,
        }),
      });
      showToast('影像记录已创建', 'success');
      setShowForm(false);
      setFile(null);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建影像失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    {
      key: 'preview',
      label: '预览',
      render: (row: ImagingRow) => {
        const url = row.imageUrl ? `${apiOrigin}${row.imageUrl}` : '';
        return url ? <img className="imaging-thumb" src={url} alt={String(row.title ?? '影像')} /> : '无图片';
      },
    },
    { key: 'title', label: '标题' },
    { key: 'type', label: '类型' },
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    {
      key: 'takenAt',
      label: '拍摄时间',
      render: (row: ImagingRow) => row.takenAt ? new Date(row.takenAt).toLocaleString('zh-CN', { hour12: false }) : '',
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>影像管理</h1>
        <button onClick={() => setShowForm(true)}>上传影像</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无影像" />
      )}

      <Dialog open={showForm} title="上传影像" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <select value={form.patientId} onChange={(event) => setForm((current) => ({ ...current, patientId: event.target.value }))}>
              <option value="">选择患者</option>
              {patients.data?.items.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            医生
            <select value={form.doctorId} onChange={(event) => setForm((current) => ({ ...current, doctorId: event.target.value }))}>
              <option value="">选择医生</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            影像类型
            <input value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} />
          </label>
          <label>
            标题
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            描述
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label>
            拍摄时间
            <input type="datetime-local" value={form.takenAt} onChange={(event) => setForm((current) => ({ ...current, takenAt: event.target.value }))} />
          </label>
          <label>
            图片文件
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            备注
            <textarea value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '上传中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
