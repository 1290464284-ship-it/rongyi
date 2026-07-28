import { describe, it, expect } from 'vitest';
import {
  Role,
  Gender,
  PatientSource,
  AppointmentStatus,
  AppointmentType,
  VisitStatus,
  TreatmentStatus,
  ChargeStatus,
  PayMethod,
  FollowUpStatus,
} from '../../enums';

describe('enums exports', () => {
  it('should export Role enum', () => {
    expect(Role.BOSS).toBe('BOSS');
    expect(Role.DOCTOR).toBe('DOCTOR');
    expect(Role.RECEPTIONIST).toBe('RECEPTIONIST');
  });

  it('should export Gender enum', () => {
    expect(Gender.MALE).toBe('MALE');
    expect(Gender.FEMALE).toBe('FEMALE');
  });

  it('should export PatientSource enum', () => {
    expect(PatientSource.WALK_IN).toBe('WALK_IN');
    expect(PatientSource.REFERRAL).toBe('REFERRAL');
  });

  it('should export AppointmentStatus enum', () => {
    expect(AppointmentStatus.BOOKED).toBe('BOOKED');
    expect(AppointmentStatus.ARRIVED).toBe('ARRIVED');
    expect(AppointmentStatus.CANCELLED).toBe('CANCELLED');
  });

  it('should export AppointmentType enum', () => {
    expect(AppointmentType.FIRST_VISIT).toBe('FIRST_VISIT');
    expect(AppointmentType.RETURN).toBe('RETURN');
  });

  it('should export VisitStatus enum', () => {
    expect(VisitStatus.IN_PROGRESS).toBe('IN_PROGRESS');
    expect(VisitStatus.COMPLETED).toBe('COMPLETED');
  });

  it('should export TreatmentStatus enum', () => {
    expect(TreatmentStatus.PLANNED).toBe('PLANNED');
    expect(TreatmentStatus.COMPLETED).toBe('COMPLETED');
  });

  it('should export ChargeStatus enum', () => {
    expect(ChargeStatus.UNPAID).toBe('UNPAID');
    expect(ChargeStatus.PAID).toBe('PAID');
  });

  it('should export PayMethod enum', () => {
    expect(PayMethod.CASH).toBe('CASH');
    expect(PayMethod.WECHAT).toBe('WECHAT');
  });

  it('should export FollowUpStatus enum', () => {
    expect(FollowUpStatus.PENDING).toBe('PENDING');
    expect(FollowUpStatus.COMPLETED).toBe('COMPLETED');
  });
});
