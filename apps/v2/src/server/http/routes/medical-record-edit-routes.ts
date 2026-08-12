import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { MedicalRecordEditService } from '../../application/service-modules/medical-record-edit';
import { parseBooleanStrict } from '../validation';
import type { RouteDependencies } from './deps';

/**
 * 病历修改申请与审核端点。
 *
 * 两条路径均已命中 route-policy 既有临床规则
 * （/^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|...)/），
 * 无需新增规则。
 */
export function registerMedicalRecordEditRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new MedicalRecordEditService(db);

  app.post('/api/v2/medical-records/:id/edit-request', wrapAsync(async (req, res) => {
    const result = service.requestEdit(
      String(req.params.id),
      {
        reason: typeof req.body?.reason === 'string' ? req.body.reason : '',
        proposedContent:
          typeof req.body?.proposedContent === 'object' && req.body.proposedContent !== null
            ? (req.body.proposedContent as Record<string, unknown>)
            : {},
      },
      req.context!,
    );
    res.status(201).json({ success: true, data: result });
  }));

  app.patch('/api/v2/medical-records/:id/edit-request/review', wrapAsync(async (req, res) => {
    const result = service.review(
      String(req.params.id),
      {
        approve: req.body?.approve === undefined ? false : parseBooleanStrict(req.body.approve, 'approve'),
        reviewNote: typeof req.body?.reviewNote === 'string' ? req.body.reviewNote : undefined,
      },
      req.context!,
    );
    res.json({ success: true, data: result });
  }));
}
