import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCrudResource, type CrudResourceOptions } from '../hooks/use-crud-resource';
import { ConfirmDialog, DataTable, Dialog, EmptyState, LoadingState, PageError, PagePager, SearchInput, type DataTableColumn } from '.';

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
 * - 只读统计端点表格：ResourcePage 的 endpoint 只读模式（hub-tabs 的 5 个统计 Tab 专用）→ 用它。
 */
interface CrudRenderContext<TForm extends object> {
  form: TForm;
  update: (patch: Partial<TForm>) => void;
  editing: boolean;
  /** 列表当前展示旧数据占位，行内写操作应禁用。 */
  stale: boolean;
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
  /** 新建/编辑 Dialog 关闭（取消/成功）后的回调；用于清空页面级残留状态（如已选文件）。 */
  onFormClose?: () => void;
  /** 表格列（不含操作列；操作列由 rowActions/canEdit/canDelete 自动追加）。 */
  columns: DataTableColumn<TRow>[];
  /** 行操作内容（如状态变更下拉、收款/退款按钮）。 */
  rowActions?: (row: TRow, ctx: CrudRenderContext<TForm>) => ReactNode;
  /**
   * 编辑打开时的异步字段补充（如从详情接口拉取被列表掩码的完整值）。
   * 返回的补丁合并到 formFromRow 结果之上；加载期间提交按钮禁用。
   * 连续打开多行时，过期请求的结果会被丢弃（按 dialogEpoch 防串）。
   */
  onEditLoad?: (row: TRow) => Promise<Partial<TForm> | null | undefined>;
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
  /** 渲染上下文变化回调（effect 期触发，一次渲染仅一次）：供页面侧安全捕获 stale/reload，替代每行实例化捕获组件 */
  onContextChange?: (ctx: CrudRenderContext<TForm>) => void;
  /** 必填：Dialog 内表单体（含字段控件；提交/取消按钮由 CrudPage 提供）。 */
  renderForm: (ctx: CrudRenderContext<TForm>) => ReactNode;
}

export function CrudPage<
  TRow extends Record<string, unknown>,
  TForm extends object,
>(props: CrudPageProps<TRow, TForm>) {
  const crud = useCrudResource<TRow, TForm>({
    ...props,
    onSaved: async (id, editing, savedForm) => {
      props.onFormClose?.();
      await props.onSaved?.(id, editing, savedForm);
    },
  });
  const isStale = crud.isStale;
  const { query, rows, searchInput, setSearch, page, setPage, showForm, editing, form, updateForm, reload } = crud;
  const ctx: CrudRenderContext<TForm> = { form, update: updateForm, editing, stale: isStale, reload };
  // 渲染上下文在 effect 期通知页面（一次渲染仅一次），替代行内每行实例化的捕获组件
  useEffect(() => {
    props.onContextChange?.(ctx);
  });
  // Dialog key：每次打开表单递增，强制重挂载，取消动画期间再次打开时清掉迟到的关闭定时器
  const [dialogEpoch, setDialogEpoch] = useState(0);
  const [editLoading, setEditLoading] = useState(false);
  // 异步编辑加载的过期防护用 ref（闭包里的 dialogEpoch 是打开瞬间的旧值，不能用于比对）
  const dialogEpochRef = useRef(0);
  function openCreate() {
    crud.openCreate();
    dialogEpochRef.current += 1;
    setDialogEpoch(dialogEpochRef.current);
  }
  function openEdit(row: TRow) {
    crud.openEdit(row);
    dialogEpochRef.current += 1;
    const epoch = dialogEpochRef.current;
    setDialogEpoch(epoch);
    if (!props.onEditLoad) return;
    setEditLoading(true);
    props.onEditLoad(row)
      .then((patch) => {
        // 过期响应丢弃：期间用户可能已打开另一行或关闭表单
        if (dialogEpochRef.current !== epoch) return;
        if (patch) updateForm(patch);
      })
      .catch(() => {
        // 加载失败：表单保留列表掩码值，由页面侧提交校验（如掩码检测）兜底，防止掩码落库
      })
      .finally(() => {
        if (dialogEpochRef.current === epoch) setEditLoading(false);
      });
  }
  function closeForm() {
    crud.closeForm();
    props.onFormClose?.();
  }

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

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
              {props.canEdit && <button disabled={isStale} onClick={() => openEdit(row)}>编辑</button>}
              {props.canDelete && <button className="danger" disabled={isStale} onClick={() => crud.requestDelete(row)}>删除</button>}
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
        <SearchInput
          value={searchInput}
          onChange={setSearch}
          placeholder={props.searchPlaceholder ?? '搜索...'}
          ariaLabel={props.searchAriaLabel ?? '搜索'}
        />
      )}
      {rows.length === 0 ? (
        <EmptyState message={props.emptyMessage ?? '暂无数据'} />
      ) : (
        <DataTable columns={columns} rows={rows} keyField="id" />
      )}
      {props.paged && (
        crud.cursorPagination ? (
          <div className="pager">
            <button type="button" disabled={isStale || !crud.canGoPrev} onClick={crud.goPrev}>上一页</button>
            <span>第 {crud.page} 页</span>
            <button type="button" disabled={isStale || !crud.hasNext} onClick={crud.goNext}>下一页</button>
          </div>
        ) : (
          <PagePager
            page={page}
            hasNext={Boolean(query.data) && page * (props.pageSize ?? 50) < query.data!.total}
            onPageChange={setPage}
            disabled={isStale}
          />
        )
      )}

      <Dialog key={dialogEpoch} open={showForm} title={title} onClose={closeForm}>
        <form onSubmit={crud.submit}>
          {props.renderForm(ctx)}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={closeForm}>取消</button>
            <button type="submit" disabled={crud.submitting || editLoading}>
              {editLoading ? '加载中...' : crud.submitting ? '保存中...' : '保存'}
            </button>
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
          onConfirm={async () => {
            if (isStale) {
              crud.cancelDelete();
              return;
            }
            await crud.confirmDelete();
          }}
          onCancel={crud.cancelDelete}
        />
      )}
    </div>
  );
}
