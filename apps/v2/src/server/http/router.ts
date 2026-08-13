import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError } from '../infrastructure/errors';
import { SqliteRepository } from '../infrastructure/repository';
import { validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';
import { resolveResource } from '../infrastructure/legacy-registry';
import { STATE_MACHINE_DEFAULT_STATUS, applyStateMachineDefaults, stripProtectedWriteFields } from '../infrastructure/security';
import { stableRequestBodyHash, withIdempotency } from '../infrastructure/idempotency';
import { parsePagination } from './pagination';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';
import { trackResourceWrite } from '../infrastructure/write-tracking';
import { RESOURCE_PERMISSION_MAP } from '../application/service-modules/permissions';
import { maskPhoneForExport } from '../application/service-modules/operations';
import { TreatmentPlanBillingService } from '../application/service-modules/treatment-plan-billing';
import { csvCell } from '../shared/csv';

const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 1_000_000;

function exportMaxRows(): number {
  const raw = Number(process.env.V2_CSV_EXPORT_MAX_ROWS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : EXPORT_MAX_ROWS;
}

export function createResourceRouter(db: Database.Database): Router {
  const router = Router();

  // rolePermissions 的 role 是业务字段（配置某角色的权限），需豁免通用写保护；
  // 其余资源一律禁止客户端写 role 等系统字段（防提权）。
  const ROLE_FIELD_EXEMPT_RESOURCES = new Set(['rolePermissions']);
  const roleExempt = (resource: ResourceDefinition): ReadonlySet<string> | undefined =>
    ROLE_FIELD_EXEMPT_RESOURCES.has(resource.name) ? new Set(['role']) : undefined;

  router.use('/:resource', (req, res, next) => {
    const resource = resolveResource(db, req.params.resource);
    if (!resource) {
      next(new NotFoundError(`Unknown resource: ${req.params.resource}`));
      return;
    }
    if (!req.context || !resource.roles.includes(req.context.role)) {
      next(new AppError('FORBIDDEN', `Forbidden resource: ${req.params.resource}`, 403));
      return;
    }
    const requiredPermission = RESOURCE_PERMISSION_MAP[resource.name];
    if (requiredPermission && req.context.permissions && !req.context.permissions.includes(requiredPermission)) {
      next(new AppError('FORBIDDEN', `Forbidden resource: ${req.params.resource}`, 403));
      return;
    }
    res.locals.resource = resource;
    next();
  });

  router.get('/:resource', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      const repo = new SqliteRepository(db, resource);
      const { page, pageSize } = parsePagination(req);
      const result = await repo.findMany({
        page,
        pageSize,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        filters: parseFilters(req),
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
        sortOrder: req.query.sortOrder === 'ASC' ? 'ASC' : 'DESC',
      }, req.context!);
      res.json({ success: true, data: result });
      /* v8 ignore start -- DB-backed list failures are already covered by service tests. */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  router.post('/:resource', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!resource.capabilities.create) throw new NotFoundError('Create is not supported for this resource');
      const rawPayload = { ...(req.body ?? {}) };
      const defaultStatus = STATE_MACHINE_DEFAULT_STATUS[resource.name];
      if (defaultStatus && rawPayload.status === undefined) rawPayload.status = defaultStatus;
      const payload = stripProtectedWriteFields(
        validatePayload(resource, rawPayload),
        roleExempt(resource),
        resource.name,
        { protectStateMachine: true },
      );
      applyStateMachineDefaults(resource.name, payload);
      const requestId = typeof req.header('idempotency-key') === 'string' ? req.header('idempotency-key')! : '';
      const result = await withIdempotency(db, {
        operation: `resource.create.${resource.name}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId,
        requestBodyHash: stableRequestBodyHash(rawPayload),
      }, async () => {
        const id = randomUUID();
        const repo = new SqliteRepository(db, resource);
        await repo.insert({ id, ...payload }, req.context!);
        if (resource.name === 'treatmentPlanItems' && payload.planId) {
          new TreatmentPlanBillingService(db).reconcilePlanTotal(String(payload.planId), req.context!);
        }
        return { success: true, data: { id } };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:resource/export', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      const repo = new SqliteRepository(db, resource);
      const firstPage = await repo.findMany({
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
        countTotal: false,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
        filters: parseFilters(req),
      }, req.context!);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${resource.name}-${Date.now()}.csv"`);
      res.write('\uFEFF');
      if (firstPage.items.length === 0) {
        res.end();
        return;
      }
      const maxRows = exportMaxRows();
      const firstAllowed = firstPage.items.slice(0, maxRows);
      const maskedFirst = firstAllowed.map((row) => maskExportRow(resource.name, row));
      res.write(`${csvHeader(maskedFirst, resource)}\r\n`);
      res.write(`${csvLines(maskedFirst)}\r\n`);
      let written = firstAllowed.length;
      let cursor = firstPage.nextCursor;
      let truncated = written < firstPage.items.length || (written >= maxRows && Boolean(cursor));
      if (truncated) cursor = undefined;
      while (cursor && written < maxRows) {
        const result = await repo.findMany({
          page: 1,
          pageSize: EXPORT_PAGE_SIZE,
          countTotal: false,
          sortBy: 'createdAt',
          sortOrder: 'DESC',
          cursor,
          filters: parseFilters(req),
        }, req.context!);
        if (result.items.length === 0) break;
        const allowed = result.items.slice(0, maxRows - written);
        res.write(`${csvLines(allowed.map((row) => maskExportRow(resource.name, row)))}\r\n`);
        written += allowed.length;
        if (allowed.length < result.items.length) {
          truncated = true;
          break;
        }
        cursor = result.nextCursor;
        if (written >= maxRows && cursor) {
          truncated = true;
          break;
        }
      }
      if (truncated) res.write('# truncated\r\n');
      res.end();
    } catch (error) {
      if (!res.headersSent) next(error);
      else res.end();
    }
  });

  router.get('/:resource/:id', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      const repo = new SqliteRepository(db, resource);
      const row = await repo.findById(req.params.id, req.context!);
      if (!row) throw new NotFoundError(`${resource.name} not found`);
      res.json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:resource/:id', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!resource.capabilities.update) throw new NotFoundError('Update is not supported for this resource');
      const payload = stripProtectedWriteFields(
        validatePayload(resource, req.body ?? {}, { partial: true }),
        roleExempt(resource),
        resource.name,
        { protectStateMachine: true },
      );
      const repo = new SqliteRepository(db, resource);
      const treatmentPlanId = resource.name === 'treatmentPlanItems'
        ? String((await repo.findById(req.params.id, req.context!))?.planId ?? '')
        : '';
      const runPatch = db.transaction(() => {
      // 治疗计划明细：price/quantity 允许经通用 CRUD 维护（前端计划编辑器写未划价明细），
      // 但已划价明细（billed=1）服务端强制不可改价/改量，与 TreatmentPlanBillingService 状态机一致。
      if (resource.name === 'treatmentPlanItems' && (Object.prototype.hasOwnProperty.call(payload, 'price') || Object.prototype.hasOwnProperty.call(payload, 'quantity'))) {
        // B-M6：原子守卫——billed=0 直接并入 UPDATE 条件，消除 check-then-update
        // 竞态（并发划价与改价同时到达时只有一个生效）；成功后手动记 SyncChange，
        // 与 repo.update 的变更传播保持一致。
        const sets: string[] = ['updatedAt = ?'];
        const values: unknown[] = [req.context!.now().toISOString()];
        if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
          sets.push('price = ?');
          values.push(payload.price);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'quantity')) {
          sets.push('quantity = ?');
          values.push(payload.quantity);
        }
        values.push(req.params.id);
        values.push(...tenantParams(req.context!.clinicId));
        const guardResult = db.prepare(
          `UPDATE TreatmentPlanItem SET ${sets.join(', ')} WHERE id = ? AND billed = 0 AND deletedAt IS NULL${tenantAnd(req.context!.clinicId)}`,
        ).run(...values);
        if (Number(guardResult.changes) === 0) {
          const existing = db.prepare(
            `SELECT 1 FROM TreatmentPlanItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(req.context!.clinicId)}`,
          ).get(req.params.id, ...tenantParams(req.context!.clinicId));
          if (!existing) throw new NotFoundError('treatmentPlanItems not found');
          throw new ConflictError(Object.prototype.hasOwnProperty.call(payload, 'price') ? '已划价明细不可改价' : '已划价明细不可修改');
        }
        trackResourceWrite(db, {
          tableName: 'TreatmentPlanItem',
          recordId: req.params.id,
          operation: 'UPDATE',
          clinicId: req.context!.clinicId ?? null,
          searchResource: null,
        });
        delete payload.price;
        delete payload.quantity;
      }
      // S-M7：治疗计划费用/优惠/状态字段在存在已划价明细后锁定（金额凭证防篡改）。
      if (resource.name === 'treatmentPlans') {
        const LOCKED_PLAN_FIELDS = ['totalFee', 'discountRate', 'discountType', 'status'] as const;
        if (LOCKED_PLAN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
          const billedItem = db.prepare(
            'SELECT 1 FROM TreatmentPlanItem WHERE planId = ? AND billed = 1 AND deletedAt IS NULL LIMIT 1',
          ).get(req.params.id);
          if (billedItem) throw new ConflictError('治疗计划已划价，费用与状态字段不可修改');
        }
      }
      repo.updateSync({ id: req.params.id, ...payload }, req.context!);
      if (resource.name === 'treatmentPlanItems' && treatmentPlanId) {
        new TreatmentPlanBillingService(db).reconcilePlanTotal(treatmentPlanId, req.context!);
      }
      });
      runPatch();
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:resource/:id', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!resource.capabilities.delete) throw new NotFoundError('Delete is not supported for this resource');
      // M2：患者主档删除限 BOSS（医生/前台可误删患者）；病历删除须未锁定（绕过审批流）。
      if (resource.name === 'patients' && !['BOSS', 'ADMIN'].includes(req.context!.role)) {
        throw new AppError('FORBIDDEN', 'Deleting patients requires BOSS', 403);
      }
      const repo = new SqliteRepository(db, resource);
      const existing = await repo.findById(req.params.id, req.context!);
      if (!existing) {
        throw new NotFoundError(`${resource.name} not found`);
      }
      if (resource.name === 'medicalRecords' && existing.isLocked === true) {
        throw new AppError('FORBIDDEN', 'Locked medical records cannot be deleted', 403);
      }
      // 已划价治疗计划明细禁止删除（金额凭证，防伪造/篡改账目）
      if (resource.name === 'treatmentPlanItems' && existing && Number(existing.billed) === 1) {
        throw new ConflictError('已划价明细不可删除');
      }
      await repo.softDelete(req.params.id, req.context!);
      if (resource.name === 'treatmentPlanItems' && existing.planId) {
        new TreatmentPlanBillingService(db).reconcilePlanTotal(String(existing.planId), req.context!);
      }
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseFilters(req: Request): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (['page', 'pageSize', 'search', 'sortBy', 'sortOrder', 'cursor'].includes(key)) continue;
    result[key] = typeof value === 'string' ? value : value;
  }
  return result;
}

function csvHeader(rows: Array<Record<string, unknown>>, resource: ResourceDefinition): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const labels = new Map(resource.fields.map((field) => [field.name, field.label ?? field.name]));
  const systemLabels: Record<string, string> = {
    id: 'ID',
    clinicId: '诊所',
    createdAt: '创建时间',
    updatedAt: '更新时间',
    deletedAt: '删除时间',
  };
  return headers.map((header) => csvCell(labels.get(header) ?? systemLabels[header] ?? header)).join(',');
}

const EXPORT_MASK_FIELDS: Record<string, Array<[string, 'phone' | 'idCard' | 'bankAccount' | 'text']>> = {
  patients: [['phone', 'phone'], ['idCard', 'idCard'], ['wechatId', 'text'], ['address', 'text']],
  suppliers: [['phone', 'phone'], ['bankAccount', 'bankAccount']],
  users: [['phone', 'phone']],
};

/** 通用 CSV 导出脱敏：患者手机/身份证、供应商账号等不得随导出明文外泄。 */
function maskExportRow(resourceName: string, row: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...row };
  for (const [field, kind] of EXPORT_MASK_FIELDS[resourceName] ?? []) {
    const value = masked[field];
    if (value === undefined || value === null || value === '') continue;
    const text = String(value);
    if (kind === 'phone') {
      masked[field] = maskPhoneForExport(text);
    } else if (kind === 'idCard' || kind === 'bankAccount') {
      masked[field] = text.length > 4 ? `${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}` : '*'.repeat(text.length);
    } else {
      masked[field] = text.length > 4 ? `${text.slice(0, 1)}****${text.slice(-1)}` : text;
    }
  }
  return masked;
}

function csvLines(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')).join('\r\n');
}
