import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AppLogger } from "../../../common/services/logger.service";
import { CLINIC_INFO_CACHE_TTL_MS } from "../../../config/constants";
import * as crypto from "node:crypto";
import { AuditLogService } from "../../../common/services/audit-log.service";
import { encryptField } from "../../../common/utils/security/encryption";

const CLINIC_INFO_CACHE_KEY = "settings:clinicInfo";
const CLINIC_INFO_TTL = CLINIC_INFO_CACHE_TTL_MS;

export interface SystemConfig {
  backupRetentionDays: string;
  defaultPageSize: string;
  cacheTTLSeconds: string;
  maxBackupSizeGB: string;
  logRetentionDays: string;
  autoBackupEnabled: string;
  sessionTimeoutMinutes: string;
  aiMedicalSummaryEnabled: string;
  aiContraindicationEnabled: string;
  aiRiskScoreEnabled: string;
  aiRecareEnabled: string;
  aiChargeSuggestEnabled: string;
  aiBusinessAlertEnabled: string;
  aiInventoryReplenishEnabled: string;
  aiInventoryReplenishmentEnabled: string;
  aiInventoryLookbackDays: string;
  aiInventoryLeadTimeDaysDefault: string;
  aiInventorySafetyFactor: string;
  aiInventoryHoldingCostRate: string;
  aiInventoryOrderCostPerOrder: string;
  aiRfmEnabled: string;
  aiRfmLookbackMonths: string;
  aiChurnEnabled: string;
  aiDoctorPerfAnomalyEnabled: string;
  aiCephalometricsEnabled: string;
  aiCephalometricEnabled: string;
  aiCephalometricDefaultTemplate: string;
  aiCephalometricScaleFactor: string;
  aiProgressBoardEnabled: string;
  aiSatisfactionEnabled: string;
  aiSchedulingEnabled: string;
  aiImportToolEnabled: string;
  aiBulkImportEnabled: string;
  aiBulkImportMaxRows: string;
  aiDbEncryptionEnabled: string;
  aiDbEncryptionAutoPersistMinutes: string;
  aiDbEncryptionPassword: string;
  electronCloseToTray: string;
  dailySchedulerEnabled: string;
  dailySchedulerHour: string;
  dailySchedulerMinute: string;
  aiRiskCariesDtWeight: string;
  aiRiskCariesAgeUnder12: string;
  aiRiskCariesSugarFreq: string;
  aiRiskCariesPlaqueRetention: string;
  aiRiskCariesPriorRctWeight: string;
  aiRiskCariesFluoride: string;
  aiRiskCariesFamily: string;
  aiRiskPeriodontalPdGte6Weight: string;
  aiRiskPeriodontalBoneLossMild: string;
  aiRiskPeriodontalBoneLossModerate: string;
  aiRiskPeriodontalBoneLossSevere: string;
  aiRiskPeriodontalMobility: string;
  aiRiskPeriodontalSmokingHeavy: string;
  aiRiskPeriodontalSmokingLight: string;
  aiRiskPeriodontalDiabetes: string;
  aiRiskPeriodontalFamily: string;
  aiRiskPeriodontalAgeOver60: string;
  aiRiskImplantPlaqueHigh: string;
  aiRiskImplantSmokingHeavy: string;
  aiRiskImplantSmokingLight: string;
  aiRiskImplantDiabetes: string;
  aiRiskImplantHistory: string;
  aiRiskImplantOcclusal: string;
  aiRiskImplantAgeOver5: string;
  aiRiskImplantAgeOver10: string;
  aiRiskImplantPoorMaintenance: string;
  aiRiskImplantSystemic: string;
  aiMedicalPhraseRecommendEnabled: string;
  aiFollowUpRecommendEnabled: string;
  aiFollowUpBatchGenEnabled: string;
  aiChargeAssistantEnabled: string;
  aiChargeAssociationLookbackDays: string;
  aiChargeMinSupportCount: string;
  aiChargeMinConfidence: string;
  aiTreatmentProgressEnabled: string;
  aiTreatmentPlanOverdueThresholdDays: string;
  aiSatisfactionAutoAlertThresholdScore: string;
  aiPrintEnabled: string;
  aiPrintDefaultPaperSize: string;
  aiPrintClinicLogo: string;
  aiHrEnabled: string;
  aiHrDefaultShiftTimes: string;
  [key: string]: string;
}

const DEFAULT_CONFIG: Partial<SystemConfig> = {
  backupRetentionDays: "30",
  defaultPageSize: "20",
  cacheTTLSeconds: "600",
  maxBackupSizeGB: "10",
  logRetentionDays: "30",
  autoBackupEnabled: "true",
  sessionTimeoutMinutes: "120",
  aiMedicalSummaryEnabled: "true",
  aiContraindicationEnabled: "true",
  aiRiskScoreEnabled: "true",
  aiRecareEnabled: "true",
  aiChargeSuggestEnabled: "true",
  aiBusinessAlertEnabled: "true",
  aiInventoryReplenishEnabled: "true",
  aiInventoryReplenishmentEnabled: "true",
  aiInventoryLookbackDays: "90",
  aiInventoryLeadTimeDaysDefault: "7",
  aiInventorySafetyFactor: "1.5",
  aiInventoryHoldingCostRate: "0.20",
  aiInventoryOrderCostPerOrder: "100",
  aiRfmEnabled: "true",
  aiRfmLookbackMonths: "18",
  aiChurnEnabled: "true",
  aiDoctorPerfAnomalyEnabled: "true",
  aiCephalometricsEnabled: "false",
  aiCephalometricEnabled: "true",
  aiCephalometricDefaultTemplate: "CHINESE_NORMAL",
  aiCephalometricScaleFactor: "1.0",
  aiProgressBoardEnabled: "true",
  aiSatisfactionEnabled: "true",
  aiSchedulingEnabled: "false",
  aiImportToolEnabled: "true",
  aiBulkImportEnabled: "true",
  aiBulkImportMaxRows: "500",
  aiDbEncryptionEnabled: "false",
  aiDbEncryptionAutoPersistMinutes: "10",
  aiDbEncryptionPassword: "",
  electronCloseToTray: "true",
  dailySchedulerEnabled: "true",
  dailySchedulerHour: "03",
  dailySchedulerMinute: "25",
  aiRiskCariesDtWeight: "10",
  aiRiskCariesAgeUnder12: "20",
  aiRiskCariesSugarFreq: "15",
  aiRiskCariesPlaqueRetention: "15",
  aiRiskCariesPriorRctWeight: "5",
  aiRiskCariesFluoride: "10",
  aiRiskCariesFamily: "10",
  aiRiskPeriodontalPdGte6Weight: "8",
  aiRiskPeriodontalBoneLossMild: "5",
  aiRiskPeriodontalBoneLossModerate: "15",
  aiRiskPeriodontalBoneLossSevere: "30",
  aiRiskPeriodontalMobility: "6",
  aiRiskPeriodontalSmokingHeavy: "25",
  aiRiskPeriodontalSmokingLight: "10",
  aiRiskPeriodontalDiabetes: "25",
  aiRiskPeriodontalFamily: "15",
  aiRiskPeriodontalAgeOver60: "10",
  aiRiskImplantPlaqueHigh: "15",
  aiRiskImplantSmokingHeavy: "20",
  aiRiskImplantSmokingLight: "10",
  aiRiskImplantDiabetes: "20",
  aiRiskImplantHistory: "15",
  aiRiskImplantOcclusal: "10",
  aiRiskImplantAgeOver5: "8",
  aiRiskImplantAgeOver10: "15",
  aiRiskImplantPoorMaintenance: "10",
  aiRiskImplantSystemic: "10",
  aiAlertRevenueDropWarn: "20",
  aiAlertRevenueDropCritical: "35",
  aiAlertNoShowWarn: "15",
  aiAlertNoShowCritical: "25",
  aiAlertNewPatientsWarn: "20",
  aiAlertNewPatientsCritical: "35",
  aiAlertAovWarn: "15",
  aiAlertAovCritical: "30",
  aiAlertDoctorPerfZWarn: "3",
  aiAlertDoctorPerfZCritical: "5",
  aiMedicalPhraseRecommendEnabled: "true",
  aiFollowUpRecommendEnabled: "true",
  aiFollowUpBatchGenEnabled: "true",
  aiChargeAssistantEnabled: "true",
  aiChargeAssociationLookbackDays: "730",
  aiChargeMinSupportCount: "5",
  aiChargeMinConfidence: "0.35",
  aiTreatmentProgressEnabled: "true",
  aiTreatmentPlanOverdueThresholdDays: "7",
  aiSatisfactionAutoAlertThresholdScore: "6",
  aiPrintEnabled: "true",
  aiPrintDefaultPaperSize: "A4",
  aiPrintClinicLogo: "",
  aiHrEnabled: "true",
  aiHrDefaultShiftTimes: '{"MORNING":["08:00","12:00"],"AFTERNOON":["13:30","17:30"],"FULL":["08:00","17:30"]}',
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private logger = new AppLogger(SettingsService.name);
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
    private auditLogService: AuditLogService,
  ) {}

  onModuleInit() {
    this.ensureDefaultConfigs();
  }

  /**
   * P0-3: 构建诊所过滤条件。
   * 对于 ClinicInfo，当 clinicId 存在时，同时返回该诊所配置和全局配置（clinicId IS NULL）。
   * 当 clinicId 不存在时（超级管理员），返回所有配置。
   */
  private buildSettingsFilter(): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      return { clause: " AND (clinicId = ? OR clinicId IS NULL)", params: [clinicId] };
    }
    return { clause: "", params: [] };
  }

  /**
   * P0-3: 获取诊所专属缓存键，防止跨诊所缓存污染。
   */
  private getCacheKey(): string {
    const clinicId = this.clinicContext.getClinicId();
    return clinicId ? `${CLINIC_INFO_CACHE_KEY}:${clinicId}` : CLINIC_INFO_CACHE_KEY;
  }

  private ensureDefaultConfigs() {
    try {
      const _clinicId = this.clinicContext.getClinicId();
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        // 默认配置作为全局配置写入（clinicId = NULL）
        const existing = this.dbService.prepare(
          "SELECT id FROM ClinicInfo WHERE key = ? AND clinicId IS NULL"
        ).get(key);
        if (!existing) {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          this.dbService.prepare(
            "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
          ).run(id, key, value, null, now);
        }
      }
      this.invalidateCache();
    } catch (err: unknown) {
      this.logger.warn('ensureDefaultConfigs failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private loadFromDb(): Record<string, string> {
    const { clause, params } = this.buildSettingsFilter();
    // ORDER BY 确保诊所专属配置（clinicId IS NOT NULL）排在全局配置之后，
    // 这样循环中后写入的诊所值会覆盖先写入的全局值，实现“诊所专属优先”。
    const rows = this.dbService.prepare(
      `SELECT id, key, value, clinicId, updatedAt FROM ClinicInfo WHERE 1=1${clause} ORDER BY CASE WHEN clinicId IS NULL THEN 0 ELSE 1 END, updatedAt ASC`
    ).all(...params) as Array<{ key: string; value: string; clinicId: string | null }>;
    const result: Record<string, string> = {};
    // 诊所专属配置优先于全局配置（靠 ORDER BY 保证顺序）
    for (const row of rows) {
      result[row.key] = row.value || "";
    }
    return result;
  }

  private async getAllWithCache(): Promise<Record<string, string>> {
    const cacheKey = this.getCacheKey();
    // P3-3: 移除原本实例级的 inMemoryCache — 它不区分 clinicId，会导致跨诊所缓存污染。
    // CacheService 本身就是内存 Map，无需额外的二级缓存。
    const fromCache = await this.cache.get<Record<string, string>>(cacheKey);
    if (fromCache) {
      return fromCache;
    }
    const fromDb = this.loadFromDb();
    await this.cache.set(cacheKey, fromDb, CLINIC_INFO_TTL);
    return fromDb;
  }

  private invalidateCache() {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      // 诊所级变更：只清当前诊所缓存
      this.cache.del(this.getCacheKey());
    } else {
      // P3-3: 全局配置变更 — 所有诊所都读取全局配置，必须清空所有诊所的缓存
      this.cache.delPattern(CLINIC_INFO_CACHE_KEY);
    }
  }

  async getClinicInfo(): Promise<Record<string, string>> {
    return this.getAllWithCache();
  }

  async get<T extends keyof SystemConfig>(key: T): Promise<string | undefined>;
  async get(key: string): Promise<string | undefined>;
  async get(key: string): Promise<string | undefined> {
    const all = await this.getAllWithCache();
    return all[key];
  }

  async getNumber(key: string, defaultValue = 0): Promise<number> {
    const val = await this.get(key);
    const num = val ? Number(val) : NaN;
    return isNaN(num) ? defaultValue : num;
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const val = await this.get(key);
    if (val === undefined) return defaultValue;
    return val === "true" || val === "1" || val === "yes";
  }

  async updateClinicInfo(key: string, value: string) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const storedValue = key === 'aiDbEncryptionPassword' && value && value.length > 0
      ? (encryptField(value) as string)
      : value;
    this.dbService.transaction((db) => {
      const existing = db.prepare(
        "SELECT id, value FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
      ).get(key, clinicId, clinicId) as { id: string; value: string } | undefined;
      const beforeValue = existing?.value;
      if (existing) {
        db.prepare(
          "UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
        ).run(storedValue, now, key, clinicId, clinicId);
      } else {
        const id = crypto.randomUUID();
        db.prepare(
          "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
        ).run(id, key, storedValue, clinicId, now);
      }
      this.auditLogService.logAudit(db, "SETTING_UPDATE", key, "ClinicInfo", clinicId, {
        beforeData: beforeValue !== undefined ? { value: '***' } : undefined,
        afterData: { value: key === 'aiDbEncryptionPassword' ? '***' : value },
      });
    });
    this.invalidateCache();
    return { key, value };
  }

  async findAll() {
    return this.getClinicInfo();
  }

  async upsertMany(data: Record<string, string>) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      for (const [key, rawValue] of Object.entries(data)) {
        const value = key === 'aiDbEncryptionPassword' && rawValue && rawValue.length > 0
          ? (encryptField(rawValue) as string)
          : rawValue;
        const existing = db.prepare(
          "SELECT id, value FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
        ).get(key, clinicId, clinicId) as { id: string; value: string } | undefined;
        if (existing) {
          db.prepare(
            "UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
          ).run(value, now, key, clinicId, clinicId);
        } else {
          const id = crypto.randomUUID();
          db.prepare(
            "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
          ).run(id, key, value, clinicId, now);
        }
        this.auditLogService.logAudit(db, "SETTING_UPDATE", key, "ClinicInfo", clinicId, {
          beforeData: existing ? { value: '***' } : undefined,
          afterData: { value: key === 'aiDbEncryptionPassword' ? '***' : rawValue },
        });
      }
    });
    this.invalidateCache();
    return { success: true };
  }

  async delete(key: string) {
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.prepare(
      "DELETE FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
    ).run(key, clinicId, clinicId);
    this.auditLogService.logAudit(this.dbService, "SETTING_DELETE", key, "ClinicInfo", clinicId);
    this.invalidateCache();
    return { key };
  }
}
