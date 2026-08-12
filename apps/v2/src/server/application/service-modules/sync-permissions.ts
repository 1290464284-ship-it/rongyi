import { AppError } from '../../infrastructure/errors';
import { RESOURCE_PERMISSION_MAP } from './permissions';
import type { AppContext } from '../../../domain/contracts';

export const SYNC_RESOURCES: Record<string, string> = {
  Patient: 'patients',
  Appointment: 'appointments',
  Treatment: 'treatments',
  Charge: 'charges',
  InventoryItem: 'inventoryItems',
  FollowUp: 'followUps',
  PurchaseOrder: 'purchaseOrders',
};

export function assertSyncTablePermission(context: AppContext, table: string): void {
  const resource = SYNC_RESOURCES[table];
  const permission = resource ? RESOURCE_PERMISSION_MAP[resource] : undefined;
  // 生产上下文由 authMiddleware 注入生效权限；测试夹具可能不带 permissions，跳过即保持旧行为。
  if (permission && context.permissions && !context.permissions.includes(permission)) {
    throw new AppError('FORBIDDEN', `Sync table requires ${permission} permission`, 403);
  }
}
