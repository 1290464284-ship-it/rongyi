import { Injectable } from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { BaseService, QueryOptions } from "../../common/services/base.service";
import { sanitizePlain } from "../../common/utils/sanitize";
import { encryptField, decryptField } from "../../common/utils/encryption";
import * as crypto from "crypto";
import { CreatePatientDto, PatientGender, PatientSource } from "./dto/create-patient.dto";

export interface Patient {
  id: string;
  code: string;
  name: string;
  gender: PatientGender;
  birthDate?: string;
  phone: string;
  idCard: string;
  address?: string;
  occupation?: string;
  remark?: string;
  source: PatientSource;
  tags: string[];
  allergies: string[];
  medicalHistory: string[];
  medicationHistory: string[];
  systemicDiseases: string[];
  referrer?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  familyId?: string;
  active: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

@Injectable()
export class PatientsService extends BaseService<Patient> {
  constructor(dbService: DbService) {
    super(dbService, "Patient", ["allergies","medicalHistory"], ["name","phone"], [
      { table: "Appointment", foreignKey: "patientId" },
      { table: "Visit", foreignKey: "patientId" },
      { table: "Treatment", foreignKey: "patientId" },
      { table: "TreatmentPlan", foreignKey: "patientId" },
      { table: "Charge", foreignKey: "patientId" },
      { table: "Imaging", foreignKey: "patientId" },
      { table: "Prescription", foreignKey: "patientId" },
      { table: "ToothRecord", foreignKey: "patientId" },
      { table: "Registration", foreignKey: "patientId" },
      { table: "FollowUp", foreignKey: "patientId" },
      { table: "MedicalRecord", foreignKey: "patientId" },
      // P1 修复（软删除级联遗漏）：原代码漏级联以下 7 张关联表，删除患者后产生孤儿数据
      { table: "MemberCard", foreignKey: "patientId" },
      { table: "Refund", foreignKey: "patientId" },
      { table: "ProcessingOrder", foreignKey: "patientId" },
      { table: "FirstExam", foreignKey: "patientId" },
      { table: "FirstExamTrack", foreignKey: "patientId" },
      { table: "OralExamination", foreignKey: "patientId" },
      { table: "PeriodontalRecord", foreignKey: "patientId" },
      { table: "DebtRecord", foreignKey: "patientId" },
      { table: "WechatMessage", foreignKey: "patientId" },
    ], true, ["code"]);
  }

  async create(dto: Partial<Patient>): Promise<Patient> {
    const createDto = dto as CreatePatientDto;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const code = createDto.code || this.generateCode('P');
    this.dbService.prepare(
      `INSERT INTO Patient (id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, source, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, referrer, emergencyContact, emergencyPhone, familyId, active, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).run(
      id, code, sanitizePlain(createDto.name), createDto.gender, createDto.birthDate || null,
      sanitizePlain(createDto.phone), encryptField(createDto.idCard),
      sanitizePlain(createDto.address || ''), sanitizePlain(createDto.occupation || ''),
      sanitizePlain(createDto.remark || ''), createDto.source || "WALK_IN",
      JSON.stringify(createDto.tags || []), JSON.stringify(createDto.allergies || []),
      JSON.stringify(createDto.medicalHistory || []), JSON.stringify(createDto.medicationHistory || []),
      JSON.stringify(createDto.systemicDiseases || []), createDto.referrer || null,
      createDto.emergencyContact || null, createDto.emergencyPhone || null,
      createDto.familyId || null, now, now
    );
    return this.decryptPatient(await super.findOne(id));
  }

  async findOne(id: string) {
    const patient = await super.findOne(id);
    return this.decryptPatient(patient);
  }

  async findMany(options: QueryOptions) {
    const result = await super.findMany(options);
    result.items = result.items.map((p: Patient) => this.decryptPatient(p));
    return result;
  }

  async update(id: string, dto: Partial<Patient>): Promise<Patient> {
    if (dto.idCard !== undefined) {
      dto = { ...dto, idCard: encryptField(dto.idCard as string) };
    }
    const result = await super.update(id, dto);
    return this.decryptPatient(result);
  }

  private decryptPatient(patient: Patient): Patient {
    if (!patient) return patient;
    if (patient.idCard) {
      patient.idCard = decryptField(patient.idCard);
    }
    return patient;
  }
}
