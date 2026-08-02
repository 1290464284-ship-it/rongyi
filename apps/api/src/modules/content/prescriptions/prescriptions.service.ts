import { BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { BaseService } from "../../../common/services/base.service";
import { Prescription } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { DrugCatalogService } from "../drug-catalog/drug-catalog.service";
import { DbService } from "../../../db/db.service";
import { PrescriptionSafetyService, PatientContraindicationContext, PrescriptionContraindicationAlert, PrescriptionItemDto as SafetyPrescriptionItemDto } from '../prescription-safety/prescription-safety.service';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { IDatabase } from '../../../db/db.interface';

interface PrescriptionItemDto {
  drugCode?: string;
  drugName: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: number;
  quantity: number;
  unit: string;
}

interface CreatePrescriptionDto {
  patientId: string;
  visitId?: string;
  doctorId: string;
  remark?: string;
  items: PrescriptionItemDto[];
  ignoreContraindicationIds?: string[];
  patientContext?: PatientContraindicationContext;
}

@Injectable()
export class PrescriptionsService extends BaseService<Prescription> {

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private drugCatalogService: DrugCatalogService,
    private prescriptionSafetyService: PrescriptionSafetyService,
  ) {
    super(dbService, clinicContext, {
      tableName: "Prescription",
      cascadeTables: [{ table: 'PrescriptionItem', foreignKey: 'prescriptionId' }],
    });
  }

  async create(dto: Partial<Prescription> & { items?: unknown[] }): Promise<Prescription> {
    const createDto = dto as unknown as CreatePrescriptionDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BusinessValidationException('处方明细不能为空');
    }

    const items = createDto.items as unknown as SafetyPrescriptionItemDto[];
    const patientCtx = createDto.patientContext ?? {};
    const ignoreIds = new Set(createDto.ignoreContraindicationIds);

    let warnings: PrescriptionContraindicationAlert[] = [];
    try {
      warnings = await this.prescriptionSafetyService.validate(items, patientCtx);
    } catch {
      warnings = [{
        ruleId: 'SYSTEM-FAIL-OPEN',
        level: 'WARN',
        message: '系统内部警告：配伍校验失败，请联系管理员。',
      }];
    }

    const dangerItems = warnings.filter(w => w.level === 'DANGER');
    const unconfirmedDanger = dangerItems.filter(d => !ignoreIds.has(d.ruleId));

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    if (unconfirmedDanger.length > 0) {
      const messages = unconfirmedDanger.map(d => `【${d.level}】${d.message}`).join('；');
      this.dbService.transaction((db) => {
        this.writeAudit(db, AuditLogType.PRESCRIPTION_CONTRAINDICATION_BLOCKED, id, {
          unconfirmedRules: unconfirmedDanger.map(d => ({ ruleId: d.ruleId, message: d.message, drugPair: d.drugPair })),
          ignoreContraindicationIds: [...ignoreIds],
        });
      });
      throw new BusinessValidationException(
        `处方存在未确认的配伍禁忌：${messages}`,
      );
    }

    this.dbService.transaction((db) => {
      this.baseRepository.insert(db, this.tableName, {
        id,
        patientId: createDto.patientId,
        visitId: createDto.visitId || null,
        doctorId: createDto.doctorId,
        remark: createDto.remark || null,
        clinicId: clinicId || null,
        createdAt: now,
        updatedAt: now,
      });

      const drugItems = createDto.items.filter(item => item.drugCode && item.quantity > 0);
      if (drugItems.length > 0) {
        this.drugCatalogService.deductStock(
          drugItems.map(item => ({ drugCode: item.drugCode ?? '', drugName: item.drugName, quantity: item.quantity })),
          db,
        );
      }

      for (const item of createDto.items) {
        const itemId = crypto.randomUUID();
        this.baseRepository.insert(db, 'PrescriptionItem', {
          id: itemId,
          prescriptionId: id,
          drugCode: item.drugCode || null,
          drugName: item.drugName,
          spec: item.spec,
          dosage: item.dosage,
          frequency: item.frequency,
          days: item.days,
          quantity: item.quantity,
          unit: item.unit,
          clinicId: clinicId || null,
        });
      }

      this.logAudit(db, AuditLogType.PRESCRIPTION_CREATE, id, "Prescription", {
        afterData: { patientId: createDto.patientId, doctorId: createDto.doctorId, itemCount: createDto.items.length },
      });

      if (dangerItems.length > 0) {
        this.writeAudit(db, AuditLogType.PRESCRIPTION_CONTRAINDICATION_IGNORED, id, {
          ignoredRules: dangerItems.map(d => ({ ruleId: d.ruleId, message: d.message, drugPair: d.drugPair })),
          contraindicationIds: dangerItems.map(d => d.ruleId),
        });
      }

      const warnItems = warnings.filter(w => w.level === 'WARN' || w.level === 'INFO');
      if (warnItems.length > 0 && dangerItems.length === 0) {
        this.writeAudit(db, AuditLogType.PRESCRIPTION_CONTRAINDICATION_WARNED, id, {
          warnings: warnItems.map(w => ({ ruleId: w.ruleId, level: w.level, message: w.message, drugPair: w.drugPair })),
        });
      }
    });
    return super.findOne(id);
  }

  private writeAudit(
    db: IDatabase,
    type: string,
    prescriptionId: string,
    detail: unknown,
  ): void {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    try {
      const stmt = db.prepare(
        `INSERT INTO AuditLog (id, type, targetId, targetType, clinicId, remark, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      stmt.run(
        crypto.randomUUID(),
        type,
        prescriptionId,
        'Prescription',
        clinicId || null,
        typeof detail === 'string' ? detail : JSON.stringify(detail),
        now,
      );
    } catch (err: unknown) {
      this.logger.warn(`写入配伍禁忌审计日志失败: ${(err as Error)?.message}`);
    }
  }
}
