import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";

export interface PeriodontalRecord {
  id: string;
  patientId: string;
  data?: Record<string, any>;
  remark?: string;
  examDate?: string;
  createdAt: string;
  updatedAt?: string;
}

@Injectable()
export class PeriodontalRecordsService extends BaseService<PeriodontalRecord> {
  constructor(dbService: DbService) {
    super(dbService, "PeriodontalRecord", ["data"], ["remark", "examDate"]);
  }

  async findByPatient(patientId: string) {
    return this.findMany({ filters: { patientId } });
  }
}
