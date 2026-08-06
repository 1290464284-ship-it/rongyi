import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { AppointmentService } from './auth';

describe('AppointmentService (purpose + temp patient)', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-appointment-purpose-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'DOCTOR', 1, 0, 0)`,
    ).run('doctor-demo-001', 'clinic-v2-001', now, now, 'doctor-demo-001', 'hash', '张医生');
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function createAppointment(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const offset = nextOffset();
    return new AppointmentService(db).create({
      doctorId: 'doctor-demo-001',
      startTime: new Date(Date.UTC(2026, 7, 6, offset, 0, 0)).toISOString(),
      endTime: new Date(Date.UTC(2026, 7, 6, offset + 1, 0, 0)).toISOString(),
      type: 'REGULAR',
      ...overrides,
    } as Parameters<AppointmentService['create']>[0], context);
  }

  let offsetCounter = 8;
  function nextOffset(): number {
    offsetCounter += 2;
    return offsetCounter;
  }

  function appointmentRow(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM Appointment WHERE id = ?').get(id) as Record<string, unknown>;
  }

  function patientCount(): number {
    return Number((db.prepare('SELECT COUNT(*) AS c FROM Patient').get() as { c: number }).c);
  }

  it('persists the purpose on the appointment when provided', async () => {
    const result = await createAppointment({ patientId: 'patient-demo-001', purpose: 'purpose-001' });
    const row = appointmentRow(String(result.id));
    expect(row.purpose).toBe('purpose-001');
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.tempPatientName).toBeNull();
    expect(row.tempPatientPhone).toBeNull();
    expect(row.status).toBe('BOOKED');
  });

  it('creates a temp patient and links the appointment when only tempPatientName/Phone are provided', async () => {
    const before = patientCount();
    const result = await createAppointment({ tempPatientName: '临时甲', tempPatientPhone: '13900000000' });
    const row = appointmentRow(String(result.id));
    expect(row.tempPatientName).toBe('临时甲');
    expect(row.tempPatientPhone).toBe('13900000000');
    expect(row.purpose).toBeNull();
    expect(String(row.patientId)).not.toBe('patient-demo-001');
    expect(patientCount()).toBe(before + 1);

    const patient = db.prepare('SELECT * FROM Patient WHERE id = ?').get(row.patientId) as Record<string, unknown>;
    expect(patient).toBeDefined();
    expect(patient.name).toBe('临时甲');
    expect(patient.phone).toBe('13900000000');
    expect(patient.gender).toBe('UNKNOWN');
    expect(patient.source).toBe('WALK_IN');
    expect(patient.active).toBe(1);
    expect(patient.isTempPatient).toBe(1);
    expect(patient.clinicId).toBe('clinic-v2-001');
    expect(String(patient.code)).toMatch(/^TEMP-/);
  });

  it('uses the existing patient when both patientId and tempPatientName are provided', async () => {
    const before = patientCount();
    const result = await createAppointment({ patientId: 'patient-demo-001', tempPatientName: '临时乙' });
    const row = appointmentRow(String(result.id));
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.tempPatientName).toBeNull();
    expect(row.tempPatientPhone).toBeNull();
    expect(patientCount()).toBe(before);
  });

  it('rejects when neither patientId nor tempPatientName is provided', async () => {
    await expect(createAppointment({})).rejects.toThrow(ValidationError);
    await expect(createAppointment({})).rejects.toThrow('patientId or tempPatientName is required');
    await expect(createAppointment({ tempPatientName: '   ' })).rejects.toThrow(ValidationError);
  });

  it('still validates the patient when patientId is provided', async () => {
    await expect(createAppointment({ patientId: 'patient-missing' })).rejects.toThrow(NotFoundError);
  });

  it('still rejects invalid appointment types', async () => {
    await expect(createAppointment({ patientId: 'patient-demo-001', type: 'WALK_IN' })).rejects.toThrow(ValidationError);
    await expect(createAppointment({ tempPatientName: '临时甲', type: 'BOGUS' })).rejects.toThrow(ValidationError);
  });
});
