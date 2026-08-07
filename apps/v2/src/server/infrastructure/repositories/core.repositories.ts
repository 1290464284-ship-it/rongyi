// 核心仓储 barrel（M-04：由单文件 core.repositories.ts 拆分）。
// 保持 `from '...repositories/core.repositories'` 导入兼容。
export { SqliteMemberCardRepository } from './member-card.repository';
export { SqliteInventoryRepository } from './inventory.repository';
export { SqliteDebtRepository } from './debt.repository';
export { SqliteAuthRepository } from './auth.repository';
export { SqlitePurchaseOrderRepository } from './purchase-order.repository';
export { SqliteProcessingOrderRepository } from './processing-order.repository';
export { SqliteFollowUpRepository, SqliteWechatMessageRepository } from './follow-up.repository';
export { SqliteAlertRepository } from './alerts.repository';
export { SqlitePatientRiskRepository } from './patient-risk.repository';
export { SqliteAnalyticsRepository } from './analytics.repository';
export { SqliteHrRepository } from './hr.repository';
export { SqliteClinicalWorkflowRepository } from './clinical-workflow.repository';
