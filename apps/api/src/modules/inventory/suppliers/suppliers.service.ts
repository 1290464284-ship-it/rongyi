import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService, QueryOptions } from "../../../common/services/base.service";
import { Supplier } from "@dental/shared";

@Injectable()
export class SuppliersService extends BaseService<Supplier> {
  constructor(dbService: DbService) {
    super(dbService, "Supplier", [], ["name"], [], true, ["code"]);
  }

  async findMany(options?: QueryOptions) {
    return super.findMany(options);
  }
}
