/**
 * 加工流程路由：加工单步骤查看/顺序登记/手动修改 + 流程统计。
 *
 * 路由策略已覆盖 /processing-orders 与 /processing-flow-stats（financeStaff）。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { ProcessingFlowService } from '../../application/service-modules/processing-flow';
import type { RouteDependencies } from './deps';

export function registerProcessingFlowRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new ProcessingFlowService(db);

  app.get('/api/v2/processing-orders/:id/steps', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.listSteps(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/processing-orders/:id/register-step', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { stepId?: unknown };
    res.json({
      success: true,
      data: service.registerStep(
        String(req.params.id),
        { stepId: typeof body.stepId === 'string' && body.stepId ? body.stepId : undefined },
        req.context!,
      ),
    });
  }));

  app.post('/api/v2/processing-orders/:id/set-step', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { stepId?: unknown; status?: unknown; remark?: unknown };
    res.json({
      success: true,
      data: service.setStep(
        String(req.params.id),
        {
          stepId: typeof body.stepId === 'string' ? body.stepId : '',
          status: typeof body.status === 'string' ? body.status : '',
          remark: typeof body.remark === 'string' ? body.remark : undefined,
        },
        req.context!,
      ),
    });
  }));

  app.get('/api/v2/processing-flow-stats', wrapAsync(async (req, res) => {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;
    res.json({ success: true, data: service.stats({ from, to }, req.context!) });
  }));
}
