import { useState, type ReactNode } from 'react';
import { useCrudResource, type CrudResourceOptions } from '../hooks/use-crud-resource';
import { ConfirmDialog, DataTable, Dialog, EmptyState, LoadingState, PageError, type DataTableColumn } from '.';

/**
 * 泛型 CRUD 页面基座（Round7 M-02 职责说明）。
 * 承载「搜索 → 分页列表 → 新建/编辑 Dialog → 删除确认 → 行操作」的完整 CRUD 交互，
 * 数据访问经 useCrudResource 走通用 /resources/:resource API。
 * 被 12 个业务页使用（Cephalometric/FirstExams/Imaging/MedicalRecords/MemberCards/
 * Patients/Prescriptions/ProcessingOrders/PurchaseOrders/TreatmentPlans/Treatments/Visits）。
 *
 * 与另外两个通用列表组件如何选型：
 * - CrudPage：业务页需要增删改 + 业务行操作 → 用它；
 * - ResourcePage：通用资源管理页（读 /resources/meta 元数据驱动表单与表格）→ 用它；
 * - SimpleListPage：只读统计端点表格（hub-tabs 的 5 个统计 Tab 专用）→ 用它。
 */
interface CrudRenderContext<TForm extends object> {
  form: TForm;
  update: (patch: Partial<TForm>) => void;
  editing: boolean;
  reload: () => Promise<unknown>;
}

export interface CrudPageProps<
  TRow extends Record<string, unknown>,
  TForm extends object,
> extends CrudResourceOptions<TRow, TForm> {
  /** 页面标题（h1）。 */
  title: string;
  /** 新建按钮文案，默认 '新建'；同时作为新建 Dialog 标题。 */
  createLabel?: string;
  /** 空列表文案，默认 '暂无数据'。 */
  emptyMessage?: string;
  /** 表格列（不含操作列；操作列由 rowActions/canEdit/canDelete 自动追加）。 */
  columns: DataTableColumn<TRow>[];
  /** 行操作内容（如状态变更下拉、收款/退款按钮）。 */
  rowActions?: (row: TRow, ctx: CrudRenderContext<TForm>) => ReactNode;
  /** 显示防抖搜索框。 */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** 显示分页器。 */
  paged?: boolean;
  /** Dialog 标题；默认新建 → createLabel，编辑 → `编辑${title}`。 */
  dialogTitle?: string | ((editing: boolean) => string);
  /** 删除确认文案，默认 '确定删除该记录吗？'。 */
  deleteMessage?: string;
  /** 删除确认 Dialog 标题，默认 '删除确认'。 */
  deleteTitle?: string;
  /** page-head 追加按钮（导出等）。 */
  extraHeaderActions?: ReactNode;
  /** 必填：Dialog 内表单体（含字段控件；提交/取消按钮由 CrudPage 提供）。 */
  renderForm: (ctx: CrudRenderContext<TForm>) => ReactNode;
}

export function CrudPage<
  TRow extends Record<string, unknown>,
  TForm extends object,
>(props: CrudPageProps<TRow, TForm>) {
  const crud = useCrudResource<TRow, TForm>(props);
  const { query, rows, searchInput, setSearch, page, setPage, showForm, editing, form, updateForm, reload } = crud;
  // Dialog key：每次打开表单递增，强制重挂载，取消动画期间再次打开时清掉迟到的关闭定时器
  const [dialogEpoch, setDialogEpoch] = useState(0);
  function openCreate() {
    crud.openCreate();
    setDialogEpoch((current) => current + 1);
  }
  function openEdit(row: TRow) {
    crud.openEdit(row);
    setDialogEpoch((current) => current + 1);
  }

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  const ctx: CrudRenderContext<TForm> = { form, update: updateForm, editing, reload };
  const hasRowActions = Boolean(props.rowActions) || props.canEdit || props.canDelete;
  const title = typeof props.dialogTitle === 'function'
    ? props.dialogTitle(editing)
    : props.dialogTitle ?? (editing ? `编辑${props.title}` : (props.createLabel ?? '新建'));
  const columns = hasRowActions
    ? [
        ...props.columns,
        {
          key: 'actions',
          label: '操作',
          render: (row: TRow) => (
            <>
              {props.rowActions?.(row, ctx)}
              {props.canEdit && <button onClick={() => openEdit(row)}>编辑</button>}
              {props.canDelete && <button className="danger" onClick={() => crud.requestDelete(row)}>删除</button>}
            </>
          ),
        },
      ]
    : props.columns;

  return (
    <div className="page">
      <div className="page-head">
        <h1>{props.title}</h1>
        {props.extraHeaderActions}
        <button onClick={openCreate}>{props.createLabel ?? '新建'}</button>
      </div>
      {props.searchable && (
        <input
          className="search"
          placeholder={props.searchPlaceholder ?? '搜索...'}
          aria-label={props.searchAriaLabel ?? '搜索'}
          value={searchInput}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {rows.length === 0 ? (
        <EmptyState message={props.emptyMessage ?? '暂无数据'} />
      ) : (
        <DataTable columns={columns} rows={rows} keyField="id" />
      )}
      {props.paged && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
          <span>第 {page} 页</span>
          <button disabled={!query.data || page * (props.pageSize ?? 50) >= query.data.total} onClick={() => setPage(page + 1)}>下一页</button>
        </div>
      )}

      <Dialog key={dialogEpoch} open={showForm} title={title} onClose={crud.closeForm}>
        <form onSubmit={crud.submit}>
          {props.renderForm(ctx)}
          <div className="modal-actions">
            <button type="button" onClick={crud.closeForm}>取消</button>
            <button type="submit" disabled={crud.submitting}>{crud.submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      {props.canDelete && (
        <ConfirmDialog
          open={crud.deleteTarget !== null}
          title={props.deleteTitle ?? '删除确认'}
          message={props.deleteMessage ?? '确定删除该记录吗？'}
          confirmText="确认删除"
          danger
          onConfirm={() => void crud.confirmDelete()}
          onCancel={crud.cancelDelete}
        />
      )}
    </div>
  );
}
