import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import { CrudPage } from './CrudPage';
import { ConfirmDialog, DataTable, SearchableSelect, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  ORTHODONTIC: '正畸',
  AESTHETIC: '美学',
  PLASTER: '石膏',
  OTHER: '其他',
};

const PHASE_LABELS: Record<string, string> = {
  INITIAL: '初诊',
  IN_PROGRESS: '治疗中',
  FINISHED: '完成',
  RETENTION: '保持期',
  OTHER: '其他',
};

const PHASE_OPTIONS = [
  { value: 'INITIAL', label: '初诊' },
  { value: 'IN_PROGRESS', label: '治疗中' },
  { value: 'FINISHED', label: '完成' },
  { value: 'RETENTION', label: '保持期' },
  { value: 'OTHER', label: '其他' },
];

const CATEGORIES_LIST_PATH = '/resources/imagingCategories?page=1&pageSize=100';
const IMAGING_LIST_PATH = '/resources/imaging?page=1&pageSize=50';

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
  categoryId?: string | null;
  phase?: string | null;
}

interface ImagingForm {
  patientId: string;
  doctorId: string;
  type: string;
  title: string;
  description: string;
  takenAt: string;
  remark: string;
  categoryId: string;
  phase: string;
  imageUrl: string;
}

const emptyForm: ImagingForm = {
  patientId: '',
  doctorId: '',
  type: '',
  title: '',
  description: '',
  takenAt: '',
  remark: '',
  categoryId: '',
  phase: '',
  imageUrl: '',
};

interface ImagingCategoryRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  type?: string | null;
  sortOrder?: number | null;
  active?: boolean | null;
}

function formatDateTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

function toLocalDatetime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function phaseLabel(phase?: string | null): string {
  if (!phase) return '';
  return PHASE_LABELS[phase] ?? phase;
}

function imagingOptionLabel(row: ImagingRow): string {
  const takenAt = formatDateTime(row.takenAt);
  return takenAt ? `${String(row.title ?? row.id)}（${takenAt}）` : String(row.title ?? row.id);
}

function categoryName(row: ImagingRow, categories: ImagingCategoryRow[]): string {
  if (!row.categoryId) return '';
  const category = categories.find((item) => item.id === row.categoryId);
  return category?.name ?? row.categoryId;
}

export function ImagingPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [apiOrigin, setApiOrigin] = useState('');
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'ORTHODONTIC', sortOrder: 0, active: true });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ImagingCategoryRow | null>(null);
  const [compareLeftId, setCompareLeftId] = useState('');
  const [compareRightId, setCompareRightId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getApiOrigin().then((origin) => {
      if (!cancelled) setApiOrigin(origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useQuery({
    queryKey: ['imaging-categories'],
    queryFn: () => apiRequest<Page<ImagingCategoryRow>>(CATEGORIES_LIST_PATH),
  });
  // 与 CrudPage 列表使用同一查询键，共享缓存，避免重复请求。
  const imagingList = useQuery({
    queryKey: ['imaging', 1, ''],
    queryFn: () => apiRequest<Page<ImagingRow>>(IMAGING_LIST_PATH),
  });

  const categoryOptions = categories.data?.items ?? [];
  const imagingOptions = imagingList.data?.items ?? [];
  const selectedLeft = imagingOptions.find((row) => row.id === compareLeftId) ?? null;
  const selectedRight = imagingOptions.find((row) => row.id === compareRightId) ?? null;
  const canCompare = selectedLeft !== null && selectedRight !== null && compareLeftId !== compareRightId;

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryForm.name.trim()) {
      showToast('请填写分类名称', 'error');
      return;
    }
    const payload = {
      name: categoryForm.name.trim(),
      type: categoryForm.type,
      sortOrder: categoryForm.sortOrder,
      active: categoryForm.active,
    };
    try {
      if (editingCategoryId) {
        await apiRequest(`/resources/imagingCategories/${editingCategoryId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('影像分类已更新', 'success');
      } else {
        await apiRequest('/resources/imagingCategories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('影像分类已创建', 'success');
      }
      setCategoryForm({ name: '', type: 'ORTHODONTIC', sortOrder: 0, active: true });
      setEditingCategoryId(null);
      await categories.refetch();
    } catch (error) {
      showToast(errorMessage(error, editingCategoryId ? '更新影像分类失败' : '创建影像分类失败'), 'error');
    }
  }

  function editCategory(row: ImagingCategoryRow) {
    setEditingCategoryId(String(row.id));
    setCategoryForm({
      name: String(row.name ?? ''),
      type: String(row.type ?? 'ORTHODONTIC'),
      sortOrder: Number(row.sortOrder ?? 0),
      active: Boolean(row.active),
    });
  }

  async function confirmDeleteCategory() {
    const target = deleteCategoryTarget;
    if (!target) return;
    try {
      await apiRequest(`/resources/imagingCategories/${String(target.id)}`, { method: 'DELETE' });
      showToast('影像分类已删除', 'success');
      setDeleteCategoryTarget(null);
      await categories.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除影像分类失败'), 'error');
    }
  }

  async function toggleCategory(row: ImagingCategoryRow) {
    try {
      await apiRequest(`/resources/imagingCategories/${String(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !row.active }),
      });
      showToast(row.active ? '影像分类已停用' : '影像分类已启用', 'success');
      await categories.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新影像分类失败'), 'error');
    }
  }

  const categoryColumns: DataTableColumn<ImagingCategoryRow>[] = [
    { key: 'name', label: '名称' },
    {
      key: 'type',
      label: '类型',
      render: (row) => CATEGORY_TYPE_LABELS[String(row.type ?? '')] ?? String(row.type ?? ''),
    },
    { key: 'sortOrder', label: '排序', render: (row) => String(row.sortOrder ?? 0) },
    { key: 'active', label: '状态', render: (row) => (row.active ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button type="button" onClick={() => editCategory(row)}>编辑</button>
          <button type="button" onClick={() => void toggleCategory(row)}>
            {row.active ? '停用' : '启用'}
          </button>
          <button type="button" className="danger" onClick={() => setDeleteCategoryTarget(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <>
      <CrudPage<ImagingRow, ImagingForm>
        title="影像管理"
        createLabel="上传影像"
        emptyMessage="暂无影像"
        queryKey={['imaging']}
        endpoint="/resources/imaging"
        initialForm={() => {
          editingIdRef.current = null;
          return { ...emptyForm };
        }}
        validate={(form) => (!form.patientId || !form.doctorId || !form.title ? '请选择患者、医生并填写影像标题' : null)}
        submitOverride={async ({ form, editing }) => {
          const imageUrl = file ? (await uploadFile(file)).url : undefined;
          const payload = {
            patientId: form.patientId,
            doctorId: form.doctorId,
            type: form.type || 'UNKNOWN',
            title: form.title,
            description: form.description || undefined,
            imageUrl: imageUrl ?? String(form.imageUrl ?? ''),
            takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : undefined,
            remark: form.remark || undefined,
            categoryId: form.categoryId || undefined,
            phase: form.phase || undefined,
          };
          if (editing) {
            await apiRequest(`/resources/imaging/${editingIdRef.current}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            await apiRequest('/resources/imaging', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }
        }}
        onAfterCreate={() => setFile(null)}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            type: String(row.type ?? ''),
            title: String(row.title ?? ''),
            description: String(row.description ?? ''),
            takenAt: toLocalDatetime(row.takenAt),
            remark: String(row.remark ?? ''),
            categoryId: String(row.categoryId ?? ''),
            phase: String(row.phase ?? ''),
            imageUrl: String(row.imageUrl ?? ''),
          };
        }}
        messages={{ create: '影像记录已创建', update: '影像记录已更新', delete: '影像记录已删除' }}
        errorMessages={{ create: '创建影像失败', update: '更新影像失败', delete: '删除影像失败' }}
        columns={imagingColumns(apiOrigin, categoryOptions)}
        canEdit
        canDelete
        renderForm={(ctx) => (
          <ImagingFormFields
            form={ctx.form}
            update={ctx.update}
            file={file}
            setFile={setFile}
            categories={categoryOptions}
          />
        )}
      />

      <section className="card" aria-label="影像分类管理">
        <h2>影像分类管理</h2>
        <DataTable columns={categoryColumns} rows={categoryOptions} keyField="id" emptyText="暂无影像分类" />
        <form className="imaging-category-form" onSubmit={saveCategory}>
          <label>
            名称
            <input
              value={categoryForm.name}
              onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
            />
          </label>
          <label>
            类型
            <select
              value={categoryForm.type}
              onChange={(event) => setCategoryForm({ ...categoryForm, type: event.target.value })}
            >
              {Object.entries(CATEGORY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            排序
            <input
              type="number"
              value={categoryForm.sortOrder}
              onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })}
            />
          </label>
          <label>
            启用
            <input
              type="checkbox"
              checked={categoryForm.active}
              onChange={(event) => setCategoryForm({ ...categoryForm, active: event.target.checked })}
            />
          </label>
          <button type="submit">{editingCategoryId ? '保存修改' : '新增分类'}</button>
          {editingCategoryId && (
            <button
              type="button"
              onClick={() => {
                setEditingCategoryId(null);
                setCategoryForm({ name: '', type: 'ORTHODONTIC', sortOrder: 0, active: true });
              }}
            >
              取消编辑
            </button>
          )}
        </form>
      </section>

      <ConfirmDialog
        open={deleteCategoryTarget !== null}
        title="删除影像分类"
        message={`确定删除影像分类“${String(deleteCategoryTarget?.name ?? '')}”吗？`}
        confirmText="确认删除"
        danger
        onConfirm={() => confirmDeleteCategory()}
        onCancel={() => setDeleteCategoryTarget(null)}
      />

      <section className="card" aria-label="影像对比">
        <h2>影像对比</h2>
        <div className="imaging-compare-controls">
          <label>
            影像一
            <select value={compareLeftId} onChange={(event) => setCompareLeftId(event.target.value)}>
              <option value="">选择影像</option>
              {imagingOptions.map((row) => (
                <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
              ))}
            </select>
          </label>
          <label>
            影像二
            <select value={compareRightId} onChange={(event) => setCompareRightId(event.target.value)}>
              <option value="">选择影像</option>
              {imagingOptions.map((row) => (
                <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => { setCompareLeftId(''); setCompareRightId(''); }}>清空对比</button>
        </div>
        {canCompare ? (
          <div className="imaging-compare-view">
            <figure className="imaging-compare-item">
              <img src={`${apiOrigin}${selectedLeft?.imageUrl ?? ''}`} alt={String(selectedLeft?.title ?? '影像')} />
              <figcaption>
                <div>标题：{selectedLeft?.title ?? ''}</div>
                <div>类型：{selectedLeft?.type ?? ''}</div>
                <div>拍摄时间：{formatDateTime(selectedLeft?.takenAt)}</div>
                <div>阶段：{phaseLabel(selectedLeft?.phase)}</div>
              </figcaption>
            </figure>
            <figure className="imaging-compare-item">
              <img src={`${apiOrigin}${selectedRight?.imageUrl ?? ''}`} alt={String(selectedRight?.title ?? '影像')} />
              <figcaption>
                <div>标题：{selectedRight?.title ?? ''}</div>
                <div>类型：{selectedRight?.type ?? ''}</div>
                <div>拍摄时间：{formatDateTime(selectedRight?.takenAt)}</div>
                <div>阶段：{phaseLabel(selectedRight?.phase)}</div>
              </figcaption>
            </figure>
          </div>
        ) : (
          <p className="imaging-compare-hint">请选择两张影像进行对比</p>
        )}
      </section>
    </>
  );
}

function imagingColumns(apiOrigin: string, categories: ImagingCategoryRow[]): DataTableColumn<ImagingRow>[] {
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
    { key: 'categoryId', label: '分类', render: (row) => categoryName(row, categories) },
    { key: 'phase', label: '阶段', render: (row) => phaseLabel(row.phase) },
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
    {
      key: 'takenAt',
      label: '拍摄时间',
      render: (row) => formatDateTime(row.takenAt),
    },
  ];
}

function ImagingFormFields({
  form,
  update,
  file: _file,
  setFile,
  categories,
}: {
  form: ImagingForm;
  update: (patch: Partial<ImagingForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  categories: ImagingCategoryRow[];
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
        分类
        <select value={form.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
          <option value="">不分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name ?? category.id}</option>
          ))}
        </select>
      </label>
      <label>
        阶段
        <select value={form.phase} onChange={(event) => update({ phase: event.target.value })}>
          <option value="">不指定</option>
          {PHASE_OPTIONS.map((phase) => (
            <option key={phase.value} value={phase.value}>{phase.label}</option>
          ))}
        </select>
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
