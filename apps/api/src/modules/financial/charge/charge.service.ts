import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { ChargeRecord, ChargeItemRecord } from './entities/charge.entity';
import { CreateChargeDto, QueryChargesDto } from './dto/create-charge.dto';
import { yuanToCents, centsToYuan } from '../../../common/utils/format/money.utils';
import { safeJsonArray } from '../../../common/utils/format/json.utils';
import { BUSINESS_CODE_MAX_RETRIES } from '../../../config/constants';
import { ChargeStatus, AuditLogType } from '../../../common/constants';
import * as crypto from 'node:crypto';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { EventBusService } from '../../../common/events/event-bus.service';
import { ChargeCreatedEvent } from '../../../common/events/domain-events';
import { ChargeRepository } from './repositories/charge.repository';

@Injectable()
export class ChargeService extends BaseService<ChargeRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private eventBus: EventBusService,
    private chargeRepository: ChargeRepository,
    private idempotency: IdempotencyService,
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

    const { items, total } = this.chargeRepository.findMany(this.dbService, {
      clinicClause,
      clinicParams,
      patientId: q.patientId,
      status: q.status,
      page,
      pageSize,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items.forEach((item: any) => {
      item.totalAmount = centsToYuan(Number(item.totalAmount) || 0);
      item.paidAmount = centsToYuan(Number(item.paidAmount) || 0);
      item.refundedAmount = centsToYuan(Number(item.refundedAmount) || 0);
      item.discount = centsToYuan(Number(item.discount) || 0);
    });

    // N+1 查询优化：批量查询患者和医生信息
    if (items.length > 0 && !q.patientId) {
      const patientIds = [...new Set(items.map(c => c.patientId).filter(Boolean))];
      const doctorIds = [...new Set(items.map(c => c.doctorId).filter(Boolean))];

      const patients = this.chargeRepository.batchFindPatients(this.dbService, patientIds, clinicClause, clinicParams);
      const patientMap = new Map<string, Record<string, unknown>>();
      patients.forEach(p => patientMap.set(p.id, p));

      const doctors = this.chargeRepository.batchFindDoctors(this.dbService, doctorIds, clinicClause, clinicParams);
      const doctorMap = new Map<string, Record<string, unknown>>();
      doctors.forEach(d => doctorMap.set(d.id, d));

      const itemsWithRelations = items.map(c => ({
        ...c,
        patient: patientMap.get(c.patientId) || null,
        doctor: doctorMap.get(c.doctorId) || null,
      }));
      return { items: itemsWithRelations, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  getCharge(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const charge = this.chargeRepository.findById(this.dbService, id, clinicClause, clinicParams);
    if (!charge) {
      throw new BusinessNotFoundException('收费记录不存在');
    }

    charge.totalAmount = centsToYuan(Number(charge.totalAmount) || 0);
    charge.paidAmount = centsToYuan(Number(charge.paidAmount) || 0);
    charge.refundedAmount = centsToYuan(Number(charge.refundedAmount) || 0);
    charge.discount = centsToYuan(Number(charge.discount) || 0);

    const items = this.chargeRepository.findItemsByChargeId(this.dbService, id, clinicClause, clinicParams);

    items.forEach((item: ChargeItemRecord) => {
      item.teethNumbers = safeJsonArray(item.teethNumbers as string | null);
      item.price = centsToYuan(Number(item.price));
      item.subtotal = centsToYuan(Number(item.subtotal));
    });

    return { ...charge, items };
  }

  /**
   * P1 修复：createCharge 增加幂等性支持
   * 原先无幂等保护，客户端因网络超时重试时会创建重复收费单（金额、项目均重复）。
   * 现在通过 dto.requestId 启用幂等：相同 requestId 重试时返回首次创建结果，而非重复创建。
   * 即使不传 requestId，仍保留原 UNIQUE 重试机制处理 number 冲突。
   */
  createCharge(dto: CreateChargeDto) {
    const clinicId = this.clinicContext.getClinicId();

    // 内部创建逻辑：保持同步（IdempotencyService 要求 handler 不能返回 Promise）
    const doCreate = (db: IDatabase): ChargeRecord & { items?: ChargeItemRecord[] } => {
      const now = new Date().toISOString();
      let lastError: Error | undefined;
      let lastChargeId: string | undefined;

      for (let attempt = 0; attempt < BUSINESS_CODE_MAX_RETRIES; attempt++) {
        try {
          const chargeId = crypto.randomUUID();
          lastChargeId = chargeId;
          const number = this.generateChargeNumberSync(db);

          let totalAmountCents = 0;
          if (dto.items && dto.items.length > 0) {
            for (const item of dto.items) {
              const priceCents = yuanToCents(item.price || 0);
              const quantity = item.quantity || 1;
              totalAmountCents += priceCents * quantity;
            }
          }

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

          // 在事务内读取刚创建的记录
          const charge = db.prepare(
            `SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, clinicId, createdAt, updatedAt FROM Charge WHERE id = ? AND deletedAt IS NULL`
          ).get(chargeId) as ChargeRecord;
          charge.totalAmount = centsToYuan(Number(charge.totalAmount) || 0);
          charge.paidAmount = centsToYuan(Number(charge.paidAmount) || 0);
          charge.refundedAmount = centsToYuan(Number(charge.refundedAmount) || 0);
          charge.discount = centsToYuan(Number(charge.discount) || 0);

          const items = db.prepare(
            `SELECT id, chargeId, treatmentId, inventoryItemId, name, category, price, quantity, teethNumbers, subtotal, clinicId FROM ChargeItem WHERE chargeId = ?`
          ).all(chargeId) as ChargeItemRecord[];
          items.forEach((item) => {
            item.teethNumbers = safeJsonArray(item.teethNumbers as string | null);
            item.price = centsToYuan(Number(item.price));
            item.subtotal = centsToYuan(Number(item.subtotal));
          });

          const result = { ...charge, items } as ChargeRecord & { items?: ChargeItemRecord[] };
          // 缓存 chargeId 与 clinicId 供外部 emit 使用
          (result as ChargeRecord & { _chargeId?: string; _clinicId?: string })._chargeId = chargeId;
          (result as ChargeRecord & { _chargeId?: string; _clinicId?: string })._clinicId = clinicId;
          (result as ChargeRecord & { _totalAmountCents?: number })._totalAmountCents = totalAmountCents;
          return result;
        } catch (e: unknown) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (e instanceof Error && e.message.includes('UNIQUE constraint failed: Charge.number')) {
            continue;
          }
          this.logger.error(
            {
              message: `创建收费单失败: ${lastError.message}`,
              chargeId: lastChargeId,
              patientId: dto.patientId,
              doctorId: dto.doctorId,
              attempt: attempt + 1,
            },
            lastError,
          );
          throw e;
        }
      }
      this.logger.error(
        {
          message: '创建收费单失败，已达最大重试次数',
          chargeId: lastChargeId,
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          maxRetries: BUSINESS_CODE_MAX_RETRIES,
        },
        lastError,
      );
      throw lastError || new BusinessValidationException('创建收费单失败，请重试');
    };

    // 选择执行策略：有 requestId 走幂等，否则走原事务
    const idempotencyKey = dto.requestId ? `charge-create:${clinicId}:${dto.patientId}:${dto.requestId}` : null;
    const result = idempotencyKey
      ? this.idempotency.executeInTransaction(
          { key: idempotencyKey, type: 'CHARGE_CREATE' },
          (db) => doCreate(db),
        )
      : this.dbService.transaction((db) => doCreate(db));

    // 提取内部缓存的 chargeId 用于事件发布（事件必须在事务外发布）
    const chargeId = (result as ChargeRecord & { _chargeId?: string })._chargeId;
    const totalAmountCents = (result as ChargeRecord & { _totalAmountCents?: number })._totalAmountCents;
    if (chargeId && totalAmountCents !== undefined) {
      this.eventBus.emit(new ChargeCreatedEvent(chargeId, dto.patientId, centsToYuan(totalAmountCents), clinicId));
    }
    // 清理内部字段
    delete (result as ChargeRecord & { _chargeId?: string })._chargeId;
    delete (result as ChargeRecord & { _clinicId?: string })._clinicId;
    delete (result as ChargeRecord & { _totalAmountCents?: number })._totalAmountCents;

    return result;
  }

  /**
   * 同步版本的 generateChargeNumber，可在事务内使用指定的 db 连接
   * 避免在 idempotency handler 内调用 this.dbService 而脱离事务
   */
  private generateChargeNumberSync(db: IDatabase): string {
    const date = new Date();
    const dateStr = date.getFullYear().toString() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');

    const clinicId = this.clinicContext.getClinicId();
    const row = db.prepare(
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
