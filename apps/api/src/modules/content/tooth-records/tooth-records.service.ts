import { Injectable, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { ToothRecord } from "@dental/shared";
import * as crypto from "crypto";

interface UpsertToothRecordDto {
  currentStatus?: string;
  conditions?: string[];
  remark?: string | null;
}

function isValidToothNumber(n: number): boolean {
  return (n >= 11 && n <= 18) || (n >= 21 && n <= 28) || (n >= 31 && n <= 38) || (n >= 41 && n <= 48)
      || (n >= 51 && n <= 55) || (n >= 61 && n <= 65) || (n >= 71 && n <= 75) || (n >= 81 && n <= 85);
}

@Injectable()
export class ToothRecordsService {
  constructor(private dbService: DbService) {}

  async findOne(patientId: string, toothNumber: number): Promise<ToothRecord | undefined> {
    return this.dbService.prepare("SELECT * FROM ToothRecord WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL").get(patientId, toothNumber) as ToothRecord | undefined;
  }

  async upsert(patientId: string, toothNumber: number, data: UpsertToothRecordDto) {
    if (!isValidToothNumber(toothNumber)) throw new BadRequestException(`无效的牙位号: ${toothNumber}`);
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const existing = db.prepare("SELECT id FROM ToothRecord WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL").get(patientId, toothNumber);
      if (existing) {
        db.prepare("UPDATE ToothRecord SET currentStatus=?, conditions=?, remark=?, updatedAt=? WHERE patientId=? AND toothNumber=? AND deletedAt IS NULL")
          .run(data.currentStatus||"SOUND", JSON.stringify(data.conditions||[]), data.remark||null, now, patientId, toothNumber);
      } else {
        db.prepare("INSERT INTO ToothRecord (id, patientId, toothNumber, currentStatus, conditions, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)")
          .run(crypto.randomUUID(), patientId, toothNumber, data.currentStatus||"SOUND", JSON.stringify(data.conditions||[]), data.remark||null, now, now);
      }
      return db.prepare("SELECT * FROM ToothRecord WHERE patientId=? AND toothNumber=? AND deletedAt IS NULL").get(patientId, toothNumber) as ToothRecord;
    });
  }

  async remove(patientId: string, toothNumber: number) {
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE ToothRecord SET deletedAt = ?, updatedAt = ? WHERE patientId = ? AND toothNumber = ? AND deletedAt IS NULL")
      .run(now, now, patientId, toothNumber);
    return { success: true };
  }

  findByPatient(patientId: string) {
    return this.dbService.prepare("SELECT * FROM ToothRecord WHERE patientId = ? AND deletedAt IS NULL ORDER BY toothNumber ASC").all(patientId);
  }
}
