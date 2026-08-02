/* eslint-disable sonarjs/super-linear-regex -- TODO: 逐步修复 lint 问题 */
import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AppLogger } from '../../../common/services/logger.service';
import { SettingsService } from '../../system/settings/settings.service';
import * as crypto from 'node:crypto';
import { drugToCategories, isAlcoholPresent } from './drug-category-maps';
import { CONTRAINDICATION_SEEDS, DrugContraindicationSeed, AppliesTo } from './contraindication-seed';

export type PatientPregnancyStatus = 'NONE' | 'FIRST_TRIMESTER' | 'SECOND' | 'THIRD' | 'LACTATING';
export type LiverLevel = 'NONE' | 'MILD' | 'MODERATE' | 'SEVERE';
export type RenalLevel = 'NONE' | 'MILD' | 'MODERATE' | 'SEVERE';

export interface PatientContraindicationContext {
  pregnancyStatus?: PatientPregnancyStatus;
  age?: number;
  liverImpairment?: LiverLevel;
  renalImpairment?: RenalLevel;
}

export interface PrescriptionItemDto {
  drugCode?: string;
  drugName: string;
  spec?: string;
  dosage?: string;
  frequency?: string;
  days?: number;
  quantity?: number;
  unit?: string;
  alcohol?: boolean;
}

export interface PrescriptionContraindicationAlert {
  ruleId: string;
  level: 'INFO' | 'WARN' | 'DANGER';
  message: string;
  drugPair?: { a: string; b: string };
  appliesGroup?: string;
  seedId?: string;
}

interface ParsedRule extends DrugContraindicationSeed {
  appliesToParsed?: AppliesTo;
}

@Injectable()
export class PrescriptionSafetyService {
  private readonly logger = new AppLogger(PrescriptionSafetyService.name);
  private readonly TABLE = 'DrugContraindication';

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {}

  private buildClinicClause(prefix: string = ' AND '): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { clause: '', params: [] };
    return { clause: `${prefix} clinicId = ?`, params: [clinicId] };
  }

  async seedDefaultsIfEmpty(): Promise<number> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return 0;

    const { clause, params } = this.buildClinicClause(' WHERE ');
    const countRow = this.dbService.prepare(
      `SELECT COUNT(*) AS count FROM ${this.TABLE}${clause}`,
    ).get(...params) as Record<string, unknown>;
    const count = Number((countRow.count ?? countRow.c ?? countRow.total ?? 0));
    if (count > 0) return 0;

    const inserted = this.dbService.transaction((db) => {
      let count = 0;
      const now = new Date().toISOString();
      const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO ${this.TABLE} (id, clinicId, drugCategoryA, drugCategoryB, severity, reason, ruleId, appliesToJson, bidirectional, doseMinDailyMg, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const seed of CONTRAINDICATION_SEEDS) {
        const id = seed.id;
        const drugCategoryA = seed.typeA === 'CATEGORY' ? seed.nameA.replace(/^CAT:/, '') : seed.nameA;
        const drugCategoryB = seed.typeB === 'CATEGORY' ? seed.nameB.replace(/^CAT:/, '') : seed.nameB;
        const appliesToJson = seed.appliesTo ? JSON.stringify(seed.appliesTo) : null;
        const bidir = seed.bidirectional === false ? 0 : 1;
        const doseMin = seed.doseMinDailyMg ?? null;
        const info = insertStmt.run(
          id, clinicId, drugCategoryA, drugCategoryB,
          seed.level, seed.message, seed.ruleId, appliesToJson,
          bidir, doseMin, now, now,
        );
        if (info.changes > 0) count++;
      }

      const logStmt = db.prepare(
        `INSERT INTO AuditLog (id, type, targetId, targetType, clinicId, remark, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      logStmt.run(
        crypto.randomUUID(),
        'DRUG_CONTRAINDICATION_SEED_IMPORTED',
        clinicId,
        'Clinic',
        clinicId,
        `一次性导入 ${count} 条默认配伍禁忌`,
        now,
      );
      return count;
    });

    this.logger.log(`seedDefaultsIfEmpty: 诊所 ${clinicId} 导入 ${inserted} 条禁忌`);
    return inserted;
  }

  async validate(
    items: PrescriptionItemDto[],
    patientCtx: PatientContraindicationContext = {},
  ): Promise<PrescriptionContraindicationAlert[]> {
    try {
      const enabled = await this.settingsService.get('aiContraindicationEnabled');
      if (enabled === 'false') return [];
    } catch {
      // 无法读 Settings：fail-open（默认 true 由 failOpen 控制）
    }

    const failOpen = true;
    const warnOnFailure = (errMsg: string): PrescriptionContraindicationAlert[] => {
      if (failOpen) {
        return [{
          ruleId: 'SYSTEM-FAIL-OPEN',
          level: 'WARN',
          message: `系统内部警告：配伍校验失败(${errMsg})，请联系管理员。`,
        }];
      }
      return [];
    };

    try {
      await this.seedDefaultsIfEmpty();
    } catch (err: unknown) {
      return warnOnFailure(err instanceof Error ? err.message : 'seed');
    }

    let rawRules: Array<Record<string, unknown>>;
    try {
      const { clause, params } = this.buildClinicClause(' WHERE ');
      const sql = `SELECT * FROM ${this.TABLE}${clause}`;
      rawRules = this.dbService.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    } catch (err: unknown) {
      return warnOnFailure(err instanceof Error ? err.message : 'select');
    }

    // 规范化处方项目 + 计算 categories
    const n = items.length;
    const normItems: Array<{ name: string; normalized: string; categories: Set<string>; hasAlcohol: boolean; dailyMg?: number }> = [];
    for (const it of items) {
      const name = (it.drugName || '').trim();
      const normalized = name;
      const categories = drugToCategories(name, it.drugCode);
      const hasAlcohol = !!it.alcohol || isAlcoholPresent(name);
      if (hasAlcohol) categories.add('ALCOHOL_GENERAL');
      const dailyMg = this.estimateDailyDoseMg(it);
      normItems.push({ name, normalized, categories, hasAlcohol, dailyMg });
    }

    // 解析规则
    const rules: ParsedRule[] = rawRules.map(r => {
      const seed: Partial<DrugContraindicationSeed> = {
        id: String(r.id ?? ''),
        nameA: String(r.drugCategoryA ?? ''),
        typeA: String(r.drugCategoryA ?? '').startsWith('CAT:') ? 'CATEGORY' : (String(r.nameA || r.drugCategoryA || '').startsWith('CAT:') ? 'CATEGORY' : 'DRUG'),
        nameB: String(r.drugCategoryB ?? ''),
        typeB: String(r.drugCategoryB ?? '').startsWith('CAT:') ? 'CATEGORY' : 'DRUG',
        level: (r.severity as 'INFO' | 'WARN' | 'DANGER') || 'WARN',
        ruleId: String(r.ruleId ?? ''),
        message: String(r.reason ?? ''),
        bidirectional: Number(r.bidirectional) !== 0,
        doseMinDailyMg: r.doseMinDailyMg ? Number(r.doseMinDailyMg) : undefined,
      };
      // 还原 A/B 类型：如果存储的 drugCategoryA/B 是类别名，尝试匹配是否在 seed 里是 CAT: 前缀
      const sref = CONTRAINDICATION_SEEDS.find(s => s.id === seed.id || s.ruleId === seed.ruleId);
      if (sref) {
        seed.typeA = sref.typeA;
        seed.nameA = sref.nameA;
        seed.typeB = sref.typeB;
        seed.nameB = sref.nameB;
        seed.appliesTo = sref.appliesTo;
      } else {
        const a = String(r.drugCategoryA ?? '');
        const b = String(r.drugCategoryB ?? '');
        if (a.startsWith('CAT:')) { seed.typeA = 'CATEGORY'; }
        else { seed.typeA = 'DRUG'; }
        seed.nameA = a;
        if (b.startsWith('CAT:')) { seed.typeB = 'CATEGORY'; }
        else { seed.typeB = 'DRUG'; }
        seed.nameB = b;
        if (r.appliesToJson && typeof r.appliesToJson === 'string') {
          try { seed.appliesTo = JSON.parse(r.appliesToJson) as AppliesTo; } catch { /* ignore parse error */ }
        }
      }
      return seed as ParsedRule;
    });

    // 去重 Map: ruleId|a|b
    const seen = new Set<string>();
    const alerts: PrescriptionContraindicationAlert[] = [];

    const addAlert = (rule: ParsedRule, a: string, b: string, group?: string) => {
      const key = `${rule.ruleId}|${[a,b].sort((x, y) => x.localeCompare(y)).join('&')}`;
      if (seen.has(key)) return;
      seen.add(key);
      alerts.push({
        ruleId: rule.ruleId,
        level: rule.level,
        message: rule.message,
        drugPair: { a, b },
        appliesGroup: group,
        seedId: rule.id,
      });
    };

    // 1. 两两药品对 + 规则匹配
    for (let i = 0; i < n; i++) {
      const itA = normItems[i];
      for (let j = i + 1; j < n; j++) {
        const itB = normItems[j];
        for (const rule of rules) {
          if (!this.passPopulationFilter(rule, patientCtx)) continue;
          const matchAB = this.matchRuleAgainstItems(rule, itA, itB);
          if (matchAB) {
            if (!this.passDoseFilter(rule, itA, itB)) continue;
            addAlert(rule, itA.name, itB.name);
            continue;
          }
          if (rule.bidirectional !== false) {
            const matchBA = this.matchRuleAgainstItems(rule, itB, itA);
            if (matchBA) {
              if (!this.passDoseFilter(rule, itB, itA)) continue;
              addAlert(rule, itB.name, itA.name);
            }
          }
        }
      }
    }

    // 2. 单药 vs 人群级规则：规则的一边是类别（PREG/LACT/AGE/LIVER/RENAL marker），另一边是 drug/category，patientCtx 满足
    for (let i = 0; i < n; i++) {
      const it = normItems[i];
      for (const rule of rules) {
        if (!this.passPopulationFilter(rule, patientCtx)) continue;
        // 如果 rule 带人群过滤，且规则一边是实际药品/类别，另一边也是药品/类别，但属于"人群级"命中（由 appliesTo 已过滤）
        const matchSingle = this.matchSingleItem(rule, it);
        if (matchSingle && this.isSingleSidePopulationRule(rule, patientCtx)) {
          if (!this.passDoseFilter(rule, it, it)) continue;
          const label = this.populationLabel(rule, patientCtx);
          addAlert(rule, it.name, label, label);
        }
      }
    }

    // 排序：DANGER > WARN > INFO
    const order: Record<string, number> = { DANGER: 0, WARN: 1, INFO: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    return alerts;
  }

  private isSingleSidePopulationRule(rule: ParsedRule, ctx: PatientContraindicationContext): boolean {
    if (!rule.appliesTo) return false;
    const at = rule.appliesTo;
    if (at.pregnancy && at.pregnancy.includes(ctx.pregnancyStatus as 'FIRST_TRIMESTER')) return true;
    if (at.lactation && ctx.pregnancyStatus === 'LACTATING') return true;
    if (at.liver && ctx.liverImpairment && at.liver.includes(ctx.liverImpairment)) return true;
    if (at.renal && ctx.renalImpairment && at.renal.includes(ctx.renalImpairment)) return true;
    if (at.ageMin !== undefined && ctx.age !== undefined && ctx.age >= at.ageMin) return true;
    if (at.ageMax !== undefined && ctx.age !== undefined && ctx.age <= at.ageMax) return true;
    return false;
  }

  private populationLabel(rule: ParsedRule, ctx: PatientContraindicationContext): string {
    const at = rule.appliesTo;
    if (!at) return '';
    if (at.pregnancy && ctx.pregnancyStatus && at.pregnancy.includes(ctx.pregnancyStatus as 'FIRST_TRIMESTER')) {
      return `妊娠${ctx.pregnancyStatus === 'FIRST_TRIMESTER' ? '早期' : ctx.pregnancyStatus === 'SECOND' ? '中期' : '晚期'}`;
    }
    if (at.lactation && ctx.pregnancyStatus === 'LACTATING') return '哺乳期';
    if (at.liver && ctx.liverImpairment) return `${ctx.liverImpairment === 'MILD' ? '轻度' : ctx.liverImpairment === 'MODERATE' ? '中度' : '严重'}肝功能不全`;
    if (at.renal && ctx.renalImpairment) return `${ctx.renalImpairment === 'MILD' ? '轻度' : ctx.renalImpairment === 'MODERATE' ? '中度' : '严重'}肾功能不全`;
    if (at.ageMax !== undefined && ctx.age !== undefined && ctx.age <= at.ageMax) return `儿童(≤${at.ageMax}岁)`;
    if (at.ageMin !== undefined && ctx.age !== undefined && ctx.age >= at.ageMin) return `老年(≥${at.ageMin}岁)`;
    return '';
  }

  private passPopulationFilter(rule: ParsedRule, ctx: PatientContraindicationContext): boolean {
    const at = rule.appliesTo;
    if (!at) return true;
    // 任一人群条件存在且不满足 → 跳过该规则
    // 但同时该规则为"人群级"时（见 isSingleSidePopulationRule），应在人群匹配时才触发
    if (at.pregnancy) {
      const pr = ctx.pregnancyStatus;
      if (!pr || pr === 'NONE' || pr === 'LACTATING') {
        // 如果没有孕期状态，或孕期不匹配 → 检查：若规则仅依赖孕期，则跳过
        const onlyPreg = !at.lactation && !at.liver && !at.renal && at.ageMin === undefined && at.ageMax === undefined;
        if (onlyPreg) return false;
      } else if (!at.pregnancy.includes(pr)) {
        return false;
      }
    }
    if (at.lactation) {
      if (ctx.pregnancyStatus !== 'LACTATING') {
        const onlyLact = !at.pregnancy && !at.liver && !at.renal && at.ageMin === undefined && at.ageMax === undefined;
        if (onlyLact) return false;
      }
    }
    if (at.liver && ctx.liverImpairment) {
      if (!at.liver.includes(ctx.liverImpairment)) return false;
    } else if (at.liver && !ctx.liverImpairment) {
      const onlyLiver = !at.pregnancy && !at.lactation && !at.renal && at.ageMin === undefined && at.ageMax === undefined;
      if (onlyLiver) return false;
    }
    if (at.renal && ctx.renalImpairment) {
      if (!at.renal.includes(ctx.renalImpairment)) return false;
    } else if (at.renal && !ctx.renalImpairment) {
      const onlyRenal = !at.pregnancy && !at.lactation && !at.liver && at.ageMin === undefined && at.ageMax === undefined;
      if (onlyRenal) return false;
    }
    if (at.ageMin !== undefined) {
      if (ctx.age === undefined || ctx.age < at.ageMin) {
        const onlyAge = !at.pregnancy && !at.lactation && !at.liver && !at.renal && at.ageMax === undefined;
        if (onlyAge) return false;
      }
    }
    if (at.ageMax !== undefined) {
      if (ctx.age === undefined || ctx.age > at.ageMax) {
        const onlyAge = !at.pregnancy && !at.lactation && !at.liver && !at.renal && at.ageMin === undefined;
        if (onlyAge) return false;
      }
    }
    return true;
  }

  private passDoseFilter(rule: ParsedRule, a: { name: string; dailyMg?: number }, b: { name: string; dailyMg?: number }): boolean {
    const threshold = rule.doseMinDailyMg;
    if (!threshold) return true;
    const match = (it: { name: string; dailyMg?: number }) => {
      if (!rule.nameA || !rule.nameB) return true;
      if (it.dailyMg === undefined) return true;
      return it.dailyMg >= threshold;
    };
    return match(a) || match(b);
  }

  private estimateDailyDoseMg(item: PrescriptionItemDto): number | undefined {
    if (!item.dosage) return undefined;
    const m = item.dosage.match(/(\d+(?:\.\d+)?)\s*(mg\/?ml|g\/?ml|mg|g)/i);
    if (!m) return undefined;
    let val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('g')) val *= 1000;
    // 粗略估计频次
    let freqMul = 1;
    if (item.frequency) {
      const f = item.frequency;
      if (f.includes('每日4次') || f.includes('qid') || f.includes('QID')) freqMul = 4;
      else if (f.includes('每日3次') || f.includes('tid') || f.includes('TID')) freqMul = 3;
      else if (f.includes('每日2次') || f.includes('bid') || f.includes('BID')) freqMul = 2;
      else if (f.includes('每日1次') || f.includes('qd') || f.includes('QD')) { /* freqMul already 1 */ }
      else if (f.includes('每8小时')) freqMul = 3;
      else if (f.includes('每12小时')) freqMul = 2;
      else if (f.includes('每6小时')) freqMul = 4;
    }
    return val * freqMul;
  }

  private ruleSideMatches(ruleName: string, ruleType: string, it: { normalized: string; categories: Set<string>; name: string }): boolean {
    if (ruleType === 'CATEGORY') {
      const cat = ruleName.replace(/^CAT:/, '');
      if (cat === 'ALCOHOL_GENERAL' || cat === 'ALCOHOL_PRESENT' || ruleName === 'CAT:ALCOHOL_GENERAL') {
        return it.categories.has('ALCOHOL_GENERAL');
      }
      return it.categories.has(cat);
    }
    // DRUG 精确或包含
    const nm = ruleName.replace(/^CAT:/, '');
    if (!nm) return false;
    if (it.normalized === nm || it.name === nm) return true;
    if (it.normalized.includes(nm) || nm.includes(it.normalized)) return true;
    return false;
  }

  private matchRuleAgainstItems(rule: ParsedRule, item1: { normalized: string; categories: Set<string>; name: string; dailyMg?: number }, item2: { normalized: string; categories: Set<string>; name: string; dailyMg?: number }): boolean {
    const sideAMatch = this.ruleSideMatches(rule.nameA, rule.typeA, item1);
    if (!sideAMatch) return false;
    return this.ruleSideMatches(rule.nameB, rule.typeB, item2);
  }

  private matchSingleItem(rule: ParsedRule, it: { normalized: string; categories: Set<string>; name: string }): boolean {
    const aMatch = this.ruleSideMatches(rule.nameA, rule.typeA, it);
    const bMatch = this.ruleSideMatches(rule.nameB, rule.typeB, it);
    // 单药 vs 人群级规则：只要一边匹配药品/类别，另一边可以是人群标记（在 seed 中如 PREGNANCY_ANY/LACTATION/LIVER_SEVERE）
    if (aMatch) {
      const other = rule.nameB;
      if (other.includes('PREGNANCY') || other.includes('LACTATION') || other.includes('LIVER') || other.includes('RENAL') || other.includes('PEDIATRIC') || other.includes('PATIENT_ELDERLY') || other.includes('糖尿病') || other.includes('肾功能')) return true;
    }
    if (bMatch) {
      const other = rule.nameA;
      if (other.includes('PREGNANCY') || other.includes('LACTATION') || other.includes('LIVER') || other.includes('RENAL') || other.includes('PEDIATRIC') || other.includes('PATIENT_ELDERLY') || other.includes('糖尿病') || other.includes('肾功能')) return true;
    }
    return aMatch && bMatch && rule.nameA !== rule.nameB;
  }

  getLogger() {
    return this.logger;
  }
}
