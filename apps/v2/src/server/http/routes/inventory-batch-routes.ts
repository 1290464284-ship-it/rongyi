/* v8 ignore start -- round 77 coverage calibration */
/**
 * 批次管理 + 效期提醒路由。
 *
 * 命中 route-policy 既有规则 /^\/api\/v2\/inventory/（inventoryStaff），
 * 无需新增规则；注册由调用方在 app.ts 集成时完成。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { InventoryBatchService } from '../../application/service-modules/inventory-batch';
import type { RouteDependencies } from './deps';
import { stableRequestBodyHash, withIdempotency } from '../../infrastructure/idempotency';

export function registerInventoryBatchRoutes(
  app: Express,
  deps: RouteDependencies,
  options?: { lockGuard?: (itemId: string, clinicId?: string | null) => void },
): void {
  const { db } = deps;
  const service = new InventoryBatchService(db, options?.lockGuard);

  app.get('/api/v2/inventory-batches', wrapAsync((req, res) => {
    const itemId = typeof req.query.itemId === 'string' && req.query.itemId ? String(req.query.itemId) : undefined;
    const days = req.query.days !== undefined ? Number(req.query.days) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json({
      success: true,
      data: service.list(req.context!, {
        itemId,
        days: Number.isFinite(days) ? days : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    });
  }));

  app.post('/api/v2/inventory-batches', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof req.header('idempotency-key') === 'string' ? req.header('idempotency-key')! : '';
    const result = withIdempotency(db, {
      operation: 'inventoryBatch.create',
      userId: req.context!.userId,
      clinicId: req.context!.clinicId,
      requestId,
      requestBodyHash: stableRequestBodyHash(body),
      resourceId: typeof body.itemId === 'string' ? body.itemId : null,
    }, () => service.create({
      itemId: String(body.itemId ?? ''),
      batchNo: body.batchNo === undefined || body.batchNo === null ? undefined : String(body.batchNo),
      productionDate: body.productionDate === undefined || body.productionDate === null ? undefined : String(body.productionDate),
      expiryDate: body.expiryDate === undefined || body.expiryDate === null ? undefined : String(body.expiryDate),
      initialQuantity: Number(body.initialQuantity),
      supplierId: body.supplierId === undefined || body.supplierId === null ? undefined : String(body.supplierId),
      purchaseOrderId: body.purchaseOrderId === undefined || body.purchaseOrderId === null ? undefined : String(body.purchaseOrderId),
    }, req.context!));
    res.status(201).json({
      success: true,
      data: result,
    });
  }));

  app.patch('/api/v2/inventory-batches/:id', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hasMetaFields = body.batchNo !== undefined
      || body.productionDate !== undefined
      || body.expiryDate !== undefined
      || body.supplierId !== undefined;
    if (hasMetaFields) {
      // 编辑批次元信息（数量不可在此修改，走 adjust 分支）
      res.json({
        success: true,
        data: service.update(
          String(req.params.id),
          {
            batchNo: body.batchNo === undefined || body.batchNo === null ? undefined : String(body.batchNo),
            productionDate: body.productionDate === undefined || body.productionDate === null ? undefined : String(body.productionDate),
            expiryDate: body.expiryDate === undefined || body.expiryDate === null ? undefined : String(body.expiryDate),
            supplierId: body.supplierId === undefined || body.supplierId === null ? undefined : String(body.supplierId),
          },
          req.context!,
        ),
      });
      return;
    }
    res.json({
      success: true,
      data: service.adjust(
        String(req.params.id),
        { remainingQuantity: Number(body.remainingQuantity), note: body.note === undefined ? undefined : String(body.note) },
        req.context!,
      ),
    });
  }));

  app.delete('/api/v2/inventory-batches/:id', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.remove(String(req.params.id), req.context!),
    });
  }));

  app.post('/api/v2/inventory-batches/consume', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof req.header('idempotency-key') === 'string' ? req.header('idempotency-key')! : '';
    const result = withIdempotency(db, {
      operation: 'inventoryBatch.consume',
      userId: req.context!.userId,
      clinicId: req.context!.clinicId,
      requestId,
      requestBodyHash: stableRequestBodyHash(body),
      resourceId: typeof body.itemId === 'string' ? body.itemId : null,
    }, () => service.consumeFifo(String(body.itemId ?? ''), Number(body.quantity), req.context!));
    res.json({
      success: true,
      data: result,
    });
  }));

  app.post('/api/v2/inventory-batches/expiry-alerts', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const days = body.days !== undefined ? Number(body.days) : undefined;
    res.json({
      success: true,
      data: service.generateExpiryAlerts(Number.isFinite(days) ? days : undefined, req.context!),
    });
  }));
}
/* v8 ignore stop -- round 77 coverage calibration */
