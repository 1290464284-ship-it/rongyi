import * as crypto from 'node:crypto';

export interface AppointmentSeedData {
  id: string;
  patientId: string;
  doctorId: string;
  chairId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  type: string;
  remark: string;
  visitId: string | null;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}



const TYPES = [
  '常规检查',
  '洗牙',
  '补牙',
  '根管治疗',
  '拔牙',
  '牙齿美白',
  '种植牙',
  '正畸咨询',
  '牙周治疗',
  '儿童齿科',
  'X光检查',
  'CT检查',
  '复查',
  '初诊',
];

const REMARKS = [
  '患者主诉牙痛',
  '需要做根管治疗',
  '定期洗牙',
  '儿童窝沟封闭',
  '种植牙复查',
  '正畸复诊',
  '补牙材料脱落',
  '牙龈出血',
  '智齿发炎',
  '牙齿敏感',
  '',
  '',
  '',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomDate(daysBack: number = 90, daysForward: number = 30): Date {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOffset = -daysBack * 24 * 60 * 60 * 1000;
  const endOffset = daysForward * 24 * 60 * 60 * 1000;
  const randomMs = startOffset + Math.random() * (endOffset - startOffset);
  const baseDate = new Date(startOfDay.getTime() + randomMs);

  const workStartHour = 8;
  const workEndHour = 18;
  const hour = randomInt(workStartHour, workEndHour - 1);
  const minute = randomInt(0, 11) * 5;

  baseDate.setHours(hour, minute, 0, 0);
  return baseDate;
}

function getDurationMinutes(type: string): number {
  if (type.includes('根管') || type.includes('种植') || type.includes('正畸')) return 60;
  if (type.includes('洗牙') || type.includes('美白') || type.includes('拔牙')) return 45;
  if (type.includes('检查') || type.includes('复查') || type.includes('初诊')) return 30;
  if (type.includes('补牙')) return 30;
  return 30;
}

function getStatusForDate(appointmentDate: Date): string {
  const now = new Date();
  const diffMs = appointmentDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours > 0) {
    return Math.random() < 0.9 ? 'BOOKED' : 'CANCELLED';
  }

  const rand = Math.random();
  if (rand < 0.65) return 'COMPLETED';
  if (rand < 0.75) return 'NO_SHOW';
  if (rand < 0.85) return 'CANCELLED';
  return 'COMPLETED';
}

export function createAppointment(
  overrides: Partial<AppointmentSeedData> & {
    clinicId: string;
    patientId: string;
    doctorId: string;
    chairId?: string;
  },
): AppointmentSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();

  const type = overrides.type || randomItem(TYPES);
  const startTimeStr = overrides.startTime || generateRandomDate().toISOString();
  const startTime = new Date(startTimeStr);

  const durationMinutes = getDurationMinutes(type);
  const endTime = overrides.endTime
    ? new Date(overrides.endTime)
    : new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const status = overrides.status || getStatusForDate(startTime);

  return {
    id,
    patientId: overrides.patientId,
    doctorId: overrides.doctorId,
    chairId: overrides.chairId || null,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    status,
    type,
    remark: overrides.remark || randomItem(REMARKS),
    visitId: overrides.visitId || null,
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createAppointments(
  count: number,
  options: {
    clinicId: string;
    patients: Array<{ id: string }>;
    doctors: Array<{ id: string }>;
    chairs?: Array<{ id: string }>;
  },
): AppointmentSeedData[] {
  const result: AppointmentSeedData[] = [];
  const { clinicId, patients, doctors, chairs = [] } = options;

  if (patients.length === 0 || doctors.length === 0) {
    return result;
  }

  for (let i = 0; i < count; i++) {
    const patient = randomItem(patients);
    const doctor = randomItem(doctors);
    const chair = chairs.length > 0 ? randomItem(chairs) : undefined;

    result.push(
      createAppointment({
        clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        chairId: chair?.id,
      }),
    );
  }

  return result;
}
