import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AuditLogType } from "../../../common/constants";

export interface PeriodontalRecord {
  id: string;
  patientId: string;
  data?: Record<string, unknown>;
  remark?: string;
  examDate?: string;
  createdAt: string;
  updatedAt?: string;
}

@Injectable()
export class PeriodontalRecordsService extends BaseService<PeriodontalRecord> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, {
      tableName: "PeriodontalRecord",
      jsonFields: ["data"],
      searchFields: ["remark", "examDate"],
    });
  }

  async create(dto: Partial<PeriodontalRecord>): Promise<PeriodontalRecord> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.PERIODONTAL_RECORD_CREATE, result.id, "PeriodontalRecord", { afterData: { patientId: result.patientId } });
    return result;
  }

  async update(id: string, dto: Partial<PeriodontalRecord>): Promise<PeriodontalRecord> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.PERIODONTAL_RECORD_UPDATE, id, "PeriodontalRecord", { afterData: { patientId: result.patientId } });
    return result;
  }

  async remove(id: string): Promise<unknown> {
    const result = await super.remove(id);
    this.logAudit(this.dbService, AuditLogType.PERIODONTAL_RECORD_DELETE, id, "PeriodontalRecord");
    return result;
  }

  async findByPatient(patientId: string) {
    return this.findMany({ filters: { patientId } });
  }
}
