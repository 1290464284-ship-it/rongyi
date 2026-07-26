import { BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { BaseService } from "../../../common/services/base.service";
import { Prescription } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { DrugCatalogService } from "../drug-catalog/drug-catalog.service";
import { DbService } from "../../../db/db.service";

interface PrescriptionItemDto {
  drugCode?: string | null;
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
  visitId?: string | null;
  doctorId: string;
  remark?: string | null;
  items: PrescriptionItemDto[];
}

/**
 * 迁移说明：
 * 1. create 方法从直接使用 db.prepare INSERT 迁移到使用 BaseRepository.insert
 * 2. 保留事务结构（涉及库存扣减和审计日志，需要原子性）
 * 3. DrugCatalogService.deductStock 跨服务调用保留不变
 */
@Injectable()
export class PrescriptionsService extends BaseService<Prescription> {

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private drugCatalogService: DrugCatalogService,
  ) {
    super(dbService, clinicContext, "Prescription", [], [], [
      { table: 'PrescriptionItem', foreignKey: 'prescriptionId' },
    ]);
  }

  async create(dto: Partial<Prescription>): Promise<Prescription> {
    const createDto = dto as unknown as CreatePrescriptionDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BusinessValidationException('处方明细不能为空');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
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
          drugItems.map(item => ({ drugCode: item.drugCode, drugName: item.drugName, quantity: item.quantity })),
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

      this.logAudit(db, "PRESCRIPTION_CREATE", id, "Prescription", { afterData: { patientId: createDto.patientId, doctorId: createDto.doctorId, itemCount: createDto.items.length } });
    });
    return super.findOne(id);
  }
}
