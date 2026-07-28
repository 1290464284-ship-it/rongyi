import { BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { BaseService } from "../../../common/services/base.service";
import { FirstExam } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { safeJsonArray } from "../../../common/utils/format/json.utils";
import { FirstExamStatus, AuditLogType } from "../../../common/constants";
import { DbService } from "../../../db/db.service";

const FIRST_EXAM_FIELDS = "id, patientId, doctorId, chiefComplaint, diagnosis, treatmentSuggestion, status, remark, createdAt, updatedAt";

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  [FirstExamStatus.DRAFT]: [FirstExamStatus.SUBMITTED, FirstExamStatus.APPROVED],
  [FirstExamStatus.SUBMITTED]: [FirstExamStatus.APPROVED, FirstExamStatus.REJECTED],
  [FirstExamStatus.REJECTED]: [FirstExamStatus.DRAFT],
  [FirstExamStatus.APPROVED]: [FirstExamStatus.DRAFT],
};

/**
 * 迁移说明：
 * 1. updateStatus/restart/stats 使用 BaseRepository 替代直接 db.prepare
 * 2. createFollowUp/getTrack/listTracks/getTeeth/updateTooth 使用 BaseRepository 操作关联表
 */
@Injectable()
export class FirstExamsService extends BaseService<FirstExam> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, 'FirstExam');
    this.selectFields = FIRST_EXAM_FIELDS.split(',').map(s => s.trim()).filter(Boolean);
    this.hasSoftDelete = true;
    this.cascadeTables = [
      { table: 'FirstExamTooth', foreignKey: 'examId' },
      { table: 'FirstExamTrack', foreignKey: 'examId' },
      { table: 'FirstExamFollowUp', foreignKey: 'examId' },
    ];
  }

  async create(dto: { patientId: string; doctorId?: string; chiefComplaint?: string; diagnosis?: string; treatmentSuggestion?: string; remark?: string }) {
    return super.create({
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      chiefComplaint: dto.chiefComplaint,
      diagnosis: dto.diagnosis,
      treatmentSuggestion: dto.treatmentSuggestion,
      remark: dto.remark,
      status: FirstExamStatus.DRAFT,
    });
  }

  async update(id: string, dto: { chiefComplaint?: string; diagnosis?: string; treatmentSuggestion?: string; remark?: string }) {
    return super.update(id, {
      chiefComplaint: dto.chiefComplaint,
      diagnosis: dto.diagnosis,
      treatmentSuggestion: dto.treatmentSuggestion,
      remark: dto.remark,
    });
  }

  async updateStatus(id: string, status: string) {
    const oldRecord = await this.findOne(id);
    const allowed = ALLOWED_TRANSITIONS[oldRecord.status] || [];
    if (!allowed.includes(status)) {
      throw new BusinessValidationException(`初诊状态不可从 ${oldRecord.status} 流转到 ${status}`);
    }
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      // 迁移：使用 BaseRepository.update 替代直接 db.prepare UPDATE
      this.baseRepository.update(
        db,
        this.tableName,
        ['status = ?', 'updatedAt = ?'],
        [status, now],
        id,
        clinicClause,
        clinicParams,
      );
      this.logAudit(db, AuditLogType.FIRST_EXAM_STATUS_UPDATE, id, "FirstExam", { beforeData: { status: oldRecord.status }, afterData: { status } });
      const clinicCondition = clinicClause.replace(/^\s*AND\s+/i, '');
      return this.baseRepository.findById(db, this.tableName, '*', id, clinicCondition ? ['deletedAt IS NULL', clinicCondition] : ['deletedAt IS NULL'], clinicParams);
    });
  }

  async stats() {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    // 迁移：使用 BaseRepository.buildPaginatedQuery 获取总数
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      this.tableName,
      'COUNT(*) as c',
      ` WHERE deletedAt IS NULL${clinicClause}`,
      clinicParams,
      'createdAt',
      'DESC',
      undefined,
      1,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery<{ c: number }>(this.dbService, builtQuery);
    const total = items[0]?.c || 0;
    return { total };
  }
  async complete(id: string) {
    return this.updateStatus(id, FirstExamStatus.APPROVED);
  }
  async createFollowUp(id: string, dto: { planDate?: string; content?: string; assigneeId?: string }) {
    await this.findOne(id); // 校验 exam 存在且属于当前诊所
    const now = new Date().toISOString();
    const fid = crypto.randomUUID();
    const clinicId = this.clinicContext.getClinicId();
    this.baseRepository.insert(this.dbService, 'FirstExamFollowUp', {
      id: fid,
      examId: id,
      planDate: dto.planDate || null,
      content: dto.content || null,
      assigneeId: dto.assigneeId || null,
      clinicId: clinicId || null,
      createdAt: now,
    });
    this.logAudit(this.dbService, AuditLogType.FIRST_EXAM_FOLLOWUP_CREATE, id, "FirstExam", { afterData: { followUpId: fid, planDate: dto.planDate, content: dto.content } });
    return { id: fid };
  }
  async getTrack(id: string) {
    const { params: clinicParams } = this.buildClinicClause();
    return this.baseRepository.findById(
      this.dbService,
      'FirstExamTrack',
      'id, examId, content, createdAt',
      id,
      ['deletedAt IS NULL'],
      clinicParams,
    );
  }
  async restart(id: string) {
    const existing = await this.findOne(id);
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      this.baseRepository.update(
        db,
        this.tableName,
        ['status = ?', 'updatedAt = ?'],
        [FirstExamStatus.DRAFT, now],
        id,
        clinicClause,
        clinicParams,
      );
      this.logAudit(db, AuditLogType.FIRST_EXAM_RESTART, id, "FirstExam", { beforeData: { status: existing.status }, afterData: { status: FirstExamStatus.DRAFT } });
    });
    return this.findOne(id);
  }
  async listTracks(examId: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'FirstExamTrack',
      'id, examId, content, createdAt',
      ` WHERE examId = ? AND deletedAt IS NULL${clinicClause}`,
      [examId, ...clinicParams],
      'createdAt',
      'DESC',
      undefined,
      100,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery(this.dbService, builtQuery);
    return items;
  }
  async updateTooth(id: string, toothNumber: number, dto: { toothStatus?: string; diseases?: unknown; treatmentPlan?: string; remark?: string }) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    const checkQuery = this.baseRepository.buildPaginatedQuery(
      'FirstExamTooth',
      'id',
      ` WHERE examId = ? AND toothNumber = ?${clinicClause}`,
      [id, toothNumber, ...clinicParams],
      'createdAt',
      'DESC',
      undefined,
      1,
      1,
    );
    const { items: existingItems } = this.baseRepository.executePaginatedQuery<{ id: string }>(this.dbService, checkQuery);
    if (existingItems.length > 0) {
      // 只更新显式传入的字段，避免 undefined 覆盖已有数据
      const fields: string[] = [];
      const values: unknown[] = [];
      if (dto.toothStatus !== undefined) { fields.push('toothStatus = ?'); values.push(dto.toothStatus); }
      if (dto.diseases !== undefined) { fields.push('diseases = ?'); values.push(JSON.stringify(dto.diseases)); }
      if (dto.treatmentPlan !== undefined) { fields.push('treatmentPlan = ?'); values.push(dto.treatmentPlan); }
      if (dto.remark !== undefined) { fields.push('remark = ?'); values.push(dto.remark); }
      if (fields.length > 0) {
        fields.push('updatedAt = ?');
        values.push(now);
        this.baseRepository.update(
          this.dbService,
          'FirstExamTooth',
          fields,
          values,
          existingItems[0].id,
          clinicClause,
          clinicParams,
        );
      }
    }
    this.logAudit(this.dbService, AuditLogType.FIRST_EXAM_TOOTH_UPDATE, id, "FirstExam", { afterData: { toothNumber, ...dto } });
    return { id, toothNumber };
  }
  async updateTrack(id: string, dto: { status?: string; leaderSuggestion?: string; directorSuggestion?: string; churnReason?: string; churnSolution?: string; doctorId?: string }) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (dto.status !== undefined) {
      fields.push('status = ?');
      values.push(dto.status);
    }
    if (dto.leaderSuggestion !== undefined) {
      fields.push('leaderSuggestion = ?');
      values.push(dto.leaderSuggestion);
    }
    if (dto.directorSuggestion !== undefined) {
      fields.push('directorSuggestion = ?');
      values.push(dto.directorSuggestion);
    }
    if (dto.churnReason !== undefined) {
      fields.push('churnReason = ?');
      values.push(dto.churnReason);
    }
    if (dto.churnSolution !== undefined) {
      fields.push('churnSolution = ?');
      values.push(dto.churnSolution);
    }
    if (dto.doctorId !== undefined) {
      fields.push('doctorId = ?');
      values.push(dto.doctorId);
    }

    if (fields.length === 0) {
      return this.getTrack(id);
    }

    fields.push('updatedAt = ?');
    values.push(now);

    this.baseRepository.update(
      this.dbService,
      'FirstExamTrack',
      fields,
      values,
      id,
      clinicClause,
      clinicParams,
    );

    this.logAudit(this.dbService, AuditLogType.FIRST_EXAM_TRACK_UPDATE, id, "FirstExamTrack", { afterData: dto });

    return this.getTrack(id);
  }
  async getTeeth(examId: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'FirstExamTooth',
      'id, examId, toothNumber, toothStatus, diseases, treatmentPlan, remark',
      ` WHERE examId = ?${clinicClause}`,
      [examId, ...clinicParams],
      'toothNumber',
      'ASC',
      undefined,
      100,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery<Record<string, unknown>>(this.dbService, builtQuery);
    for (const tooth of items) {
      tooth.diseases = safeJsonArray(tooth.diseases as string | null);
    }
    return items;
  }
  async batchUpdateTeeth(examId: string, teeth: { toothNumber: number; toothStatus?: string; diseases?: unknown; treatmentPlan?: string; remark?: string }[]) {
    await this.findOne(examId);
    if (!Array.isArray(teeth) || teeth.length === 0) {
      return this.getTeeth(examId);
    }
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    this.dbService.transaction((db) => {
      const now = new Date().toISOString();
      const clinicId = this.clinicContext.getClinicId();

      // Batch existence check: fetch all existing teeth in ONE query
      const toothNumbers = teeth.map(t => t.toothNumber);
      const placeholders = toothNumbers.map(() => '?').join(',');
      const batchCheckSql = `SELECT id, toothNumber FROM FirstExamTooth WHERE examId = ? AND toothNumber IN (${placeholders})${clinicClause}`;
      const batchCheckParams = [examId, ...toothNumbers, ...clinicParams];
      const existingRows = db.prepare(batchCheckSql).all(...batchCheckParams) as { id: string; toothNumber: number }[];
      const existingMap = new Map(existingRows.map(r => [r.toothNumber, r.id]));

      // Partition teeth into updates and inserts
      const updates: { tooth: typeof teeth[number]; id: string }[] = [];
      const inserts: typeof teeth[number][] = [];
      for (const tooth of teeth) {
        const existingId = existingMap.get(tooth.toothNumber);
        if (existingId) {
          updates.push({ tooth, id: existingId });
        } else {
          inserts.push(tooth);
        }
      }

      // Batch updates
      if (updates.length > 0) {
        const updateStmt = db.prepare(
          `UPDATE FirstExamTooth SET toothStatus = ?, diseases = ?, treatmentPlan = ?, remark = ?, updatedAt = ? WHERE id = ?`
        );
        for (const { tooth, id } of updates) {
          updateStmt.run(
            tooth.toothStatus,
            tooth.diseases !== undefined ? JSON.stringify(tooth.diseases) : null,
            tooth.treatmentPlan,
            tooth.remark,
            now,
            id,
          );
        }
      }

      // Batch inserts
      if (inserts.length > 0) {
        const insertStmt = db.prepare(
          `INSERT INTO FirstExamTooth (id, examId, toothNumber, toothStatus, diseases, treatmentPlan, remark, clinicId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const tooth of inserts) {
          insertStmt.run(
            crypto.randomUUID(), examId, tooth.toothNumber,
            tooth.toothStatus || null,
            tooth.diseases !== undefined ? JSON.stringify(tooth.diseases) : null,
            tooth.treatmentPlan || null, tooth.remark || null,
            clinicId || null, now, now,
          );
        }
      }
    });
    return this.getTeeth(examId);
  }
}
