import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";

export interface OralExamination {
  id: string;
  patientId: string;
  caries?: any[];
  looseTeeth?: any[];
  mucosa?: string;
  tmj?: string;
  remark?: string;
  createdAt: string;
  updatedAt?: string;
}

@Injectable()
export class OralExaminationsService extends BaseService<OralExamination> {
  constructor(dbService: DbService) {
    super(dbService, "OralExamination", ["caries", "looseTeeth"], ["mucosa", "tmj", "remark"]);
  }

  async findByPatient(patientId: string) {
    return this.findMany({ filters: { patientId } });
  }
}
