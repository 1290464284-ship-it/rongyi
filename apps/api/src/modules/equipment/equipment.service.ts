import { Injectable } from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { BaseService } from "../../common/services/base.service";
import { ClinicContextService } from "../../common/services/clinic-context.service";
import { Equipment } from "@dental/shared";
import { AuditLogType } from "../../common/constants";

@Injectable()
export class EquipmentService extends BaseService<Equipment> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, "Equipment", [], ["name"]);
  }

  async create(dto: Partial<Equipment>): Promise<Equipment> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.EQUIPMENT_CREATE, result.id, "Equipment", { afterData: { name: result.name } });
    return result;
  }

  async update(id: string, dto: Partial<Equipment>): Promise<Equipment> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.EQUIPMENT_UPDATE, id, "Equipment", { afterData: { name: result.name } });
    return result;
  }

  async remove(id: string): Promise<unknown> {
    await super.softDelete(id);
    return id;
  }
}
