import { Injectable } from '@nestjs/common';
import { SqlExecutor } from '../../../common/repositories/base.repository';

export interface CreatePatientData {
  id: string;
  code: string;
  name: string;
  gender: string;
  birthDate?: string | null;
  phone: string;
  idCard?: string | null;
  address?: string | null;
  occupation?: string | null;
  remark?: string | null;
  source: string;
  tags: string;
  allergies: string;
  medicalHistory: string;
  medicationHistory: string;
  systemicDiseases: string;
  referrer?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  familyId?: string | null;
  clinicId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FindManyOptions {
  selectColumns: string;
  conditions: string[];
  params: unknown[];
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
  cursor?: string;
  page: number;
  pageSize: number;
}

/**
 * PatientRepository —— 患者数据访问层
 *
 * 职责：封装 Patient 表的所有 SQL 操作，不包含业务逻辑。
 * 业务逻辑（如字段加密、脱敏、JSON 序列化）由 PatientsService 负责。
 */
@Injectable()
export class PatientRepository {
  private readonly tableName = 'Patient';

  create(db: SqlExecutor, data: CreatePatientData): void {
    db.prepare(
      `INSERT INTO ${this.tableName} (id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, source, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, referrer, emergencyContact, emergencyPhone, familyId, active, clinicId, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    ).run(
      data.id,
      data.code,
      data.name,
      data.gender,
      data.birthDate ?? null,
      data.phone,
      data.idCard ?? null,
      data.address ?? null,
      data.occupation ?? null,
      data.remark ?? null,
      data.source,
      data.tags,
      data.allergies,
      data.medicalHistory,
      data.medicationHistory,
      data.systemicDiseases,
      data.referrer ?? null,
      data.emergencyContact ?? null,
      data.emergencyPhone ?? null,
      data.familyId ?? null,
      data.clinicId ?? null,
      data.createdAt,
      data.updatedAt,
    );
  }

  findMany(
    db: SqlExecutor,
    options: FindManyOptions,
  ): { items: Record<string, unknown>[]; total: number } {
    const { selectColumns, conditions, params, sortBy, sortOrder, cursor, page, pageSize } = options;

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName}${whereClause}`;
    const total = (db.prepare(countSql).get(...params) as { total: number } | undefined)?.total || 0;

    let dataSql = `SELECT ${selectColumns} FROM ${this.tableName}${whereClause}`;
    const dataParams: unknown[] = [...params];

    if (cursor) {
      const whereOrAnd = conditions.length > 0 ? 'AND' : 'WHERE';
      const cursorOp = sortOrder === 'ASC' ? '>' : '<';
      dataSql += ` ${whereOrAnd} id ${cursorOp} ?`;
      dataParams.push(cursor);
      dataSql += ` ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder} LIMIT ?`;
      dataParams.push(pageSize);
    } else {
      dataSql += ` ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder} LIMIT ? OFFSET ?`;
      dataParams.push(pageSize, (page - 1) * pageSize);
    }

    const items = db.prepare(dataSql).all(...dataParams) as Record<string, unknown>[];
    return { items, total };
  }
}
