import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError } from '../infrastructure/errors';
import { SqliteRepository } from '../infrastructure/repository';
import { validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';
import { resolveResource } from '../infrastructure/legacy-registry';
import { stripProtectedWriteFields } from '../infrastructure/security';
import { withIdempotency } from '../infrastructure/idempotency';
import { parsePagination } from './pagination';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';
import { recordSyncChange } from '../infrastructure/sync-change';

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
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}), roleExempt(resource), resource.name);
      const requestId = typeof req.header('idempotency-key') === 'string' ? req.header('idempotency-key')! : '';
      const result = await withIdempotency(db, {
        operation: `resource.create.${resource.name}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId,
      }, async () => {
        const id = randomUUID();
        const repo = new SqliteRepository(db, resource);
        await repo.insert({ id, ...payload }, req.context!);
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
      const rows: Array<Record<string, unknown>> = [];
      let page = 1;
      const pageSize = 200;
      for (;;) {
        const result = await repo.findMany({
          page,
          pageSize,
          filters: parseFilters(req),
        }, req.context!);
        rows.push(...result.items);
        if (rows.length >= result.total) break;
        page += 1;
      }
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${resource.name}-${Date.now()}.csv"`);
      res.send(`\uFEFF${toCsv(rows, resource)}`);
    } catch (error) {
      next(error);
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
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}, { partial: true }), roleExempt(resource), resource.name);
      const repo = new SqliteRepository(db, resource);
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
          const existing = await repo.findById(req.params.id, req.context!);
          if (!existing) throw new NotFoundError('treatmentPlanItems not found');
          throw new ConflictError(Object.prototype.hasOwnProperty.call(payload, 'price') ? '已划价明细不可改价' : '已划价明细不可修改');
        }
        if (req.context!.clinicId) {
          recordSyncChange(db, {
            tableName: 'TreatmentPlanItem',
            recordId: req.params.id,
            operation: 'UPDATE',
            clinicId: req.context!.clinicId,
          });
        }
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
      await repo.update({ id: req.params.id, ...payload }, req.context!);
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
      if (resource.name === 'patients' && req.context!.role !== 'BOSS') {
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
    if (['page', 'pageSize', 'search', 'sortBy', 'sortOrder'].includes(key)) continue;
    result[key] = typeof value === 'string' ? value : value;
  }
  return result;
}

function toCsv(rows: Array<Record<string, unknown>>, resource: ResourceDefinition): string {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const labels = new Map(resource.fields.map((field) => [field.name, field.label ?? field.name]));
  const systemLabels: Record<string, string> = {
    id: 'ID',
    clinicId: '诊所',
    createdAt: '创建时间',
    updatedAt: '更新时间',
    deletedAt: '删除时间',
  };
  const lines = [
    headers.map((header) => csvCell(labels.get(header) ?? systemLabels[header] ?? header)).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  return lines.join('\r\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}
