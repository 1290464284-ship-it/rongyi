import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { Imaging } from "@dental/shared";
import { AuditLogType } from "../../../common/constants";

@Injectable()
export class ImagingService extends BaseService<Imaging> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, "Imaging", [], ["title"]);
  }

  async create(dto: Partial<Imaging>): Promise<Imaging> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.IMAGING_CREATE, result.id, "Imaging", { afterData: { title: result.title } });
    return result;
  }

  async update(id: string, dto: Partial<Imaging>): Promise<Imaging> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.IMAGING_UPDATE, id, "Imaging", { afterData: { title: result.title } });
    return result;
  }

  async remove(id: string): Promise<unknown> {
    await super.softDelete(id);
    return id;
  }
}
