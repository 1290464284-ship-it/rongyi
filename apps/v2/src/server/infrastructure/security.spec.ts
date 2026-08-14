import { describe, expect, it } from 'vitest';
import { assertProductionBackupKeyConfigured, maskSensitiveFields, stripProtectedWriteFields } from './security';

describe('security helpers', () => {
  it('masks sensitive fields before returning rows', () => {
    const row = maskSensitiveFields({
      id: 'u1',
      username: 'admin',
      passwordHash: 'hash',
      refreshToken: 'token',
      phone: '13800000000',
    }) as Record<string, unknown>;
    expect(row.passwordHash).toBeNull();
    expect(row.refreshToken).toBeNull();
    expect(row.phone).toBe('13800000000');
  });

  it('removes protected fields from generic write payloads', () => {
    const payload = stripProtectedWriteFields({
      name: 'Doctor',
      passwordHash: 'hash',
      refreshToken: 'token',
      clinicId: 'other-clinic',
      createdAt: '2020-01-01',
    });
    expect(payload.name).toBe('Doctor');
    expect(payload.passwordHash).toBeUndefined();
    expect(payload.refreshToken).toBeUndefined();
    expect(payload.clinicId).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
  });

  it('masks expanded sensitive fields and nested values recursively', () => {
    const masked = maskSensitiveFields({
      id: 'p1',
      name: 'Alice',
      phone: '13800000000',
      idCard: '110101199001011234',
      member: { cardNo: 'MC-001', wechatId: 'wx_abc' },
      contacts: [{ email: 'a@b.com', mobile: '13900000000' }],
      medicalRecordNo: 'MR-9',
      insuranceNo: 'IN-8',
      note: 'plain',
    });
    expect(masked).toMatchObject({
      phone: '13800000000',
      idCard: '110101199001011234',
      note: 'plain',
      member: { cardNo: 'MC-001', wechatId: 'wx_abc' },
      contacts: [{ email: 'a@b.com', mobile: '13900000000' }],
      medicalRecordNo: 'MR-9',
      insuranceNo: 'IN-8',
    });
  });

  it('truncates recursion beyond depth 5 instead of leaking nested values', () => {
    const deep = { a: { b: { c: { d: { e: { f: { phone: 'x' } } } } } } };
    const masked = maskSensitiveFields(deep);
    expect(masked.a.b.c.d.e.f).toBe('[MaxDepth]');
  });

  it('keeps business fields writable while blocking credentials', () => {
    const payload = stripProtectedWriteFields({
      phone: '13800000000',
      idCard: '110101199001011234',
      cardNo: 'MC-001',
      passwordHash: 'hash',
      role: 'ADMIN',
      balance: 100,
    });
    expect(payload.phone).toBe('13800000000');
    expect(payload.idCard).toBe('110101199001011234');
    expect(payload.cardNo).toBe('MC-001');
    expect(payload.passwordHash).toBeUndefined();
    expect(payload.role).toBeUndefined();
    expect(payload.balance).toBeUndefined();
  });

  it('fails closed in production when the backup key is missing', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBackupKey = process.env.V2_BACKUP_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.V2_BACKUP_KEY;
      expect(() => assertProductionBackupKeyConfigured('production')).toThrow('V2_BACKUP_KEY must be set');
      process.env.V2_BACKUP_KEY = 'production-backup-key';
      expect(() => assertProductionBackupKeyConfigured('production')).not.toThrow();
      expect(() => assertProductionBackupKeyConfigured('development')).not.toThrow();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousBackupKey === undefined) delete process.env.V2_BACKUP_KEY;
      else process.env.V2_BACKUP_KEY = previousBackupKey;
    }
  });

  it('honours exempt fields across generic, resource and state-machine protection', () => {
    const kept = stripProtectedWriteFields(
      { role: 'ADMIN', balance: 100, status: 'COMPLETED', totalAmount: 500 },
      new Set(['role', 'status', 'totalAmount']),
      'purchaseOrders',
      { protectStateMachine: true },
    );
    expect(kept.role).toBe('ADMIN');
    expect(kept.balance).toBeUndefined();
    expect(kept.status).toBe('COMPLETED');
    expect(kept.totalAmount).toBe(500);

    const stateKept = stripProtectedWriteFields(
      { status: 'COMPLETED', passwordHash: 'h' },
      new Set(['status']),
      'appointments',
      { protectStateMachine: true },
    );
    expect(stateKept.status).toBe('COMPLETED');
    expect(stateKept.passwordHash).toBeUndefined();
  });

  it('treats a missing NODE_ENV as development', () => {
    const previous = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      expect(() => assertProductionBackupKeyConfigured()).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
