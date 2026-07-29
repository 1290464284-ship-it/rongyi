import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { Supplier } from "@dental/shared";

@Injectable()
export class SuppliersService extends BaseService<Supplier> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, { tableName: "Supplier", searchFields: ["name"], uniqueFields: ["code"] });
  }
}
