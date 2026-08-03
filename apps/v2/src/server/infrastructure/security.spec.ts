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
    });
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
});

