 
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
import { CephalometricMeasurementsService, MeasurementResult, MEASUREMENT_DEFINITIONS } from './measurements.service';
import { CephalometricClassificationService, ClassificationResult } from './classification.service';
import {
  CephalometricTemplateComparisonService,
  TemplateName,
  TemplateComparisonResult,
} from './template-comparison.service';
import { Landmarks } from './cephalometric-landmarks';
import { ReferencePlanes, calcReferencePlanes } from './reference-planes';
import { CreateCephalometricDto, UpdateCephalometricDto } from './dto/cephalometric.dto';
import { PrintTemplateService } from '../../system/print/print-template.service';
import { TemplateEngineService } from '../../system/print/template-engine.service';
import { DEFAULT_CEPHALOMETRIC_TEMPLATE } from '../../system/print/cephalometric-template';

export interface CephalometricEntity {
  id: string;
  patientId: string;
  imagingId: string | null;
  doctorId: string | null;
  name: string;
  landmarks: Landmarks;
  landmarksValidated: number;
  referencePlanes: ReferencePlanes;
  measurements: MeasurementResult;
  classification: ClassificationResult;
  comparisonTemplate: TemplateName | string | null;
  comparisonResult: TemplateComparisonResult | null;
  notes: string | null;
  clinicId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportContext {
  analysis: {
    id: string;
    name: string;
    createdAt: string;
    notes: string | null;
    landmarksValidated: number;
    imagingId: string | null;
  };
  patient: Record<string, unknown> | null;
  doctor: Record<string, unknown> | null;
  measurements: Array<{
    key: string;
    label: string;
    value: string;
    norm: number;
    sd: number;
    delta: string;
    severity: string;
    unit: string;
  }>;
  measurementsSummary: {
    total: number;
    valid: number;
    normal: number;
    mild: number;
    moderate: number;
    severe: number;
  };
  classification: ClassificationResult | null;
  comparison: TemplateComparisonResult | null;
  landmarksSvg: string;
  clinic: Record<string, unknown>;
  generatedAt: string;
}

@Injectable()
export class CephalometricService {
  private logger = new AppLogger(CephalometricService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private measurementsService: CephalometricMeasurementsService,
    private classificationService: CephalometricClassificationService,
    private comparisonService: CephalometricTemplateComparisonService,
    private auditLogService: AuditLogService,
    private settingsService: SettingsService,
    private printTemplateService: PrintTemplateService,
    private templateEngine: TemplateEngineService,
  ) {}

  private buildClinicClause(): { clause: string; params: string[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      return { clause: ' AND clinicId = ?', params: [clinicId] };
    }
    return { clause: '', params: [] };
  }

  private parseOptionalJSON<T>(val: unknown, fallback: T): T {
    if (val === null || val === undefined) return fallback;
    if (typeof val !== 'string') return val as T;
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }

  private parseRow(raw: Record<string, unknown>): CephalometricEntity {
    return {
      id: String(raw.id ?? ''),
      patientId: String(raw.patientId ?? ''),
      imagingId: raw.imagingId ? String(raw.imagingId) : null,
      doctorId: raw.doctorId ? String(raw.doctorId) : null,
      name: String(raw.name ?? ''),
      landmarks: this.parseOptionalJSON<Landmarks>(raw.landmarks, {}),
      landmarksValidated: Number(raw.landmarksValidated) || 0,
      referencePlanes: this.parseOptionalJSON<ReferencePlanes>(raw.referencePlanes, { FH: null, SN: null, OP: null, MP: null, PP: null }),
      measurements: this.parseOptionalJSON<MeasurementResult>(raw.measurements, {} as MeasurementResult),
      classification: this.parseOptionalJSON<ClassificationResult>(raw.classification, {
        skeletal: 'ClassI', dental: 'ClassI', vertical: 'Average', summary: '', issueFlags: [],
      }),
      comparisonTemplate: raw.comparisonTemplate ? String(raw.comparisonTemplate) : null,
      comparisonResult: this.parseOptionalJSON<TemplateComparisonResult | null>(raw.comparisonResult, null),
      notes: raw.notes ? String(raw.notes) : null,
      clinicId: String(raw.clinicId ?? ''),
      createdBy: raw.createdBy ? String(raw.createdBy) : null,
      createdAt: String(raw.createdAt ?? ''),
      updatedAt: String(raw.updatedAt ?? ''),
      deletedAt: raw.deletedAt ? String(raw.deletedAt) : null,
    };
  }

  private async ensureEnabled(): Promise<void> {
    const enabled = await this.settingsService.getBoolean('aiCephalometricEnabled', true);
    if (!enabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '头影测量功能已禁用，请在设置中启用 aiCephalometricEnabled');
    }
  }

  private async getScaleFactor(): Promise<number> {
    return this.settingsService.getNumber('aiCephalometricScaleFactor', 1.0);
  }

  async createAnalysis(dto: CreateCephalometricDto): Promise<CephalometricEntity> {
    await this.ensureEnabled();
    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    if (!clinicId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '缺少诊所上下文');
    }

    const scaleFactor = await this.getScaleFactor();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const createdBy = userId ?? null;

    let referencePlanes: ReferencePlanes = dto.referencePlanes ?? calcReferencePlanes(dto.landmarks);
    let measurements: MeasurementResult;
    let classification: ClassificationResult;
    if (dto.skipRecalc) {
      measurements = dto.referencePlanes
        ? this.measurementsService.calcAllMeasurements(dto.landmarks, dto.referencePlanes, scaleFactor)
        : {} as MeasurementResult;
    } else {
      referencePlanes = this.measurementsService.calcLandmarksDerived(dto.landmarks);
      measurements = this.measurementsService.calcAllMeasurements(dto.landmarks, referencePlanes, scaleFactor);
    }
    classification = this.classificationService.classify(measurements);

    const defaultTpl = await this.settingsService.get('aiCephalometricDefaultTemplate');
    const comparisonTemplate: TemplateName | null = (defaultTpl === 'ANDREWS' || defaultTpl === 'BOLTON' || defaultTpl === 'TWEED' || defaultTpl === 'CHINESE_NORMAL') ? defaultTpl : null;
    const comparisonResult: TemplateComparisonResult | null = comparisonTemplate
      ? this.comparisonService.compareToTemplate(measurements, comparisonTemplate)
      : null;

    const stmt = this.dbService.prepare(
      `INSERT INTO ${TableNames.CEPHALOMETRIC_ANALYSIS} (
        id, patientId, imagingId, doctorId, name, landmarks, landmarksValidated,
        referencePlanes, measurements, classification, comparisonTemplate, comparisonResult,
        notes, clinicId, createdBy, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      id,
      dto.patientId,
      dto.imagingId ?? null,
      dto.doctorId ?? null,
      dto.name,
      JSON.stringify(dto.landmarks ?? {}),
      JSON.stringify(referencePlanes),
      JSON.stringify(measurements),
      JSON.stringify(classification),
      comparisonTemplate,
      comparisonResult ? JSON.stringify(comparisonResult) : null,
      dto.notes ?? null,
      clinicId,
      createdBy,
      now,
      now,
    );

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_CREATED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS,
      clinicId,
      {
        operatorId: createdBy ?? undefined,
        afterData: { name: dto.name, patientId: dto.patientId },
      },
    );

    return this.getById(id);
  }

  async updateAnalysis(id: string, dto: UpdateCephalometricDto): Promise<CephalometricEntity> {
    await this.ensureEnabled();
    const existing = await this.getById(id);
    const scaleFactor = await this.getScaleFactor();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    let newLandmarks = existing.landmarks;
    let newPlanes = existing.referencePlanes;
    let newMeasurements = existing.measurements;
    let newClassification = existing.classification;
    let newComparison = existing.comparisonResult;
    let newComparisonTemplate = existing.comparisonTemplate;
    const newLandmarksValidated = dto.landmarks ? 1 : existing.landmarksValidated;

    if (dto.landmarks && !dto.skipRecalc) {
      newLandmarks = dto.landmarks;
      newPlanes = dto.referencePlanes ?? calcReferencePlanes(newLandmarks);
      newMeasurements = this.measurementsService.calcAllMeasurements(newLandmarks, newPlanes, scaleFactor);
      newClassification = this.classificationService.classify(newMeasurements);
      if (newComparisonTemplate && (newComparisonTemplate === 'ANDREWS' || newComparisonTemplate === 'BOLTON' || newComparisonTemplate === 'TWEED' || newComparisonTemplate === 'CHINESE_NORMAL')) {
        newComparison = this.comparisonService.compareToTemplate(newMeasurements, newComparisonTemplate);
      }
    } else if (dto.landmarks) {
      newLandmarks = dto.landmarks;
      if (dto.referencePlanes) newPlanes = dto.referencePlanes;
    } else if (dto.referencePlanes) {
      newPlanes = dto.referencePlanes;
      if (!dto.skipRecalc) {
        newMeasurements = this.measurementsService.calcAllMeasurements(newLandmarks, newPlanes, scaleFactor);
        newClassification = this.classificationService.classify(newMeasurements);
        if (newComparisonTemplate && (newComparisonTemplate === 'ANDREWS' || newComparisonTemplate === 'BOLTON' || newComparisonTemplate === 'TWEED' || newComparisonTemplate === 'CHINESE_NORMAL')) {
          newComparison = this.comparisonService.compareToTemplate(newMeasurements, newComparisonTemplate);
        }
      }
    }

    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS}
       SET name = COALESCE(?, name),
           imagingId = COALESCE(?, imagingId),
           doctorId = COALESCE(?, doctorId),
           landmarks = ?,
           referencePlanes = ?,
           measurements = ?,
           classification = ?,
           comparisonResult = ?,
           notes = COALESCE(?, notes),
           landmarksValidated = ?,
           updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).run(
      dto.name ?? null,
      dto.imagingId ?? null,
      dto.doctorId ?? null,
      JSON.stringify(newLandmarks),
      JSON.stringify(newPlanes),
      JSON.stringify(newMeasurements),
      JSON.stringify(newClassification),
      newComparison ? JSON.stringify(newComparison) : null,
      dto.notes ?? null,
      newLandmarksValidated,
      now,
      id,
      clinicId,
    );

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_UPDATED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS,
      clinicId,
      {
        afterData: {
          nameChanged: !!dto.name,
          landmarksChanged: !!dto.landmarks,
          landmarksValidated: newLandmarksValidated,
        },
      },
    );

    return this.getById(id);
  }

  async deleteAnalysis(id: string): Promise<void> {
    const existing = await this.getById(id);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS} SET deletedAt = ?, updatedAt = ? WHERE id = ? AND clinicId = ?`,
    ).run(now, now, id, clinicId);

    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_DELETED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS,
      clinicId,
      { beforeData: { name: existing.name } },
    );
  }

  async list(options: {
    patientId?: string;
    page?: number;
    pageSize?: number;
    cursor?: string;
    keyword?: string;
  }): Promise<{ items: CephalometricEntity[]; total: number; page: number; pageSize: number }> {
    const { clause, params } = this.buildClinicClause();
    const wheres = [`deletedAt IS NULL${clause}`];
    const finalParams = [...params];
    if (options.patientId) {
      wheres.push('patientId = ?');
      finalParams.push(options.patientId);
    }
    if (options.keyword) {
      wheres.push('name LIKE ?');
      finalParams.push(`%${options.keyword}%`);
    }
    if (options.cursor) {
      const cursorRow = this.dbService.prepare(
        `SELECT createdAt FROM ${TableNames.CEPHALOMETRIC_ANALYSIS} WHERE id = ? AND deletedAt IS NULL${clause}`,
      ).get(options.cursor, ...params) as { createdAt: string } | undefined;
      if (cursorRow) {
        wheres.push('createdAt < ?');
        finalParams.push(cursorRow.createdAt);
      }
    }
    const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const countRow = this.dbService.prepare(
      `SELECT COUNT(*) as c FROM ${TableNames.CEPHALOMETRIC_ANALYSIS} ${whereClause}`,
    ).get(...finalParams) as { c: number };
    const total = countRow?.c || 0;

    const rows = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_ANALYSIS} ${whereClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    ).all(...finalParams, pageSize, offset) as Array<Record<string, unknown>>;

    return {
      items: rows.map(r => this.parseRow(r)),
      total,
      page,
      pageSize,
    };
  }

  async getById(id: string): Promise<CephalometricEntity> {
    const { clause, params } = this.buildClinicClause();
    const row = this.dbService.prepare(
      `SELECT * FROM ${TableNames.CEPHALOMETRIC_ANALYSIS} WHERE id = ? AND deletedAt IS NULL${clause}`,
    ).get(id, ...params) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessNotFoundException('头影测量分析不存在');
    return this.parseRow(row);
  }

  async recalc(id: string): Promise<CephalometricEntity> {
    await this.ensureEnabled();
    const existing = await this.getById(id);
    const scaleFactor = await this.getScaleFactor();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const newPlanes = this.measurementsService.calcLandmarksDerived(existing.landmarks);
    const newMeasurements = this.measurementsService.calcAllMeasurements(existing.landmarks, newPlanes, scaleFactor);
    const newClassification = this.classificationService.classify(newMeasurements);
    const tpl = existing.comparisonTemplate as TemplateName | null;
    const newComparison: TemplateComparisonResult | null =
      tpl && (tpl === 'ANDREWS' || tpl === 'BOLTON' || tpl === 'TWEED' || tpl === 'CHINESE_NORMAL')
        ? this.comparisonService.compareToTemplate(newMeasurements, tpl)
        : null;

    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS}
       SET referencePlanes = ?, measurements = ?, classification = ?, comparisonResult = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).run(
      JSON.stringify(newPlanes),
      JSON.stringify(newMeasurements),
      JSON.stringify(newClassification),
      newComparison ? JSON.stringify(newComparison) : null,
      now,
      id,
      clinicId,
    );

    return this.getById(id);
  }

  async validate(id: string): Promise<CephalometricEntity> {
    await this.ensureEnabled();
    const existing = await this.getById(id);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const userId = this.clinicContext.getUserId();
    if (existing.landmarksValidated !== 1) {
      this.dbService.prepare(
        `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS} SET landmarksValidated = 1, updatedAt = ? WHERE id = ? AND clinicId = ?`,
      ).run(now, id, clinicId);
    }
    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.CEPHALOMETRIC_VALIDATED,
      id,
      TableNames.CEPHALOMETRIC_ANALYSIS,
      clinicId,
      { operatorId: userId ?? undefined, afterData: { landmarksValidated: 1 } },
    );
    return this.getById(id);
  }

  async compare(id: string, templateName: TemplateName): Promise<CephalometricEntity> {
    await this.ensureEnabled();
    const existing = await this.getById(id);
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const result = this.comparisonService.compareToTemplate(existing.measurements, templateName);
    this.dbService.prepare(
      `UPDATE ${TableNames.CEPHALOMETRIC_ANALYSIS}
       SET comparisonTemplate = ?, comparisonResult = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND clinicId = ?`,
    ).run(templateName, JSON.stringify(result), now, id, clinicId);
    return this.getById(id);
  }

  async generateReport(id: string): Promise<ReportContext> {
    const analysis = await this.getById(id);
    const { clause, params } = this.buildClinicClause();

    const patient = this.dbService.prepare(
      `SELECT id, name, gender, phone, birthDate FROM Patient WHERE id = ? AND deletedAt IS NULL${clause}`,
    ).get(analysis.patientId, ...params) as Record<string, unknown> | undefined;

    let doctor: Record<string, unknown> | undefined | null = null;
    if (analysis.doctorId) {
      doctor = this.dbService.prepare(
        `SELECT id, name, role, title FROM User WHERE id = ? AND deletedAt IS NULL${clause}`,
      ).get(analysis.doctorId, ...params) as Record<string, unknown> | undefined;
    }

    const measTable = MEASUREMENT_DEFINITIONS.map(def => {
      const m = (analysis.measurements as unknown as Record<string, unknown>)[def.key] as MeasurementResult[keyof MeasurementResult] | undefined;
      const val = m?.value;
      const delta = m?.delta;
      const sevNum = Number(m?.severity ?? 0);
      const sevLabel = sevNum === 0 ? 'NORMAL' : sevNum === 1 ? 'MILD' : sevNum === 2 ? 'MODERATE' : 'SEVERE';
      return {
        key: def.key,
        label: def.label,
        value: val === null || val === undefined || Number.isNaN(val) ? '—' : Number(val).toFixed(1),
        norm: def.norm,
        sd: def.sd,
        delta: delta === null || delta === undefined || Number.isNaN(delta) ? '—' : (delta > 0 ? '+' : '') + Number(delta).toFixed(1),
        severity: sevLabel,
        unit: def.unit,
      };
    });

    let normal = 0, mild = 0, moderate = 0, severe = 0, valid = 0;
    for (const def of MEASUREMENT_DEFINITIONS) {
      const m = (analysis.measurements as unknown as Record<string, unknown>)[def.key] as MeasurementResult[keyof MeasurementResult] | undefined;
      if (m?.value !== null && m?.value !== undefined) {
        valid++;
        const sev = Number(m.severity ?? 0);
        if (sev === 0) normal++;
        else if (sev === 1) mild++;
        else if (sev === 2) moderate++;
        else severe++;
      }
    }

    const clinic: Record<string, unknown> = {};
    try {
      const cid = this.clinicContext.getClinicId();
      if (cid) {
        const cRow = this.dbService.prepare(
          `SELECT id, name, address, phone, code FROM Clinic WHERE id = ?`,
        ).get(cid) as Record<string, unknown> | undefined;
        if (cRow) {
          clinic.id = cRow.id;
          clinic.name = String(cRow.name ?? '');
          clinic.address = String(cRow.address ?? '');
          clinic.phone = String(cRow.phone ?? '');
          clinic.code = String(cRow.code ?? '');
        }
      }
    } catch { /* ignore */ }
    const logoFromSettings = await this.settingsService.get('aiPrintClinicLogo');
    clinic.logo = logoFromSettings ?? '';

    return {
      analysis: {
        id: analysis.id,
        name: analysis.name,
        createdAt: analysis.createdAt,
        notes: analysis.notes,
        landmarksValidated: analysis.landmarksValidated,
        imagingId: analysis.imagingId,
      },
      patient: patient ?? null,
      doctor: doctor ?? null,
      measurements: measTable,
      measurementsSummary: {
        total: MEASUREMENT_DEFINITIONS.length,
        valid,
        normal,
        mild,
        moderate,
        severe,
      },
      classification: analysis.classification,
      comparison: analysis.comparisonResult,
      landmarksSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid meet"><rect width="400" height="500" fill="#fafafa" stroke="#ddd"/><text x="200" y="250" text-anchor="middle" fill="#999" font-size="14">[头影影像占位 - 需前端渲染]</text></svg>`,
      clinic,
      generatedAt: new Date().toISOString(),
    };
  }

  async renderPrintHtml(id: string): Promise<string> {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.printTemplateService.seedDefaults(clinicId);
    const code = 'CEPHALOMETRIC_REPORT';
    try {
      this.printTemplateService.getDefaultTemplate(code);
    } catch {
      this.printTemplateService.saveTemplate(code, {
        name: '头影测量分析报告',
        category: 'CLINICAL',
        paperSize: 'A4',
        orientation: 'portrait',
        content: DEFAULT_CEPHALOMETRIC_TEMPLATE,
      });
    }
    const ctx = await this.generateReport(id);
    const tpl = this.printTemplateService.getDefaultTemplate(code);
    return this.templateEngine.render(tpl.content, ctx as unknown as Record<string, unknown>).html;
  }
}
