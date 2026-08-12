import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AppError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext, UserRole } from '../../../domain/contracts';

/**
 * 用户级模块权限。
 *
 * 每个模块对应一个权限键，导航、通用资源路由和专用模块路由共用同一套键。
 * 生效权限 = 主角色默认权限 ∪ 附加角色默认权限，再叠加 UserPermission 显式覆盖。
 */
export const PERMISSION_KEYS = [
  'dashboard',
  'frontDesk',
  'patients',
  'clinical',
  'finance',
  'inventory',
  'analytics',
  'communication',
  'hr',
  'system',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly PermissionKey[]> = {
  BOSS: PERMISSION_KEYS,
  ADMIN: PERMISSION_KEYS,
  DOCTOR: ['dashboard', 'patients', 'clinical', 'communication'],
};

/** 通用资源名 -> 所属模块权限键；未列出的资源仍按资源定义的角色校验。 */
export const RESOURCE_PERMISSION_MAP: Record<string, PermissionKey> = {
  patients: 'patients',
  familyMembers: 'patients',
  patientRiskScores: 'patients',
  appointments: 'patients',
  appointmentPurposes: 'patients',
  chairs: 'patients',
  registrations: 'patients',
  visits: 'clinical',
  firstExams: 'clinical',
  firstExamTeeth: 'clinical',
  oralExaminations: 'clinical',
  periodontalRecords: 'clinical',
  treatments: 'clinical',
  treatmentPlans: 'clinical',
  treatmentPlanItems: 'clinical',
  medicalRecords: 'clinical',
  medicalPhrases: 'clinical',
  toothRecords: 'clinical',
  imaging: 'clinical',
  imagingCategories: 'clinical',
  cephalometricCases: 'clinical',
  prescriptions: 'clinical',
  prescriptionItems: 'clinical',
  departments: 'clinical',
  charges: 'finance',
  chargeItems: 'finance',
  memberCards: 'finance',
  memberCardLogs: 'finance',
  memberPointLogs: 'finance',
  debtRecords: 'finance',
  refunds: 'finance',
  chargeCombos: 'finance',
  chargeComboItems: 'finance',
  payMethods: 'finance',
  invoices: 'finance',
  treatmentCatalogs: 'finance',
  inventoryItems: 'inventory',
  inventoryTransactions: 'inventory',
  inventoryBatches: 'inventory',
  inventoryDocs: 'inventory',
  inventoryDocItems: 'inventory',
  inventoryReplenishmentSuggestions: 'inventory',
  suppliers: 'inventory',
  purchaseOrders: 'inventory',
  purchaseOrderItems: 'inventory',
  processingOrders: 'inventory',
  processingOrderItems: 'inventory',
  processingOrderSteps: 'inventory',
  processingFlowSteps: 'inventory',
  processingFactories: 'inventory',
  dispenses: 'inventory',
  dispenseItems: 'inventory',
  stocktakes: 'inventory',
  stocktakeItems: 'inventory',
  narcoticRegistry: 'inventory',
  drugCatalogItems: 'inventory',
  followUps: 'communication',
  followUpTemplates: 'communication',
  followUpDicts: 'communication',
  wechatMessages: 'communication',
  wechatReminders: 'communication',
  satisfactionSurveys: 'communication',
  attendance: 'hr',
  leaveRequests: 'hr',
  equipment: 'hr',
  workSchedules: 'hr',
  shiftTemplates: 'hr',
  operationLogs: 'system',
  settings: 'system',
  businessAlerts: 'system',
  dataImportJobs: 'system',
  syncChanges: 'system',
  printTemplates: 'system',
};

export interface UserPermissionRow {
  userId: string;
  permission: string;
  allowed: boolean;
  clinicId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UserPermissionInput {
  permission: string;
  allowed: boolean;
}

function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function computeEffectivePermissions(
  db: Database.Database,
  userId: string,
  clinicId: string | null,
  primaryRole: UserRole,
): string[] {
  const roles = [primaryRole];
  const additional = db.prepare(
    `SELECT role FROM UserRole
     WHERE userId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).all(userId, ...tenantParams(clinicId)) as Array<{ role: string }>;
  for (const row of additional) {
    if (Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_PERMISSIONS, row.role)) {
      roles.push(row.role as UserRole);
    }
  }

  const effective = new Set<string>();
  for (const role of roles) {
    for (const key of ROLE_DEFAULT_PERMISSIONS[role]) effective.add(key);
  }

  const roleOverrides = db.prepare(
    `SELECT role, resource, allowed FROM RolePermission
     WHERE permission = 'access' AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).all(...tenantParams(clinicId)) as Array<{ role: string; resource: string; allowed: number }>;
  for (const role of roles) {
    for (const row of roleOverrides) {
      if (row.role !== role || !isPermissionKey(row.resource)) continue;
      if (Number(row.allowed) === 1) effective.add(row.resource);
      else effective.delete(row.resource);
    }
  }

  const overrides = db.prepare(
    `SELECT permission, allowed FROM UserPermission
     WHERE userId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).all(userId, ...tenantParams(clinicId)) as Array<{ permission: string; allowed: number }>;
  for (const row of overrides) {
    if (!isPermissionKey(row.permission)) continue;
    if (Number(row.allowed) === 1) effective.add(row.permission);
    else effective.delete(row.permission);
  }

  return PERMISSION_KEYS.filter((key) => effective.has(key));
}

export class UserPermissionService {
  constructor(private readonly db: Database.Database) {}

  listForUser(userId: string, context: AppContext): {
    items: UserPermissionRow[];
    defaults: string[];
    effective: string[];
  } {
    const user = this.findUser(userId, context);
    if (context.role !== 'BOSS' && user.role === 'BOSS') {
      throw new AppError('FORBIDDEN', '管理员不能修改老板的权限', 403);
    }
    const items = this.db.prepare(
      `SELECT userId, permission, allowed, clinicId, createdAt, updatedAt, deletedAt
       FROM UserPermission
       WHERE userId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY createdAt ASC`,
    ).all(userId, ...tenantParams(context.clinicId)) as UserPermissionRow[];
    return {
      items,
      defaults: PERMISSION_KEYS.filter((key) =>
        ROLE_DEFAULT_PERMISSIONS[user.role].includes(key)),
      effective: computeEffectivePermissions(this.db, userId, context.clinicId, user.role),
    };
  }

  setPermissions(userId: string, inputs: UserPermissionInput[], context: AppContext): {
    items: UserPermissionRow[];
    effective: string[];
  } {
    const user = this.findUser(userId, context);
    if (!Array.isArray(inputs) || inputs.some((input) => !input || typeof input !== 'object')) {
      throw new ValidationError('permissions must be an array');
    }
    const seen = new Set<string>();
    const normalized: UserPermissionInput[] = [];
    for (const input of inputs) {
      const permission = String(input.permission ?? '');
      if (!isPermissionKey(permission)) {
        throw new ValidationError(`Invalid permission key: ${permission}`);
      }
      if (seen.has(permission)) throw new ValidationError(`Duplicate permission key: ${permission}`);
      seen.add(permission);
      normalized.push({ permission, allowed: parsePermissionBoolean(input.allowed) });
    }

    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      this.db.prepare(
        `DELETE FROM UserPermission WHERE userId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(userId, ...tenantParams(context.clinicId));
      const insert = this.db.prepare(
        `INSERT INTO UserPermission (userId, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      );
      for (const input of normalized) {
        insert.run(userId, input.permission, input.allowed ? 1 : 0, context.clinicId ?? null, now, now);
      }
    });
    run();

    const items = this.listForUser(userId, context).items;
    return {
      items,
      effective: computeEffectivePermissions(this.db, userId, context.clinicId, user.role),
    };
  }

  private findUser(userId: string, context: AppContext): { id: string; role: UserRole } {
    // 多诊所用户以 UserClinic 成员关系为准，User.clinicId 只是历史回退字段。
    let user = context.clinicId
      ? (this.db.prepare(
          `SELECT u.id, u.role FROM User u
           JOIN UserClinic uc ON uc.userId = u.id AND uc.clinicId = @clinicId AND uc.deletedAt IS NULL
           WHERE u.id = @userId AND u.deletedAt IS NULL
           LIMIT 1`,
        ).get({ clinicId: context.clinicId, userId }) as { id: string; role: UserRole } | undefined)
      : undefined;
    if (!user) {
      user = this.db.prepare(
        `SELECT id, role FROM User WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(userId, ...tenantParams(context.clinicId)) as { id: string; role: UserRole } | undefined;
    }
    if (!user) throw new NotFoundError('User not found');
    return user;
  }
}

export interface RoleModulePermissionInput {
  resource: string;
  allowed: boolean;
}

export class RoleModulePermissionService {
  constructor(private readonly db: Database.Database) {}

  listForRole(role: string, context: AppContext): {
    items: Array<{ resource: string; allowed: boolean }>;
    defaults: string[];
    effective: string[];
  } {
    const validRole = this.validateRole(role);
    const items = this.db.prepare(
      `SELECT resource, allowed FROM RolePermission
       WHERE role = ? AND permission = 'access' AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY resource ASC`,
    ).all(role, ...tenantParams(context.clinicId)) as Array<{ resource: string; allowed: number }>;
    return {
      items: items.map((row) => ({ resource: row.resource, allowed: Number(row.allowed) === 1 })),
      defaults: [...ROLE_DEFAULT_PERMISSIONS[validRole]],
      effective: this.effectiveForRole(role, context),
    };
  }

  setForRole(role: string, inputs: RoleModulePermissionInput[], context: AppContext): {
    items: Array<{ resource: string; allowed: boolean }>;
    effective: string[];
  } {
    this.validateRole(role);
    if (context.role !== 'BOSS' && role === 'BOSS') {
      throw new AppError('FORBIDDEN', '管理员不能修改老板角色的权限', 403);
    }
    if (!Array.isArray(inputs) || inputs.some((input) => !input || typeof input !== 'object')) {
      throw new ValidationError('permissions must be an array');
    }
    const seen = new Set<string>();
    const normalized: RoleModulePermissionInput[] = [];
    for (const input of inputs) {
      const resource = String(input.resource ?? '');
      if (!isPermissionKey(resource)) {
        throw new ValidationError(`Invalid permission key: ${resource}`);
      }
      if (seen.has(resource)) throw new ValidationError(`Duplicate permission key: ${resource}`);
      seen.add(resource);
      normalized.push({ resource, allowed: parsePermissionBoolean(input.allowed) });
    }

    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      this.db.prepare(
        `DELETE FROM RolePermission
         WHERE role = ? AND permission = 'access' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(role, ...tenantParams(context.clinicId));
      const insert = this.db.prepare(
        `INSERT INTO RolePermission (id, role, resource, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, 'access', ?, ?, ?, ?, NULL)`,
      );
      for (const input of normalized) {
        insert.run(randomUUID(), role, input.resource, input.allowed ? 1 : 0, context.clinicId ?? null, now, now);
      }
    });
    run();

    return {
      items: normalized,
      effective: this.effectiveForRole(role, context),
    };
  }

  private effectiveForRole(role: string, context: AppContext): string[] {
    const effective = new Set<string>(ROLE_DEFAULT_PERMISSIONS[this.validateRole(role)]);
    const rows = this.db.prepare(
      `SELECT resource, allowed FROM RolePermission
       WHERE role = ? AND permission = 'access' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).all(role, ...tenantParams(context.clinicId)) as Array<{ resource: string; allowed: number }>;
    for (const row of rows) {
      if (!isPermissionKey(row.resource)) continue;
      if (Number(row.allowed) === 1) effective.add(row.resource);
      else effective.delete(row.resource);
    }
    return PERMISSION_KEYS.filter((key) => effective.has(key));
  }

  private validateRole(role: string): UserRole {
    if (!Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_PERMISSIONS, role)) {
      throw new ValidationError(`Invalid role: ${role}`);
    }
    return role as UserRole;
  }
}

function parsePermissionBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  // Boolean('false') === true 会让“撤销”变成“授权”，必须严格解析。
  throw new ValidationError('allowed must be a boolean');
}
