import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AppError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import { stripProtectedWriteFields } from '../../infrastructure/security';
import { validatePayload } from '../../http/validation';
import { resourceRegistry } from '../../../domain/resources';
import type { AppContext } from '../../../domain/contracts';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { hashRefreshToken, newRefreshToken } from './common';

const SYNC_ALLOWED_TABLES = new Set([
  'Patient',
  'Appointment',
  'Treatment',
  'Charge',
  'InventoryItem',
  'FollowUp',
  'PurchaseOrder',
]);

const SYNC_RESOURCES: Record<string, string> = {
  Patient: 'patients',
  Appointment: 'appointments',
  Treatment: 'treatments',
  Charge: 'charges',
  InventoryItem: 'inventoryItems',
  FollowUp: 'followUps',
  PurchaseOrder: 'purchaseOrders',
};

export class SyncService {
  constructor(private readonly db: Database.Database) {}

  pull(since: string, deviceId: string, deviceToken: string, context: AppContext): { changes: Array<Record<string, unknown>>; serverTime: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(deviceId, deviceToken, context);
    const changes = this.db.prepare(
      `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
       FROM SyncChange
       WHERE createdAt > ? AND deviceId != ?${tenantAnd(context.clinicId)}
       ORDER BY createdAt ASC
       LIMIT 1000`,
    ).all(since, deviceId, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return { changes, serverTime: new Date().toISOString() };
  }

  async push(payload: {
    deviceId: string;
    deviceToken: string;
    changes: Array<{
      tableName: string;
      recordId: string;
      operation: string;
      updatedAt: string;
      data?: Record<string, unknown>;
    }>;
  }, context: AppContext): Promise<{
    accepted: number;
    failed: number;
    errors: Array<{ recordId: string; error: string }>;
  }> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(payload.deviceId, payload.deviceToken, context);
    let accepted = 0;
    const errors: Array<{ recordId: string; error: string }> = [];
    for (const change of payload.changes) {
      if (!SYNC_ALLOWED_TABLES.has(change.tableName)) {
        errors.push({ recordId: change.recordId, error: 'Table is not allowed for sync' });
        continue;
      }
      const resourceName = SYNC_RESOURCES[change.tableName];
      const definition = resourceRegistry.get(resourceName);
      /* v8 ignore start */
      if (!definition) {
        errors.push({ recordId: change.recordId, error: `Resource is not defined: ${resourceName}` });
        continue;
      }
      /* v8 ignore stop */
      try {
        const repo = new SqliteRepository(this.db, definition);
        if (change.operation === 'DELETE') {
          if (!(await repo.findById(change.recordId, context))) {
            throw new Error(`Sync record not found: ${change.recordId}`);
          }
          await repo.softDelete(change.recordId, context);
        } else {
          if (!change.data || typeof change.data !== 'object') {
            throw new Error('Sync change requires row data');
          }
          const existing = await repo.findById(change.recordId, context);
          const payloadRow = stripProtectedWriteFields(validatePayload(
            definition,
            change.data,
            existing ? { partial: true } : {},
          ));
          const entity = { id: change.recordId, ...payloadRow };
          if (existing) await repo.update(entity, context);
          else await repo.insert(entity, context);
        }
        this.record(change.tableName, change.recordId, change.operation, payload.deviceId, context.clinicId);
        accepted += 1;
      } catch (error) {
        /* v8 ignore start -- non-Error rejection is defensive; current repositories throw Error instances. */
        errors.push({ recordId: change.recordId, error: error instanceof Error ? error.message : String(error) });
        /* v8 ignore stop */
      }
    }
    return { accepted, failed: errors.length, errors };
  }

  registerDevice(deviceId: string, name: string, context: AppContext): { deviceId: string; token: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    const token = newRefreshToken();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncDevice (
         id, clinicId, userId, deviceId, tokenHash, name, active,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON CONFLICT(clinicId, deviceId) DO UPDATE SET
         tokenHash = excluded.tokenHash,
         name = excluded.name,
         active = 1,
         updatedAt = excluded.updatedAt`,
    ).run(randomUUID(), context.clinicId, context.userId, deviceId, hashRefreshToken(token), name, now, now);
    return { deviceId, token };
  }

  record(tableName: string, recordId: string, operation: string, deviceId: string, clinicId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(randomUUID(), clinicId, now, now, tableName, recordId, operation, deviceId);
  }

  cleanup(before: string | undefined, context: AppContext): { deleted: number; cutoff: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    const cutoff = before ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
    const result = this.db.prepare(
      `DELETE FROM SyncChange WHERE createdAt < ?${tenantAnd(context.clinicId)}`,
    ).run(cutoff, ...tenantParams(context.clinicId));
    return { deleted: result.changes, cutoff };
  }

  private assertDevice(deviceId: string, deviceToken: string, context: AppContext): void {
    if (!deviceId || !deviceToken || !context.clinicId) {
      throw new AppError('UNAUTHORIZED', 'Device credentials are required', 401);
    }
    const device = this.db.prepare(
      `SELECT id FROM SyncDevice WHERE deviceId = ? AND tokenHash = ? AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(deviceId, hashRefreshToken(deviceToken), ...tenantParams(context.clinicId));
    if (!device) throw new AppError('UNAUTHORIZED', 'Device is not registered or active', 401);
  }
}
