import { BadRequestException, Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Prescription } from "@dental/shared";
import * as crypto from "crypto";

interface PrescriptionItemDto {
  drugCode?: string | null;
  drugName: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: number;
  quantity: number;
  unit: string;
}

interface CreatePrescriptionDto {
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  remark?: string | null;
  items: PrescriptionItemDto[];
}

@Injectable()
export class PrescriptionsService extends BaseService<Prescription> {
  constructor(dbService: DbService) {
    super(dbService, "Prescription", [], []);
  }

  async create(dto: Partial<Prescription>): Promise<Prescription> {
    const createDto = dto as unknown as CreatePrescriptionDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BadRequestException('处方明细不能为空');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = this.dbService.transaction((db) => {
      db.prepare("INSERT INTO Prescription (id, patientId, visitId, doctorId, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)")
        .run(id, createDto.patientId, createDto.visitId || null, createDto.doctorId, createDto.remark || null, now, now);
      for (const item of createDto.items) {
        db.prepare("INSERT INTO PrescriptionItem (id, prescriptionId, drugCode, drugName, spec, dosage, frequency, days, quantity, unit) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(crypto.randomUUID(), id, item.drugCode || null, item.drugName, item.spec, item.dosage, item.frequency, item.days, item.quantity, item.unit);
        if (item.drugCode && item.quantity > 0) {
          const drug = db.prepare("SELECT id, stock FROM DrugCatalog WHERE code = ?").get(item.drugCode) as { id: string; stock: number } | undefined;
          if (drug) {
            if (drug.stock < item.quantity) {
              throw new BadRequestException(`药品 ${item.drugName} (${item.drugCode}) 库存不足，当前库存：${drug.stock}`);
            }
            const updateResult = db.prepare("UPDATE DrugCatalog SET stock = stock - ? WHERE code = ? AND stock >= ?")
              .run(item.quantity, item.drugCode, item.quantity);
            if (updateResult.changes === 0) {
              throw new BadRequestException(`药品 ${item.drugName} (${item.drugCode}) 库存不足`);
            }
          }
        }
      }
      return id;
    });
    return super.findOne(result);
  }
}
