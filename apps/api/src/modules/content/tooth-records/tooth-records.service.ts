import { BusinessValidationException } from '@common/errors';
import { Injectable, Optional } from '@nestjs/common';

import { ToothRecord } from "@dental/shared";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import * as crypto from "node:crypto";
import { DbService } from "../../../db/db.service";
import { MedicalPhraseService } from "../medical-phrase/medical-phrase.service";

interface UpsertToothRecordDto {
  currentStatus?: string;
  conditions?: string[];
  remark?: string;
}

function isValidToothNumber(n: number): boolean {
  return (n >= 11 && n <= 18) || (n >= 21 && n <= 28) || (n >= 31 && n <= 38) || (n >= 41 && n <= 48)
      || (n >= 51 && n <= 55) || (n >= 61 && n <= 65) || (n >= 71 && n <= 75) || (n >= 81 && n <= 85);
}

/**
 * 迁移说明：
 * 1. findByTooth/upsert/removeByTooth 从直接使用 db.prepare 迁移到使用 BaseRepository
 * 2. ToothRecord 表特殊：使用 patientId + toothNumber 组合键查询，而非标准 id 查询
 */
@Injectable()
export class ToothRecordsService extends BaseService<ToothRecord> {

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    @Optional() private medicalPhraseService?: MedicalPhraseService,
  ) {
    super(dbService, clinicContext, { tableName: 'ToothRecord', jsonFields: ['conditions'] });
  }

  async findByTooth(patientId: string, toothNumber: number): Promise<ToothRecord | undefined> {
    if (!isValidToothNumber(toothNumber)) throw new BusinessValidationException(`无效的牙位号: ${toothNumber}`);
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      this.tableName,
      '*',
      ` WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL${clinicClause}`,
      [patientId, toothNumber, ...clinicParams],
      'createdAt',
      'DESC',
      undefined,
      1,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery<ToothRecord>(this.dbService, builtQuery);
    const record = items[0];
    if (record) this.parseJsonFields([record]);
    return record;
  }

  async upsert(patientId: string, toothNumber: number, data: UpsertToothRecordDto) {
    if (!isValidToothNumber(toothNumber)) throw new BusinessValidationException(`无效的牙位号: ${toothNumber}`);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const record = this.dbService.transaction((db) => {
      const checkQuery = this.baseRepository.buildPaginatedQuery(
        this.tableName,
        'id',
        ` WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL${clinicClause}`,
        [patientId, toothNumber, ...clinicParams],
        'createdAt',
        'DESC',
        undefined,
        1,
        1,
      );
      const { items: existingItems } = this.baseRepository.executePaginatedQuery<{ id: string }>(db, checkQuery);
      const existing = existingItems[0];

      if (existing) {
        this.baseRepository.update(
          db,
          this.tableName,
          ['currentStatus = ?', 'conditions = ?', 'remark = ?', 'updatedAt = ?'],
          [data.currentStatus || 'SOUND', JSON.stringify(data.conditions || []), data.remark || null, now],
          existing.id,
          clinicClause,
          clinicParams,
        );
        this.logAudit(db, "TOOTH_RECORD_UPDATE", existing.id, "ToothRecord", { afterData: { currentStatus: data.currentStatus, conditions: data.conditions } });
      } else {
        const newId = crypto.randomUUID();
        this.baseRepository.insert(db, this.tableName, {
          id: newId,
          patientId,
          toothNumber,
          currentStatus: data.currentStatus || 'SOUND',
          conditions: JSON.stringify(data.conditions || []),
          remark: data.remark || null,
          clinicId: clinicId || null,
          createdAt: now,
          updatedAt: now,
        });
        this.logAudit(db, "TOOTH_RECORD_CREATE", newId, "ToothRecord", { afterData: { currentStatus: data.currentStatus, conditions: data.conditions } });
      }

      const resultQuery = this.baseRepository.buildPaginatedQuery(
        this.tableName,
        '*',
        ` WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL${clinicClause}`,
        [patientId, toothNumber, ...clinicParams],
        'createdAt',
        'DESC',
        undefined,
        1,
        1,
      );
      const { items: resultItems } = this.baseRepository.executePaginatedQuery<ToothRecord>(db, resultQuery);
      return resultItems[0];
    });
    if (record) this.parseJsonFields([record]);
    if (record && this.medicalPhraseService
        && (record.currentStatus && record.currentStatus !== 'SOUND'
            || (Array.isArray(record.conditions) && record.conditions.length > 0))) {
      void this.medicalPhraseService.recommendForTeeth({
          patientId,
          selectedToothNumbers: [toothNumber],
        }).catch(() => { /* fire & forget, swallow silently */ });
    }
    return record;
  }

  async removeByTooth(patientId: string, toothNumber: number) {
    if (!isValidToothNumber(toothNumber)) throw new BusinessValidationException(`无效的牙位号: ${toothNumber}`);
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const checkQuery = this.baseRepository.buildPaginatedQuery(
      this.tableName,
      'id',
      ` WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL${clinicClause}`,
      [patientId, toothNumber, ...clinicParams],
      'createdAt',
      'DESC',
      undefined,
      1,
      1,
    );
    const { items: existingItems } = this.baseRepository.executePaginatedQuery<{ id: string }>(this.dbService, checkQuery);
    if (existingItems.length > 0) {
      this.baseRepository.update(
        this.dbService,
        this.tableName,
        ['deletedAt = ?', 'updatedAt = ?'],
        [now, now],
        existingItems[0].id,
        clinicClause,
        clinicParams,
      );
      this.logAudit(this.dbService, "TOOTH_RECORD_REMOVE", existingItems[0].id, "ToothRecord");
    }
    return { success: true };
  }

  async findByPatient(patientId: string) {
    return this.findMany({ filters: { patientId }, pageSize: 100, sortBy: 'toothNumber', sortOrder: 'ASC' });
  }
}
