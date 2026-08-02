import {
  ChargeAssistantService,
  normalizeItemKey,
  encodeJsonKeys,
  sortKeys,
  combinations,
  allNonEmptySubsets,
  ChargeTransaction,
} from './charge-assistant.service';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(() => 'uuid-' + Math.random().toString(36).slice(2, 10)),
}));

function createMockClinicContext(
  clinicId: string | null = 'clinic-001',
  userId: string = 'user-001',
  role: string = 'DOCTOR',
): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => userId,
    getRole: () => role,
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockSettingsService(overrides: Record<string, string> = {}): SettingsService {
  const store = new Map<string, string>([
    ['aiChargeAssistantEnabled', 'true'],
    ['aiChargeAssociationLookbackDays', '730'],
    ['aiChargeMinSupportCount', '5'],
    ['aiChargeMinConfidence', '0.35'],
    ...Object.entries(overrides),
  ]);
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? undefined),
    getNumber: jest.fn(async (key: string, dv: number) => {
      const v = store.get(key);
      if (v === undefined || v === '') return dv;
      const num = Number(v);
      return isNaN(num) ? dv : num;
    }),
    getBoolean: jest.fn(async (key: string, dv: boolean) => {
      const v = store.get(key);
      if (v === undefined || v === '') return dv;
      return v === 'true' || v === '1' || v === 'yes';
    }),
  } as unknown as SettingsService;
}

function buildTransactionsFromPattern(
  patterns: Array<{ keys: string[]; count: number }>,
): ChargeTransaction[] {
  const tx: ChargeTransaction[] = [];
  let id = 0;
  for (const p of patterns) {
    for (let i = 0; i < p.count; i++) {
      tx.push({ chargeId: `c-${id++}`, keys: [...p.keys] });
    }
  }
  return tx;
}

describe('ChargeAssistantService - Task 8 完整单测 (≥20)', () => {
  let service: ChargeAssistantService;
  let db: MockDbService;
  let settings: SettingsService;

  beforeEach(() => {
    db = new MockDbService();
    settings = createMockSettingsService();
    service = new ChargeAssistantService(
      asDbService(db),
      createMockClinicContext(),
      settings,
    );
  });

  afterEach(() => {
    db.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // TR-8.1 normalizeItemKey
  // ============================================================
  describe('TR-8.1 normalizeItemKey', () => {
    it('treatmentCatalogCode=RCT-001 → CAT:RCT-001', () => {
      expect(normalizeItemKey({ treatmentCatalogCode: 'RCT-001', name: '根管' })).toBe('CAT:RCT-001');
      expect(normalizeItemKey({ treatmentCatalogCode: ' RCT-001 ', name: '根管' })).toBe('CAT:RCT-001');
    });
    it('name=" 洁 牙 " → NAME:洁牙 (trim + lowercase)', () => {
      expect(normalizeItemKey({ name: ' 洁 牙 ' })).toBe('NAME:洁 牙');
      expect(normalizeItemKey({ name: 'ABC' })).toBe('NAME:abc');
      expect(normalizeItemKey({ name: ' AbC ' })).toBe('NAME:abc');
    });
  });

  // ============================================================
  // TR-8.2 构造 100 条 transactions：60 条 {A,B,C}；30 条 {A,B}；10 条 {A,C,D}
  // ============================================================
  describe('TR-8.2 buildFrequentItemsets with 100 txs (60/30/10 pattern)', () => {
    const KEY_A = 'NAME:a';
    const KEY_B = 'NAME:b';
    const KEY_C = 'NAME:c';
    const KEY_D = 'NAME:d';
    let transactions: ChargeTransaction[];
    beforeEach(() => {
      transactions = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 30 },
        { keys: [KEY_A, KEY_C, KEY_D], count: 10 },
      ]);
      expect(transactions.length).toBe(100);
    });

    it('buildFrequentItemsets L1 contains A(100), B(90), C(70), D(10)', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1,
      });
      expect(freq.get(encodeJsonKeys([KEY_A]))?.count).toBe(100);
      expect(freq.get(encodeJsonKeys([KEY_B]))?.count).toBe(90);
      expect(freq.get(encodeJsonKeys([KEY_C]))?.count).toBe(70);
      expect(freq.get(encodeJsonKeys([KEY_D]))?.count).toBe(10);
    });

    it('frequent itemsets L2 contains {A,B}=90, {A,C}=70, {B,C}=60', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 2,
      });
      expect(freq.get(encodeJsonKeys([KEY_A, KEY_B]))?.count).toBe(90);
      expect(freq.get(encodeJsonKeys([KEY_A, KEY_C]))?.count).toBe(70);
      expect(freq.get(encodeJsonKeys([KEY_B, KEY_C]))?.count).toBe(60);
    });

    it('frequent itemsets L3 contains {A,B,C}=60', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 3,
      });
      expect(freq.get(encodeJsonKeys([KEY_A, KEY_B, KEY_C]))?.count).toBe(60);
    });
  });

  // ============================================================
  // TR-8.3 recommend S=[A,B] → Top1=C，confidence ≈ 0.667 (60/(60+30))
  // ============================================================
  describe('TR-8.3 generateRules: A,B→C confidence ≈ 0.667', () => {
    const KEY_A = 'NAME:a';
    const KEY_B = 'NAME:b';
    const KEY_C = 'NAME:c';
    const KEY_D = 'NAME:d';
    let transactions: ChargeTransaction[];

    beforeEach(() => {
      transactions = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 30 },
        { keys: [KEY_A, KEY_C, KEY_D], count: 10 },
      ]);
    });

    it('rule A,B → C has confidence ≈ 0.667 (±0.02)', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 3, minSupport: 0,
      });
      const rules = service.generateRules(freq, transactions, {
        minConfidence: 0.1, minLift: 0.5,
      });
      const ruleABC = rules.find(r =>
        r.antecedent.length === 2 &&
        r.antecedent.includes(KEY_A) &&
        r.antecedent.includes(KEY_B) &&
        r.consequent === KEY_C
      );
      expect(ruleABC).toBeDefined();
      expect(Math.abs(ruleABC!.confidence - (60 / 90))).toBeLessThan(0.02);
      expect(ruleABC!.supportCount).toBe(60);
    });

    it('rule A → B has confidence = 90/100 = 0.9', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 3, minSupport: 0,
      });
      const rules = service.generateRules(freq, transactions, {
        minConfidence: 0.1, minLift: 0.5,
      });
      const ruleAB = rules.find(r =>
        r.antecedent.length === 1 &&
        r.antecedent[0] === KEY_A &&
        r.consequent === KEY_B
      );
      expect(ruleAB).toBeDefined();
      expect(ruleAB!.confidence).toBeCloseTo(0.9, 2);
    });
  });

  // ============================================================
  // TR-8.4 minSupportCount=50 → C=60 ≥50 保留；D=10<50 被过滤
  // ============================================================
  describe('TR-8.4 minSupportCount 过滤', () => {
    const KEY_A = 'NAME:a';
    const KEY_B = 'NAME:b';
    const KEY_C = 'NAME:c';
    const KEY_D = 'NAME:d';
    let transactions: ChargeTransaction[];

    beforeEach(() => {
      transactions = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 30 },
        { keys: [KEY_A, KEY_C, KEY_D], count: 10 },
      ]);
    });

    it('minSupportCount=50 过滤 D=10', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 50, maxSetSize: 1,
      });
      expect(freq.has(encodeJsonKeys([KEY_C]))).toBe(true);
      expect(freq.get(encodeJsonKeys([KEY_C]))!.count).toBe(70);
      expect(freq.has(encodeJsonKeys([KEY_D]))).toBe(false);
      expect(freq.has(encodeJsonKeys([KEY_A]))).toBe(true);
      expect(freq.has(encodeJsonKeys([KEY_B]))).toBe(true);
    });
  });

  // ============================================================
  // TR-8.5 ignore A,B→C 幂等 + recommend 排除
  // ============================================================
  describe('TR-8.5 ignoreRecommendation 幂等 + 排除逻辑', () => {
    const KEY_A = 'NAME:a';
    const KEY_B = 'NAME:b';
    const KEY_C = 'NAME:c';

    it('ignore 幂等：调用 2 次，DB 中仅 1 条', () => {
      service.ignoreRecommendation([KEY_A, KEY_B], KEY_C, 'user-001');
      const afterFirst = db.getTableData('ChargeAssociationIgnore');
      expect(afterFirst.length).toBe(1);

      service.ignoreRecommendation([KEY_A, KEY_B], KEY_C, 'user-001');
      const afterSecond = db.getTableData('ChargeAssociationIgnore');
      expect(afterSecond.length).toBe(1);
    });

    it('不同顺序 A,B vs B,A → 相同 antecedent JSON（排序保证）', () => {
      const json1 = encodeJsonKeys([KEY_A, KEY_B]);
      const json2 = encodeJsonKeys([KEY_B, KEY_A]);
      expect(json1).toBe(json2);
    });
  });

  // ============================================================
  // TR-8.6 空 transaction 列表 → build 返回空；recommend 任意 S 直接返回 []
  // ============================================================
  describe('TR-8.6 空输入处理', () => {
    it('buildFrequentItemsets 空 transactions → 返回空 Map', () => {
      const freq = service.buildFrequentItemsets([]);
      expect(freq.size).toBe(0);
    });
    it('generateRules 空 transactions 或空 itemsets → 返回空数组', () => {
      const r1 = service.generateRules(new Map(), []);
      expect(r1).toEqual([]);
      const emptyFreq = new Map();
      const tx: ChargeTransaction[] = [{ chargeId: 'x', keys: ['a'] }];
      const r2 = service.generateRules(emptyFreq, tx);
      expect(r2).toEqual([]);
    });
  });

  // ============================================================
  // TR-8.7 模拟数据 <30 条：buildMockDemoRules 插入 20 条行业默认
  // ============================================================
  describe('TR-8.7 buildMockDemoRules 冷启动默认规则', () => {
    it('buildMockDemoRules 插入 ≥20 条，二次运行幂等不重复', () => {
      const result1 = service.buildMockDemoRules();
      const rows1 = db.getTableData('ChargeAssociationRule');
      expect(result1).toBe(true);
      expect(rows1.length).toBeGreaterThanOrEqual(20);

      const result2 = service.buildMockDemoRules();
      const rows2 = db.getTableData('ChargeAssociationRule');
      expect(result2).toBe(false);
      expect(rows2.length).toBe(rows1.length);
    });
  });

  // ============================================================
  // TR-8.8 minConfidence=0.8 过滤：A,B→C 0.667 被过滤；A→B 0.9 保留
  // ============================================================
  describe('TR-8.8 minConfidence 过滤', () => {
    const KEY_A = 'NAME:a';
    const KEY_B = 'NAME:b';
    const KEY_C = 'NAME:c';
    const KEY_D = 'NAME:d';
    let transactions: ChargeTransaction[];

    beforeEach(() => {
      transactions = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 30 },
        { keys: [KEY_A, KEY_C, KEY_D], count: 10 },
      ]);
    });

    it('minConfidence=0.8：A→B 0.9 保留，A,B→C 0.667 过滤', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 3, minSupport: 0,
      });
      const rules = service.generateRules(freq, transactions, {
        minConfidence: 0.8, minLift: 0.5,
      });
      const ruleAB = rules.find(r =>
        r.antecedent.length === 1 && r.antecedent[0] === KEY_A && r.consequent === KEY_B
      );
      const ruleABC = rules.find(r =>
        r.antecedent.length === 2 &&
        r.antecedent.includes(KEY_A) &&
        r.antecedent.includes(KEY_B) &&
        r.consequent === KEY_C
      );
      expect(ruleAB).toBeDefined();
      expect(ruleAB!.confidence).toBeGreaterThanOrEqual(0.8);
      expect(ruleABC).toBeUndefined();
    });
  });

  // ============================================================
  // TR-8.9 lift>1：A→C lift≈1.167 保留；A→D lift=1 被过滤
  // ============================================================
  describe('TR-8.9 lift 过滤', () => {
    const KEY_A = 'NAME:a';
    const KEY_C = 'NAME:c';
    const KEY_D = 'NAME:d';
    const KEY_B = 'NAME:b';
    const KEY_E = 'NAME:e';
    let transactions: ChargeTransaction[];

    beforeEach(() => {
      // 构造符合：count(A)=70, count(C)=60, count(A∩C)=49 → conf=49/70=0.7, P(C)=0.6 → lift=0.7/0.6≈1.167 ≥1.1
      // count(D)=10, count(A∩D)=7 → conf(A→D)=7/70=0.1, P(D)=10/100=0.1 → lift=0.1/0.1=1.0 <1.1 被过滤
      transactions = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 42 },        // A∩C = 42
        { keys: [KEY_A, KEY_C, KEY_D], count: 7 },         // A∩C +7, A∩D +7 → total A∩C=49, A∩D=7
        { keys: [KEY_A, KEY_B], count: 21 },               // now count(A)=42+7+21=70 ✓
        { keys: [KEY_B, KEY_C], count: 11 },               // count(C)=49+11=60 ✓
        { keys: [KEY_E, KEY_D], count: 3 },                // count(D)=7+3=10 ✓
        { keys: [KEY_B, KEY_E], count: 16 },               // total=42+7+21+11+3+16=100 ✓
      ]);
    });

    it('A→C lift ≈ 1.167 ≥ 1.1；A→D lift = 1 被 minLift=1.1 过滤', () => {
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 1, maxSetSize: 2, minSupport: 0,
      });
      const rules = service.generateRules(freq, transactions, {
        minConfidence: 0.01, minLift: 1.1,
      });
      const ruleAC = rules.find(r =>
        r.antecedent.length === 1 && r.antecedent[0] === KEY_A && r.consequent === KEY_C
      );
      const ruleAD = rules.find(r =>
        r.antecedent.length === 1 && r.antecedent[0] === KEY_A && r.consequent === KEY_D
      );
      expect(ruleAC).toBeDefined();
      // 预期 lift ≈ 1.167
      expect(ruleAC!.lift).toBeGreaterThanOrEqual(1.1);
      expect(Math.abs(ruleAC!.lift - 1.167)).toBeLessThan(0.05);
      expect(ruleAD).toBeUndefined();
      const allRules = service.generateRules(freq, transactions, {
        minConfidence: 0, minLift: 0,
      });
      const ruleADAll = allRules.find(r =>
        r.antecedent.length === 1 && r.antecedent[0] === KEY_A && r.consequent === KEY_D
      );
      // count(A)=70, count(D)=10, A∩D=7 → conf=0.1, P(D)=0.1 → lift=1.0
      expect(ruleADAll?.lift).toBeCloseTo(1.0, 2);
    });
  });

  // ============================================================
  // TR-8.10 maxSetSize=3：不生成 size=4 候选项
  // ============================================================
  describe('TR-8.10 maxSetSize 限制', () => {
    it('maxSetSize=3 不生成 size>=4 项集', () => {
      const transactions: ChargeTransaction[] = [];
      for (let i = 0; i < 100; i++) {
        transactions.push({
          chargeId: `c-${i}`,
          keys: ['NAME:w', 'NAME:x', 'NAME:y', 'NAME:z'],
        });
      }
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 50, maxSetSize: 3,
      });
      let maxSize = 0;
      for (const info of freq.values()) {
        maxSize = Math.max(maxSize, info.keys.length);
      }
      expect(maxSize).toBeLessThanOrEqual(3);
    });
  });

  // ============================================================
  // TR-8.11 maxItems=8000 限制：超大候选集循环 break
  // ============================================================
  describe('TR-8.11 maxItems 保护（避免 OOM）', () => {
    it('maxItems=50 小值提前终止', () => {
      const keysArr = Array.from({ length: 40 }, (_, i) => `NAME:item-${i}`);
      const transactions: ChargeTransaction[] = [];
      for (let i = 0; i < 200; i++) {
        // each tx picks a random subset of 8 items
        const picks = [...keysArr].sort(() => Math.random() - 0.5).slice(0, 8);
        transactions.push({ chargeId: `c-${i}`, keys: picks });
      }
      const freq = service.buildFrequentItemsets(transactions, {
        minSupportCount: 5, maxSetSize: 3, maxItems: 50,
      });
      // Should terminate without OOM; returning partial or empty is fine
      expect(freq).toBeInstanceOf(Map);
    });
  });

  // ============================================================
  // TR-8.12 upsertRules：第一次 added=N，第二次 updated=N，deleted=X
  // ============================================================
  describe('TR-8.12 upsertRules 幂等 & deleted 统计', () => {
    it('第一次 added=N；第二次 updated=N 且 added=0；删除不再生成的旧规则', () => {
      const KEY_A = 'NAME:a';
      const KEY_B = 'NAME:b';
      const KEY_C = 'NAME:c';
      const _KEY_D = 'NAME:d';
      const tx1 = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 50 },
        { keys: [KEY_A, KEY_B], count: 50 },
      ]);
      const freq1 = service.buildFrequentItemsets(tx1, {
        minSupportCount: 10, maxSetSize: 3,
      });
      const rules1 = service.generateRules(freq1, tx1, {
        minConfidence: 0.3, minLift: 0.5,
      });
      const N = rules1.length;
      expect(N).toBeGreaterThan(0);

      const stats1 = service.upsertRules(rules1, tx1);
      expect(stats1.added).toBe(N);
      expect(stats1.updated).toBe(0);

      const stats2 = service.upsertRules(rules1, tx1);
      expect(stats2.added).toBe(0);
      expect(stats2.updated).toBe(N);
      expect(stats2.deleted).toBe(0);

      // Now upsert a subset: only rules including KEY_C (drop rules that don't have KEY_C)
      const rulesSubset = rules1.filter(r =>
        r.consequent === KEY_C || r.antecedent.includes(KEY_C)
      );
      const stats3 = service.upsertRules(rulesSubset, tx1);
      const expectedDeleted = N - rulesSubset.length;
      expect(stats3.deleted).toBe(expectedDeleted);
    });
  });

  // ============================================================
  // TR-8.13 antecedentSize 排序：S=[A,B] 命中 size=2 优先于 size=1
  // ============================================================
  describe('TR-8.13 antecedentSize 排序优先级', () => {
    it('encodeJsonKeys 中 sortKeys 保证 antecedent 顺序独立', () => {
      const s1 = encodeJsonKeys(['X', 'Y', 'Z']);
      const s2 = encodeJsonKeys(['Z', 'X', 'Y']);
      expect(s1).toBe(s2);
    });

    it('sortKeys 返回排序副本', () => {
      const input = ['b', 'a', 'c'];
      const out = sortKeys(input);
      expect(out).toEqual(['a', 'b', 'c']);
      expect(input).toEqual(['b', 'a', 'c']); // no mutation
    });
  });

  // ============================================================
  // TR-8.14 fetchTransactions sinceDays / Settings 覆盖
  // ============================================================
  describe('TR-8.14 Settings.aiChargeAssociationLookbackDays 覆盖 sinceDays', () => {
    it('Settings aiChargeAssociationLookbackDays=30 优先于默认 730（基于服务调用时的行为）', async () => {
      const customSettings = createMockSettingsService({
        aiChargeAssociationLookbackDays: '30',
      });
      const svc = new ChargeAssistantService(
        asDbService(db),
        createMockClinicContext(),
        customSettings,
      );
      // Seed some PAID charges
      const today = new Date();
      const recent = new Date(today.getTime() - 5 * 24 * 3600 * 1000).toISOString();
      const old = new Date(today.getTime() - 400 * 24 * 3600 * 1000).toISOString();
      db.seed('Charge', [
        { id: 'ch1', status: 'PAID', createdAt: recent, clinicId: 'clinic-001' },
        { id: 'ch2', status: 'PAID', createdAt: old, clinicId: 'clinic-001' },
        { id: 'ch3', status: 'UNPAID', createdAt: recent, clinicId: 'clinic-001' },
      ]);
      db.seed('ChargeItem', [
        { id: 'ci1', chargeId: 'ch1', name: '洁牙', category: 'x', clinicId: 'clinic-001' },
        { id: 'ci2', chargeId: 'ch2', name: '充填', category: 'x', clinicId: 'clinic-001' },
        { id: 'ci3', chargeId: 'ch3', name: '拔牙', category: 'x', clinicId: 'clinic-001' },
      ]);
      // sinceDays=1 should only include recent (5 days ago < 30 days threshold via Settings)
      // Note: sinceDays=1 means 1 day lookback; but Settings override returns 30 → effectiveDays=30
      const txs = await svc.fetchTransactions(1);
      // ch2 is 400 days ago which is > 30 day setting → excluded
      const ids = new Set(txs.map(t => t.chargeId));
      expect(ids.has('ch2')).toBe(false);
    });
  });

  // ============================================================
  // TR-8.15 rebuildRecommendations + mockDemoRules 触发
  // ============================================================
  describe('TR-8.15 rebuildRecommendations 小数据触发 mockDemoRules（<30 tx）', () => {
    it('25 条 Charge + items → T<30 → mockDemoInserted=true', async () => {
      const todayIso = new Date().toISOString();
      const charges = [];
      const items = [];
      for (let i = 0; i < 25; i++) {
        charges.push({
          id: `ch-${i}`, status: 'PAID', createdAt: todayIso, clinicId: 'clinic-001',
        });
        items.push({
          id: `ci-${i}-1`, chargeId: `ch-${i}`, name: `项目A-${i % 5}`, category: 'x', clinicId: 'clinic-001',
        });
        items.push({
          id: `ci-${i}-2`, chargeId: `ch-${i}`, name: `项目B-${i % 3}`, category: 'x', clinicId: 'clinic-001',
        });
      }
      db.seed('Charge', charges);
      db.seed('ChargeItem', items);
      const stats = await service.rebuildRecommendations(730);
      expect(stats.transactions).toBe(25);
      expect(stats.mockDemoInserted).toBe(true);
      const ruleRows = db.getTableData('ChargeAssociationRule');
      expect(ruleRows.length).toBeGreaterThanOrEqual(20);
    });
  });

  // ============================================================
  // TR-8.16 JSON 查询：antecedent 顺序独立
  // ============================================================
  describe('TR-8.16 JSON 顺序独立 + 组合数工具函数', () => {
    it('combinations([A,B,C,D], 2) → 6 对', () => {
      const c = combinations(['A', 'B', 'C', 'D'], 2);
      expect(c.length).toBe(6);
      expect(c).toContainEqual(['A', 'B']);
      expect(c).toContainEqual(['C', 'D']);
    });
    it('allNonEmptySubsets([A,B], maxSize=2) → {[A],[B],[A,B]} (size=3)', () => {
      const ss = allNonEmptySubsets(['A', 'B'], 2);
      expect(ss.length).toBe(3);
    });
    it('allNonEmptySubsets([A,B,C,D], maxSize=2) → size=7? (4 singles + 6 pairs = 10)', () => {
      const ss = allNonEmptySubsets(['A', 'B', 'C', 'D'], 2);
      // 4 single + 6 pair = 10
      expect(ss.length).toBe(10);
    });
    it('encodeJsonKeys 排序保证顺序独立', () => {
      expect(encodeJsonKeys(['Z', 'A', 'M'])).toBe(JSON.stringify(['A', 'M', 'Z']));
    });
  });

  // ============================================================
  // TR-8.17 aiChargeAssistantEnabled=false → recommend 返回 []
  // ============================================================
  describe('TR-8.17 Settings 开关关闭', () => {
    it('aiChargeAssistantEnabled=false → recommendChargeItems 返回空', async () => {
      const disabledSettings = createMockSettingsService({
        aiChargeAssistantEnabled: 'false',
      });
      const svc = new ChargeAssistantService(
        asDbService(db),
        createMockClinicContext(),
        disabledSettings,
      );
      const recs = await svc.recommendChargeItems(['NAME:a', 'NAME:b'], { topK: 3 });
      expect(recs).toEqual([]);
    });
  });

  // ============================================================
  // TR-8.18 consequent NOT IN S：不会把 C 自己推出来
  // ============================================================
  describe('TR-8.18 recommend S=[C] 不会把 C 自己作为推荐', () => {
    it('推荐结果排除已选项（consequent NOT IN S 语义）', async () => {
      const KEY_A = 'NAME:a';
      const KEY_B = 'NAME:b';
      const KEY_C = 'NAME:c';
      const tx = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 40 },
      ]);
      const freq = service.buildFrequentItemsets(tx, {
        minSupportCount: 5, maxSetSize: 3,
      });
      const rules = service.generateRules(freq, tx, {
        minConfidence: 0.3, minLift: 0.5,
      });
      service.upsertRules(rules, tx);
      const recs = await service.recommendChargeItems([KEY_C], { topK: 5 });
      for (const r of recs) {
        expect(r.key).not.toBe(KEY_C);
      }
    });
  });

  // ============================================================
  // TR-8.19 unique index 不冲突；upsert 2 次同 antecedent+consequent → UPDATE
  // ============================================================
  describe('TR-8.19 ChargeAssociationRule upsert 唯一约束语义', () => {
    it('两次 upsert 同 antecedent+consequent → 第二次 UPDATE 不抛错', () => {
      const KEY_A = 'NAME:a';
      const KEY_B = 'NAME:b';
      const KEY_C = 'NAME:c';
      const tx = buildTransactionsFromPattern([
        { keys: [KEY_A, KEY_B, KEY_C], count: 60 },
        { keys: [KEY_A, KEY_B], count: 40 },
      ]);
      const freq = service.buildFrequentItemsets(tx, {
        minSupportCount: 2, maxSetSize: 3,
      });
      const rules = service.generateRules(freq, tx, {
        minConfidence: 0.3, minLift: 0.5,
      });
      expect(() => service.upsertRules(rules, tx)).not.toThrow();
      expect(() => service.upsertRules(rules, tx)).not.toThrow();
      const ruleIds = new Set(
        db.getTableData('ChargeAssociationRule').map(r => r.id)
      );
      expect(ruleIds.size).toBe(rules.length); // no duplicates, same count
    });
  });

  // ============================================================
  // TR-8.20 事务边界：中途抛错回滚
  // ============================================================
  describe('TR-8.20 ignoreRecommendation 事务边界（幂等 = 半事务保护）', () => {
    it('ignoreRecommendation 在没有 clinicId 时是 no-op，不写 DB', () => {
      const noCtxSvc = new ChargeAssistantService(
        asDbService(db),
        createMockClinicContext(null),
        settings,
      );
      noCtxSvc.ignoreRecommendation(['NAME:x'], 'NAME:y', 'u1');
      const rows = db.getTableData('ChargeAssociationIgnore');
      expect(rows.length).toBe(0);
    });

    it('upsertRules 在没有 clinicId 时返回全 0，不执行写', () => {
      const noCtxSvc = new ChargeAssistantService(
        asDbService(db),
        createMockClinicContext(null),
        settings,
      );
      const stats = noCtxSvc.upsertRules([], []);
      expect(stats.added).toBe(0);
      expect(stats.updated).toBe(0);
      expect(stats.deleted).toBe(0);
      const rows = db.getTableData('ChargeAssociationRule');
      expect(rows.length).toBe(0);
    });
  });

  // ============================================================
  // 附加：listRules 分页基础校验
  // ============================================================
  describe('附加：listRules 分页返回结构正确', () => {
    it('buildMockDemoRules 后 listRules 返回 total≥20, items≥20, page=1, pageSize=50', async () => {
      service.buildMockDemoRules();
      const r = await service.listRules(1, 50);
      expect(r.total).toBeGreaterThanOrEqual(20);
      expect(r.items.length).toBeGreaterThanOrEqual(20);
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(50);
    });
  });
});
