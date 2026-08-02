/* eslint-disable @typescript-eslint/no-unused-vars, sonarjs/different-types-comparison, unicorn/prefer-logical-operator-over-ternary -- TODO: 逐步修复 lint 问题 */
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AppLogger } from '../../../common/services/logger.service';
import { BusinessValidationException, BusinessNotFoundException } from '../../../common/errors';
import { AuditLogType } from '../../../common/constants';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { SettingsService } from '../../system/settings/settings.service';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import {
  RiskWeights,
  DEFAULT_RISK_WEIGHTS,
  CARIES_WEIGHT_KEYS,
  PERIODONTAL_WEIGHT_KEYS,
  IMPLANT_WEIGHT_KEYS,
  scoreToLevel,
  RiskLevel,
  CariesWeights,
  PeriodontalWeights,
  ImplantWeights,
} from './risk-factor-weights';

export interface CariesFactorBreakdown {
  C1: number;
  C2: number;
  C3: number;
  C4: number;
  C5: number;
  C6: number;
  C7: number;
}

export interface PeriodontalFactorBreakdown {
  P1: number;
  P2: number;
  P3: number;
  P4: number;
  P5: number;
  P6: number;
  P7: number;
}

export interface ImplantFactorBreakdown {
  I1: number;
  I2: number;
  I3: number;
  I4: number;
  I5: number;
  I6: number;
  I7: number;
  I8: number;
}

export interface FactorSnapshot {
  caries: CariesFactorBreakdown;
  periodontal: PeriodontalFactorBreakdown;
  implant: ImplantFactorBreakdown;
  weightsOverride: Partial<RiskWeights> | null;
  dataSources: {
    treatmentCount: number;
    periodontalRecords: number;
    firstExamRows: number;
  };
}

export interface RiskScoreResult {
  cariesScore: number;
  periodontalScore: number;
  implantScore: number;
  cariesLevel: RiskLevel;
  periodontalLevel: RiskLevel;
  implantLevel: RiskLevel;
  factorSnapshot: FactorSnapshot;
}

export interface PatientRiskScoreRow {
  id: string;
  clinicId: string;
  patientId: string;
  cariesScore: number;
  periodontalScore: number;
  implantScore: number;
  cariesLevel: RiskLevel;
  periodontalLevel: RiskLevel;
  implantLevel: RiskLevel;
  factorSnapshotJson: string | FactorSnapshot;
  assessedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

@Injectable()
export class PatientRiskService {
  private logger = new AppLogger(PatientRiskService.name);
  private auditLogService = new AuditLogService();

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {}

  private buildClinicClause(prefix: string = ' AND '): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    const result = buildClinicFilter(clinicId);
    if (!result.clause) {
      return { clause: '', params: [] };
    }
    const condition = result.clause.replace(/^\s*AND\s+/i, '');
    return { clause: prefix + condition, params: result.params };
  }

  private async resolveWeights(overrideWeights?: RiskWeights): Promise<RiskWeights> {
    if (overrideWeights) {
      return {
        caries: { ...DEFAULT_RISK_WEIGHTS.caries, ...(overrideWeights.caries || {}) },
        periodontal: { ...DEFAULT_RISK_WEIGHTS.periodontal, ...(overrideWeights.periodontal || {}) },
        implant: { ...DEFAULT_RISK_WEIGHTS.implant, ...(overrideWeights.implant || {}) },
      };
    }
    const caries: Partial<CariesWeights> = {};
    for (const [field, settingKey] of Object.entries(CARIES_WEIGHT_KEYS)) {
      const val = await this.settingsService.getNumber(settingKey, NaN);
      if (!isNaN(val)) {
        (caries as Record<string, number>)[field] = val;
      }
    }
    const periodontal: Partial<PeriodontalWeights> = {};
    for (const [field, settingKey] of Object.entries(PERIODONTAL_WEIGHT_KEYS)) {
      const val = await this.settingsService.getNumber(settingKey, NaN);
      if (!isNaN(val)) {
        (periodontal as Record<string, number>)[field] = val;
      }
    }
    const implant: Partial<ImplantWeights> = {};
    for (const [field, settingKey] of Object.entries(IMPLANT_WEIGHT_KEYS)) {
      const val = await this.settingsService.getNumber(settingKey, NaN);
      if (!isNaN(val)) {
        (implant as Record<string, number>)[field] = val;
      }
    }
    return {
      caries: { ...DEFAULT_RISK_WEIGHTS.caries, ...caries },
      periodontal: { ...DEFAULT_RISK_WEIGHTS.periodontal, ...periodontal },
      implant: { ...DEFAULT_RISK_WEIGHTS.implant, ...implant },
    };
  }

  private calculateAge(birthDate: string | null | undefined): number {
    if (!birthDate) return 0;
    try {
      const b = new Date(birthDate);
      if (isNaN(b.getTime())) return 0;
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const monthDiff = now.getMonth() - b.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < b.getDate())) {
        age--;
      }
      return Math.max(0, age);
    } catch {
      return 0;
    }
  }

  private parseJsonArray(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private parseJsonObject(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private safeNum(v: unknown, fallback = 0): number {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  private getPatient(patientId: string): {
    id: string;
    birthDate: string | null;
    tags: string[];
    medicalHistory: string[];
    systemicDiseases: string[];
    fluorideExposure: number | null;
  } | null {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const row = this.dbService.prepare(
      `SELECT id, birthDate, tags, medicalHistory, systemicDiseases, fluorideExposure
       FROM Patient WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(patientId, ...clinicParams) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      birthDate: row.birthDate ? String(row.birthDate) : null,
      tags: this.parseJsonArray(row.tags),
      medicalHistory: this.parseJsonArray(row.medicalHistory),
      systemicDiseases: this.parseJsonArray(row.systemicDiseases),
      fluorideExposure: row.fluorideExposure !== null && row.fluorideExposure != undefined
        ? this.safeNum(row.fluorideExposure, 0)
        : null,
    };
  }

  private getTreatments(patientId: string): Array<{
    id: string;
    name: string;
    category: string;
    teethNumbers: string[];
    completedDate: string | null;
    remark: string | null;
    status: string;
  }> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const rows = this.dbService.prepare(
      `SELECT id, name, category, teethNumbers, completedDate, remark, status
       FROM Treatment WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`,
    ).all(patientId, ...clinicParams) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      name: r.name ? String(r.name) : '',
      category: r.category ? String(r.category) : '',
      teethNumbers: this.parseJsonArray(r.teethNumbers),
      completedDate: r.completedDate ? String(r.completedDate) : null,
      remark: r.remark ? String(r.remark) : null,
      status: r.status ? String(r.status) : '',
    }));
  }

  private getPeriodontalRecords(patientId: string): Array<{
    id: string;
    data: Record<string, unknown>;
    plaqueIndex: number | null;
    boneLoss: string | null;
    examDate: string | null;
  }> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const rows = this.dbService.prepare(
      `SELECT id, data, plaqueIndex, boneLoss, examDate
       FROM PeriodontalRecord WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`,
    ).all(patientId, ...clinicParams) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      data: this.parseJsonObject(r.data),
      plaqueIndex: r.plaqueIndex !== null && r.plaqueIndex != undefined
        ? this.safeNum(r.plaqueIndex, 0)
        : null,
      boneLoss: r.boneLoss ? String(r.boneLoss) : null,
      examDate: r.examDate ? String(r.examDate) : null,
    }));
  }

  private getFirstExams(patientId: string): Array<{
    id: string;
    remark: string | null;
  }> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const rows = this.dbService.prepare(
      `SELECT id, remark FROM FirstExam WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`,
    ).all(patientId, ...clinicParams) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      remark: r.remark ? String(r.remark) : null,
    }));
  }

  private getFirstExamTeeth(patientId: string): Array<{
    examId: string;
    toothNumber: number;
    diseases: string[];
  }> {
    const examRows = this.getFirstExams(patientId);
    if (examRows.length === 0) return [];
    const examIds = examRows.map(e => e.id);
    const placeholders = examIds.map(() => '?').join(',');
    const rows = this.dbService.prepare(
      `SELECT examId, toothNumber, diseases FROM FirstExamTooth WHERE examId IN (${placeholders})`,
    ).all(...examIds) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      examId: String(r.examId),
      toothNumber: this.safeNum(r.toothNumber, 0),
      diseases: this.parseJsonArray(r.diseases),
    }));
  }

  private isPermanentTooth(toothNumber: number): boolean {
    return toothNumber >= 1 && toothNumber <= 8;
  }

  private isBabyTooth(toothNumber: number): boolean {
    return toothNumber >= 51 && toothNumber <= 85;
  }

  private countDtFromTreatments(treatments: Array<{ name: string; teethNumbers: string[] }>): number {
    const dtNames = ['充填', '根管', '拔除', '补牙', '填充'];
    const teeth = new Set<string>();
    for (const t of treatments) {
      const nameHit = dtNames.some(n => t.name.includes(n));
      if (!nameHit) continue;
      for (const tnRaw of t.teethNumbers) {
        const tn = this.safeNum(tnRaw, 0);
        if (this.isPermanentTooth(tn)) {
          teeth.add(String(tn));
        }
      }
    }
    return teeth.size;
  }

  private countDtFromFirstExamTeeth(firstExamTeeth: Array<{ toothNumber: number; diseases: string[] }>): number {
    const cariousDiseases = ['DECAY', 'DECAYED', 'CARIES', '龋齿', '龋', '蛀牙'];
    const teeth = new Set<number>();
    for (const ft of firstExamTeeth) {
      if (!this.isPermanentTooth(ft.toothNumber)) continue;
      const hit = ft.diseases.some(d => cariousDiseases.some(cd => d.toUpperCase().includes(cd.toUpperCase())));
      if (hit) teeth.add(ft.toothNumber);
    }
    return teeth.size;
  }

  private countRct(treatments: Array<{ name: string }>): number {
    return treatments.filter(t => t.name.includes('根管')).length;
  }

  private countPdGte6Teeth(periodontalRecords: Array<{ data: Record<string, unknown> }>): number {
    const teeth = new Set<string>();
    for (const pr of periodontalRecords) {
      const data = pr.data;
      if (!data || typeof data !== 'object') continue;
      for (const [toothKey, toothData] of Object.entries(data)) {
        if (!toothData || typeof toothData !== 'object') continue;
        const td = toothData as Record<string, unknown>;
        const probeKeys = ['probeDepth', 'pd', 'PD', '探诊深度', 'pd_mm', 'pdMm'];
        for (const pk of probeKeys) {
          const val = this.safeNum((td)[pk], 0);
          if (val >= 6) {
            teeth.add(toothKey);
            break;
          }
        }
        const sites = (td).sites;
        if (Array.isArray(sites)) {
          for (const site of sites) {
            if (!site || typeof site !== 'object') continue;
            const s = site as Record<string, unknown>;
            for (const pk of probeKeys) {
              const val = this.safeNum(s[pk], 0);
              if (val >= 6) {
                teeth.add(toothKey);
                break;
              }
            }
          }
        }
      }
    }
    return teeth.size;
  }

  private countMobilityGte2(periodontalRecords: Array<{ data: Record<string, unknown> }>): number {
    const teeth = new Set<string>();
    for (const pr of periodontalRecords) {
      const data = pr.data;
      if (!data || typeof data !== 'object') continue;
      for (const [toothKey, toothData] of Object.entries(data)) {
        if (!toothData || typeof toothData !== 'object') continue;
        const td = toothData as Record<string, unknown>;
        const mobilityKeys = ['mobility', 'mob', '松动度', '松动'];
        for (const mk of mobilityKeys) {
          const val = this.safeNum((td)[mk], 0);
          if (val >= 2) {
            teeth.add(toothKey);
            break;
          }
        }
      }
    }
    return teeth.size;
  }

  private hasHighPlaqueIndex(periodontalRecords: Array<{ plaqueIndex: number | null }>): boolean {
    return periodontalRecords.some(pr => pr.plaqueIndex !== null && pr.plaqueIndex >= 3);
  }

  private getSmokingLevel(tags: string[], systemicDiseases: string[]): 'NONE' | 'LIGHT' | 'HEAVY' {
    const all = [...tags, ...systemicDiseases].map(s => s.toUpperCase());
    if (all.some(s => s.includes('SMOKER_HEAVY') || s.includes('HEAVY_SMOKER') || s.includes('重度吸烟') || s.includes('大量吸烟'))) {
      return 'HEAVY';
    }
    if (all.some(s => s.includes('SMOKER') || s.includes('SMOKING') || s.includes('吸烟') || s.includes('SMOKER_LIGHT') || s.includes('LIGHT_SMOKER'))) {
      return 'LIGHT';
    }
    return 'NONE';
  }

  private hasDiabetes(systemicDiseases: string[]): boolean {
    const diabetesTags = ['DIABETES_TYPE1', 'DIABETES_TYPE2', 'DIABETES_UNSPECIFIED', 'DIABETES', '糖尿病', '1型糖尿病', '2型糖尿病'];
    return systemicDiseases.some(s => diabetesTags.some(dt => s.toUpperCase().includes(dt.toUpperCase())));
  }

  private getBoneLossScore(periodontalRecords: Array<{ boneLoss: string | null; data: Record<string, unknown> }>, tags: string[], weights: PeriodontalWeights): number {
    for (const pr of periodontalRecords) {
      if (pr.boneLoss) {
        const bl = pr.boneLoss.toUpperCase();
        if (bl.includes('SEVERE') || bl.includes('重度') || bl.includes('严重')) return weights.boneLossSevere;
        if (bl.includes('MODERATE') || bl.includes('中度')) return weights.boneLossModerate;
        if (bl.includes('MILD') || bl.includes('轻度')) return weights.boneLossMild;
      }
    }
    const tagUpper = tags.map(t => t.toUpperCase());
    if (tagUpper.some(t => t.includes('BONE_LOSS_SEVERE') || t.includes('SEVERE_BONE_LOSS'))) return weights.boneLossSevere;
    if (tagUpper.some(t => t.includes('BONE_LOSS_MODERATE') || t.includes('MODERATE_BONE_LOSS'))) return weights.boneLossModerate;
    if (tagUpper.some(t => t.includes('BONE_LOSS_MILD') || t.includes('MILD_BONE_LOSS') || t.includes('BONE_LOSS'))) return weights.boneLossMild;
    return 0;
  }

  private hasImplant(treatments: Array<{ category: string; name: string }>): boolean {
    return treatments.some(t =>
      t.category.toUpperCase().includes('IMPLANT') ||
      t.name.includes('种植') ||
      t.category.includes('种植')
    );
  }

  private getImplantAgeScore(treatments: Array<{ name: string; category: string; completedDate: string | null }>, weights: ImplantWeights): number {
    let maxYears = 0;
    const now = new Date();
    for (const t of treatments) {
      const isImplant = t.category.toUpperCase().includes('IMPLANT') || t.name.includes('种植') || t.category.includes('种植');
      if (!isImplant || !t.completedDate) continue;
      const cd = new Date(t.completedDate);
      if (isNaN(cd.getTime())) continue;
      const years = (now.getTime() - cd.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (years > maxYears) maxYears = years;
    }
    if (maxYears > 10) return weights.implantAgeOver10;
    if (maxYears > 5) return weights.implantAgeOver5;
    return 0;
  }

  private hasPoorMaintenance(treatments: Array<{ name: string; completedDate: string | null }>, weights: ImplantWeights): number {
    const maintenanceNames = ['洁治', '洗牙', '维护', '洁牙', 'SCALING', 'CLEANING', 'MAINTENANCE', 'PERIODONTAL_MAINTENANCE'];
    const now = new Date();
    const cutoff = new Date(now.getTime() - 18 * 30 * 24 * 60 * 60 * 1000);
    const hasRecent = treatments.some(t => {
      const nameHit = maintenanceNames.some(n => t.name.toUpperCase().includes(n.toUpperCase()));
      if (!nameHit || !t.completedDate) return false;
      const cd = new Date(t.completedDate);
      return !isNaN(cd.getTime()) && cd >= cutoff;
    });
    return hasRecent ? 0 : weights.poorMaintenance;
  }

  private hasOcclusalOverload(treatments: Array<{ remark: string | null }>, tags: string[]): boolean {
    const tagUpper = tags.map(t => t.toUpperCase());
    if (tagUpper.some(t => t.includes('OCCLUSAL_OVERLOAD') || t.includes('OCCLUSOVERLOAD') || t.includes('咬合过载'))) return true;
    return treatments.some(t => {
      if (!t.remark) return false;
      const r = t.remark.toUpperCase();
      return r.includes('OCCLUSAL_OVERLOAD') || r.includes('咬合过载') || r.includes('OCCLUSAL TRAUMA');
    });
  }

  private hasSystemicDiseaseImplant(systemicDiseases: string[]): boolean {
    const diseaseTags = ['OSTEOPOROSIS', '骨质疏松', 'IMMUNOSUPPRESSION', '免疫抑制', '免疫低下', 'RADIATION_THERAPY', '放疗史', '放射治疗', 'SJOGREN', '干燥综合征', '舍格伦'];
    const diabetesExclude = ['DIABETES'];
    return systemicDiseases.some(s => {
      const upper = s.toUpperCase();
      const isDiabetes = diabetesExclude.some(d => upper.includes(d));
      if (isDiabetes) return false;
      return diseaseTags.some(dt => upper.includes(dt.toUpperCase()));
    });
  }

  private calculateCaries(
    patient: { birthDate: string | null; tags: string[]; medicalHistory: string[]; fluorideExposure: number | null },
    treatments: Array<{ name: string; teethNumbers: string[] }>,
    firstExamTeeth: Array<{ toothNumber: number; diseases: string[] }>,
    firstExams: Array<{ remark: string | null }>,
    periodontalRecords: Array<{ plaqueIndex: number | null }>,
    weights: CariesWeights,
  ): { score: number; breakdown: CariesFactorBreakdown } {
    const age = this.calculateAge(patient.birthDate);
    const dtFromTx = this.countDtFromTreatments(treatments);
    const dtFromExam = this.countDtFromFirstExamTeeth(firstExamTeeth);
    const dtCount = Math.max(dtFromTx, dtFromExam);

    const C1 = Math.min(50, dtCount * weights.dtWeight);
    const C2 = age < 12 ? weights.ageUnder12 : 0;

    const tagsUpper = patient.tags.map(t => t.toUpperCase());
    const medUpper = patient.medicalHistory.map(m => m.toUpperCase());
    const sugarTag = tagsUpper.includes('SUGAR_HIGH') ||
      tagsUpper.some(t => t.includes('高糖饮食') || t.includes('SWEET')) ||
      medUpper.some(m => m.includes('高糖饮食') || m.includes('甜食'));
    const sugarExam = firstExams.some(fe => fe.remark && (fe.remark.includes('甜食') || fe.remark.includes('高糖')));
    const C3 = (sugarTag || sugarExam) ? weights.sugarFreq : 0;

    const poorHygiene = tagsUpper.includes('POOR_ORAL_HYGIENE') ||
      tagsUpper.some(t => t.includes('口腔卫生差') || t.includes('菌斑')) ||
      this.hasHighPlaqueIndex(periodontalRecords);
    const C4 = poorHygiene ? weights.plaqueRetention : 0;

    const rctCount = this.countRct(treatments);
    const C5 = Math.min(20, rctCount * weights.priorRctWeight);

    const hasFluoride = patient.fluorideExposure !== null && patient.fluorideExposure > 0;
    const C6 = hasFluoride ? 0 : weights.fluoride;

    const familyHistory = medUpper.includes('FAMILY_CARIES_HISTORY') ||
      tagsUpper.includes('CARIES_HIGH_RISK') ||
      tagsUpper.some(t => t.includes('龋易感家族') || t.includes('家族史龋') || t.includes('龋齿家族史'));
    const C7 = familyHistory ? weights.family : 0;

    const sum = C1 + C2 + C3 + C4 + C5 + C6 + C7;
    const score = Math.min(100, Math.max(0, Math.round(sum || 0)));

    return {
      score,
      breakdown: { C1, C2, C3, C4, C5, C6, C7 },
    };
  }

  private calculatePeriodontal(
    patient: { birthDate: string | null; tags: string[]; systemicDiseases: string[] },
    periodontalRecords: Array<{ data: Record<string, unknown>; plaqueIndex: number | null; boneLoss: string | null }>,
    weights: PeriodontalWeights,
  ): { score: number; breakdown: PeriodontalFactorBreakdown } {
    const age = this.calculateAge(patient.birthDate);
    const pdCount = this.countPdGte6Teeth(periodontalRecords);
    const P1 = Math.min(48, pdCount * weights.pdGte6Weight);

    const P2 = this.getBoneLossScore(periodontalRecords, patient.tags, weights);

    const mobilityCount = this.countMobilityGte2(periodontalRecords);
    const P3 = Math.min(18, mobilityCount * weights.mobility);

    const smokingLevel = this.getSmokingLevel(patient.tags, patient.systemicDiseases);
    const P4 = smokingLevel === 'HEAVY' ? weights.smokingHeavy : smokingLevel === 'LIGHT' ? weights.smokingLight : 0;

    const P5 = this.hasDiabetes(patient.systemicDiseases) ? weights.diabetes : 0;

    const tagsUpper = patient.tags.map(t => t.toUpperCase());
    const P6 = tagsUpper.some(t => t.includes('PERIODONTITIS_FAMILY') || t.includes('牙周炎家族史') || t.includes('FAMILY_PERIODONTITIS'))
      ? weights.family : 0;

    const P7 = age >= 60 ? weights.ageOver60 : 0;

    const sum = P1 + P2 + P3 + P4 + P5 + P6 + P7;
    const score = Math.min(100, Math.max(0, Math.round(sum || 0)));

    return {
      score,
      breakdown: { P1, P2, P3, P4, P5, P6, P7 },
    };
  }

  private calculateImplant(
    patient: { tags: string[]; systemicDiseases: string[] },
    treatments: Array<{
      name: string; category: string; completedDate: string | null; remark: string | null;
    }>,
    periodontalRecords: Array<{ plaqueIndex: number | null }>,
    periodontalScore: number,
    weights: ImplantWeights,
  ): { score: number; breakdown: ImplantFactorBreakdown } {
    const tagsUpper = patient.tags.map(t => t.toUpperCase());
    const hasImp = this.hasImplant(treatments);

    const I1 = (hasImp && this.hasHighPlaqueIndex(periodontalRecords)) ? weights.plaqueHigh : 0;

    const smokingLevel = this.getSmokingLevel(patient.tags, patient.systemicDiseases);
    const I2 = smokingLevel === 'HEAVY' ? weights.smokingHeavy : smokingLevel === 'LIGHT' ? weights.smokingLight : 0;

    const I3 = this.hasDiabetes(patient.systemicDiseases) ? weights.diabetes : 0;

    const hasPeriodontitisHistory = periodontalScore > 59 ||
      tagsUpper.some(t => t.includes('PERIODONTITIS') || t.includes('牙周炎'));
    const I4 = hasPeriodontitisHistory ? weights.history : 0;

    const I5 = this.hasOcclusalOverload(treatments, patient.tags) ? weights.occlusal : 0;

    const I6 = hasImp ? this.getImplantAgeScore(treatments, weights) : 0;

    const I7 = hasImp ? this.hasPoorMaintenance(treatments, weights) : 0;

    const I8 = this.hasSystemicDiseaseImplant(patient.systemicDiseases) ? weights.systemic : 0;

    const sum = I1 + I2 + I3 + I4 + I5 + I6 + I7 + I8;
    const score = Math.min(100, Math.max(0, Math.round(sum || 0)));

    return {
      score,
      breakdown: { I1, I2, I3, I4, I5, I6, I7, I8 },
    };
  }

  async calculateAndSave(
    patientId: string,
    overrideWeights?: RiskWeights,
    assessedById: string | null = null,
  ): Promise<RiskScoreResult & { id: string; createdAt: string }> {
    const enabled = await this.settingsService.getBoolean('aiRiskScoreEnabled', true);
    if (!enabled) {
      throw new BusinessValidationException('风险评分功能未启用');
    }
    if (!patientId) {
      throw new BusinessValidationException('患者不存在');
    }
    const patient = this.getPatient(patientId);
    if (!patient) {
      throw new BusinessValidationException('患者不存在');
    }

    const weights = await this.resolveWeights(overrideWeights);
    const treatments = this.getTreatments(patientId);
    const periodontalRecords = this.getPeriodontalRecords(patientId);
    const firstExams = this.getFirstExams(patientId);
    const firstExamTeeth = this.getFirstExamTeeth(patientId);

    const cariesResult = this.calculateCaries(patient, treatments, firstExamTeeth, firstExams, periodontalRecords, weights.caries);
    const periodontalResult = this.calculatePeriodontal(patient, periodontalRecords, weights.periodontal);
    const implantResult = this.calculateImplant(patient, treatments, periodontalRecords, periodontalResult.score, weights.implant);

    const cariesLevel = scoreToLevel(cariesResult.score);
    const periodontalLevel = scoreToLevel(periodontalResult.score);
    const implantLevel = scoreToLevel(implantResult.score);

    const weightsOverride: Partial<RiskWeights> | null = overrideWeights ? overrideWeights : null;

    const factorSnapshot: FactorSnapshot = {
      caries: Object.assign({ C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0 }, cariesResult.breakdown),
      periodontal: Object.assign({ P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0 }, periodontalResult.breakdown),
      implant: Object.assign({ I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0, I8: 0 }, implantResult.breakdown),
      weightsOverride,
      dataSources: {
        treatmentCount: treatments.length,
        periodontalRecords: periodontalRecords.length,
        firstExamRows: firstExams.length,
      },
    };

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const snapshotJson = JSON.stringify(factorSnapshot);

    this.dbService.transaction((db) => {
      db.prepare(
        `INSERT INTO PatientRiskScore (
          id, clinicId, patientId, cariesScore, periodontalScore, implantScore,
          cariesLevel, periodontalLevel, implantLevel, factorSnapshotJson,
          assessedById, createdAt, updatedAt, deletedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        clinicId || null,
        patientId,
        cariesResult.score,
        periodontalResult.score,
        implantResult.score,
        cariesLevel,
        periodontalLevel,
        implantLevel,
        snapshotJson,
        assessedById,
        now,
        now,
        null,
      );

      this.auditLogService.logAudit(
        db,
        AuditLogType.PATIENT_RISK_SCORE_CALCULATED,
        patientId,
        'Patient',
        clinicId || null,
        {
          afterData: {
            cariesScore: cariesResult.score,
            periodontalScore: periodontalResult.score,
            implantScore: implantResult.score,
            cariesLevel,
            periodontalLevel,
            implantLevel,
          },
          operatorId: assessedById || undefined,
        },
      );
    });

    this.logger.log(`[RISK_SCORE] 患者 ${patientId} 风险评分完成: 龋=${cariesResult.score}(${cariesLevel}), 牙周=${periodontalResult.score}(${periodontalLevel}), 种植=${implantResult.score}(${implantLevel})`);

    return {
      id,
      createdAt: now,
      cariesScore: cariesResult.score,
      periodontalScore: periodontalResult.score,
      implantScore: implantResult.score,
      cariesLevel,
      periodontalLevel,
      implantLevel,
      factorSnapshot,
    };
  }

  async getLatest(patientId: string): Promise<(RiskScoreResult & { id: string; createdAt: string; assessedById: string | null }) | null> {
    if (!patientId) return null;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const row = this.dbService.prepare(
      `SELECT * FROM PatientRiskScore WHERE patientId = ? AND deletedAt IS NULL${clinicClause}
       ORDER BY createdAt DESC LIMIT 1`,
    ).get(patientId, ...clinicParams) as PatientRiskScoreRow | undefined;
    if (!row) return null;
    return this.mapRowToResult(row);
  }

  async getHistory(
    patientId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ items: Array<RiskScoreResult & { id: string; createdAt: string; assessedById: string | null }>; total: number; page: number; pageSize: number }> {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const ps = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 20)));
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const totalRow = this.dbService.prepare(
      `SELECT COUNT(*) as cnt FROM PatientRiskScore WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(patientId, ...clinicParams) as { cnt: number };
    const total = this.safeNum(totalRow?.cnt, 0);
    const offset = (p - 1) * ps;
    const rows = this.dbService.prepare(
      `SELECT * FROM PatientRiskScore WHERE patientId = ? AND deletedAt IS NULL${clinicClause}
       ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    ).all(patientId, ...clinicParams, ps, offset) as PatientRiskScoreRow[];
    const items = rows.map(r => this.mapRowToResult(r));
    return { items, total, page: p, pageSize: ps };
  }

  private mapRowToResult(row: PatientRiskScoreRow): RiskScoreResult & { id: string; createdAt: string; assessedById: string | null } {
    let factorSnapshot: FactorSnapshot;
    if (typeof row.factorSnapshotJson === 'string') {
      try {
        const parsed = JSON.parse(row.factorSnapshotJson);
        factorSnapshot = {
          caries: Object.assign({ C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0 }, (parsed?.caries || {})),
          periodontal: Object.assign({ P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0 }, (parsed?.periodontal || {})),
          implant: Object.assign({ I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0, I8: 0 }, (parsed?.implant || {})),
          weightsOverride: parsed?.weightsOverride ?? null,
          dataSources: {
            treatmentCount: this.safeNum(parsed?.dataSources?.treatmentCount, 0),
            periodontalRecords: this.safeNum(parsed?.dataSources?.periodontalRecords, 0),
            firstExamRows: this.safeNum(parsed?.dataSources?.firstExamRows, 0),
          },
        };
      } catch {
        factorSnapshot = {
          caries: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0 },
          periodontal: { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0 },
          implant: { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0, I8: 0 },
          weightsOverride: null,
          dataSources: { treatmentCount: 0, periodontalRecords: 0, firstExamRows: 0 },
        };
      }
    } else {
      factorSnapshot = row.factorSnapshotJson;
    }
    return {
      id: row.id,
      createdAt: row.createdAt,
      assessedById: row.assessedById,
      cariesScore: this.safeNum(row.cariesScore, 0),
      periodontalScore: this.safeNum(row.periodontalScore, 0),
      implantScore: this.safeNum(row.implantScore, 0),
      cariesLevel: row.cariesLevel || 'LOW',
      periodontalLevel: row.periodontalLevel || 'LOW',
      implantLevel: row.implantLevel || 'LOW',
      factorSnapshot,
    };
  }

  async ensurePatientExists(patientId: string): Promise<void> {
    const patient = this.getPatient(patientId);
    if (!patient) {
      throw new BusinessValidationException('患者不存在');
    }
  }
}
