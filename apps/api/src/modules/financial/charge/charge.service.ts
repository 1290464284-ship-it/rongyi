import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { ChargeRecord, ChargeItemRecord } from './entities/charge.entity';
import { CreateChargeDto, QueryChargesDto } from './dto/create-charge.dto';
import { yuanToCents, centsToYuan } from '../../../common/utils/format/money.utils';
import { safeJsonArray } from '../../../common/utils/format/json.utils';
import { BUSINESS_CODE_MAX_RETRIES } from '../../../config/constants';
import { ChargeStatus, AuditLogType } from '../../../common/constants';
import * as crypto from 'node:crypto';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { StatsService } from '../../system/stats/stats.service';

@Injectable()
export class ChargeService extends BaseService<ChargeRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private statsService: StatsService,
  ) {
    super(dbService, clinicContext, 'Charge', [], ['number'], [
      { table: 'ChargeItem', foreignKey: 'chargeId' },
    ], true, ['number'], 'number', 'C', [
      'totalAmount', 'paidAmount', 'refundedAmount', 'discount',
    ]);
  }

  async listCharges(q: QueryChargesDto) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const page = Number(q.page) || 1;
    const pageSize = Number(q.pageSize) || 20;
    
    let query = `SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, createdAt, updatedAt FROM Charge WHERE deletedAt IS NULL${clinicClause}`;
    let countQuery = `SELECT COUNT(*) as count FROM Charge WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
    
    if (q.patientId) {
      query += " AND patientId = ?";
      countQuery += " AND patientId = ?";
      qp.push(q.patientId);
      cp.push(q.patientId);
    }
    if (q.status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      qp.push(q.status);
      cp.push(q.status);
    }
    
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    
    const items = this.dbService.prepare(query).all(...qp) as Array<Record<string, unknown>>;
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    
    items.forEach((item: Record<string, unknown>) => {
      item.totalAmount = centsToYuan(Number(item.totalAmount) || 0);
      item.paidAmount = centsToYuan(Number(item.paidAmount) || 0);
      item.refundedAmount = centsToYuan(Number(item.refundedAmount) || 0);
      item.discount = centsToYuan(Number(item.discount) || 0);
    });

    // N+1 查询优化：批量查询患者和医生信息
    if (items.length > 0 && !q.patientId) {
      const patientIds = [...new Set(items.map(c => c.patientId as string).filter(Boolean))];
      const doctorIds = [...new Set(items.map(c => c.doctorId as string).filter(Boolean))];
      
      const patientMap = new Map<string, Record<string, unknown>>();
      if (patientIds.length > 0) {
        const placeholders = patientIds.map(() => '?').join(',');
        const patients = this.dbService.prepare(`SELECT id, name, phone FROM Patient WHERE id IN (${placeholders}) AND deletedAt IS NULL${clinicClause}`).all(...patientIds, ...clinicParams) as Array<Record<string, unknown>>;
        patients.forEach(p => patientMap.set(p.id as string, p));
      }
      
      const doctorMap = new Map<string, Record<string, unknown>>();
      if (doctorIds.length > 0) {
        const placeholders = doctorIds.map(() => '?').join(',');
        const doctors = this.dbService.prepare(`SELECT id, name, role FROM User WHERE id IN (${placeholders}) AND active = 1${clinicClause}`).all(...doctorIds, ...clinicParams) as Array<Record<string, unknown>>;
        doctors.forEach(d => doctorMap.set(d.id as string, d));
      }
      
      const itemsWithRelations = items.map(c => ({
        ...c,
        patient: patientMap.get(c.patientId as string) || null,
        doctor: doctorMap.get(c.doctorId as string) || null,
      }));
      return { items: itemsWithRelations, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  getCharge(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const charge = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(id, ...clinicParams) as ChargeRecord;

    if (!charge) {
      throw new BusinessNotFoundException('收费记录不存在');
    }

    charge.totalAmount = centsToYuan(Number(charge.totalAmount) || 0);
    charge.paidAmount = centsToYuan(Number(charge.paidAmount) || 0);
    charge.refundedAmount = centsToYuan(Number(charge.refundedAmount) || 0);
    charge.discount = centsToYuan(Number(charge.discount) || 0);

    const items = this.dbService.prepare(
      `SELECT id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price, quantity, teethNumbers, subtotal, clinicId, createdAt FROM ChargeItem WHERE chargeId = ?${clinicClause} ORDER BY createdAt`
    ).all(id, ...clinicParams) as ChargeItemRecord[];

    items.forEach((item: ChargeItemRecord) => {
      item.teethNumbers = safeJsonArray(item.teethNumbers as string | null);
      item.price = centsToYuan(Number(item.price));
      item.subtotal = centsToYuan(Number(item.subtotal));
    });

    return { ...charge, items };
  }

  createCharge(dto: CreateChargeDto) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < BUSINESS_CODE_MAX_RETRIES; attempt++) {
      try {
        const chargeId = crypto.randomUUID();
        const number = this.generateChargeNumber();

        let totalAmountCents = 0;
        if (dto.items && dto.items.length > 0) {
          for (const item of dto.items) {
            const priceCents = yuanToCents(item.price || 0);
            const quantity = item.quantity || 1;
            totalAmountCents += priceCents * quantity;
          }
        }

        const result = this.dbService.transaction((db) => {
          db.prepare(
            `INSERT INTO Charge (id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, clinicId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`
          ).run(
            chargeId,
            dto.patientId,
            null,
            dto.doctorId || null,
            number,
            totalAmountCents,
            ChargeStatus.UNPAID,
            dto.remark || null,
            clinicId,
            now,
            now,
          );

          if (dto.items && dto.items.length > 0) {
            const insertItem = db.prepare(
              `INSERT INTO ChargeItem (id, chargeId, treatmentId, inventoryItemId, name, category, price, quantity, teethNumbers, subtotal, clinicId)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const item of dto.items) {
              const itemId = crypto.randomUUID();
              const priceCents = yuanToCents(item.price || 0);
              const quantity = item.quantity || 1;
              const subtotalCents = priceCents * quantity;
              insertItem.run(
                itemId,
                chargeId,
                null,
                null,
                item.name,
                item.category || '',
                priceCents,
                quantity,
                JSON.stringify(item.teethNumbers || []),
                subtotalCents,
                clinicId,
              );
            }
          }

          this.logAudit(db, AuditLogType.CHARGE_CREATE, chargeId, "Charge", { afterData: { number, totalAmount: centsToYuan(totalAmountCents), status: ChargeStatus.UNPAID } });

          return this.getCharge(chargeId);
        });

        this.statsService.invalidateStatsCache('dashboard');
        this.statsService.invalidateStatsCache('charge');
        this.statsService.invalidateStatsCache('revenue');
        this.statsService.invalidateStatsCache('doctorWorkload');
        this.statsService.invalidateStatsCache('revenueByDoctor');
        this.statsService.invalidateStatsCache('revenueByCategory');

        return result;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed: Charge.number')) {
          continue;
        }
        throw e;
      }
    }
    throw lastError || new BusinessValidationException('创建收费单失败，请重试');
  }

  private generateChargeNumber(): string {
    const date = new Date();
    const dateStr = date.getFullYear().toString() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');

    const clinicId = this.clinicContext.getClinicId();
    const row = this.dbService.prepare(
      "SELECT number FROM Charge WHERE number LIKE ? ESCAPE '\\' AND clinicId = ? ORDER BY number DESC LIMIT 1"
    ).get(`${dateStr}%`, clinicId) as { number: string } | undefined;

    let seq = 1;
    if (row?.number) {
      // eslint-disable-next-line sonarjs/super-linear-regex
      const match = row.number.match(/(\d+)$/);
      if (match) {
        seq = parseInt(match[1], 10) + 1;
      }
    }

    return `${dateStr}${String(seq).padStart(4, '0')}`;
  }
}
