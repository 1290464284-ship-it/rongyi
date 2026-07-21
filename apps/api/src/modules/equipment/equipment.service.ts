import { Injectable } from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { BaseService } from "../../common/services/base.service";
import { Equipment } from "@dental/shared";

@Injectable()
export class EquipmentService extends BaseService<Equipment> {
  constructor(dbService: DbService) {
    super(dbService, "Equipment", [], ["name"]);
  }
}
