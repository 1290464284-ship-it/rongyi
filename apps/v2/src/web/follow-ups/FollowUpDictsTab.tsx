import { useState } from 'react';
import { ConfirmDialog, DataTable, Dialog, LoadingState, PageError, type DataTableColumn } from '../components';
import { useCrudResource } from '../hooks/use-crud-resource';
import { DICT_TYPE_LABELS, DICT_TYPES } from './constants';
import { emptyDictForm, type FollowUpDictForm } from './types';

export function FollowUpDictsTab() {
  const [dictTypeFilter, setDictTypeFilter] = useState('');
  const crud = useCrudResource<Record<string, unknown>, FollowUpDictForm>({
    queryKey: ['followup-dicts', dictTypeFilter],
    endpoint: '/resources/followUpDicts',
    listPath: `/resources/followUpDicts?page=1&pageSize=200${dictTypeFilter ? `&dictType=${encodeURIComponent(dictTypeFilter)}` : ''}`,
    initialForm: emptyDictForm,
    canEdit: true,
    canDelete: true,
    validate: (form) => (form.name.trim() ? null : '请填写词典项名称'),
    toPayload: (form) => ({
      dictType: form.dictType,
      name: form.name.trim(),
      sortOrder: Number(form.sortOrder) || 0,
      active: form.active,
      remark: form.remark.trim() || undefined,
    }),
    messages: { create: '词典项已创建', update: '词典项已更新', delete: '词典项已删除' },
    errorMessages: { create: '创建词典项失败', update: '更新词典项失败', delete: '删除词典项失败' },
  });

  if (crud.query.isLoading) return <LoadingState label="词典加载中..." />;
  if (crud.query.error) {
    return (
      <>
        <PageError message={crud.query.error instanceof Error ? crud.query.error.message : String(crud.query.error)} />
        <button onClick={() => void crud.query.refetch()}>重试</button>
      </>
    );
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'dictType',
      label: '分类',
      render: (row) => DICT_TYPE_LABELS[String(row.dictType ?? '')] ?? String(row.dictType ?? ''),
    },
    { key: 'name', label: '名称' },
    { key: 'sortOrder', label: '排序', render: (row) => String(row.sortOrder ?? '') },
    { key: 'active', label: '启用', render: (row) => (row.active ? '是' : '否') },
    { key: 'remark', label: '备注', render: (row) => String(row.remark ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => crud.openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => crud.requestDelete(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h2>词典管理</h2>
        <button onClick={crud.openCreate}>新建词典项</button>
      </div>
      <select aria-label="词典分类筛选" value={dictTypeFilter} onChange={(event) => setDictTypeFilter(event.target.value)}>
        <option value="">全部分类</option>
        {DICT_TYPES.map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </select>
      <DataTable columns={columns} rows={crud.rows} keyField="id" emptyText="暂无词典项" />
      {crud.query.data?.truncated && <p className="reminder-muted">词典项超过 200 条，仅显示部分数据</p>}
      <Dialog open={crud.showForm} title={crud.editing ? '编辑词典项' : '新建词典项'} onClose={crud.closeForm}>
        <form onSubmit={crud.submit}>
          <label>
            分类
            <select value={crud.form.dictType} onChange={(event) => crud.updateForm({ dictType: event.target.value })}>
              {DICT_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input value={crud.form.name} onChange={(event) => crud.updateForm({ name: event.target.value })} />
          </label>
          <label>
            排序
            <input type="number" value={crud.form.sortOrder} onChange={(event) => crud.updateForm({ sortOrder: event.target.value })} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={crud.form.active}
              onChange={(event) => crud.updateForm({ active: event.target.checked })}
            />
            启用
          </label>
          <label>
            备注
            <textarea value={crud.form.remark} onChange={(event) => crud.updateForm({ remark: event.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={crud.closeForm}>取消</button>
            <button type="submit" disabled={crud.submitting}>{crud.submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={crud.deleteTarget !== null}
        title="删除确认"
        message="确定删除该词典项吗？"
        confirmText="确认删除"
        danger
        onConfirm={() => void crud.confirmDelete()}
        onCancel={crud.cancelDelete}
      />
    </>
  );
}
