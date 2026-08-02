/* eslint-disable @typescript-eslint/no-unused-vars, no-useless-assignment, sonarjs/no-redundant-assignments -- TODO: 逐步修复 lint 问题 */
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AppLogger } from '../../../common/services/logger.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { BusinessException, BusinessNotFoundException, ErrorCode } from '../../../common/errors';
import { SettingsService } from '../../system/settings/settings.service';
import { TableNames } from '../../../common/constants/table-names';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import {
  ShortCodeLandmarks,
  SHORT_CODE_LANDMARKS,
  SHORT_CODE_LABEL_MAP,
  REQUIRED_SHORT_CODES,
} from './cephalometric-landmarks';
import {
  MetricsFormulaService,
  AnalysisMethod,
  MetricResult,
} from './metrics-formula.service';
import {
  NormValueService,
  NormDirection,
  NormRange,
  AdultChild,
  NormGender,
} from './norm-value.service';

/**
 * 标志点缺失错误（TR-19.12 / TR-19.13）
 */
export class MissingLandmarkError extends Error {
  constructor(public missing: string[]) {
    super(`缺少标志点：${missing.join(', ')}`);
    this.name = 'MissingLandmarkError';
  }
}

/**
 * 完整指标计算结果（含正常值/方向）
 */
export interface FullMetric extends MetricResult {
  normalRange: [number, number] | null;
  direction: NormDirection;
}

/**
 * 标志点集合实体
 */
export interface LandmarkSetEntity {
  id: string;
  patientId: string;
  imagingId: string | null;
  name: string;
  landmarks: ShortCodeLandmarks;
  analysisMethod: AnalysisMethod;
  status: 'DRAFT' | 'COMPLETED';
  clinicId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * 分析记录实体
 */
export interface AnalysisRecordEntity {
  id: string;
  landmarkSetId: string;
  method: AnalysisMethod;
  metrics: FullMetric[];
  computedAt: string;
  note: string | null;
  clinicId: string;
  doctorId: string | null;
  patientId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * 历史对比 diff 项（TR-19.24 / TR-19.25）
 */
export interface CompareDiffItem {
  code: string;
  label: string;
  value1: number | null;
  value2: number | null;
  delta: number | null;
  arrow: '↗' | '↘' | '→';
  unit: string;
}

export interface CompareResult {
  id1: string;
  id2: string;
  diffs: CompareDiffItem[];
}

@Injectable()
export class CephalometricAnalysisService {
  private logger = new AppLogger(CephalometricAnalysisService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private metricsFormulaService: MetricsFormulaService,
    private normValueService: NormValueService,
    private auditLogService: AuditLogService,
    private settingsService: SettingsService,
  ) {}

  // =========================================================================
  // 标志点集合
  // =========================================================================

  /**
   * 创建标志点集合
   */
  async createLandmarkSet(input: {
    patientId: string;
    imagingId?: string;
    name: string;
    landmarks: ShortCodeLandmarks;
    analysisMethod?: AnalysisMethod;
  }): Promise<LandmarkSetEntity> {
    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    if (!clinicId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '缺少诊所上下文');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const method: AnalysisMethod = input.analysisMethod ?? 'STEINER';

    this.dbService.prepare(
      `INSERT INTO ${TableNames.CEPHALOMETRIC_LANDMARK_SET}
       (id, clinicId, patientId, imageId, landmarkJson, method, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
    ).run(
      id,
      clinicId,
      input.patientId,
      input.imagingId ?? null,
      JSON.stringify(input.landmarks),
      method,
      now,
      now,
    );

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_CREATED,
      id,
      TableNames.CEPHALOMETRIC_LANDMARK_SET,
      clinicId,
      { operatorId: userId ?? undefined, afterData: { name: input.name, patientId: input.patientId } },
    );

    return this.getLandmarkSetById(id);
  }

  /**
   * 更新标志点集合
   */
  async updateLandmarkSet(id: string, input: {
    name?: string;
    landmarks?: ShortCodeLandmarks;
    analysisMethod?: AnalysisMethod;
    imagingId?: string;
  }): Promise<LandmarkSetEntity> {
    const existing = await this.getLandmarkSetById(id);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();

    const newLandmarks = input.landmarks ?? existing.landmarks;
    const newMethod = input.analysisMethod ?? existing.analysisMethod;
    const newImagingId = input.imagingId !== undefined ? input.imagingId : existing.imagingId;
    const newName = input.name ?? existing.name;

    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_LANDMARK_SET}
       SET landmarkJson = ?, method = ?, imageId = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).run(
      JSON.stringify(newLandmarks),
      newMethod,
      newImagingId,
      now,
      id,
      clinicId,
    );

    return this.getLandmarkSetById(id);
  }

  /**
   * 列表查询标志点集合（按患者过滤）
   */
  async listLandmarkSets(patientId?: string): Promise<LandmarkSetEntity[]> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return [];
    const params: string[] = [clinicId];
    let patientClause = '';
    if (patientId) {
      patientClause = ' AND patientId = ?';
      params.push(patientId);
    }
    const rows = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_LANDMARK_SET}
       WHERE deletedAt IS NULL AND clinicId = ?${patientClause}
       ORDER BY createdAt DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => this.parseLandmarkSetRow(r));
  }

  /**
   * 获取标志点集合
   */
  async getLandmarkSetById(id: string): Promise<LandmarkSetEntity> {
    const clinicId = this.clinicContext.getClinicId();
    const row = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_LANDMARK_SET}
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).get(id, clinicId) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessNotFoundException('标志点集合不存在');
    return this.parseLandmarkSetRow(row);
  }

  private parseLandmarkSetRow(raw: Record<string, unknown>): LandmarkSetEntity {
    let landmarks: ShortCodeLandmarks = {};
    try {
      landmarks = JSON.parse(String(raw.landmarkJson ?? '{}'));
    } catch { landmarks = {}; }
    return {
      id: String(raw.id ?? ''),
      patientId: String(raw.patientId ?? ''),
      imagingId: raw.imageId ? String(raw.imageId) : null,
      name: String(raw.name ?? raw.id ?? ''),
      landmarks,
      analysisMethod: (String(raw.method ?? 'STEINER')) as AnalysisMethod,
      status: (String(raw.status ?? 'DRAFT')) as 'DRAFT' | 'COMPLETED',
      clinicId: String(raw.clinicId ?? ''),
      createdBy: raw.createdBy ? String(raw.createdBy) : null,
      createdAt: String(raw.createdAt ?? ''),
      updatedAt: String(raw.updatedAt ?? ''),
      deletedAt: raw.deletedAt ? String(raw.deletedAt) : null,
    };
  }

  // =========================================================================
  // 校验
  // =========================================================================

  /**
   * 校验必填标志点（TR-19.12 / TR-19.13）
   * 缺失点列表返回中文 label，例如 ["N 鼻根点", "Po 耳点"]
   */
  validateLandmarks(landmarks: ShortCodeLandmarks): { missing: string[]; missingCodes: string[] } {
    const missingCodes: string[] = [];
    for (const code of REQUIRED_SHORT_CODES) {
      const p = landmarks[code];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
        missingCodes.push(code);
      }
    }
    const missing = missingCodes.map(c => `${c} ${SHORT_CODE_LABEL_MAP[c] ?? c}`);
    return { missing, missingCodes };
  }

  /**
   * 校验必填点（缺失则抛 MissingLandmarkError）
   */
  ensureLandmarksValid(landmarks: ShortCodeLandmarks): void {
    const { missing } = this.validateLandmarks(landmarks);
    if (missing.length > 0) {
      throw new MissingLandmarkError(missing);
    }
  }

  // =========================================================================
  // 计算
  // =========================================================================

  /**
   * 计算分析（TR-19.15 ~ TR-19.20）
   * 遍历 method 对应的指标列表，每个计算 + classifyDirection → 返回完整 metrics 数组
   */
  computeAnalysis(
    landmarks: ShortCodeLandmarks,
    method: AnalysisMethod | 'ALL' = 'ALL',
    normOptions: { adultChild?: AdultChild; gender?: NormGender } = {},
  ): FullMetric[] {
    const baseResults: MetricResult[] = method === 'ALL'
      ? this.metricsFormulaService.computeAll(landmarks)
      : this.metricsFormulaService.computeByMethod(landmarks, method);

    return baseResults.map(m => {
      const norm = this.normValueService.getNorm(m.code, normOptions);
      const normalRange: [number, number] | null = norm ? [norm.min, norm.max] : null;
      const direction: NormDirection = (m.value === null || !norm)
        ? 'NORMAL'
        : this.normValueService.classifyDirection(m.value, norm.min, norm.max);
      return {
        ...m,
        normalRange,
        direction,
      };
    });
  }

  /**
   * 保存分析记录（TR-19.23）
   * 1. 校验标志点必填项
   * 2. 调 computeAnalysis 计算
   * 3. 存 CephalometricAnalysisRecord
   *
   * method 可传 'ALL' 表示合并全方法（≥50 项）；
   * DB 记录的 method 字段存储具体方法（landmarkSet.analysisMethod），不存 'ALL'。
   */
  async saveAnalysis(
    landmarkSetId: string,
    options: { method?: AnalysisMethod | 'ALL'; note?: string; doctorId?: string } = {},
  ): Promise<AnalysisRecordEntity> {
    await this.ensureAnalysisEnabled();

    const landmarkSet = await this.getLandmarkSetById(landmarkSetId);
    this.ensureLandmarksValid(landmarkSet.landmarks);

    const computeMethod: AnalysisMethod | 'ALL' = options.method ?? landmarkSet.analysisMethod;
    const metrics = this.computeAnalysis(landmarkSet.landmarks, computeMethod);
    const recordMethod: AnalysisMethod = computeMethod === 'ALL'
      ? landmarkSet.analysisMethod
      : computeMethod;

    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.dbService.prepare(
      `INSERT INTO ${TableNames.CEPHALOMETRIC_ANALYSIS_RECORD}
       (id, clinicId, landmarkSetId, method, metricsJson, analysisDate, doctorId, remark, patientId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      clinicId,
      landmarkSetId,
      recordMethod,
      JSON.stringify(metrics),
      now,
      options.doctorId ?? userId ?? null,
      options.note ?? null,
      landmarkSet.patientId,
      now,
      now,
    );

    // 同步标志点集合状态为 COMPLETED
    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_LANDMARK_SET}
       SET status = 'COMPLETED', updatedAt = ?
       WHERE id = ? AND clinicId = ?`,
    ).run(now, landmarkSetId, clinicId);

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_VALIDATED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS_RECORD,
      clinicId,
      { operatorId: userId ?? undefined, afterData: { method: recordMethod, metricsCount: metrics.length } },
    );

    return this.getAnalysisById(id);
  }

  /**
   * 获取分析记录
   */
  async getAnalysisById(id: string): Promise<AnalysisRecordEntity> {
    const clinicId = this.clinicContext.getClinicId();
    const row = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_ANALYSIS_RECORD}
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).get(id, clinicId) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessNotFoundException('头影测量分析记录不存在');
    return this.parseAnalysisRow(row);
  }

  /**
   * 列出患者所有分析记录（按时间倒序，TR-19.26）
   */
  async listByPatient(patientId: string): Promise<AnalysisRecordEntity[]> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return [];
    const rows = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_ANALYSIS_RECORD}
       WHERE patientId = ? AND deletedAt IS NULL AND clinicId = ?
       ORDER BY createdAt DESC`,
    ).all(patientId, clinicId) as Array<Record<string, unknown>>;
    return rows.map(r => this.parseAnalysisRow(r));
  }

  /**
   * 软删除分析记录（TR-19.27）
   */
  async deleteById(id: string): Promise<void> {
    const existing = await this.getAnalysisById(id);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS_RECORD}
       SET deletedAt = ?, updatedAt = ?
       WHERE id = ? AND clinicId = ?`,
    ).run(now, now, id, clinicId);

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_DELETED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS_RECORD,
      clinicId,
      { beforeData: { method: existing.method } },
    );
  }

  private parseAnalysisRow(raw: Record<string, unknown>): AnalysisRecordEntity {
    let metrics: FullMetric[] = [];
    try {
      metrics = JSON.parse(String(raw.metricsJson ?? '[]'));
    } catch { metrics = []; }
    return {
      id: String(raw.id ?? ''),
      landmarkSetId: String(raw.landmarkSetId ?? ''),
      method: (String(raw.method ?? 'STEINER')) as AnalysisMethod,
      metrics,
      computedAt: String(raw.analysisDate ?? raw.createdAt ?? ''),
      note: raw.remark ? String(raw.remark) : null,
      clinicId: String(raw.clinicId ?? ''),
      doctorId: raw.doctorId ? String(raw.doctorId) : null,
      patientId: String(raw.patientId ?? ''),
      createdAt: String(raw.createdAt ?? ''),
      updatedAt: String(raw.updatedAt ?? ''),
      deletedAt: raw.deletedAt ? String(raw.deletedAt) : null,
    };
  }

  // =========================================================================
  // 对比
  // =========================================================================

  /**
   * 两 record diff（TR-19.24 / TR-19.25）
   * 返回每个指标 { code, label, value1, value2, delta, arrow }
   */
  async compareRecords(id1: string, id2: string): Promise<CompareResult> {
    const r1 = await this.getAnalysisById(id1);
    const r2 = await this.getAnalysisById(id2);

    const map1 = new Map(r1.metrics.map(m => [m.code, m]));
    const map2 = new Map(r2.metrics.map(m => [m.code, m]));
    const allCodes = new Set<string>([...map1.keys(), ...map2.keys()]);

    const diffs: CompareDiffItem[] = [];
    for (const code of allCodes) {
      const m1 = map1.get(code);
      const m2 = map2.get(code);
      const v1 = m1?.value ?? null;
      const v2 = m2?.value ?? null;
      let delta: number | null = null;
      let arrow: '↗' | '↘' | '→' = '→';
      if (v1 !== null && v2 !== null) {
        delta = Math.round((v2 - v1) * 10) / 10;
        if (delta > 0) arrow = '↗';
        else if (delta < 0) arrow = '↘';
        else arrow = '→';
      }
      diffs.push({
        code,
        label: m1?.label ?? m2?.label ?? code,
        value1: v1,
        value2: v2,
        delta,
        arrow,
        unit: m1?.unit ?? m2?.unit ?? '',
      });
    }
    return { id1, id2, diffs };
  }

  // =========================================================================
  // Settings 守卫
  // =========================================================================

  private async ensureAnalysisEnabled(): Promise<void> {
    const enabled = await this.settingsService.getBoolean('aiCephalometricEnabled', true);
    if (!enabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '头影测量功能已禁用，请在设置中启用 aiCephalometricEnabled');
    }
  }

  /**
   * 列出全部短代码常量（供前端渲染 UI）
   */
  listShortCodeLandmarks() {
    return SHORT_CODE_LANDMARKS;
  }
}
