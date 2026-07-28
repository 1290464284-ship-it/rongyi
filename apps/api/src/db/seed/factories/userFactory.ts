import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { generateRandomPassword, BCRYPT_ROUNDS_DEFAULT } from '../../../config/constants';

export interface UserSeedData {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  phone: string;
  active: number;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}

const FIRST_NAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡'];
const LAST_NAMES_DOCTOR = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明'];
const LAST_NAMES_RECEPTION = ['秀英', '丽华', '桂英', '玉兰', '静', '丽', '敏', '娜', '艳', '娟'];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(): string {
  const prefixes = ['138', '139', '137', '136', '135', '158', '159', '188', '189', '186'];
  const prefix = randomItem(prefixes);
  const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return prefix + suffix;
}

export function createUser(overrides: Partial<UserSeedData> & { clinicId: string; role: string }): UserSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();

  let name: string;
  let username: string;

  if (overrides.role === 'BOSS') {
    name = overrides.name || '老板';
    username = overrides.username || 'boss';
  } else if (overrides.role === 'DOCTOR') {
    const lastName = overrides.name || randomItem(FIRST_NAMES) + randomItem(LAST_NAMES_DOCTOR);
    name = lastName;
    username = overrides.username || `doctor_${id.slice(0, 6)}`;
  } else if (overrides.role === 'RECEPTIONIST') {
    const lastName = overrides.name || randomItem(FIRST_NAMES) + randomItem(LAST_NAMES_RECEPTION);
    name = lastName;
    username = overrides.username || `front_${id.slice(0, 6)}`;
  } else {
    name = overrides.name || '用户';
    username = overrides.username || `user_${id.slice(0, 6)}`;
  }

  const seedPassword = process.env.ADMIN_INITIAL_PASSWORD || generateRandomPassword();
  const passwordHash = overrides.passwordHash || bcrypt.hashSync(seedPassword, BCRYPT_ROUNDS_DEFAULT);

  return {
    id,
    username,
    passwordHash,
    name,
    role: overrides.role,
    phone: overrides.phone || randomPhone(),
    active: overrides.active ?? 1,
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createUsers(
  count: number,
  baseOverrides: Partial<UserSeedData> & { clinicId: string; role: string },
): UserSeedData[] {
  const result: UserSeedData[] = [];
  for (let i = 0; i < count; i++) {
    result.push(createUser(baseOverrides));
  }
  return result;
}

export function createAdmin(clinicId: string, overrides: Partial<UserSeedData> = {}): UserSeedData {
  return createUser({
    ...overrides,
    clinicId,
    role: 'BOSS',
    username: overrides.username || 'admin',
    name: overrides.name || '管理员',
  });
}

export function createDoctor(clinicId: string, overrides: Partial<UserSeedData> = {}): UserSeedData {
  return createUser({
    ...overrides,
    clinicId,
    role: 'DOCTOR',
  });
}

export function createReceptionist(clinicId: string, overrides: Partial<UserSeedData> = {}): UserSeedData {
  return createUser({
    ...overrides,
    clinicId,
    role: 'RECEPTIONIST',
  });
}
