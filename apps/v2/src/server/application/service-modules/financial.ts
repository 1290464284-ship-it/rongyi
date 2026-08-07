// financial 服务 barrel（M-04：由单文件 financial.ts 拆分）。
// 保持 `export * from './service-modules/financial'` 与
// `import { ChargeService } from './financial'` 兼容。
export { ChargeService } from './financial/charge.service';
export { MemberCardService } from './financial/member-card.service';
export { PurchaseOrderService } from './financial/purchase-order.service';
export { ProcessingOrderService } from './financial/processing-order.service';
export { DebtService } from './financial/debt.service';
