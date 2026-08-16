import { useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { ConfirmDialog, DataTable, LoadingState } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { CATEGORY_TYPE_LABELS } from './constants';
import { categoryColumns } from './columns';
import type { ImagingCategoryRow } from './types';

export function ImagingCategoryPanel({
  categories,
  loading,
  error,
  onRetry,
  onChanged,
}: {
  categories: ImagingCategoryRow[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'ORTHODONTIC', sortOrder: 0, active: true });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const categoryBusyRef = useRef(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ImagingCategoryRow | null>(null);

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
    setCategoryBusy(true);
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
      await onChanged();
    } catch (error) {
      showToast(errorMessage(error, editingCategoryId ? '更新影像分类失败' : '创建影像分类失败'), 'error');
    } finally {
      categoryBusyRef.current = false;
      setCategoryBusy(false);
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
      await onChanged();
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
      await onChanged();
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
    <section className="card" aria-label="影像分类管理">
      <h2>影像分类管理</h2>
      {loading ? (
        <LoadingState label="影像分类加载中..." />
      ) : error ? (
        <div className="query-section-error">
          <p className="error">影像分类加载失败</p>
          <button type="button" className="btn-secondary" onClick={() => void onRetry()}>重试</button>
        </div>
      ) : (
        <DataTable columns={categoryColumnDefs} rows={categories} keyField="id" emptyText="暂无影像分类" />
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
        <button type="submit" disabled={categoryBusy}>{categoryBusy ? '保存中...' : editingCategoryId ? '保存修改' : '新增分类'}</button>
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

      <ConfirmDialog
        open={deleteCategoryTarget !== null}
        title="删除影像分类"
        message={`确定删除影像分类“${String(deleteCategoryTarget?.name ?? '')}”吗？`}
        confirmText="确认删除"
        danger
        onConfirm={() => confirmDeleteCategory()}
        onCancel={() => setDeleteCategoryTarget(null)}
      />
    </section>
  );
}
