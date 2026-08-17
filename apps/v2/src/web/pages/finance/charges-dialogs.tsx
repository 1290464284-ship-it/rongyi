import { ConfirmDialog, Dialog } from '../../components';
import { ComboDialog } from '../../charges/ComboDialog';
import { PaymentDialog } from '../../charges/PaymentDialog';
import { QuickChargeDialog } from '../../charges/QuickChargeDialog';
import { RefundDialog } from '../../charges/RefundDialog';
import type { ChargesActions } from './charges-actions';

export function ChargesDialogs(props: ChargesActions) {
  const {
    paymentTarget,
    setPaymentTarget,
    paymentAmount,
    setPaymentAmount,
    paymentMethod,
    setPaymentMethod,
    paymentMethodRoot,
    setPaymentMethodRoot,
    actionBusy,
    pay,
    payTreeLoaded,
    payRoots,
    payLeafOptions,
    effectivePayRoot,
    effectivePayLeaf,
    refundTarget,
    setRefundTarget,
    refundAmount,
    setRefundAmount,
    refundReason,
    setRefundReason,
    refund,
    quickTarget,
    setQuickTarget,
    quickQuantity,
    setQuickQuantity,
    quickPatientId,
    setQuickPatientId,
    quickBusy,
    quickCharge,
    comboOpen,
    setComboOpen,
    combos,
    applyCombo,
    deleteTarget,
    setDeleteTarget,
    deleteCharge,
  } = props;

  return (
    <>
      <Dialog open={paymentTarget !== null} title="收款" onClose={() => setPaymentTarget(null)}>
        <PaymentDialog
          amount={paymentAmount}
          setAmount={setPaymentAmount}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          methodRoot={paymentMethodRoot}
          setMethodRoot={setPaymentMethodRoot}
          busy={actionBusy}
          onClose={() => setPaymentTarget(null)}
          onSubmit={pay}
          payTreeLoaded={payTreeLoaded}
          payRoots={payRoots}
          payLeafOptions={payLeafOptions}
          effectivePayRoot={effectivePayRoot}
          effectivePayLeaf={effectivePayLeaf}
        />
      </Dialog>

      <Dialog open={refundTarget !== null} title="退款" onClose={() => setRefundTarget(null)}>
        <RefundDialog
          amount={refundAmount}
          setAmount={setRefundAmount}
          reason={refundReason}
          setReason={setRefundReason}
          busy={actionBusy}
          onClose={() => setRefundTarget(null)}
          onSubmit={refund}
        />
      </Dialog>

      <Dialog open={quickTarget !== null} title="快捷收费" onClose={() => setQuickTarget(null)}>
        <QuickChargeDialog
          target={quickTarget}
          quantity={quickQuantity}
          setQuantity={setQuickQuantity}
          patientId={quickPatientId}
          setPatientId={setQuickPatientId}
          busy={quickBusy}
          onClose={() => setQuickTarget(null)}
          onSubmit={quickCharge}
        />
      </Dialog>

      <Dialog open={comboOpen} title="调出收费组合" onClose={() => setComboOpen(false)}>
        <ComboDialog combos={combos} onClose={() => setComboOpen(false)} onApply={applyCombo} />
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除收费单确认"
        message={`确定删除该收费单吗？此操作不可恢复。${deleteTarget ? `（${deleteTarget.number ?? deleteTarget.id}）` : ''}`}
        confirmText="确认删除"
        danger
        onConfirm={() => deleteCharge()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
