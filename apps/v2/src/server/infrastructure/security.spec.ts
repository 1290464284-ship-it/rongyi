import { describe, expect, it } from 'vitest';
import { maskSensitiveFields, stripProtectedWriteFields } from './security';

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

  it('stops recursion beyond depth 5', () => {
    const deep = { a: { b: { c: { d: { e: { f: { phone: 'x' } } } } } } };
    const masked = maskSensitiveFields(deep);
    expect(masked.a.b.c.d.e.f.phone).toBe('x');
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
});
