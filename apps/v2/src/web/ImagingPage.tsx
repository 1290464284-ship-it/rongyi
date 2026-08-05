import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';

interface ImagingRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  type?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  takenAt?: string | null;
}

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
  const [file, setFile] = useState<File | null>(null);
  const [apiOrigin, setApiOrigin] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getApiOrigin().then((origin) => {
      if (!cancelled) setApiOrigin(origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CrudPage<ImagingRow, ImagingForm>
      title="影像管理"
      createLabel="上传影像"
      emptyMessage="暂无影像"
      queryKey={['imaging']}
      endpoint="/resources/imaging"
      initialForm={emptyForm}
      validate={(form) => (!form.patientId || !form.doctorId || !form.title ? '请选择患者、医生并填写影像标题' : null)}
      submitOverride={async ({ form }) => {
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
      }}
      onAfterCreate={() => setFile(null)}
      messages={{ create: '影像记录已创建' }}
      errorMessages={{ create: '创建影像失败' }}
      columns={imagingColumns(apiOrigin)}
      renderForm={(ctx) => (
        <ImagingFormFields form={ctx.form} update={ctx.update} file={file} setFile={setFile} />
      )}
    />
  );
}

function imagingColumns(apiOrigin: string): DataTableColumn<ImagingRow>[] {
  return [
    {
      key: 'preview',
      label: '预览',
      render: (row) => {
        const url = row.imageUrl ? `${apiOrigin}${row.imageUrl}` : '';
        return url ? <img className="imaging-thumb" src={url} alt={String(row.title ?? '影像')} /> : '无图片';
      },
    },
    { key: 'title', label: '标题' },
    { key: 'type', label: '类型' },
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
    {
      key: 'takenAt',
      label: '拍摄时间',
      render: (row) => (row.takenAt ? new Date(row.takenAt).toLocaleString('zh-CN', { hour12: false }) : ''),
    },
  ];
}

function ImagingFormFields({
  form,
  update,
  file,
  setFile,
}: {
  form: ImagingForm;
  update: (patch: Partial<ImagingForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  const doctors = useQuery({
    queryKey: ['imaging-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        影像类型
        <input value={form.type} onChange={(event) => update({ type: event.target.value })} />
      </label>
      <label>
        标题
        <input value={form.title} onChange={(event) => update({ title: event.target.value })} />
      </label>
      <label>
        描述
        <textarea value={form.description} onChange={(event) => update({ description: event.target.value })} />
      </label>
      <label>
        拍摄时间
        <input type="datetime-local" value={form.takenAt} onChange={(event) => update({ takenAt: event.target.value })} />
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
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
