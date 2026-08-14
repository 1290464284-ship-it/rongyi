import { describe, expect, it } from 'vitest';
import { AppError } from '../../infrastructure/errors';
import { assertSyncPushShape, assertSyncTablePermission } from './sync-permissions';

describe('sync permission guards', () => {
  it('allows unknown tables and contexts without permissions', () => {
    expect(() => assertSyncTablePermission(
      { userId: 'u', clinicId: null, role: 'BOSS', traceId: 't', now: () => new Date() },
      'UnknownTable',
    )).not.toThrow();
    expect(() => assertSyncTablePermission(
      { userId: 'u', clinicId: null, role: 'DOCTOR', traceId: 't', now: () => new Date() },
      'Patient',
    )).not.toThrow();
  });

  it('blocks tables whose module permission is missing from the context', () => {
    const assert = (): void => assertSyncTablePermission({
      userId: 'u',
      clinicId: null,
      role: 'DOCTOR',
      permissions: ['dashboard'],
      traceId: 't',
      now: () => new Date(),
    }, 'Charge');
    expect(assert).toThrow(AppError);
    expect(assert).toThrow('Sync table requires finance permission');
  });

  it('validates sync push payload shapes', () => {
    expect(() => assertSyncPushShape(null)).toThrow('changes must be an array');
    expect(() => assertSyncPushShape({ changes: [] })).toThrow('deviceId must be a non-empty string');
    expect(() => assertSyncPushShape({ deviceId: 'd', changes: [] })).toThrow('deviceToken must be a non-empty string');
    expect(() => assertSyncPushShape({ deviceId: 'd', deviceToken: 't', changes: new Array(5001).fill({}) }))
      .toThrow('changes must be an array with at most 5000 entries');
    expect(() => assertSyncPushShape({
      deviceId: 'd',
      deviceToken: 't',
      changes: [{ tableName: 'Patient', recordId: 'p1' }],
    })).toThrow('each change requires tableName, recordId and operation');
    expect(() => assertSyncPushShape({
      deviceId: 'd',
      deviceToken: 't',
      changes: [{ tableName: 'Patient', recordId: 'p1', operation: 'UPSERT' }],
    })).not.toThrow();
  });
});
