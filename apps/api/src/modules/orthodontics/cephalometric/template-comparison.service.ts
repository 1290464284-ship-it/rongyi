/* eslint-disable unicorn/no-top-level-side-effects, @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { Injectable } from '@nestjs/common';
import { MeasurementResult, MeasurementValue, MEASUREMENT_DEFINITIONS } from './measurements.service';

export type TemplateName = 'ANDREWS' | 'BOLTON' | 'TWEED' | 'CHINESE_NORMAL';

export type SeverityLabel = 'NORMAL' | 'MILD' | 'MODERATE' | 'SEVERE';

export interface TemplateDelta {
  key: string;
  label: string;
  value: number | null;
  mean: number;
  sd: number;
  delta: number | null;
  severity: SeverityLabel;
}

export interface TemplateComparisonResult {
  template: TemplateName;
  deltas: TemplateDelta[];
  summary: string;
}

interface TemplateNormSd {
  norm: number;
  sd: number;
}

const ANDREWS_TEMPLATE: Record<string, TemplateNormSd> = {};
const BOLTON_TEMPLATE: Record<string, TemplateNormSd> = {};
const TWEED_TEMPLATE: Record<string, TemplateNormSd> = {};
const CHINESE_NORMAL_TEMPLATE: Record<string, TemplateNormSd> = {};

function fillTemplate(target: Record<string, TemplateNormSd>, overrides: Record<string, Partial<TemplateNormSd>> = {}) {
  for (const def of MEASUREMENT_DEFINITIONS) {
    const base: TemplateNormSd = { norm: def.norm, sd: def.sd };
    const ovr = overrides[def.key] || {};
    target[def.key] = { norm: ovr.norm ?? base.norm, sd: ovr.sd ?? base.sd };
  }
}

fillTemplate(ANDREWS_TEMPLATE, {
  SNA: { norm: 82, sd: 2 },
  SNB: { norm: 80, sd: 2 },
  ANB: { norm: 2, sd: 1.5 },
  Wits: { norm: -1, sd: 2 },
  'U1-SN': { norm: 102, sd: 4 },
  'L1-MP': { norm: 90, sd: 4 },
  'Interincisal Angle': { norm: 130, sd: 6 },
  FMA: { norm: 22, sd: 2.5 },
  'SN-MP': { norm: 30, sd: 4 },
  Overjet: { norm: 2.5, sd: 1 },
  Overbite: { norm: 2, sd: 0.8 },
});

fillTemplate(BOLTON_TEMPLATE, {
  SNA: { norm: 82, sd: 3 },
  SNB: { norm: 79, sd: 3 },
  ANB: { norm: 3, sd: 2 },
  Wits: { norm: 0, sd: 2 },
  'U1-SN': { norm: 105, sd: 5 },
  'L1-MP': { norm: 92, sd: 5 },
  'Interincisal Angle': { norm: 126, sd: 8 },
  FMA: { norm: 25, sd: 3 },
  'SN-MP': { norm: 32, sd: 5 },
  Overjet: { norm: 2, sd: 1.5 },
  Overbite: { norm: 2, sd: 1 },
});

fillTemplate(TWEED_TEMPLATE, {
  SNA: { norm: 82, sd: 3 },
  SNB: { norm: 80, sd: 3 },
  ANB: { norm: 2, sd: 2 },
  Wits: { norm: 0, sd: 2 },
  'U1-SN': { norm: 100, sd: 4 },
  'L1-MP': { norm: 90, sd: 4 },
  'U1-NA-mm': { norm: 3, sd: 1.5 },
  'U1-NA-deg': { norm: 20, sd: 3 },
  'L1-NB-mm': { norm: 3, sd: 1.5 },
  'L1-NB-deg': { norm: 22, sd: 3 },
  'Interincisal Angle': { norm: 128, sd: 6 },
  FMA: { norm: 25, sd: 3 },
  'SN-MP': { norm: 32, sd: 5 },
  'PFH/AFH': { norm: 0.67, sd: 0.05 },
  Overjet: { norm: 2, sd: 1 },
  Overbite: { norm: 2, sd: 0.8 },
});

fillTemplate(CHINESE_NORMAL_TEMPLATE, {
  SNA: { norm: 83, sd: 3 },
  SNB: { norm: 80, sd: 3 },
  ANB: { norm: 3, sd: 2 },
  Wits: { norm: 1, sd: 2 },
  'U1-SN': { norm: 105, sd: 5 },
  'L1-MP': { norm: 94, sd: 5 },
  'U1-NA-mm': { norm: 5, sd: 2 },
  'U1-NA-deg': { norm: 24, sd: 4 },
  'L1-NB-mm': { norm: 5, sd: 2 },
  'L1-NB-deg': { norm: 28, sd: 4 },
  'Interincisal Angle': { norm: 122, sd: 8 },
  FMA: { norm: 27, sd: 4 },
  'SN-MP': { norm: 34, sd: 5 },
  'Y-axis': { norm: 65, sd: 4 },
  'PFH/AFH': { norm: 0.62, sd: 0.06 },
  'ANS-Me': { norm: 68, sd: 5 },
  'N-ANS': { norm: 54, sd: 4 },
  'S-Go': { norm: 72, sd: 6 },
  Overjet: { norm: 2.5, sd: 1.5 },
  Overbite: { norm: 2.5, sd: 1 },
  'Nasolabial Angle': { norm: 92, sd: 10 },
  'Holdaway angle': { norm: 8, sd: 3 },
});

 
export const TEMPLATE_LIBRARY: Record<TemplateName, Record<string, TemplateNormSd>> = {
  ANDREWS: ANDREWS_TEMPLATE,
  BOLTON: BOLTON_TEMPLATE,
  TWEED: TWEED_TEMPLATE,
  CHINESE_NORMAL: CHINESE_NORMAL_TEMPLATE,
};

@Injectable()
export class CephalometricTemplateComparisonService {
  getAvailableTemplates(): TemplateName[] {
    return ['ANDREWS', 'BOLTON', 'TWEED', 'CHINESE_NORMAL'];
  }

  compareToTemplate(
    measurements: MeasurementResult,
    templateName: TemplateName,
  ): TemplateComparisonResult {
    const template = TEMPLATE_LIBRARY[templateName];
    if (!template) {
      throw new Error(`Unknown template: ${templateName}`);
    }

    const deltas: TemplateDelta[] = [];
    let severeCount = 0;
    let modCount = 0;
    let mildCount = 0;
    let validCount = 0;

    for (const def of MEASUREMENT_DEFINITIONS) {
      const meas = measurements[def.key] as MeasurementValue | undefined;
      const tpl = template[def.key];
      if (!tpl || !meas) {
        continue;
      }
      const val = meas.value;
      const delta = val === null ? null : val - tpl.norm;
      const severity: SeverityLabel = this.sevFrom(delta, tpl.sd);
      validCount++;
      if (severity === 'SEVERE') severeCount++;
      else if (severity === 'MODERATE') modCount++;
      else if (severity === 'MILD') mildCount++;
      deltas.push({
        key: def.key,
        label: def.label,
        value: val,
        mean: tpl.norm,
        sd: tpl.sd,
        delta,
        severity,
      });
    }

    let summary: string;
    if (severeCount > 0) {
      summary = `偏差显著：${severeCount} 项≥2.5SD，${modCount} 项≥1.5SD，建议重点关注`;
    } else if (modCount > 0) {
      summary = `中度偏离：${modCount} 项≥1.5SD，整体偏差可控`;
    } else if (mildCount > 0) {
      summary = `轻微偏离：${mildCount} 项介于 0.5~1.5SD，基本接近模板标准`;
    } else {
      summary = `偏差均<0.5SD，与 ${templateName} 模板高度一致`;
    }

    return {
      template: templateName,
      deltas,
      summary,
    };
  }

  private sevFrom(delta: number | null, sd: number): SeverityLabel {
    if (delta === null) return 'NORMAL';
    const ratio = Math.abs(delta) / Math.max(sd, 0.0001);
    if (ratio >= 2.5) return 'SEVERE';
    if (ratio >= 1.5) return 'MODERATE';
    if (ratio >= 0.5) return 'MILD';
    return 'NORMAL';
  }
}
