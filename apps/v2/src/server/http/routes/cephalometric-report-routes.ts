/**
 * 测量报告路由：
 * - POST /api/v2/cephalometric/:id/report   保存测量报告
 * - GET  /api/v2/cephalometric/:id/report   读取测量报告
 * - POST /api/v2/cephalometric/:id/send     微信发送留痕
 * - POST /api/v2/cephalometric/compare      轮廓重叠比较（1-10 个病例）
 *
 * 路径前缀 /api/v2/cephalometric 由调用方在 route-policy.ts 挂接鉴权规则（clinical）。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { CephalometricReportService } from '../../application/service-modules/cephalometric-report';

export function registerCephalometricReportRoutes(app: Express, db: Database.Database): void {
  const service = new CephalometricReportService(db);

  app.post('/api/v2/cephalometric/compare', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.compare(body.caseIds as string[], req.context!) });
  }));

  app.post('/api/v2/cephalometric/:id/report', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      success: true,
      data: service.saveReport(String(req.params.id), {
        reportJson: body.reportJson as Record<string, unknown> | string,
        reportStatus: body.reportStatus as string | undefined,
      }, req.context!),
    });
  }));

  app.get('/api/v2/cephalometric/:id/report', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.getReport(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/cephalometric/:id/send', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      success: true,
      data: service.sendWechat(String(req.params.id), {
        phone: body.phone as string | undefined,
        note: body.note as string | undefined,
      }, req.context!),
    });
  }));
}
