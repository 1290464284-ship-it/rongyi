import { LoadingState, PageError, PagePager, SearchInput } from '../../components';
import { toCents } from '../../lib/format';
import { useCrudResource } from '../../hooks/use-crud-resource';
import type { ChargeForm, ChargeRow } from '../../charges/types';
import { buildValidItems, emptyChargeForm } from '../../charges/charge-utils';
import { ChargeCreateForm } from '../../charges/ChargeCreateForm';
import { ChargeList } from '../../charges/ChargeList';
import { ChargeTreePanel } from '../../charges/ChargeTreePanel';
import { useChargesActions } from './charges-actions';
import { ChargesDialogs } from './charges-dialogs';

export function ChargesPage({ initialSearch }: { initialSearch?: string } = {}) {
  const crud = useCrudResource<ChargeRow, ChargeForm>({
    queryKey: ['charges'],
    endpoint: '/charges',
    listPath: ({ page, search }) => `/resources/charges?page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    initialSearch,
    initialForm: emptyChargeForm,
    validate: (form) => {
      const validItems = buildValidItems(form.items);
      if (!form.patientId || validItems.length === 0) {
        return '请选择患者并至少填写一条有效收费明细';
      }
      return null;
    },
    toPayload: (form) => ({
      patientId: form.patientId,
      items: buildValidItems(form.items),
      discount: toCents(form.discount) || undefined,
      remark: form.remark || undefined,
    }),
    messages: { create: '收费单已创建' },
    errorMessages: { create: '创建收费失败' },
  });
  const actions = useChargesActions(crud);

  if (crud.query.isLoading) return <LoadingState />;
  if (crud.query.error) return <PageError message={(crud.query.error as Error).message} />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>收费管理</h1>
        <SearchInput
          value={crud.searchInput}
          onChange={crud.setSearch}
          placeholder="搜索收费单..."
          ariaLabel="搜索收费单"
        />
      </div>
      <ChargeCreateForm
        form={crud.form}
        update={crud.updateForm}
        updateItem={actions.updateItem}
        submitting={crud.submitting}
        onSubmit={crud.submit}
        comboLoading={actions.comboLoading}
        actionBusy={actions.actionBusy}
        onLoadCombos={actions.loadCombos}
        onQuoteDiscount={actions.quoteMemberDiscount}
      />
      {actions.payMethodQuery.error && (
        <span className="field-error" role="alert">
          自定义缴费方式加载失败，已回退内置方式
          <button type="button" onClick={() => void actions.payMethodQuery.refetch()}>重试</button>
        </span>
      )}
      <ChargeList
        rows={crud.rows}
        onPayment={actions.setPaymentTarget}
        onRefund={actions.setRefundTarget}
        onDelete={actions.setDeleteTarget}
        disabled={actions.stale}
      />
      <PagePager
        page={crud.page}
        hasNext={crud.hasNext}
        onPageChange={crud.setPage}
        disabled={actions.stale}
      />

      <section aria-label="收费项目" className="charge-tree-panel">
        <h2>收费项目</h2>
        <ChargeTreePanel
          isLoading={actions.chargeTreeQuery.isLoading}
          error={actions.chargeTreeQuery.error}
          items={actions.chargeTreeQuery.data?.items ?? []}
          expandedCatalogs={actions.expandedCatalogs}
          onToggleCatalog={actions.toggleCatalog}
          onQuickCharge={actions.openQuickCharge}
        />
      </section>

      <ChargesDialogs {...actions} />
    </div>
  );
}
