import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, NotFoundError } from '../infrastructure/errors';
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
      if (!req.context) throw new NotFoundError('Auth context missing');
      const repo = new SqliteRepository(db, resource);
      const result = await repo.findMany({
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 20),
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        filters: parseFilters(req),
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
        sortOrder: req.query.sortOrder === 'ASC' ? 'ASC' : 'DESC',
      }, req.context);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:resource', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!resource.capabilities.create) throw new NotFoundError('Create is not supported for this resource');
      if (!req.context) throw new NotFoundError('Auth context missing');
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}));
      const id = randomUUID();
      const repo = new SqliteRepository(db, resource);
      await repo.insert({ id, ...payload }, req.context);
      res.status(201).json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:resource/:id', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!req.context) throw new NotFoundError('Auth context missing');
      const repo = new SqliteRepository(db, resource);
      const row = await repo.findById(req.params.id, req.context);
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
      if (!req.context) throw new NotFoundError('Auth context missing');
      const payload = stripProtectedWriteFields(validatePayload(resource, req.body ?? {}));
      const repo = new SqliteRepository(db, resource);
      await repo.update({ id: req.params.id, ...payload }, req.context);
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:resource/:id', async (req, res, next) => {
    try {
      const resource = res.locals.resource as ResourceDefinition;
      if (!resource.capabilities.delete) throw new NotFoundError('Delete is not supported for this resource');
      if (!req.context) throw new NotFoundError('Auth context missing');
      const repo = new SqliteRepository(db, resource);
      await repo.softDelete(req.params.id, req.context);
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
