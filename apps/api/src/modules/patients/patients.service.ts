import { BusinessValidationException, BusinessForbiddenException, BusinessConflictException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../db/db.service";
import { BaseService, QueryOptions, MAX_PAGE_SIZE } from "../../common/services/base.service";
import { PAGINATION } from "../../common/constants/pagination";
import { sanitizePlain } from "../../common/utils/security/sanitize";
import { encryptField, decryptField } from "../../common/utils/security/encryption";
import { maskIdCard, maskPhone } from "../../common/utils/security/mask";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../common/services/clinic-context.service";
import { CreatePatientDto, PatientSource } from "./dto/create-patient.dto";
import { UNIQUE_CONSTRAINT_MAX_RETRIES } from "../../config/constants";
import { validateColumnName, escapeLike } from "../../common/utils/db/validate-name";
import { Pagination } from "@dental/shared";
import { Gender } from "@dental/shared";
import { AuditLogType } from "../../common/constants";
import { EventBusService } from '../../common/events/event-bus.service';
import { PatientRegisteredEvent } from '../../common/events/domain-events';
import { PatientRepository } from './repositories/patient.repository';

export interface Patient {
  id: string;
  code: string;
  name: string;
  gender: Gender;
  birthDate?: string;
  phone: string;
  idCard: string;
  address?: string;
  occupation?: string;
  remark?: string;
  source: PatientSource;
  tags: string[];
  allergies: string[];
  medicalHistory: string[];
  medicationHistory: string[];
  systemicDiseases: string[];
  referrer?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  familyId?: string;
  active: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

@Injectable()
export class PatientsService extends BaseService<Patient> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private eventBus: EventBusService,
    private patientRepository: PatientRepository,
  ) {
    // 注册 tags/medicationHistory/systemicDiseases 为 JSON 字段，确保读取时正确解析为数组
    super(dbService, clinicContext, "Patient", ["allergies","medicalHistory","tags","medicationHistory","systemicDiseases"], ["name","phone"], [
      { table: "Appointment", foreignKey: "patientId" },
      { table: "Visit", foreignKey: "patientId" },
      { table: "Treatment", foreignKey: "patientId" },
      { table: "TreatmentPlan", foreignKey: "patientId" },
      { table: "Charge", foreignKey: "patientId" },
      { table: "Imaging", foreignKey: "patientId" },
      { table: "Prescription", foreignKey: "patientId" },
      { table: "ToothRecord", foreignKey: "patientId" },
      { table: "Registration", foreignKey: "patientId" },
      { table: "FollowUp", foreignKey: "patientId" },
      { table: "MedicalRecord", foreignKey: "patientId" },
      // 以下关联表也需级联软删除，避免删除患者后产生孤儿数据
      { table: "MemberCard", foreignKey: "patientId" },
      { table: "Refund", foreignKey: "patientId" },
      { table: "ProcessingOrder", foreignKey: "patientId" },
      { table: "FirstExam", foreignKey: "patientId" },
      { table: "FirstExamTrack", foreignKey: "patientId" },
      { table: "OralExamination", foreignKey: "patientId" },
      { table: "PeriodontalRecord", foreignKey: "patientId" },
      { table: "DebtRecord", foreignKey: "patientId" },
      { table: "WechatMessage", foreignKey: "patientId" },
    ], true, ["code"]);
  }

  async create(dto: CreatePatientDto): Promise<Patient> {
    const MAX_RETRIES = UNIQUE_CONSTRAINT_MAX_RETRIES;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const code = dto.code || this.generateCode('P');
        const clinicId = this.clinicContext.getClinicId();
        this.patientRepository.create(this.dbService, {
          id,
          code,
          name: sanitizePlain(dto.name),
          gender: dto.gender,
          birthDate: dto.birthDate || null,
          phone: sanitizePlain(dto.phone),
          idCard: dto.idCard ? encryptField(dto.idCard) : null,
          address: sanitizePlain(dto.address || ''),
          occupation: sanitizePlain(dto.occupation || ''),
          remark: sanitizePlain(dto.remark || ''),
          source: dto.source || "WALK_IN",
          tags: JSON.stringify(dto.tags || []),
          allergies: JSON.stringify(dto.allergies || []),
          medicalHistory: JSON.stringify(dto.medicalHistory || []),
          medicationHistory: JSON.stringify(dto.medicationHistory || []),
          systemicDiseases: JSON.stringify(dto.systemicDiseases || []),
          referrer: dto.referrer || null,
          emergencyContact: dto.emergencyContact || null,
          emergencyPhone: dto.emergencyPhone || null,
          familyId: dto.familyId || null,
          clinicId: clinicId || null,
          createdAt: now,
          updatedAt: now,
        });
        const result = this.decryptPatient(await super.findOne(id));

        this.eventBus.emit(new PatientRegisteredEvent(id, clinicId || null));

        return result;
      } catch (err: unknown) {
        if (attempt < MAX_RETRIES && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          if (!dto.code) {
            continue;
          }
        }
        throw err;
      }
    }
    throw new BusinessConflictException(`创建患者失败，请重试`);
  }

  async findOne(id: string): Promise<Patient> {
    const patient = await super.findOne(id);
    return this.decryptPatient(patient);
  }

  async findMany(options: QueryOptions = {}): Promise<Pagination<Patient>> {
    const { keyword, page: rawPage = 1, pageSize: rawPageSize = PAGINATION.DEFAULT_PAGE_SIZE, sortBy = 'createdAt', sortOrder = 'DESC', cursor, includeDeleted = false, skipClinicFilter = false } = options;
    const page = Math.max(1, Math.floor(Number(rawPage) || 1));
    const pageSize = Math.min(Math.max(1, Math.floor(Number(rawPageSize) || PAGINATION.DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);

    if (!validateColumnName(sortBy)) {
      throw new BusinessValidationException(`无效的排序字段`);
    }

    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!skipClinicFilter) {
      const clinicId = this.clinicContext.getClinicId();
      if (clinicId) {
        conditions.push('clinicId = ?');
        params.push(clinicId);
      } else {
        throw new BusinessForbiddenException('缺少诊所信息，请重新登录');
      }
    }

    if (this.hasSoftDelete && !includeDeleted) {
      conditions.push('deletedAt IS NULL');
    }

    if (keyword && keyword.trim()) {
      const trimmed = keyword.trim();
      const escaped = escapeLike(trimmed);
      const prefixPattern = `${escaped}%`;

      const searchConditions: string[] = [];
      const searchParams: unknown[] = [];

      searchConditions.push("name LIKE ? ESCAPE '\\'");
      searchParams.push(prefixPattern);

      searchConditions.push("phone LIKE ? ESCAPE '\\'");
      searchParams.push(prefixPattern);

      searchConditions.push("code LIKE ? ESCAPE '\\'");
      searchParams.push(prefixPattern);

      if (/^\d+$/.test(trimmed) && trimmed.length >= 8) {
        searchConditions.push("idCard LIKE ? ESCAPE '\\'");
        searchParams.push(prefixPattern);
      }

      conditions.push(`(${searchConditions.join(' OR ')})`);
      params.push(...searchParams);
    }

    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (!validateColumnName(key)) {
          throw new BusinessValidationException(`无效的筛选字段`);
        }
        if (value !== undefined && value !== null && value !== '') {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      });
    }

    const { items: rawItems, total } = this.patientRepository.findMany(this.dbService, {
      selectColumns: 'id, code, name, gender, birthDate, phone, idCard, source, tags, active, createdAt, updatedAt',
      conditions,
      params,
      sortBy,
      sortOrder: validSortOrder,
      cursor,
      page,
      pageSize,
    });
    const items = (rawItems as unknown) as Patient[];

    this.parseJsonFields(items);

    const decryptedItems = items.map((p: Patient) => this.decryptPatient(p));

    return {
      items: decryptedItems,
      total,
      page,
      pageSize,
    };
  }

  async update(id: string, dto: Partial<Patient>): Promise<Patient> {
    if (dto.idCard !== undefined) {
      dto = { ...dto, idCard: dto.idCard ? encryptField(dto.idCard) : null };
    }
    const result = await super.update(id, dto);
    return this.decryptPatient(result);
  }

  private decryptPatient(patient: Patient): Patient {
    if (!patient) return patient;
    const result = { ...patient };
    try {
      if (result.idCard && result.idCard.includes(':')) {
        const decrypted = decryptField(result.idCard);
        // 统一使用 mask.ts 工具，避免 Knowledge Duplication
        result.idCard = maskIdCard(decrypted) ?? decrypted;
      }
    } catch {
      // 加密数据损坏时保留原始值，避免单条记录导致整个列表 500
      result.idCard = '[解密失败]';
    }
    // 列表展示时也对 phone 脱敏（详细查看时通过 getFullPhone 接口拿全量）
    if (result.phone) {
      result.phone = maskPhone(result.phone) ?? result.phone;
    }
    return result;
  }

  /**
   * D2-5: 获取完整手机号（仅在需要场景调用，如发送短信）
   * 调用方需确保有相应权限
   */
  async getFullPhone(patientId: string): Promise<string | null> {
    this.logAudit(this.dbService, AuditLogType.PHONE_ACCESS, patientId, "Patient", { remark: "获取完整手机号" });
    const patient = await super.findOne(patientId);
    return patient?.phone ?? null;
  }

  /**
   * 获取完整身份证号（仅在需要场景调用，如打印处方）
   * 调用方需确保有相应权限
   */
  async getFullIdCard(patientId: string): Promise<string | null> {
    this.logAudit(this.dbService, AuditLogType.ID_CARD_ACCESS, patientId, "Patient", { remark: "获取完整身份证号" });
    const patient = await super.findOne(patientId);
    if (!patient.idCard) return null;
    return decryptField(patient.idCard);
  }

  /**
   * 软删除患者（覆盖 BaseService 的硬删除行为）
   * 执行软删除：设置 deletedAt + active=0 + 级联软删除关联表 + 唯一字段后缀
   * 合并事务：softDelete 与 active=0 在同一事务内完成，确保原子性
   */
  async remove(id: string): Promise<unknown> {
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.transaction(() => {
      // 直接调用同步的 softDeleteManager（避免 async softDelete 的 floating promise 问题）
      const existing = this.softDeleteManager.softDelete(this.dbService, id, {
        tableName: this.tableName,
        cascadeTables: this.cascadeTables,
        uniqueFields: this.uniqueFields,
        hasSoftDelete: this.hasSoftDelete,
        selectColumns: this.getSelectColumns(),
        clinicClause: this.buildClinicClause(),
        clinicId,
      });
      this.parseJsonFields([existing as unknown as Patient]);
      this.parseMoneyFields([existing as unknown as Patient]);

      // 患者模型特有：软删除后标记为 inactive（在同一事务内执行）
      if (clinicId) {
        this.dbService.prepare('UPDATE Patient SET active = 0 WHERE id = ? AND clinicId = ?').run(id, clinicId);
      } else {
        this.dbService.prepare('UPDATE Patient SET active = 0 WHERE id = ?').run(id);
      }
    });
    return id;
  }
}
