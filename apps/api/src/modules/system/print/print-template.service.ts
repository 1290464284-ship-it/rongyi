import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AppLogger } from '../../../common/services/logger.service';
import { BusinessNotFoundException } from '../../../common/errors';
import {
  PrintTemplateCode,
  PrintTemplateCategory,
  PaperSize,
  Orientation,
  PrintTemplateEntity,
} from './dto/print-template.dto';
import {
  DEFAULT_PRESCRIPTION_TEMPLATE,
  DEFAULT_RECEIPT_TEMPLATE,
  DEFAULT_TREATMENT_PLAN_TEMPLATE,
  DEFAULT_CLINIC_REPORT_TEMPLATE,
} from './default-templates';
import { DEFAULT_CEPHALOMETRIC_TEMPLATE } from './cephalometric-template';

const DEFAULT_TEMPLATES: Array<{
  code: PrintTemplateCode;
  name: string;
  category: PrintTemplateCategory;
  paperSize: PaperSize;
  orientation: Orientation;
  content: string;
  contentFn?: () => string;
}> = [
  {
    code: 'PRESCRIPTION',
    name: '处方打印模板',
    category: 'PRESCRIPTION',
    paperSize: 'A5',
    orientation: 'portrait',
    content: DEFAULT_PRESCRIPTION_TEMPLATE,
  },
  {
    code: 'RECEIPT',
    name: '收据模板',
    category: 'FINANCIAL',
    paperSize: 'RECEIPT',
    orientation: 'portrait',
    content: DEFAULT_RECEIPT_TEMPLATE,
  },
  {
    code: 'TREATMENT_PLAN',
    name: '治疗计划模板',
    category: 'CLINICAL',
    paperSize: 'A4',
    orientation: 'portrait',
    content: DEFAULT_TREATMENT_PLAN_TEMPLATE,
  },
  {
    code: 'CLINIC_REPORT',
    name: '就诊报告模板',
    category: 'REPORT',
    paperSize: 'A4',
    orientation: 'portrait',
    content: DEFAULT_CLINIC_REPORT_TEMPLATE,
  },
  {
    code: 'CEPHALOMETRIC_REPORT',
    name: '头影测量分析报告',
    category: 'CLINICAL',
    paperSize: 'A4',
    orientation: 'portrait',
    content: DEFAULT_CEPHALOMETRIC_TEMPLATE,
  },
];

@Injectable()
export class PrintTemplateService implements OnModuleInit {
  private logger = new AppLogger(PrintTemplateService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
  ) {}

  onModuleInit() {
    try {
      const clinicId = this.clinicContext.getClinicId();
      if (clinicId) {
        this.seedDefaults(clinicId);
      }
    } catch (err: unknown) {
      this.logger.warn('PrintTemplate onModuleInit seedDefaults skipped:', err instanceof Error ? err.message : String(err));
    }
  }

  private buildClinicClause(): { clause: string; params: string[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      return { clause: ' AND clinicId = ?', params: [clinicId] };
    }
    return { clause: '', params: [] };
  }

  seedDefaults(clinicId: string): number {
    const now = new Date().toISOString();
    let createdCount = 0;

    this.dbService.transaction((db) => {
      for (const tpl of DEFAULT_TEMPLATES) {
        const existing = db.prepare(
          `SELECT id FROM PrintTemplate WHERE code = ? AND clinicId = ? AND deletedAt IS NULL`
        ).get(tpl.code, clinicId) as { id: string } | undefined;

        if (existing) continue;

        const id = crypto.randomUUID();
        const content = typeof tpl.contentFn === 'function' ? tpl.contentFn() : tpl.content;
        db.prepare(
          `INSERT INTO PrintTemplate (id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, '{}', 1, ?, ?, ?, ?, ?)`
        ).run(
          id,
          tpl.code,
          tpl.name,
          tpl.category,
          content,
          tpl.paperSize,
          tpl.orientation,
          clinicId,
          now,
          now,
        );
        createdCount++;
      }
    });

    if (createdCount > 0) {
      this.logger.log(`seedDefaults: 已为诊所 ${clinicId} 创建 ${createdCount} 套默认模板`);
    }
    return createdCount;
  }

  listTemplates(options: { category?: PrintTemplateCategory } = {}): PrintTemplateEntity[] {
    const { clause, params } = this.buildClinicClause();
    const whereParts: string[] = [`deletedAt IS NULL${clause}`];
    const finalParams = [...params];

    if (options.category) {
      whereParts.push('category = ?');
      finalParams.push(options.category);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    return this.dbService.prepare(
      `SELECT id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdBy, createdAt, updatedAt, deletedAt
       FROM PrintTemplate ${whereClause}
       ORDER BY category ASC, isDefault DESC, createdAt ASC`
    ).all(...finalParams) as PrintTemplateEntity[];
  }

  getTemplate(code: string): PrintTemplateEntity {
    const { clause, params } = this.buildClinicClause();
    const row = this.dbService.prepare(
      `SELECT id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdBy, createdAt, updatedAt, deletedAt
       FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL${clause}`
    ).get(code, ...params) as PrintTemplateEntity | undefined;

    if (!row) {
      throw new BusinessNotFoundException(`打印模板不存在: ${code}`);
    }
    return row;
  }

  getDefaultTemplate(code: string): PrintTemplateEntity {
    const { clause, params } = this.buildClinicClause();
    const row = this.dbService.prepare(
      `SELECT id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdBy, createdAt, updatedAt, deletedAt
       FROM PrintTemplate WHERE code = ? AND isDefault = 1 AND deletedAt IS NULL${clause}`
    ).get(code, ...params) as PrintTemplateEntity | undefined;

    if (row) return row;

    const fallback = this.dbService.prepare(
      `SELECT id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdBy, createdAt, updatedAt, deletedAt
       FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL${clause}
       ORDER BY isDefault DESC, createdAt ASC LIMIT 1`
    ).get(code, ...params) as PrintTemplateEntity | undefined;

    if (!fallback) {
      throw new BusinessNotFoundException(`打印模板不存在: ${code}`);
    }
    return fallback;
  }

  saveTemplate(
    code: string,
    dto: {
      name: string;
      content: string;
      category?: PrintTemplateCategory;
      variables?: Record<string, unknown>;
      paperSize?: PaperSize;
      orientation?: Orientation;
    },
  ): PrintTemplateEntity {
    const clinicId = this.clinicContext.getClinicId() ?? '';
    const createdBy = this.clinicContext.getUserId();
    const now = new Date().toISOString();

    const variablesJson = dto.variables ? JSON.stringify(dto.variables) : '{}';

    return this.dbService.transaction((db) => {
      const existing = db.prepare(
        `SELECT id FROM PrintTemplate WHERE code = ? AND clinicId = ? AND deletedAt IS NULL`
      ).get(code, clinicId) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE PrintTemplate SET name = ?, content = ?, variables = ?, updatedAt = ?,
           paperSize = COALESCE(?, paperSize),
           orientation = COALESCE(?, orientation),
           category = COALESCE(?, category)
           WHERE code = ? AND clinicId = ? AND deletedAt IS NULL`
        ).run(
          dto.name,
          dto.content,
          variablesJson,
          now,
          dto.paperSize ?? null,
          dto.orientation ?? null,
          dto.category ?? null,
          code,
          clinicId,
        );
      } else {
        const id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO PrintTemplate (id, code, name, category, content, variables, isDefault, paperSize, orientation, clinicId, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, COALESCE(?, 'REPORT'), ?, ?, 0, COALESCE(?, 'A4'), COALESCE(?, 'portrait'), ?, ?, ?, ?)`
        ).run(
          id,
          code,
          dto.name,
          dto.category ?? null,
          dto.content,
          variablesJson,
          dto.paperSize ?? null,
          dto.orientation ?? null,
          clinicId,
          createdBy ?? null,
          now,
          now,
        );
      }

      return this.getTemplate(code);
    });
  }

  setDefault(code: string): PrintTemplateEntity {
    const { clause, params } = this.buildClinicClause();
    const now = new Date().toISOString();

    this.dbService.transaction((db) => {
      const existing = db.prepare(
        `SELECT id, category FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL${clause}`
      ).get(code, ...params) as { id: string; category: PrintTemplateCategory } | undefined;

      if (!existing) {
        throw new BusinessNotFoundException(`打印模板不存在: ${code}`);
      }

      db.prepare(
        `UPDATE PrintTemplate SET isDefault = 0, updatedAt = ? WHERE category = ? AND deletedAt IS NULL${clause}`
      ).run(now, existing.category, ...params);

      db.prepare(
        `UPDATE PrintTemplate SET isDefault = 1, updatedAt = ? WHERE code = ? AND deletedAt IS NULL${clause}`
      ).run(now, code, ...params);
    });

    return this.getTemplate(code);
  }
}
