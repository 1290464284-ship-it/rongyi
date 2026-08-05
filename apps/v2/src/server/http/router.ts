import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, NotFoundError, ValidationError } from '../infrastructure/errors';
import { SqliteRepository } from '../infrastructure/repository';
import { validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';
import { resolveResource } from '../infrastructure/legacy-registry';
import { stripProtectedWriteFields } from '../infrastructure/security';

export function createResourceRouter(db: Database.Database): Router {
  const router = Router();

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
      const rawPage = req.query.page ?? 1;
      const rawPageSize = req.query.pageSize ?? 20;
      const page = typeof rawPage === 'string' && rawPage.trim() !== '' ? Number(rawPage) : 1;
      const pageSize = typeof rawPageSize === 'string' && rawPageSize.trim() !== '' ? Number(rawPageSize) : 20;
      if (!Number.isInteger(page) || page < 1) throw new ValidationError('page must be a positive integer');
      if (!Number.isInteger(pageSize) || pageSize < 1) throw new ValidationError('pageSize must be an integer between 1 and 200');
      const cappedPageSize = Math.min(200, pageSize);
      const result = await repo.findMany({
        page,
        pageSize: cappedPageSize,
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
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}));
      const id = randomUUID();
      const repo = new SqliteRepository(db, resource);
      await repo.insert({ id, ...payload }, req.context!);
      res.status(201).json({ success: true, data: { id } });
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
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}, { partial: true }));
      const repo = new SqliteRepository(db, resource);
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
      const repo = new SqliteRepository(db, resource);
      if (!(await repo.findById(req.params.id, req.context!))) {
        throw new NotFoundError(`${resource.name} not found`);
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
  return `"${text.replace(/"/g, '""')}"`;
}
