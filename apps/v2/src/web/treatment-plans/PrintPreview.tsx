import type { ReactNode } from 'react';
import { formatMoney } from '../lib/format';
import type { TreatmentPlanPrintResult } from './plan-types';

export function PrintPreview({ payload, onClose }: { payload: TreatmentPlanPrintResult; onClose: () => void }): ReactNode {
  return (
    <div className="print-preview">
      <p><strong>患者：</strong>{String(payload.plan.patientName ?? '')}</p>
      <p><strong>医生：</strong>{String(payload.plan.doctorName ?? '')}</p>
      <p><strong>计划名称：</strong>{String(payload.plan.name ?? '')}</p>
      <table>
        <thead>
          <tr><th>项目</th><th>数量</th><th>单价</th></tr>
        </thead>
        <tbody>
          {payload.items.map((item, index) => (
            <tr key={String(item.id ?? index)}>
              <td>{String(item.name ?? '')}</td>
              <td>{String(item.quantity ?? '')}</td>
              <td>{formatMoney(item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><strong>模板：</strong>{String(payload.template?.name ?? '默认模板')}</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
        <button type="button" onClick={() => window.print()}>打印本页</button>
      </div>
    </div>
  );
}
