import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Imaging } from "@dental/shared";

@Injectable()
export class ImagingService extends BaseService<Imaging> {
  constructor(dbService: DbService) {
    super(dbService, "Imaging", [], ["title"]);
  }
}
