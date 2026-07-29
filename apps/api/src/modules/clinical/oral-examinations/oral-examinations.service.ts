import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AuditLogType } from "../../../common/constants";

export interface OralExamination {
  id: string;
  patientId: string;
  caries?: unknown[];
  looseTeeth?: unknown[];
  mucosa?: string;
  tmj?: string;
  remark?: string;
  createdAt: string;
  updatedAt?: string;
}

@Injectable()
export class OralExaminationsService extends BaseService<OralExamination> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, {
      tableName: "OralExamination",
      jsonFields: ["caries", "looseTeeth"],
      searchFields: ["mucosa", "tmj", "remark"],
    });
  }

  async create(dto: Partial<OralExamination>): Promise<OralExamination> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.ORAL_EXAM_CREATE, result.id, "OralExamination", { afterData: { patientId: result.patientId } });
    return result;
  }

  async update(id: string, dto: Partial<OralExamination>): Promise<OralExamination> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.ORAL_EXAM_UPDATE, id, "OralExamination", { afterData: { patientId: result.patientId } });
    return result;
  }

  async remove(id: string): Promise<unknown> {
    const result = await super.remove(id);
    this.logAudit(this.dbService, AuditLogType.ORAL_EXAM_DELETE, id, "OralExamination");
    return result;
  }

  async findByPatient(patientId: string) {
    return this.findMany({ filters: { patientId } });
  }
}
