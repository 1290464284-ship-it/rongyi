import * as crypto from 'node:crypto';

export interface MemberCardSeedData {
  id: string;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  totalPoints: number;
  level: string;
  status: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}

const STATUSES = ['ACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED'];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let cardNoCounter = 0;

export function createMemberCard(
  overrides: Partial<MemberCardSeedData> & {
    clinicId: string;
    patientId: string;
  },
): MemberCardSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  cardNoCounter++;
  const cardNo = overrides.cardNo || `MC${String(cardNoCounter).padStart(8, '0')}`;

  const status = overrides.status || (Math.random() < 0.9 ? 'ACTIVE' : randomItem(STATUSES));

  const totalRecharge = overrides.totalRecharge ?? (
    randomInt(status === 'ACTIVE' ? 1 : 0, status === 'ACTIVE' ? 20 : 10) * 10000
  );

  const totalConsume = overrides.totalConsume ?? (
    totalRecharge > 0
      ? Math.floor(totalRecharge * (0.2 + Math.random() * 0.7))
      : 0
  );

  const balance = overrides.balance ?? Math.max(0, totalRecharge - totalConsume);

  const totalPoints = overrides.totalPoints ?? Math.floor(totalRecharge / 100);
  const points = overrides.points ?? Math.floor(totalPoints * (0.3 + Math.random() * 0.7));

  let level = overrides.level;
  if (!level) {
    if (totalRecharge >= 100000) level = 'DIAMOND';
    else if (totalRecharge >= 50000) level = 'PLATINUM';
    else if (totalRecharge >= 20000) level = 'GOLD';
    else if (totalRecharge >= 5000) level = 'SILVER';
    else level = 'NORMAL';
  }

  return {
    id,
    patientId: overrides.patientId,
    cardNo,
    balance,
    totalRecharge,
    totalConsume,
    points,
    totalPoints,
    level,
    status,
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createMemberCards(
  count: number,
  options: {
    clinicId: string;
    patients: Array<{ id: string }>;
  },
): MemberCardSeedData[] {
  const result: MemberCardSeedData[] = [];
  const { clinicId, patients } = options;

  if (patients.length === 0) {
    return result;
  }

  const shuffledPatients = [...patients].sort(() => Math.random() - 0.5);
  const actualCount = Math.min(count, shuffledPatients.length);

  for (let i = 0; i < actualCount; i++) {
    result.push(
      createMemberCard({
        clinicId,
        patientId: shuffledPatients[i].id,
      }),
    );
  }

  return result;
}

export function resetMemberCardNoCounter(): void {
  cardNoCounter = 0;
}
