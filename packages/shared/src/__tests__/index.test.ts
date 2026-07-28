import { describe, it, expect } from 'vitest';
import * as shared from '../index';

describe('shared package index exports', () => {
  it('should export validators', () => {
    expect(shared.yuanToCents).toBeDefined();
    expect(shared.centsToYuan).toBeDefined();
    expect(shared.formatCents).toBeDefined();
    expect(shared.isValidMoneyAmount).toBeDefined();
    expect(shared.isPhoneNumber).toBeDefined();
    expect(shared.normalizePhone).toBeDefined();
  });

  it('should export constants', () => {
    expect(shared.MAX_PAGE_SIZE).toBeDefined();
    expect(shared.PAGINATION).toBeDefined();
    expect(shared.ROLES).toBeDefined();
    expect(shared.ROLE_LEVELS).toBeDefined();
    expect(shared.hasRoleLevel).toBeDefined();
    expect(shared.CACHE_PREFIXES).toBeDefined();
    expect(shared.buildCacheKey).toBeDefined();
  });

  it('should export enums', () => {
    expect(shared.Role).toBeDefined();
    expect(shared.Gender).toBeDefined();
    expect(shared.PatientSource).toBeDefined();
    expect(shared.AppointmentStatus).toBeDefined();
    expect(shared.AppointmentType).toBeDefined();
    expect(shared.VisitStatus).toBeDefined();
    expect(shared.TreatmentStatus).toBeDefined();
    expect(shared.ChargeStatus).toBeDefined();
    expect(shared.PayMethod).toBeDefined();
    expect(shared.FollowUpStatus).toBeDefined();
  });

  it('should export type label mappings', () => {
    expect(shared.PATIENT_SOURCE_LABEL).toBeDefined();
    expect(shared.PATIENT_SOURCE_COLOR).toBeDefined();
    expect(shared.APPOINTMENT_STATUS_LABEL).toBeDefined();
    expect(shared.TREATMENT_STATUS_LABEL).toBeDefined();
    expect(shared.CHARGE_STATUS_LABEL).toBeDefined();
    expect(shared.EQUIPMENT_STATUS_LABEL).toBeDefined();
    expect(shared.EQUIPMENT_STATUS_COLOR).toBeDefined();
    expect(shared.EQUIPMENT_CATEGORIES).toBeDefined();
  });

  it('validators should work when imported from index', () => {
    expect(shared.yuanToCents(10)).toBe(1000);
    expect(shared.centsToYuan(1000)).toBe(10);
    expect(shared.isValidMoneyAmount(100)).toBe(true);
    expect(shared.isValidMoneyAmount(-1)).toBe(false);
    expect(shared.isPhoneNumber('13800138000')).toBe(true);
    expect(shared.isPhoneNumber('12345')).toBe(false);
  });
});
