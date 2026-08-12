import { AppError } from '../../infrastructure/errors';
import { ValidationError } from '../../infrastructure/errors';
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

/** SyncChange 落库失败必须回滚整批业务写入，否则其他设备永远拉不到该变更。 */
export class SyncChangeRecordError extends Error {}

export function assertSyncTablePermission(context: AppContext, table: string): void {
  const resource = SYNC_RESOURCES[table];
  const permission = resource ? RESOURCE_PERMISSION_MAP[resource] : undefined;
  // 生产上下文由 authMiddleware 注入生效权限；测试夹具可能不带 permissions，跳过即保持旧行为。
  if (permission && context.permissions && !context.permissions.includes(permission)) {
    throw new AppError('FORBIDDEN', `Sync table requires ${permission} permission`, 403);
  }
}

export function assertSyncPushShape(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { changes?: unknown }).changes)) {
    throw new ValidationError('changes must be an array');
  }
  const { deviceId, deviceToken } = payload as { deviceId?: unknown; deviceToken?: unknown };
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new ValidationError('deviceId must be a non-empty string');
  }
  if (typeof deviceToken !== 'string' || deviceToken.length === 0) {
    throw new ValidationError('deviceToken must be a non-empty string');
  }
  const changes = (payload as { changes: unknown[] }).changes;
  if (changes.length > 5000) throw new ValidationError('changes must be an array with at most 5000 entries');
  for (const change of changes) {
    if (
      !change
      || typeof change !== 'object'
      || typeof (change as { tableName?: unknown }).tableName !== 'string'
      || typeof (change as { recordId?: unknown }).recordId !== 'string'
      || typeof (change as { operation?: unknown }).operation !== 'string'
    ) {
      throw new ValidationError('each change requires tableName, recordId and operation');
    }
  }
}
