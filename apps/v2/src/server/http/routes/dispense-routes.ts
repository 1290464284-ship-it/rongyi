/**
 * 药房工作台路由：发药单（列表/详情/创建/发药/退药）+ 麻药登记。
 *
 * 命中 route-policy 新规则（/^\/api\/v2\/dispenses/ 与 /^\/api\/v2\/narcotic-registry/），
 * 规则由调用方在 route-policy.ts 集成时添加，本文件不触碰策略层。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { parsePagination } from '../pagination';
import {
  DispenseService,
  type DispenseAssignInput,
  type DispenseCreateInput,
  type DispenseUpdateInput,
  type NarcoticCreateInput,
  type ReturnItemInput,
} from '../../application/service-modules/dispense';
import type { RouteDependencies } from './deps';

export function registerDispenseRoutes(
  app: Express,
  deps: RouteDependencies,
  options?: { lockGuard?: (itemId: string, clinicId?: string | null) => void },
): void {
  const { db } = deps;
  const service = new DispenseService(db, options?.lockGuard);

  app.get('/api/v2/dispenses', wrapAsync(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status
      ? String(req.query.status)
      : undefined;
    const { page, pageSize } = parsePagination(req);
    const items = service.list(req.context!, { status, page, pageSize });
    const total = service.count(req.context!, { status });
    res.json({ success: true, data: { items, total, page, pageSize } });
  }));

  app.get('/api/v2/dispenses/:id', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.detail(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/dispenses', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json({ success: true, data: service.create(parseCreateInput(body), req.context!) });
  }));

  app.patch('/api/v2/dispenses/:id', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.updateDispense(String(req.params.id), parseUpdateInput(body), req.context!) });
  }));

  app.delete('/api/v2/dispenses/:id', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.deleteDispense(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/dispenses/:id/dispense', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      success: true,
      data: await service.dispense(String(req.params.id), req.context!, parseAssignInput(body)),
    });
  }));

  app.post('/api/v2/dispenses/:id/return', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      success: true,
      data: await service.returnItems(String(req.params.id), parseReturnInput(body), req.context!),
    });
  }));

  app.get('/api/v2/narcotic-registry', wrapAsync(async (req, res) => {
    const recordDate = typeof req.query.recordDate === 'string' && req.query.recordDate
      ? String(req.query.recordDate)
      : undefined;
    const { page, pageSize } = parsePagination(req, { defaultPageSize: 200 });
    res.json({
      success: true,
      data: service.narcoticList(req.context!, { ...(recordDate ? { recordDate } : {}), page, pageSize }),
    });
  }));

  app.post('/api/v2/narcotic-registry', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json({ success: true, data: service.recordNarcotic(parseNarcoticInput(body), req.context!) });
  }));

  app.patch('/api/v2/narcotic-registry/:id', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.updateNarcotic(String(req.params.id), parseNarcoticInput(body), req.context!) });
  }));

  app.delete('/api/v2/narcotic-registry/:id', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.deleteNarcotic(String(req.params.id), req.context!) });
  }));
}

function parseCreateInput(body: Record<string, unknown>): DispenseCreateInput {
  const items = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>).map((entry) => ({
        itemId: typeof entry.itemId === 'string' ? entry.itemId : String(entry.itemId ?? ''),
        quantity: Number(entry.quantity),
        batchId: entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
          ? undefined
          : String(entry.batchId),
      }))
    : [];
  return {
    number: typeof body.number === 'string' ? body.number : String(body.number ?? ''),
    patientId: typeof body.patientId === 'string' ? body.patientId : String(body.patientId ?? ''),
    chargeId: body.chargeId === undefined || body.chargeId === null ? undefined : String(body.chargeId),
    prescriptionId: body.prescriptionId === undefined || body.prescriptionId === null ? undefined : String(body.prescriptionId),
    doctorId: body.doctorId === undefined || body.doctorId === null ? undefined : String(body.doctorId),
    note: body.note === undefined || body.note === null ? undefined : String(body.note),
    items,
  };
}

function parseUpdateInput(body: Record<string, unknown>): DispenseUpdateInput {
  const items = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>).map((entry) => ({
        id: entry.id === undefined || entry.id === null || entry.id === '' ? undefined : String(entry.id),
        itemId: typeof entry.itemId === 'string' ? entry.itemId : String(entry.itemId ?? ''),
        quantity: Number(entry.quantity),
        batchId: entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
          ? undefined
          : String(entry.batchId),
      }))
    : [];
  return {
    number: typeof body.number === 'string' ? body.number : String(body.number ?? ''),
    patientId: typeof body.patientId === 'string' ? body.patientId : String(body.patientId ?? ''),
    note: body.note === undefined || body.note === null ? undefined : String(body.note),
    items,
  };
}

function parseAssignInput(body: Record<string, unknown>): DispenseAssignInput {
  if (!Array.isArray(body.items)) return {};
  return {
    items: (body.items as Array<Record<string, unknown>>).map((entry) => ({
      dispenseItemId: typeof entry.dispenseItemId === 'string'
        ? entry.dispenseItemId
        : String(entry.dispenseItemId ?? ''),
      batchId: entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
        ? null
        : String(entry.batchId),
    })),
  };
}

function parseReturnInput(body: Record<string, unknown>): ReturnItemInput {
  const items = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>).map((entry) => ({
        dispenseItemId: typeof entry.dispenseItemId === 'string'
          ? entry.dispenseItemId
          : String(entry.dispenseItemId ?? ''),
        quantity: Number(entry.quantity),
      }))
    : [];
  return { items };
}

function parseNarcoticInput(body: Record<string, unknown>): NarcoticCreateInput {
  const optionalString = (value: unknown): string | undefined =>
    value === undefined || value === null || value === '' ? undefined : String(value);
  const optionalNumber = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    recordDate: typeof body.recordDate === 'string' ? body.recordDate : String(body.recordDate ?? ''),
    patientId: optionalString(body.patientId),
    doctorId: optionalString(body.doctorId),
    itemId: typeof body.itemId === 'string' ? body.itemId : String(body.itemId ?? ''),
    batchNo: optionalString(body.batchNo),
    quantity: Number(body.quantity),
    unit: optionalString(body.unit),
    usage: optionalString(body.usage),
    balanceBefore: optionalNumber(body.balanceBefore),
    balanceAfter: optionalNumber(body.balanceAfter),
    remark: optionalString(body.remark),
  };
}
