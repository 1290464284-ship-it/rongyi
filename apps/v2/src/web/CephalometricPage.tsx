import { useEffect, useState } from 'react';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';

interface CephalometricRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
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
    <CrudPage<CephalometricRow, CephalometricForm>
      title="头影测量"
      createLabel="新建测量"
      emptyMessage="暂无头影测量"
      queryKey={['cephalometric']}
      endpoint="/resources/cephalometricCases"
      initialForm={emptyForm}
      validate={(form) => {
        let parsedLandmarks: Record<string, unknown> = {};
        let parsedMetrics: Record<string, unknown> = {};
        try {
          parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
          parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
        } catch {
          return '标记点或测量结果必须是有效 JSON';
        }
        if (!form.patientId || (!file && !parsedLandmarks)) {
          return '请选择患者并上传影像或填写标记点';
        }
        return null;
      }}
      submitOverride={async ({ form }) => {
        const parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
        const parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
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
      }}
      onAfterCreate={() => setFile(null)}
      messages={{ create: '头影测量已创建' }}
      errorMessages={{ create: '创建头影测量失败' }}
      columns={cephalometricColumns(apiOrigin)}
      renderForm={(ctx) => (
        <CephalometricFormFields form={ctx.form} update={ctx.update} file={file} setFile={setFile} />
      )}
    />
  );
}

function cephalometricColumns(apiOrigin: string): DataTableColumn<CephalometricRow>[] {
  return [
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'status', label: '状态' },
    {
      key: 'preview',
      label: '影像',
      render: (row) => (row.imageUrl ? <img className="imaging-thumb" src={`${apiOrigin}${row.imageUrl}`} alt="头影影像" /> : '无影像'),
    },
  ];
}

function CephalometricFormFields({
  form,
  update,
  file,
  setFile,
}: {
  form: CephalometricForm;
  update: (patch: Partial<CephalometricForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        模板 ID
        <input value={form.templateId} onChange={(event) => update({ templateId: event.target.value })} />
      </label>
      <label>
        影像文件
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <label>
        标记点 JSON
        <textarea value={form.landmarksJson} onChange={(event) => update({ landmarksJson: event.target.value })} />
      </label>
      <label>
        测量结果 JSON
        <textarea value={form.metricsJson} onChange={(event) => update({ metricsJson: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
