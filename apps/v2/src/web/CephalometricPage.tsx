import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface CephalometricRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  imageUrl?: string | null;
  status?: string | null;
}

interface CephalometricForm {
  patientId: string;
  status: string;
  templateId: string;
  landmarksJson: string;
  metricsJson: string;
  remark: string;
}

const emptyForm: CephalometricForm = {
  patientId: '',
  status: 'DRAFT',
  templateId: '',
  landmarksJson: '{}',
  metricsJson: '{}',
  remark: '',
};

export function CephalometricPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CephalometricForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiOrigin, setApiOrigin] = useState('');

  const patients = useQuery({
    queryKey: ['ceph-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const query = useQuery({
    queryKey: ['cephalometric'],
    queryFn: () => apiRequest<Page<CephalometricRow>>('/resources/cephalometricCases?page=1&pageSize=50'),
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
    let parsedLandmarks: Record<string, unknown> = {};
    let parsedMetrics: Record<string, unknown> = {};
    try {
      parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
      parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
    } catch {
      showToast('标记点或测量结果必须是有效 JSON', 'error');
      return;
    }
    if (submitting || !form.patientId || (!file && !parsedLandmarks)) {
      showToast('请选择患者并上传影像或填写标记点', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const imageUrl = file ? (await uploadFile(file)).url : undefined;
      await apiRequest('/resources/cephalometricCases', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          imageUrl: imageUrl ?? '',
          landmarksJson: JSON.stringify(parsedLandmarks),
          metricsJson: JSON.stringify(parsedMetrics),
          templateId: form.templateId || undefined,
          status: form.status,
          remark: form.remark || undefined,
        }),
      });
      showToast('头影测量已创建', 'success');
      setShowForm(false);
      setFile(null);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建头影测量失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'patientId', label: '患者' },
    { key: 'status', label: '状态' },
    {
      key: 'preview',
      label: '影像',
      render: (row: CephalometricRow) => row.imageUrl
        ? <img className="imaging-thumb" src={`${apiOrigin}${row.imageUrl}`} alt="头影影像" />
        : '无影像',
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>头影测量</h1>
        <button onClick={() => setShowForm(true)}>新建测量</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无头影测量" />
      )}

      <Dialog open={showForm} title="新建头影测量" onClose={() => setShowForm(false)}>
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
            状态
            <input value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} />
          </label>
          <label>
            模板 ID
            <input value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))} />
          </label>
          <label>
            影像文件
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label>
            标记点 JSON
            <textarea value={form.landmarksJson} onChange={(event) => setForm((current) => ({ ...current, landmarksJson: event.target.value }))} />
          </label>
          <label>
            测量结果 JSON
            <textarea value={form.metricsJson} onChange={(event) => setForm((current) => ({ ...current, metricsJson: event.target.value }))} />
          </label>
          <label>
            备注
            <textarea value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
