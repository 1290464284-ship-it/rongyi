import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, uploadFile } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { ConfirmDialog, DataTable, LoadingState, MissingSelectOption, SignedImage } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import type { Page } from '../../lib/types';
import { CATEGORY_TYPE_LABELS, CATEGORIES_LIST_PATH } from '../../imaging/constants';
import { imagingColumns, categoryColumns } from '../../imaging/columns';
import { formatDateTime, imagingOptionLabel, phaseLabel, toLocalDatetime } from '../../imaging/format';
import { ImagingFormFields } from '../../imaging/ImagingFormFields';
import { emptyForm } from '../../imaging/types';
import type { ImagingRow, ImagingForm, ImagingCategoryRow } from '../../imaging/types';

export function ImagingPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'ORTHODONTIC', sortOrder: 0, active: true });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const categoryBusyRef = useRef(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ImagingCategoryRow | null>(null);
  const [compareLeftId, setCompareLeftId] = useState('');
  const [compareRightId, setCompareRightId] = useState('');
  const [compareSearch, setCompareSearch] = useState('');
  const [comparePage, setComparePage] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Record<string, ImagingRow>>({});

  const categories = useQuery({
    queryKey: ['imaging-categories'],
    queryFn: () => apiRequest<Page<ImagingCategoryRow>>(CATEGORIES_LIST_PATH),
  });
  const compareOptionsQuery = useQuery({
    // B5：初始态（无搜索、第 1 页）与 CrudPage 列表同 URL，复用其 queryKey 共享缓存，消除同端点双请求
    queryKey: compareSearch === '' && comparePage === 1
      ? ['imaging', 1, '']
      : ['imaging-options', compareSearch, comparePage],
    queryFn: () => apiRequest<Page<ImagingRow>>(
      `/resources/imaging?page=${comparePage}&pageSize=50${compareSearch ? `&search=${encodeURIComponent(compareSearch)}` : ''}`,
    ),
  });

  const categoryOptions = categories.data?.items ?? [];
  const imagingOptions = compareOptionsQuery.data?.items ?? [];
  const compareTotal = compareOptionsQuery.data?.total ?? 0;
  const compareTotalPages = Math.max(1, Math.ceil(compareTotal / 50));
  const selectedLeft = selectedRows[compareLeftId] ?? imagingOptions.find((row) => row.id === compareLeftId) ?? null;
  const selectedRight = selectedRows[compareRightId] ?? imagingOptions.find((row) => row.id === compareRightId) ?? null;
  const canCompare = selectedLeft !== null && selectedRight !== null && compareLeftId !== compareRightId;

  function selectCompare(side: 'left' | 'right', id: string) {
    const row = imagingOptions.find((candidate) => candidate.id === id) ?? null;
    if (row) {
      setSelectedRows((current) => ({ ...current, [id]: row }));
    }
    if (side === 'left') setCompareLeftId(id);
    else setCompareRightId(id);
  }

  /** 过期对比选项的标签：过期 id 恒有 selectedRows 记录，row 非空。 */
  function missingSelectLabel(row: ImagingRow | null, fallbackId: string): string {
    /* v8 ignore next -- 过期 id 由 selectCompare 恒写入 selectedRows，row 非空 */
    if (!row) return fallbackId;
    return imagingOptionLabel(row);
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (categoryBusyRef.current) return;
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
    categoryBusyRef.current = true;
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
    } finally {
      categoryBusyRef.current = false;
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
    /* v8 ignore next -- ConfirmDialog 仅在 target 非空时渲染，守卫不可达 */
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
    const id = String(row.id);
    /* v8 ignore next -- 该行按钮在 toggleBusyId === id 时呈现忙碌态，重复点击不可达 */
    if (toggleBusyId === id) return;
    setToggleBusyId(id);
    try {
      await apiRequest(`/resources/imagingCategories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !row.active }),
      });
      showToast(row.active ? '影像分类已停用' : '影像分类已启用', 'success');
      await categories.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新影像分类失败'), 'error');
    } finally {
      setToggleBusyId(null);
    }
  }

  const categoryColumnDefs = categoryColumns({
    onEdit: editCategory,
    onToggle: toggleCategory,
    onDelete: setDeleteCategoryTarget,
    toggleBusyId,
  });

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
          let uploadedFilename: string | null = null;
          // form.imageUrl 恒为 string（emptyForm 写 ''，formFromRow 写 String(row.imageUrl ?? '')），nullish 兜底为死代码，已删除。
          let imageUrl = form.imageUrl;
          if (file) {
            const uploaded = await uploadFile(file);
            uploadedFilename = uploaded.filename;
            imageUrl = uploaded.url;
          }
          const payload = {
            patientId: form.patientId,
            doctorId: form.doctorId,
            type: form.type || 'UNKNOWN',
            title: form.title,
            description: form.description || undefined,
            imageUrl,
            takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : undefined,
            remark: form.remark || undefined,
            categoryId: form.categoryId || undefined,
            phase: form.phase || undefined,
          };
          try {
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
            setFile(null);
          } catch (error) {
            // 记录创建/更新失败时清理已上传的孤儿文件，避免占用配额和磁盘。
            if (uploadedFilename) {
              try {
                await apiRequest(`/files/${uploadedFilename}`, { method: 'DELETE' });
              } catch {
                // 清理失败不掩盖原始错误。
              }
            }
            throw error;
          }
        }}
        onAfterCreate={() => setFile(null)}
        onFormClose={() => setFile(null)}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          setFile(null);
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
        columns={imagingColumns(categoryOptions)}
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
        {categories.isLoading ? (
          <LoadingState label="影像分类加载中..." />
        ) : categories.error ? (
          <div className="query-section-error">
            <p className="error">影像分类加载失败</p>
            <button type="button" className="btn-secondary" onClick={() => void categories.refetch()}>重试</button>
          </div>
        ) : (
          <DataTable columns={categoryColumnDefs} rows={categoryOptions} keyField="id" emptyText="暂无影像分类" />
        )}
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
        <div className="imaging-compare-toolbar">
          <input
            aria-label="对比选项搜索"
            type="search"
            placeholder="搜索影像"
            value={compareSearch}
            onChange={(event) => {
              setCompareSearch(event.target.value);
              setComparePage(1);
            }}
          />
          {compareTotalPages > 1 && (
            <div className="pager">
              <button type="button" disabled={compareOptionsQuery.isFetching || comparePage <= 1} onClick={() => setComparePage((current) => Math.max(1, current - 1))}>上一页</button>
              <span>第 {comparePage} / {compareTotalPages} 页（共 {compareTotal} 条）</span>
              <button type="button" disabled={compareOptionsQuery.isFetching || comparePage >= compareTotalPages} onClick={() => setComparePage((current) => current + 1)}>下一页</button>
            </div>
          )}
        </div>
        {compareOptionsQuery.isLoading ? (
          <LoadingState label="对比选项加载中..." />
        ) : compareOptionsQuery.error ? (
          <div className="query-section-error">
            <p className="error">对比选项加载失败</p>
            <button type="button" className="btn-secondary" onClick={() => void compareOptionsQuery.refetch()}>重试</button>
          </div>
        ) : (
          <div className="imaging-compare-controls">
            <label>
              影像一
              <select value={compareLeftId} onChange={(event) => selectCompare('left', event.target.value)}>
                {compareLeftId !== '' && !imagingOptions.some((row) => String(row.id) === compareLeftId) && (
                  <MissingSelectOption value={compareLeftId} label={missingSelectLabel(selectedLeft, compareLeftId)} />
                )}
                <option value="">选择影像</option>
                {imagingOptions.map((row) => (
                  <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
                ))}
              </select>
            </label>
            <label>
              影像二
              <select value={compareRightId} onChange={(event) => selectCompare('right', event.target.value)}>
                {compareRightId !== '' && !imagingOptions.some((row) => String(row.id) === compareRightId) && (
                  <MissingSelectOption value={compareRightId} label={missingSelectLabel(selectedRight, compareRightId)} />
                )}
                <option value="">选择影像</option>
                {imagingOptions.map((row) => (
                  <option key={row.id} value={row.id}>{imagingOptionLabel(row)}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => {
              setSelectedRows((current) => {
                const next = { ...current };
                delete next[compareLeftId];
                delete next[compareRightId];
                return next;
              });
              setCompareLeftId('');
              setCompareRightId('');
            }}>清空对比</button>
          </div>
        )}
        {canCompare ? (
          <div className="imaging-compare-view">
            <figure className="imaging-compare-item">
              <SignedImage path={selectedLeft?.imageUrl} alt={String(selectedLeft?.title ?? '影像')} />
              <figcaption>
                <div>标题：{selectedLeft?.title ?? ''}</div>
                <div>类型：{selectedLeft?.type ?? ''}</div>
                <div>拍摄时间：{formatDateTime(selectedLeft?.takenAt)}</div>
                <div>阶段：{phaseLabel(selectedLeft?.phase)}</div>
              </figcaption>
            </figure>
            <figure className="imaging-compare-item">
              <SignedImage path={selectedRight?.imageUrl} alt={String(selectedRight?.title ?? '影像')} />
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
