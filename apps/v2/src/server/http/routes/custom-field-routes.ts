import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { AppError } from '../../infrastructure/errors';
import { CustomFieldService } from '../../application/service-modules/custom-fields';
import type { RouteDependencies } from './deps';

function requireBoss(context: { role: string }): void {
  if (!['BOSS', 'ADMIN'].includes(context.role)) {
    throw new AppError('FORBIDDEN', 'Only BOSS can manage custom field definitions', 403);
  }
}

export function registerCustomFieldRoutes(
  app: Express,
  deps: RouteDependencies,
): void {
  const service = new CustomFieldService(deps.db);

  app.get('/api/v2/custom-fields', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.listDefinitions(String(req.query.entity ?? 'patient'), req.context!),
    });
  }));

  app.post('/api/v2/custom-fields', wrapAsync((req, res) => {
    requireBoss(req.context!);
    res.status(201).json({
      success: true,
      data: service.createDefinition(String(req.body?.entity ?? 'patient'), req.body ?? {}, req.context!),
    });
  }));

  app.patch('/api/v2/custom-fields/:id', wrapAsync((req, res) => {
    requireBoss(req.context!);
    res.json({
      success: true,
      data: service.updateDefinition(String(req.params.id), req.body ?? {}, req.context!),
    });
  }));

  app.delete('/api/v2/custom-fields/:id', wrapAsync((req, res) => {
    requireBoss(req.context!);
    service.deleteDefinition(String(req.params.id), req.context!);
    res.json({ success: true, data: { id: String(req.params.id) } });
  }));

  app.get('/api/v2/custom-fields/values', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.listValues(
        String(req.query.entity ?? 'patient'),
        String(req.query.entityId ?? ''),
        req.context!,
      ),
    });
  }));

  app.put('/api/v2/custom-fields/values', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.setValues(
        String(req.body?.entity ?? 'patient'),
        String(req.body?.entityId ?? ''),
        Array.isArray(req.body?.values) ? req.body.values : [],
        req.context!,
      ),
    });
  }));
}
