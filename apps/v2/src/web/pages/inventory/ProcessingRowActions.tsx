import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import { transitionProcessingOrder } from '../../processing-orders/api';
import { ProcessingStatusSelect } from '../../processing-orders/ProcessingStatusSelect';
import type { ProcessingRow } from '../../processing-orders/types';

/** 行内“撤销结算”按钮：busy 期间禁用，防止双击重复撤销。 */
function UnsettleButton({ onDone, disabled }: { onDone: () => Promise<void>; disabled?: boolean }) {
  const { busy, run } = useAsyncAction();
  return (
    /* v8 ignore next -- disabled 时浏览器不派发点击，守卫为防御冗余 */
    <button disabled={busy || disabled} onClick={() => { if (disabled) return; run(onDone); }}>
      {busy ? '撤销中...' : '撤销结算'}
    </button>
  );
}

export function ProcessingRowActions({ row, ctx, onFlow, onSettle, onUnsettle }: {
  row: ProcessingRow;
  ctx: { stale: boolean; reload: () => Promise<unknown> };
  onFlow: (ctx: { stale: boolean }, row: ProcessingRow) => void;
  onSettle: (ctx: { stale: boolean; reload: () => Promise<unknown> }, row: ProcessingRow) => void;
  onUnsettle: (row: ProcessingRow, reload: () => Promise<unknown>) => Promise<void>;
}) {
  const { showToast } = useToast();
  return (
    <>
      <button disabled={ctx.stale} onClick={() => onFlow(ctx, row)}>流程</button>
      <ProcessingStatusSelect
        rowId={row.id}
        disabled={ctx.stale}
        onTransition={(id, status) => {
          /* v8 ignore next -- 状态选择器在 stale 期间 disabled */
          if (ctx.stale) return;
          transitionProcessingOrder(showToast, ctx.reload, id, status);
        }}
      />
      {row.settleStatus === 'SETTLED' ? (
        <UnsettleButton disabled={ctx.stale} onDone={() => onUnsettle(row, ctx.reload)} />
      ) : (
        <button disabled={ctx.stale} onClick={() => onSettle(ctx, row)}>结算</button>
      )}
    </>
  );
}
