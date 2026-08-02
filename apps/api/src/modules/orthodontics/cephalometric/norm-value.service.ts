import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { TableNames } from '../../../common/constants/table-names';

/**
 * 头影测量正常值方向（Task 19）
 * UP=偏大，DOWN=偏小，NORMAL=正常
 */
export type NormDirection = 'UP' | 'NORMAL' | 'DOWN';

export type AdultChild = 'ADULT' | 'CHILD';
export type NormGender = 'M' | 'F' | 'ALL';

export interface NormRange {
  code: string;
  label: string;
  method: string;
  min: number;
  max: number;
  unit: string;
  source: string;
}

export interface NormOverride {
  id?: string;
  code: string;
  label: string;
  method: string;
  adultChild: AdultChild;
  gender: NormGender;
  min: number;
  max: number;
  unit: string;
  source: string;
}

/**
 * 23 项核心指标硬编码正常值（成人默认，参考教材《口腔正畸学》/《头影测量学》）
 * key 与 measurements 的 code 对齐；min/max 为均值 ± 2SD 的近似范围
 */
export const HARDCODED_NORMS: NormRange[] = [
  { code: 'SNA', label: 'SNA 角', method: 'STEINER', min: 79, max: 85, unit: '°', source: '教材《口腔正畸学》第7版' },
  { code: 'SNB', label: 'SNB 角', method: 'STEINER', min: 77, max: 83, unit: '°', source: '教材《口腔正畸学》第7版' },
  { code: 'ANB', label: 'ANB 角', method: 'STEINER', min: 0, max: 4, unit: '°', source: '教材《口腔正畸学》第7版' },
  { code: 'SND', label: 'SND 角', method: 'STEINER', min: 75, max: 81, unit: '°', source: '教材《口腔正畸学》第7版' },
  { code: 'U1-NA-deg', label: 'U1-NA 角度', method: 'STEINER', min: 18, max: 26, unit: '°', source: 'Steiner 法' },
  { code: 'L1-NB-deg', label: 'L1-NB 角度', method: 'STEINER', min: 21, max: 29, unit: '°', source: 'Steiner 法' },
  { code: 'U1-NA-mm', label: 'U1-NA 距离', method: 'STEINER', min: 2, max: 6, unit: 'mm', source: 'Steiner 法' },
  { code: 'L1-NB-mm', label: 'L1-NB 距离', method: 'STEINER', min: 2, max: 6, unit: 'mm', source: 'Steiner 法' },
  { code: 'U1-SN', label: 'U1-SN 倾斜角', method: 'STEINER', min: 100, max: 110, unit: '°', source: 'Steiner 法' },
  { code: 'Holdaway', label: 'Holdaway 修正角', method: 'STEINER', min: 4, max: 10, unit: '°', source: 'Holdaway 修正' },
  { code: 'FMA', label: 'FMA 下颌平面角', method: 'TWEE', min: 22, max: 28, unit: '°', source: 'Tweed 法' },
  { code: 'FMIA', label: 'FMIA 角', method: 'TWEE', min: 62, max: 68, unit: '°', source: 'Tweed 法' },
  { code: 'IMPA', label: 'IMPA 角', method: 'TWEE', min: 86, max: 94, unit: '°', source: 'Tweed 法' },
  { code: 'L1-MP', label: 'L1-MP 倾斜角', method: 'TWEE', min: 86, max: 94, unit: '°', source: 'Tweed 法' },
  { code: 'SN-MP', label: 'SN-MP 平面角', method: 'STEINER', min: 27, max: 37, unit: '°', source: '教材《头影测量学》' },
  { code: 'Occ-SN', label: 'Occ-SN 呀平面角', method: 'STEINER', min: 12, max: 22, unit: '°', source: 'Steiner 法' },
  { code: 'Occ-MP', label: 'Occ-MP 呀平面-下颌平面角', method: 'DOWNS', min: 8, max: 18, unit: '°', source: 'Downs 法' },
  { code: 'Overjet', label: '覆盖', method: 'STEINER', min: 1, max: 3, unit: 'mm', source: '教材《口腔正畸学》第7版' },
  { code: 'Overbite', label: '覆𬌗', method: 'STEINER', min: 1, max: 3, unit: 'mm', source: '教材《口腔正畸学》第7版' },
  { code: 'Wits', label: 'Wits 评估值', method: 'STEINER', min: -2, max: 2, unit: 'mm', source: 'Jacobson Wits 法' },
  { code: 'InterincisalAngle', label: '上下中切牙角', method: 'DOWNS', min: 118, max: 132, unit: '°', source: 'Downs 法' },
  { code: 'FacialAngle', label: '面角 (Downs)', method: 'DOWNS', min: 82, max: 92, unit: '°', source: 'Downs 法' },
  { code: 'MPA-Downs', label: '下颌平面角 (Downs)', method: 'DOWNS', min: 22, max: 32, unit: '°', source: 'Downs 法' },
];

const HARDCODED_MAP: Map<string, NormRange> = new Map(
  HARDCODED_NORMS.map(n => [n.code, n]),
);

@Injectable()
export class NormValueService {
  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
  ) {}

  /**
   * 方向判定（TR-19.14）
   * value > max → 'UP'；value < min → 'DOWN'；否则 'NORMAL'
   */
  classifyDirection(value: number, min: number, max: number): NormDirection {
    if (value > max) return 'UP';
    if (value < min) return 'DOWN';
    return 'NORMAL';
  }

  /**
   * 获取正常值（TR-19.22）
   * 先查 DB CephalometricNormValue（按 clinicId + code + gender），否则返回硬编码默认
   */
  getNorm(
    code: string,
    options: { adultChild?: AdultChild; gender?: NormGender } = {},
  ): NormRange | null {
    const gender = options.gender ?? 'ALL';
    const clinicId = this.clinicContext.getClinicId();

    if (clinicId) {
      const row = this.dbService.prepare(
        `SELECT id, metricName as code, mean, stdDev, unit, source, method, gender
         FROM ${TableNames.CEPHALOMETRIC_NORM_VALUE}
         WHERE metricName = ? AND clinicId = ? AND deletedAt IS NULL
         ORDER BY CASE WHEN gender = ? THEN 0
                       WHEN gender = 'ALL' THEN 1
                       ELSE 2 END
         LIMIT 1`,
      ).get(code, clinicId, gender) as
        | { code: string; mean: number; stdDev: number; unit: string; source: string; method: string }
        | undefined;

      if (row) {
        return {
          code: row.code,
          label: row.code,
          method: row.method,
          min: row.mean - 2 * row.stdDev,
          max: row.mean + 2 * row.stdDev,
          unit: row.unit || '°',
          source: row.source || 'DB 自定义',
        };
      }
    }

    return HARDCODED_MAP.get(code) ?? null;
  }

  /**
   * 列出全部硬编码正常值
   */
  listHardcodedNorms(): NormRange[] {
    return Array.from(HARDCODED_NORMS);
  }

  /**
   * 列出当前诊所的所有自定义正常值
   */
  listDbOverrides(): NormOverride[] {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return [];
    const rows = this.dbService.prepare(
      `SELECT id, metricName as code, method, mean, stdDev, unit, source
       FROM ${TableNames.CEPHALOMETRIC_NORM_VALUE}
       WHERE clinicId = ? AND deletedAt IS NULL
       ORDER BY method, metricName`,
    ).all(clinicId) as Array<{
      id: string;
      code: string;
      method: string;
      mean: number;
      stdDev: number;
      unit: string;
      source: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      code: r.code,
      label: r.code,
      method: r.method,
      adultChild: 'ADULT',
      gender: 'ALL',
      min: r.mean - 2 * r.stdDev,
      max: r.mean + 2 * r.stdDev,
      unit: r.unit || '°',
      source: r.source || 'DB 自定义',
    }));
  }

  /**
   * 新增/覆写自定义正常值（TR-19.22）
   * 若同 clinicId + method + metricName 已存在则覆盖
   */
  saveOverride(override: Omit<NormOverride, 'id'>): NormOverride {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      throw new Error('缺少诊所上下文');
    }
    const mean = (override.min + override.max) / 2;
    const stdDev = Math.max(0.0001, (override.max - override.min) / 4);
    const now = new Date().toISOString();

    const existing = this.dbService.prepare(
      `SELECT id FROM ${TableNames.CEPHALOMETRIC_NORM_VALUE}
       WHERE clinicId = ? AND method = ? AND metricName = ? AND deletedAt IS NULL`,
    ).get(clinicId, override.method, override.code) as { id: string } | undefined;

    if (existing) {
      this.dbService.prepare(
        `UPDATE ${TableNames.CEPHALOMETRIC_NORM_VALUE}
         SET mean = ?, stdDev = ?, unit = ?, source = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(mean, stdDev, override.unit, override.source || 'DB 自定义', now, existing.id);
      return { ...override, id: existing.id };
    }

    const id = crypto.randomUUID();
    this.dbService.prepare(
      `INSERT INTO ${TableNames.CEPHALOMETRIC_NORM_VALUE}
       (id, clinicId, method, metricName, race, gender, ageMin, ageMax, mean, stdDev, unit, source, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'CHINESE', 'BOTH', NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      clinicId,
      override.method,
      override.code,
      mean,
      stdDev,
      override.unit,
      override.source || 'DB 自定义',
      now,
      now,
    );

    return { ...override, id };
  }
}
