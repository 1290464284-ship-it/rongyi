import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { AppLogger } from '../../../common/services/logger.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AuditLogType, TableNames } from '../../../common/constants';

export interface NormalizeItemInput {
  treatmentCatalogCode?: string;
  name?: string;
}

export interface ChargeTransaction {
  chargeId: string;
  keys: string[];
}

export interface FrequentItemsetInfo {
  count: number;
  keys: string[];
}

export interface AssociationRule {
  antecedent: string[];
  consequent: string;
  support: number;
  confidence: number;
  lift: number;
  supportCount: number;
  totalTransactions: number;
}

export interface RuleRecord {
  id: string;
  clinicId: string;
  antecedent: string[];
  consequent: string;
  antecedentSize: number;
  support: number;
  confidence: number;
  lift: number;
  supportCount: number;
  totalTransactions: number;
  createdAt: string;
  updatedAt: string;
  computedAt: string;
}

export interface RecommendationResult {
  rule: RuleRecord;
  key: string;
  itemNameHint: string;
  confidence: number;
  lift: number;
}

export interface UpsertStats {
  added: number;
  updated: number;
  deleted: number;
}

export interface RebuildStats {
  transactions: number;
  frequentItemsets: number;
  rules: number;
  mockDemoInserted: boolean;
  upsert: UpsertStats;
  sinceDays: number;
}

const MAX_ANTECEDENT_SIZE_DEFAULT = 2;
const MAX_SET_SIZE_DEFAULT = 3;
const MIN_SUPPORT_DEFAULT = 0.01;
const MIN_SUPPORT_COUNT_DEFAULT = 5;
const MIN_CONFIDENCE_DEFAULT = 0.35;
const MIN_LIFT_DEFAULT = 1.1;
const MAX_ITEMS_DEFAULT = 8000;
const DEFAULT_LOOKBACK_DAYS = 730;

export const normalizeItemKey = (item: NormalizeItemInput): string => {
  if (item.treatmentCatalogCode && item.treatmentCatalogCode.trim().length > 0) {
    return `CAT:${item.treatmentCatalogCode.trim()}`;
  }
  if (!item.name) {
    throw new Error('normalizeItemKey requires either treatmentCatalogCode or name');
  }
  return `NAME:${item.name.trim().toLowerCase()}`;
};

const sortKeys = (keys: string[]): string[] => [...keys].sort((a, b) => a.localeCompare(b));
const encodeJsonKeys = (keys: string[]): string => JSON.stringify(sortKeys(keys));

const keyToNameHint = (key: string): string => {
  if (key.startsWith('CAT:')) {
    return key.slice('CAT:'.length);
  }
  if (key.startsWith('NAME:')) {
    const raw = key.slice('NAME:'.length);
    return raw.length > 0 ? raw[0].toUpperCase() + raw.slice(1) : raw;
  }
  return key;
};

const combinations = <T>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  const n = arr.length;
  if (size > n) return result;
  const indices = Array.from({ length: size }, (_, i) => i);
  while (true) {
    result.push(indices.map(i => arr[i]));
    let i = size - 1;
    while (i >= 0 && indices[i] === i + n - size) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1] + 1;
  }
  return result;
};

const allNonEmptySubsets = <T>(arr: T[], maxSize: number): T[][] => {
  const subsets: T[][] = [];
  const n = Math.min(arr.length, maxSize);
  for (let size = 1; size <= n; size++) {
    subsets.push(...combinations(arr, size));
  }
  return subsets;
};

export interface BuildFrequentOptions {
  minSupport?: number;
  maxSetSize?: number;
  minSupportCount?: number;
  maxItems?: number;
}

export interface GenerateRuleOptions {
  minConfidence?: number;
  minLift?: number;
}

@Injectable()
export class ChargeAssistantService extends BaseService<RuleRecord> {
  private readonly chargeAssistantLogger: AppLogger;

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {
    super(dbService, clinicContext, {
      tableName: TableNames.CHARGE_ASSOCIATION_RULE,
      hasSoftDelete: false,
    });
    this.chargeAssistantLogger = new AppLogger(ChargeAssistantService.name);
  }

  // ===========================================================================
  // 1. normalizeItemKey (public for reuse)
  // ===========================================================================
  normalizeItemKey(item: NormalizeItemInput): string {
    return normalizeItemKey(item);
  }

  // ===========================================================================
  // 2. fetchTransactions
  // ===========================================================================
  async fetchTransactions(
    sinceDays = DEFAULT_LOOKBACK_DAYS,
    endDate?: Date,
  ): Promise<ChargeTransaction[]> {
    const clinicId = this.clinicContext.getClinicId();
    const overrideDays = await this.settingsService.getNumber(
      'aiChargeAssociationLookbackDays',
      0,
    );
    const effectiveDays = overrideDays > 0 ? overrideDays : sinceDays;

    const end = endDate ? new Date(endDate) : new Date();
    const startMs = end.getTime() - effectiveDays * 24 * 60 * 60 * 1000;
    const startStr = new Date(startMs).toISOString();

    let clinicFilter = '';
    const clinicParams: unknown[] = [];
    if (clinicId) {
      clinicFilter = ' AND c.clinicId = ?';
      clinicParams.push(clinicId);
    }

    const rows = this.dbService.prepare(
      `SELECT
         c.id AS chargeId,
         ci.treatmentId,
         ci.name,
         tc.code AS treatmentCatalogCode
       FROM Charge c
       INNER JOIN ChargeItem ci ON ci.chargeId = c.id
       LEFT JOIN Treatment t ON t.id = ci.treatmentId
       LEFT JOIN TreatmentCatalog tc ON tc.id = t.treatmentCatalogId
       WHERE c.status IN ('PAID', 'PARTIAL')
         AND c.createdAt >= ?
         AND c.deletedAt IS NULL
         AND ci.deletedAt IS NULL
         ${clinicFilter}
       ORDER BY c.id`
    ).all(startStr, ...clinicParams) as Array<{
      chargeId: string;
      treatmentId?: string;
      name: string;
      treatmentCatalogCode?: string;
    }>;

    const txMap = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = normalizeItemKey({
        treatmentCatalogCode: r.treatmentCatalogCode,
        name: r.name,
      });
      if (!txMap.has(r.chargeId)) {
        txMap.set(r.chargeId, new Set());
      }
      txMap.get(r.chargeId)!.add(key);
    }

    const result: ChargeTransaction[] = [];
    txMap.forEach((keySet, chargeId) => {
      result.push({ chargeId, keys: [...keySet] });
    });
    return result;
  }

  // ===========================================================================
  // 3. buildFrequentItemsets (pure, testable)
  // ===========================================================================
  buildFrequentItemsets(
    transactions: ChargeTransaction[],
    options: BuildFrequentOptions = {},
  ): Map<string, FrequentItemsetInfo> {
    const T = transactions.length;
    if (T === 0) return new Map();

    const minSupport = options.minSupport ?? MIN_SUPPORT_DEFAULT;
    const maxSetSize = Math.max(1, options.maxSetSize ?? MAX_SET_SIZE_DEFAULT);
    const minSupportCountParam = options.minSupportCount ?? MIN_SUPPORT_COUNT_DEFAULT;
    const maxItems = options.maxItems ?? MAX_ITEMS_DEFAULT;
    const minThreshold = Math.max(minSupportCountParam, Math.ceil(minSupport * T));

    const freq = new Map<string, FrequentItemsetInfo>();

    // Step 1: C1 -> L1
    const c1Count = new Map<string, number>();
    for (const tx of transactions) {
      for (const k of tx.keys) {
        c1Count.set(k, (c1Count.get(k) ?? 0) + 1);
      }
    }

    let totalCandidates = 0;
    const L1: string[][] = [];
    for (const [k, count] of c1Count.entries()) {
      if (count >= minThreshold) {
        const itemset = [k];
        const key = encodeJsonKeys(itemset);
        freq.set(key, { count, keys: itemset });
        L1.push(itemset);
        totalCandidates++;
      }
    }

    let prevL = L1;

    // Step 2: L(k) -> C(k+1) -> L(k+1)
    for (let k = 1; k < maxSetSize; k++) {
      if (prevL.length === 0) break;
      const nextSize = k + 1;

      // self-join: combine two itemsets of size k that share prefix k-1
      const Cnext = new Map<string, string[]>();
      for (let i = 0; i < prevL.length; i++) {
        for (let j = i + 1; j < prevL.length; j++) {
          const a = prevL[i];
          const b = prevL[j];
          let sharePrefix = true;
          for (let p = 0; p < k - 1; p++) {
            if (a[p] !== b[p]) { sharePrefix = false; break; }
          }
          if (!sharePrefix) continue;
          if (k === 1 || a[k - 1] < b[k - 1]) {
            const combined = sortKeys([...a, b[k - 1]]);
            if (combined.length === nextSize) {
              const cKey = encodeJsonKeys(combined);
              if (!Cnext.has(cKey)) Cnext.set(cKey, combined);
            }
          }
        }
      }

      // prune: any (k)-subset must be in prevL (represented in freq)
      const prunedCandidates = new Map<string, string[]>();
      for (const [ck, itemset] of Cnext.entries()) {
        let valid = true;
        const subsets = combinations(itemset, k);
        for (const ss of subsets) {
          const ssKey = encodeJsonKeys(ss);
          if (!freq.has(ssKey)) { valid = false; break; }
        }
        if (valid) prunedCandidates.set(ck, itemset);
      }

      if (totalCandidates + prunedCandidates.size > maxItems) {
        this.chargeAssistantLogger.warn(
          `[Apriori] candidate count (${totalCandidates + prunedCandidates.size}) exceeds maxItems=${maxItems}, break early`
        );
        break;
      }
      totalCandidates += prunedCandidates.size;

    // count support (precompute tx sets for speed)
      const txSets: Set<string>[] = transactions.map(tx => new Set(tx.keys));
      const nextL: string[][] = [];
      for (const [ck, itemset] of prunedCandidates.entries()) {
        let sup = 0;
        for (let txi = 0; txi < txSets.length; txi++) {
          const txSet = txSets[txi];
          let allIn = true;
          for (const ik of itemset) {
            if (!txSet.has(ik)) { allIn = false; break; }
          }
          if (allIn) sup++;
        }
        if (sup >= minThreshold) {
          freq.set(ck, { count: sup, keys: itemset });
          nextL.push(itemset);
        }
      }
      prevL = nextL;
    }

    return freq;
  }

  // ===========================================================================
  // 4. generateRules (pure, testable)
  // ===========================================================================
  generateRules(
    frequentItemSets: Map<string, FrequentItemsetInfo>,
    transactions: ChargeTransaction[],
    options: GenerateRuleOptions = {},
  ): AssociationRule[] {
    const T = transactions.length;
    if (T === 0 || frequentItemSets.size === 0) return [];

    const minConfidence = options.minConfidence ?? MIN_CONFIDENCE_DEFAULT;
    const minLift = options.minLift ?? MIN_LIFT_DEFAULT;

    const rules: AssociationRule[] = [];
    for (const info of frequentItemSets.values()) {
      const I = info.keys;
      if (I.length < 2) continue;
      const freqI = info.count;
      const supI = freqI / T;

      for (let sizeA = 1; sizeA < I.length; sizeA++) {
        const antecedentCombos = combinations(I, sizeA);
        for (const A of antecedentCombos) {
          const keyA = encodeJsonKeys(A);
          const freqA = frequentItemSets.get(keyA)?.count ?? 0;
          if (freqA === 0) continue;
          const B = I.filter(k => !A.includes(k));
          if (B.length !== 1) continue;
          const consequentKey = B[0];
          const keyB = encodeJsonKeys(B);
          const freqB = frequentItemSets.get(keyB)?.count ?? 1;
          const conf = freqI / freqA;
          const probB = freqB / T;
          const lift = probB > 0 ? conf / probB : 0;
          if (conf >= minConfidence && lift >= minLift) {
            rules.push({
              antecedent: A,
              consequent: consequentKey,
              support: supI,
              confidence: conf,
              lift,
              supportCount: freqI,
              totalTransactions: T,
            });
          }
        }
      }
    }
    return rules;
  }

  // ===========================================================================
  // 5. upsertRules
  // ===========================================================================
  upsertRules(rules: AssociationRule[], transactions: ChargeTransaction[]): UpsertStats {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { added: 0, updated: 0, deleted: 0 };
    }
    const totalT = transactions.length;
    const now = new Date().toISOString();

    const { added, updated, deleted } = this.dbService.transaction((db) => {
      const existingMap = new Map<string, string>();
      const existingRows = db.prepare(
        `SELECT id, antecedent, consequent FROM ChargeAssociationRule WHERE clinicId = ?`
      ).all(clinicId) as Array<{ id: string; antecedent: string; consequent: string }>;
      for (const r of existingRows) {
        existingMap.set(`${r.antecedent}||${r.consequent}`, r.id);
      }

      const keptRuleKeys = new Set<string>();
      let addedCount = 0;
      let updatedCount = 0;

      const insertStmt = db.prepare(
        `INSERT INTO ChargeAssociationRule (
          id, clinicId, antecedent, consequent, antecedentSize,
          support, confidence, lift, supportCount, totalTransactions,
          updatedAt, computedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const updateStmt = db.prepare(
        `UPDATE ChargeAssociationRule SET
           support = ?, confidence = ?, lift = ?,
           supportCount = ?, totalTransactions = ?,
           updatedAt = ?, computedAt = ?
         WHERE id = ?`
      );

      for (const rule of rules) {
        const antecedentStr = encodeJsonKeys(rule.antecedent);
        const consequentStr = rule.consequent;
        const ruleKey = `${antecedentStr}||${consequentStr}`;
        keptRuleKeys.add(ruleKey);
        const existingId = existingMap.get(ruleKey);
        if (existingId) {
          updateStmt.run(
            rule.support, rule.confidence, rule.lift,
            rule.supportCount, rule.totalTransactions,
            now, now,
            existingId,
          );
          updatedCount++;
        } else {
          const id = crypto.randomUUID();
          insertStmt.run(
            id, clinicId, antecedentStr, consequentStr, rule.antecedent.length,
            rule.support, rule.confidence, rule.lift,
            rule.supportCount, totalT,
            now, now,
          );
          addedCount++;
        }
      }

      let deletedCount = 0;
      const deleteStmt = db.prepare(`UPDATE ChargeAssociationRule SET deletedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ? AND clinicId = ? AND deletedAt IS NULL`);
      for (const [k, existingId] of existingMap.entries()) {
        if (!keptRuleKeys.has(k)) {
          deleteStmt.run(existingId, clinicId);
          deletedCount++;
        }
      }

      return { added: addedCount, updated: updatedCount, deleted: deletedCount };
    });

    return { added, updated, deleted };
  }

  // ===========================================================================
  // 6. recommendChargeItems
  // ===========================================================================
  async recommendChargeItems(
    selectedKeys: string[],
    options: { topK?: number; maxAntecedentSize?: number } = {},
  ): Promise<RecommendationResult[]> {
    const clinicId = this.clinicContext.getClinicId();
    const topK = Math.max(1, options.topK ?? 3);
    const maxAntecedentSize = Math.max(1, options.maxAntecedentSize ?? MAX_ANTECEDENT_SIZE_DEFAULT);

    const enabled = await this.settingsService.getBoolean('aiChargeAssistantEnabled', true);
    if (!enabled || !clinicId || selectedKeys.length === 0) {
      return [];
    }

    const S = sortKeys(selectedKeys.map(k => k.trim()));
    const SSet = new Set(S);

    const subsets = allNonEmptySubsets(S, maxAntecedentSize);
    if (subsets.length === 0) return [];

    const placeholders = subsets.map(() => '?').join(',');
    const subsetJsons = subsets.map(s => encodeJsonKeys(s));

    const rows = this.dbService.prepare(
      `SELECT r.* FROM ChargeAssociationRule r
       WHERE r.clinicId = ?
         AND r.antecedent IN (${placeholders})
       ORDER BY r.antecedentSize DESC, r.confidence DESC, r.lift DESC
       LIMIT ${topK * 10}`
    ).all(clinicId, ...subsetJsons) as Array<{
      id: string; clinicId: string; antecedent: string; consequent: string;
      antecedentSize: number; support: number; confidence: number; lift: number;
      supportCount: number; totalTransactions: number;
      updatedAt: string; computedAt: string;
    }>;

    const ignoreCheckPairs: Array<{ ante: string; cons: string }> = [];
    for (const r of rows) {
      ignoreCheckPairs.push({ ante: r.antecedent, cons: r.consequent });
    }
    const ignoredSet = new Set<string>();
    if (ignoreCheckPairs.length > 0) {
      const ignorePlaceholders = ignoreCheckPairs.map(() => '(?, ?)').join(',');
      const ignoreParams: unknown[] = [];
      for (const p of ignoreCheckPairs) {
        ignoreParams.push(p.ante, p.cons);
      }
      const ignoredRows = this.dbService.prepare(
        `SELECT antecedent, consequent FROM ChargeAssociationIgnore
         WHERE clinicId = ? AND (antecedent, consequent) IN (${ignorePlaceholders})`
      ).all(clinicId, ...ignoreParams) as Array<{ antecedent: string; consequent: string }>;
      for (const ig of ignoredRows) {
        ignoredSet.add(`${ig.antecedent}||${ig.consequent}`);
      }
    }

    const results: RecommendationResult[] = [];
    const seenConsequent = new Set<string>();
    for (const r of rows) {
      if (SSet.has(r.consequent)) continue;
      const igKey = `${r.antecedent}||${r.consequent}`;
      if (ignoredSet.has(igKey)) continue;
      if (seenConsequent.has(r.consequent)) continue;
      seenConsequent.add(r.consequent);

      let antecedentParsed: string[] = [];
      try { antecedentParsed = JSON.parse(r.antecedent) as string[]; } catch { /* noop */ }

      const ruleRecord: RuleRecord = {
        id: r.id,
        clinicId: r.clinicId,
        antecedent: antecedentParsed,
        consequent: r.consequent,
        antecedentSize: r.antecedentSize,
        support: r.support,
        confidence: r.confidence,
        lift: r.lift,
        supportCount: r.supportCount,
        totalTransactions: r.totalTransactions,
        createdAt: ((r as Record<string, unknown>).createdAt as string | undefined) ?? r.computedAt ?? r.updatedAt,
        updatedAt: r.updatedAt,
        computedAt: r.computedAt,
      };
      results.push({
        rule: ruleRecord,
        key: r.consequent,
        itemNameHint: keyToNameHint(r.consequent),
        confidence: r.confidence,
        lift: r.lift,
      });
      if (results.length >= topK) break;
    }
    return results;
  }

  // ===========================================================================
  // 7. ignoreRecommendation
  // ===========================================================================
  ignoreRecommendation(
    antecedentKeys: string[],
    consequentKey: string,
    operatorId?: string,
  ): void {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return;

    const antecedentStr = encodeJsonKeys(antecedentKeys);
    const now = new Date().toISOString();
    const opId = operatorId ?? this.clinicContext.getClinicId() ?? 'system';
    const id = crypto.randomUUID();

    this.dbService.transaction((db: IDatabase) => {
      const existing = db.prepare(
        `SELECT id, clinicId, antecedent, consequent FROM ChargeAssociationIgnore
         WHERE clinicId = ? AND antecedent = ? AND consequent = ?`
      ).get(clinicId, antecedentStr, consequentKey);
      if (!existing) {
        db.prepare(
          `INSERT INTO ChargeAssociationIgnore (id, clinicId, antecedent, consequent, ignoredAt, ignoredBy)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, clinicId, antecedentStr, consequentKey, now, opId);
        this.logAudit(db, AuditLogType.CHARGE_ASSISTANT_IGNORE, id, 'ChargeAssociationIgnore', {
          afterData: { antecedentKeys, consequentKey },
          operatorId: opId,
        });
      }
    });
  }

  // ===========================================================================
  // 8. rebuildRecommendations
  // ===========================================================================
  async rebuildRecommendations(sinceDays?: number): Promise<RebuildStats> {
    const clinicId = this.clinicContext.getClinicId() ?? undefined;
    const effectiveSinceDays = sinceDays ?? DEFAULT_LOOKBACK_DAYS;

    this.chargeAssistantLogger.log(
      `[ChargeAssistant] rebuildRecommendations start sinceDays=${effectiveSinceDays} clinicId=${clinicId ?? 'N/A'}`
    );

    const transactions = await this.fetchTransactions(effectiveSinceDays);
    const T = transactions.length;

    const minSupport = MIN_SUPPORT_DEFAULT;
    const maxSetSize = MAX_SET_SIZE_DEFAULT;
    const minSupportCount = await this.settingsService.getNumber(
      'aiChargeMinSupportCount',
      MIN_SUPPORT_COUNT_DEFAULT,
    );
    const minConfidence = await this.settingsService.getNumber(
      'aiChargeMinConfidence',
      MIN_CONFIDENCE_DEFAULT,
    );
    const minLift = MIN_LIFT_DEFAULT;

    const frequentItemsets = this.buildFrequentItemsets(transactions, {
      minSupport, maxSetSize, minSupportCount, maxItems: MAX_ITEMS_DEFAULT,
    });
    const rules = this.generateRules(frequentItemsets, transactions, {
      minConfidence, minLift,
    });

    let mockDemoInserted = false;
    if (T < 30) {
      mockDemoInserted = this.buildMockDemoRules();
    }

    const upsertStats = this.upsertRules(rules, transactions);

    const stats: RebuildStats = {
      transactions: T,
      frequentItemsets: frequentItemsets.size,
      rules: rules.length,
      mockDemoInserted,
      upsert: upsertStats,
      sinceDays: effectiveSinceDays,
    };

    try {
      const opId = this.clinicContext.getClinicId() ?? 'system';
      this.logAudit(this.dbService, AuditLogType.CHARGE_ASSISTANT_REBUILT,
        crypto.randomUUID(), 'ChargeAssistant', {
          afterData: stats,
          remark: `ChargeAssistant rebuilt clinicId=${clinicId ?? 'N/A'}`,
          operatorId: opId,
        });
    } catch (err) {
      this.chargeAssistantLogger.warn('rebuild audit write failed:',
        err instanceof Error ? err.message : String(err));
    }

    this.chargeAssistantLogger.log(
      `[ChargeAssistant] rebuildRecommendations done: T=${T} itemsets=${frequentItemsets.size} ` +
      `rules=${rules.length} added=${upsertStats.added} updated=${upsertStats.updated} ` +
      `deleted=${upsertStats.deleted} mock=${mockDemoInserted}`
    );
    return stats;
  }

  // ===========================================================================
  // 9. buildMockDemoRules
  // ===========================================================================
  buildMockDemoRules(): boolean {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return false;

    const demos: Array<{ ante: NormalizeItemInput[]; cons: NormalizeItemInput; conf: number; lift: number }> = [
      { ante: [{ name: '洁牙' }], cons: { name: '抛光' }, conf: 0.85, lift: 2.1 },
      { ante: [{ name: '洁牙' }, { name: '抛光' }], cons: { name: '上药' }, conf: 0.78, lift: 1.8 },
      { ante: [{ name: '洁牙' }], cons: { name: '上药' }, conf: 0.62, lift: 1.5 },
      { ante: [{ treatmentCatalogCode: 'RCT-001' }], cons: { name: '打桩' }, conf: 0.72, lift: 2.3 },
      { ante: [{ treatmentCatalogCode: 'RCT-001' }, { name: '打桩' }], cons: { name: '牙冠' }, conf: 0.88, lift: 3.2 },
      { ante: [{ treatmentCatalogCode: 'RCT-001' }], cons: { name: '牙冠' }, conf: 0.65, lift: 2.4 },
      { ante: [{ name: '拔牙' }], cons: { name: '止血棉' }, conf: 0.92, lift: 4.5 },
      { ante: [{ name: '拔牙' }, { name: '止血棉' }], cons: { name: '消炎药' }, conf: 0.81, lift: 2.0 },
      { ante: [{ name: '拔牙' }, { name: '止血棉' }, { name: '消炎药' }], cons: { name: '止痛药' }, conf: 0.75, lift: 1.9 },
      { ante: [{ name: '拔牙' }], cons: { name: '消炎药' }, conf: 0.68, lift: 1.7 },
      { ante: [{ name: '拔牙' }], cons: { name: '止痛药' }, conf: 0.58, lift: 1.4 },
      { ante: [{ name: '烤瓷冠' }], cons: { name: '粘接' }, conf: 0.86, lift: 3.5 },
      { ante: [{ name: '烤瓷冠' }, { name: '粘接' }], cons: { name: '试戴' }, conf: 0.82, lift: 2.8 },
      { ante: [{ name: '烤瓷冠' }], cons: { name: '试戴' }, conf: 0.60, lift: 2.0 },
      { ante: [{ name: '充填' }], cons: { name: '酸蚀' }, conf: 0.88, lift: 3.8 },
      { ante: [{ name: '充填' }, { name: '酸蚀' }], cons: { name: '抛光' }, conf: 0.84, lift: 2.9 },
      { ante: [{ name: '充填' }], cons: { name: '抛光' }, conf: 0.66, lift: 2.2 },
      { ante: [{ name: '根管治疗' }], cons: { name: 'X光片' }, conf: 0.90, lift: 2.5 },
      { ante: [{ name: '种植体植入' }], cons: { name: '愈合基台' }, conf: 0.83, lift: 3.6 },
      { ante: [{ name: '正畸矫治器' }], cons: { name: '托槽粘接' }, conf: 0.77, lift: 3.0 },
    ];

    const now = new Date().toISOString();
    const totalT = 100;
    let inserted = 0;
    this.dbService.transaction((db) => {
      const insertStmt = db.prepare(
        `INSERT INTO ChargeAssociationRule (
          id, clinicId, antecedent, consequent, antecedentSize,
          support, confidence, lift, supportCount, totalTransactions,
          createdAt, updatedAt, computedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < demos.length; i++) {
        const d = demos[i];
        const anteKeys = sortKeys(d.ante.map(a => normalizeItemKey(a)));
        const consKey = normalizeItemKey(d.cons);
        const antecedentStr = encodeJsonKeys(anteKeys);
        const existing = db.prepare(
          `SELECT id, clinicId, antecedent, consequent FROM ChargeAssociationRule
           WHERE clinicId = ? AND antecedent = ? AND consequent = ?`
        ).get(clinicId, antecedentStr, consKey);
        if (existing) continue;
        const ruleKeyStr = anteKeys.join('|') + '->' + consKey;
        const hashId = Buffer.from(ruleKeyStr).toString('base64').slice(0, 18);
        const id = `mock-rule-${String(i).padStart(2, '0')}-${hashId}`;
        const sup = d.conf * 0.5;
        const supCount = Math.max(5, Math.round(sup * totalT));
        try {
          insertStmt.run(
            id, clinicId, antecedentStr, consKey, anteKeys.length,
            sup, d.conf, d.lift, supCount, totalT, now, now, now,
          );
          inserted++;
        } catch (e) {
          this.chargeAssistantLogger.warn(`[buildMockDemoRules] insert failed for ${ruleKeyStr}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
    return inserted > 0;
  }

  // ===========================================================================
  // 10. listRules (分页)
  // ===========================================================================
  async listRules(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{ items: RuleRecord[]; total: number; page: number; pageSize: number }> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { items: [], total: 0, page, pageSize };
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeSize = Math.min(200, Math.max(1, Math.floor(Number(pageSize) || 50)));
    const offset = (safePage - 1) * safeSize;

    const totalRow = this.dbService.prepare(
      `SELECT COUNT(*) AS c FROM ChargeAssociationRule WHERE clinicId = ?`
    ).get(clinicId) as { c?: number; count?: number; total?: number };
    const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.total ?? 0);

    const rows = this.dbService.prepare(
      `SELECT * FROM ChargeAssociationRule
       WHERE clinicId = ?
       ORDER BY antecedentSize DESC, confidence DESC, lift DESC, supportCount DESC
       LIMIT ? OFFSET ?`
    ).all(clinicId, safeSize, offset) as Array<{
      id: string; clinicId: string; antecedent: string; consequent: string;
      antecedentSize: number; support: number; confidence: number; lift: number;
      supportCount: number; totalTransactions: number;
      updatedAt: string; computedAt: string;
    }>;

    const items: RuleRecord[] = rows.map(r => {
      let antecedentParsed: string[] = [];
      try { antecedentParsed = JSON.parse(r.antecedent) as string[]; } catch { /* noop */ }
      return {
        id: r.id, clinicId: r.clinicId,
        antecedent: antecedentParsed, consequent: r.consequent,
        antecedentSize: r.antecedentSize, support: r.support,
        confidence: r.confidence, lift: r.lift,
        supportCount: r.supportCount, totalTransactions: r.totalTransactions,
        createdAt: ((r as Record<string, unknown>).createdAt as string | undefined) ?? r.computedAt ?? r.updatedAt,
        updatedAt: r.updatedAt, computedAt: r.computedAt,
      };
    });
    return { items, total, page: safePage, pageSize: safeSize };
  }
}

export { encodeJsonKeys, sortKeys, keyToNameHint, combinations, allNonEmptySubsets };
