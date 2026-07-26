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
import { StatsService } from '../system/stats/stats.service';

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
    private statsService: StatsService,
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
        this.dbService.prepare(
          `INSERT INTO Patient (id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, source, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, referrer, emergencyContact, emergencyPhone, familyId, active, clinicId, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`
        ).run(
          id, code, sanitizePlain(dto.name), dto.gender, dto.birthDate || null,
          sanitizePlain(dto.phone), dto.idCard ? encryptField(dto.idCard) : null,
          sanitizePlain(dto.address || ''), sanitizePlain(dto.occupation || ''),
          sanitizePlain(dto.remark || ''), dto.source || "WALK_IN",
          JSON.stringify(dto.tags || []), JSON.stringify(dto.allergies || []),
          JSON.stringify(dto.medicalHistory || []), JSON.stringify(dto.medicationHistory || []),
          JSON.stringify(dto.systemicDiseases || []), dto.referrer || null,
          dto.emergencyContact || null, dto.emergencyPhone || null,
          dto.familyId || null, clinicId || null, now, now
        );
        const result = this.decryptPatient(await super.findOne(id));

        this.statsService.invalidateStatsCache('dashboard');
        this.statsService.invalidateStatsCache('patient');
        this.statsService.invalidateStatsCache('patientGrowth');

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

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) as total FROM Patient${whereClause}`;
    const countRow = this.dbService.prepare(countQuery).get(...params) as { total: number };
    const total = countRow.total;

    let dataQuery = `SELECT id, code, name, gender, birthDate, phone, idCard, source, tags, active, createdAt, updatedAt FROM Patient${whereClause}`;
    const dataParams: unknown[] = [...params];

    if (cursor) {
      const whereOrAnd = conditions.length > 0 ? 'AND' : 'WHERE';
      const cursorOp = validSortOrder === 'ASC' ? '>' : '<';
      dataQuery += ` ${whereOrAnd} id ${cursorOp} ?`;
      dataParams.push(cursor);
      dataQuery += ` ORDER BY ${sortBy} ${validSortOrder}, id ${validSortOrder} LIMIT ?`;
      dataParams.push(pageSize);
    } else {
      dataQuery += ` ORDER BY ${sortBy} ${validSortOrder}, id ${validSortOrder} LIMIT ? OFFSET ?`;
      dataParams.push(pageSize, (page - 1) * pageSize);
    }

    const items = this.dbService.prepare(dataQuery).all(...dataParams) as Patient[];

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
    if (result.idCard && result.idCard.includes(':')) {
      const decrypted = decryptField(result.idCard);
      // 统一使用 mask.ts 工具，避免 Knowledge Duplication
      result.idCard = maskIdCard(decrypted) ?? decrypted;
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
}
