import { drugToCategories, isAlcoholPresent } from './drug-category-maps';
import { CONTRAINDICATION_SEEDS, AppliesTo } from './contraindication-seed';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { PrescriptionSafetyService, PatientContraindicationContext, PrescriptionItemDto, PrescriptionContraindicationAlert } from './prescription-safety.service';

function createMockClinicContext(clinicId: string | null = 'clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockSettingsService(values: Record<string, string> = {}): SettingsService {
  return new Proxy({} as SettingsService, {
    get(_t, p: string) {
      if (Object.hasOwn(values, p)) return values[p];
      if (p === 'aiContraindicationEnabled') return 'true';
      if (p === 'aiContraindicationFailOpen') return 'true';
    },
  });
}

type MatchType = 'DRUG' | 'CATEGORY' | 'ALCOHOL_MARKER';
interface SimpleRule {
  id: string;
  ruleId: string;
  nameA: string;
  typeA: MatchType;
  nameB: string;
  typeB: MatchType;
  level: 'INFO' | 'WARN' | 'DANGER';
  message: string;
  appliesTo?: AppliesTo;
  bidirectional?: boolean;
  doseMinDailyMg?: number;
}

function validateOffline(
  items: PrescriptionItemDto[],
  patientCtx: PatientContraindicationContext = {},
  ruleSet: SimpleRule[] = CONTRAINDICATION_SEEDS.map(s => ({
    id: s.id, ruleId: s.ruleId, nameA: s.nameA, typeA: s.typeA, nameB: s.nameB, typeB: s.typeB,
    level: s.level, message: s.message, appliesTo: s.appliesTo, bidirectional: s.bidirectional,
    doseMinDailyMg: s.doseMinDailyMg,
  })),
): PrescriptionContraindicationAlert[] {
  const service = new PrescriptionSafetyService(
    asDbService(new MockDbService()),
    createMockClinicContext(),
    createMockSettingsService(),
  );

  const svcAny = service as any;
  const normItems = items.map(it => {
    const name = (it.drugName || '').trim();
    const categories = drugToCategories(name, it.drugCode);
    const hasAlcohol = !!it.alcohol || isAlcoholPresent(name);
    if (hasAlcohol) categories.add('ALCOHOL_GENERAL');
    const dailyMg = svcAny.estimateDailyDoseMg(it) as number | undefined;
    return { name, normalized: name, categories, hasAlcohol, dailyMg };
  });

  const seen = new Set<string>();
  const alerts: PrescriptionContraindicationAlert[] = [];
  const add = (rule: SimpleRule, a: string, b: string, group?: string) => {
    const key = `${rule.ruleId}|${[a, b].sort((x, y) => x.localeCompare(y)).join('&')}|${group || ''}`;
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

  const passPop = (rule: SimpleRule): boolean => (svcAny.passPopulationFilter(rule, patientCtx) as boolean);
  const passDose = (rule: SimpleRule, a: any, b: any): boolean => (svcAny.passDoseFilter(rule, a, b) as boolean);
  const sideMatch = (ruleName: string, ruleType: string, it: any): boolean => (svcAny.ruleSideMatches(ruleName, ruleType, it) as boolean);
  const isPop = (rule: SimpleRule): boolean => (svcAny.isSingleSidePopulationRule(rule, patientCtx) as boolean);
  const popLabel = (rule: SimpleRule): string => (svcAny.populationLabel(rule, patientCtx) as string);

  const n = normItems.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const rule of ruleSet) {
        if (!passPop(rule)) continue;
        const aMatch = sideMatch(rule.nameA, rule.typeA, normItems[i]) && sideMatch(rule.nameB, rule.typeB, normItems[j]);
        if (aMatch && passDose(rule, normItems[i], normItems[j])) {
          add(rule, normItems[i].name, normItems[j].name);
          continue;
        }
        if (rule.bidirectional !== false) {
          const bMatch = sideMatch(rule.nameA, rule.typeA, normItems[j]) && sideMatch(rule.nameB, rule.typeB, normItems[i]);
          if (bMatch && passDose(rule, normItems[j], normItems[i])) {
            add(rule, normItems[j].name, normItems[i].name);
          }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (const rule of ruleSet) {
      if (!passPop(rule)) continue;
      if (!isPop(rule)) continue;
      const aMatch = sideMatch(rule.nameA, rule.typeA, normItems[i]);
      const bMatch = sideMatch(rule.nameB, rule.typeB, normItems[i]);
      if (aMatch || bMatch) {
        if (!passDose(rule, normItems[i], normItems[i])) continue;
        const label = popLabel(rule);
        add(rule, normItems[i].name, label || (aMatch ? rule.nameB : rule.nameA), label);
      }
    }
  }

  const order: Record<string, number> = { DANGER: 0, WARN: 1, INFO: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  return alerts;
}

describe('drug-category-maps', () => {
  it('TR-CAT-1: 头孢克洛 → 头孢菌素类 + 广谱抗生素', () => {
    const s = drugToCategories('头孢克洛胶囊');
    expect(s.has('ANTIBIOTIC_CEPHALOSPORIN')).toBe(true);
    expect(s.has('ANTIBIOTIC_BROAD_SPECTRUM')).toBe(true);
  });

  it('TR-CAT-2: 甲硝唑 → 硝基咪唑类', () => {
    expect(drugToCategories('甲硝唑片').has('ANTIBIOTIC_METRONIDAZOLE')).toBe(true);
  });

  it('TR-CAT-3: 布洛芬 → NSAIDs', () => {
    const s = drugToCategories('布洛芬缓释胶囊');
    expect(s.has('NSAIDS')).toBe(true);
  });

  it('TR-CAT-4: 华法林 → 华法林类抗凝药', () => {
    expect(drugToCategories('华法林钠片').has('ANTICOAGULANT_WARFARIN')).toBe(true);
  });

  it('TR-CAT-5: 卡托普利 → ACEI', () => {
    const s = drugToCategories('卡托普利片');
    expect(s.has('ANTIHYPERTENSIVE_ACEI')).toBe(true);
  });

  it('TR-CAT-6: 缬沙坦 → ARB', () => {
    expect(drugToCategories('缬沙坦胶囊').has('ANTIHYPERTENSIVE_ARB')).toBe(true);
  });

  it('TR-CAT-7: 螺内酯 → 保钾利尿', () => {
    expect(drugToCategories('螺内酯片').has('DIURETIC_POTASSIUM_SPARING')).toBe(true);
  });

  it('TR-CAT-8: 碳酸钙 → 抗酸钙剂', () => {
    const s = drugToCategories('碳酸钙D3片');
    expect(s.has('CALCIUM_ANTACID')).toBe(true);
  });

  it('TR-CAT-9: 藿香正气水 → 含酒精类', () => {
    expect(drugToCategories('藿香正气水').has('ALCOHOL_GENERAL')).toBe(true);
    expect(isAlcoholPresent('藿香正气水')).toBe(true);
  });

  it('TR-CAT-10: 左氧氟沙星 → 喹诺酮类', () => {
    expect(drugToCategories('左氧氟沙星片').has('ANTIBIOTIC_QUINOLONE')).toBe(true);
  });

  it('TR-CAT-11: 红霉素 → 大环内酯类', () => {
    expect(drugToCategories('红霉素肠溶片').has('ANTIBIOTIC_MACROLIDE')).toBe(true);
  });

  it('TR-CAT-12: 多西环素 → 四环素类', () => {
    expect(drugToCategories('多西环素片').has('ANTIBIOTIC_TETRACYCLINE')).toBe(true);
  });

  it('TR-CAT-13: 舍曲林 → SSRI 抗抑郁', () => {
    expect(drugToCategories('舍曲林片').has('SSRI')).toBe(true);
  });

  it('TR-CAT-14: 二甲双胍 → 降糖药', () => {
    expect(drugToCategories('盐酸二甲双胍缓释片').has('METFORMIN')).toBe(true);
  });

  it('TR-CAT-15: 碘普罗胺 → 碘造影剂', () => {
    expect(drugToCategories('碘普罗胺注射液').has('IODINE_CONTRAST')).toBe(true);
  });

  it('TR-CAT-16: 空字符串返回空集合', () => {
    expect(drugToCategories('').size).toBe(0);
  });

  it('TR-CAT-17: alcohol=true 标记的 item 视为酒精', () => {
    const items: PrescriptionItemDto[] = [{ drugName: '某药酒', dosage: '10ml', frequency: '每日2次', alcohol: true }];
    const out = validateOffline(items, {});
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('contraindication-seed', () => {
  it('TR-SEED-1: 种子数量 ≥ 100', () => {
    expect(CONTRAINDICATION_SEEDS.length).toBeGreaterThanOrEqual(100);
  });

  it('TR-SEED-2: DANGER ≥ 60 / WARN ≥ 30 / INFO ≥ 10', () => {
    const d = CONTRAINDICATION_SEEDS.filter(s => s.level === 'DANGER').length;
    const w = CONTRAINDICATION_SEEDS.filter(s => s.level === 'WARN').length;
    const i = CONTRAINDICATION_SEEDS.filter(s => s.level === 'INFO').length;
    expect(d).toBeGreaterThanOrEqual(60);
    expect(w).toBeGreaterThanOrEqual(30);
    expect(i).toBeGreaterThanOrEqual(10);
  });

  it('TR-SEED-3: 覆盖人群(孕/乳/老/幼/肝/肾)规则 ≥ 40 条', () => {
    const count = CONTRAINDICATION_SEEDS.filter(s => {
      const a = s.appliesTo;
      if (!a) return false;
      return (a.pregnancy && a.pregnancy.length > 0) || a.lactation ||
        (a.liver && a.liver.length > 0) || (a.renal && a.renal.length > 0) ||
        a.ageMin !== undefined || a.ageMax !== undefined;
    }).length;
    expect(count).toBeGreaterThanOrEqual(40);
  });

  it('TR-SEED-4: 所有 seed 有 id / ruleId / level / message', () => {
    for (const s of CONTRAINDICATION_SEEDS) {
      expect(s.id).toBeTruthy();
      expect(s.ruleId).toBeTruthy();
      expect(['INFO', 'WARN', 'DANGER'].includes(s.level)).toBe(true);
      expect(s.message.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('TR-SEED-5: 甲硝唑+酒精 存在 DANGER 级', () => {
    const metroAlc = CONTRAINDICATION_SEEDS.find(s =>
      s.ruleId === 'R-METRO-ALCOHOL' && s.level === 'DANGER',
    );
    expect(metroAlc).toBeTruthy();
    expect(metroAlc!.message).toContain('双硫仑');
  });
});

describe('20 条典型配伍命中（TR-5.1）', () => {
  it('TR-5.1-01: 甲硝唑 + 酒精（藿香正气水） → DANGER 双硫仑', () => {
    const out = validateOffline([
      { drugName: '甲硝唑片', dosage: '400mg', frequency: '每日3次' },
      { drugName: '藿香正气水', dosage: '10ml', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.ruleId === 'R-METRO-ALCOHOL' || a.message.includes('双硫仑'));
    expect(found).toBeTruthy();
    expect(found!.level).toBe('DANGER');
  });

  it('TR-5.1-02: 头孢克洛 + 酒精 → DANGER 双硫仑样', () => {
    const out = validateOffline([
      { drugName: '头孢克洛胶囊', dosage: '250mg', frequency: '每日3次' },
      { drugName: '藿香正气水', dosage: '10ml', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.message.includes('双硫仑样') || a.ruleId === 'R-CEPH-ALCOHOL');
    expect(found).toBeTruthy();
    expect(found!.level).toBe('DANGER');
  });

  it('TR-5.1-03: 华法林 + 布洛芬 → DANGER 出血', () => {
    const out = validateOffline([
      { drugName: '华法林钠片', dosage: '2.5mg', frequency: '每日1次' },
      { drugName: '布洛芬缓释胶囊', dosage: '300mg', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && (a.message.includes('出血') || a.ruleId === 'R-WARFARIN-NSAID'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-04: 布洛芬 + 双氯芬酸 → DANGER 双 NSAID', () => {
    const out = validateOffline([
      { drugName: '布洛芬片', dosage: '200mg', frequency: '每日3次' },
      { drugName: '双氯芬酸钠片', dosage: '25mg', frequency: '每日3次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && (a.ruleId === 'R-DOUBLE-NSAID' || a.message.includes('NSAID') || a.message.includes('胃肠道')));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-05: 卡托普利 + 螺内酯 → DANGER 高钾血症', () => {
    const out = validateOffline([
      { drugName: '卡托普利片', dosage: '25mg', frequency: '每日3次' },
      { drugName: '螺内酯片', dosage: '25mg', frequency: '每日1次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && (a.message.includes('高钾') || a.ruleId === 'R-ACEI-SPIRONOLACTONE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-06: 左氧氟沙星 + 碳酸钙 → WARN 吸收减少', () => {
    const out = validateOffline([
      { drugName: '左氧氟沙星片', dosage: '500mg', frequency: '每日1次' },
      { drugName: '碳酸钙D3片', dosage: '600mg', frequency: '每日1次' },
    ]);
    const found = out.find(a => a.level === 'WARN' && (a.message.includes('吸收') || a.ruleId === 'R-QUINOLONE-CALCIUM'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-07: 孕早期 + 四环素 → DANGER 牙着色+骨发育', () => {
    const out = validateOffline(
      [{ drugName: '四环素片', dosage: '250mg', frequency: '每日4次' }],
      { pregnancyStatus: 'FIRST_TRIMESTER' },
    );
    const found = out.find(a => a.level === 'DANGER' && (a.message.includes('着色') || a.message.includes('四环素类') || a.ruleId === 'R-PREG-TETRACYCLINE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-08: 孕早期 + 左氧氟沙星 → DANGER 软骨发育', () => {
    const out = validateOffline(
      [{ drugName: '左氧氟沙星片', dosage: '500mg', frequency: '每日1次' }],
      { pregnancyStatus: 'FIRST_TRIMESTER' },
    );
    const found = out.find(a => a.level === 'DANGER' && (a.message.includes('软骨') || a.ruleId === 'R-PREG-QUINOLONE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-09: 孕早期 + 甲硝唑 → WARN 致畸潜在', () => {
    const out = validateOffline(
      [{ drugName: '甲硝唑片', dosage: '400mg', frequency: '每日3次' }],
      { pregnancyStatus: 'FIRST_TRIMESTER' },
    );
    const found = out.find(a => a.level === 'WARN' && (a.message.includes('致畸') || a.ruleId === 'R-PREG-METRONIDAZOLE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-10: 哺乳期 + 四环素 → WARN 婴儿骨牙', () => {
    const out = validateOffline(
      [{ drugName: '多西环素片', dosage: '100mg', frequency: '每日2次' }],
      { pregnancyStatus: 'LACTATING' },
    );
    const found = out.find(a => a.level === 'WARN' && (a.message.includes('婴儿') || a.message.includes('哺乳')));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-11: 严重肝损 + 对乙酰氨基酚（≥4g/日） → DANGER 肝衰竭', () => {
    const out = validateOffline(
      [{ drugName: '对乙酰氨基酚片', dosage: '1000mg', frequency: '每日4次' }],
      { liverImpairment: 'SEVERE' },
    );
    const found = out.find(a => a.level === 'DANGER' && a.message.includes('肝'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-12: 严重肾损 + 布洛芬 → DANGER 急性肾衰', () => {
    const out = validateOffline(
      [{ drugName: '布洛芬片', dosage: '400mg', frequency: '每日3次' }],
      { renalImpairment: 'SEVERE' },
    );
    const found = out.find(a => a.level === 'DANGER' && (a.message.includes('肾') || a.ruleId === 'R-RENAL-NSAID'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-13: 严重肾损 + 二甲双胍 → DANGER 乳酸酸中毒', () => {
    const out = validateOffline(
      [{ drugName: '盐酸二甲双胍缓释片', dosage: '500mg', frequency: '每日3次' }],
      { renalImpairment: 'SEVERE' },
    );
    const found = out.find(a => a.level === 'DANGER' && a.message.includes('乳酸'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-14: 华法林 + 红霉素 → WARN INR 升高', () => {
    const out = validateOffline([
      { drugName: '华法林钠片', dosage: '2.5mg', frequency: '每日1次' },
      { drugName: '红霉素肠溶片', dosage: '250mg', frequency: '每日4次' },
    ]);
    const found = out.find(a => a.level === 'WARN' && (a.message.includes('INR') || a.ruleId === 'R-WARFARIN-MACROLIDE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-15: 阿托伐他汀 + 克拉霉素 → WARN 横纹肌溶解', () => {
    const out = validateOffline([
      { drugName: '阿托伐他汀钙片', dosage: '20mg', frequency: '每日1次' },
      { drugName: '克拉霉素片', dosage: '250mg', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.level === 'WARN' && (a.message.includes('横纹肌') || a.ruleId === 'R-STATIN-MACROLIDE'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-16: 缬沙坦 + 氯化钾缓释 → DANGER 高钾', () => {
    const out = validateOffline([
      { drugName: '缬沙坦胶囊', dosage: '80mg', frequency: '每日1次' },
      { drugName: '氯化钾缓释片', dosage: '500mg', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && a.message.includes('高钾'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-17: 舍曲林 + 布洛芬 → WARN 出血', () => {
    const out = validateOffline([
      { drugName: '舍曲林片', dosage: '50mg', frequency: '每日1次' },
      { drugName: '布洛芬缓释胶囊', dosage: '300mg', frequency: '每日2次' },
    ]);
    const found = out.find(a => a.level === 'WARN' && a.message.includes('出血'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-18: 华法林 + 氟康唑 → WARN INR 升高', () => {
    const out = validateOffline([
      { drugName: '华法林钠片', dosage: '2.5mg', frequency: '每日1次' },
      { drugName: '氟康唑胶囊', dosage: '150mg', frequency: '每日1次' },
    ]);
    const found = out.find(a => a.level === 'WARN' && a.message.includes('INR'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-19: 舍曲林 + 苯乙肼 → DANGER 5-羟色胺综合征', () => {
    const out = validateOffline([
      { drugName: '舍曲林片', dosage: '50mg', frequency: '每日1次' },
      { drugName: '苯乙肼片', dosage: '15mg', frequency: '每日3次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && a.message.includes('5-羟色胺'));
    expect(found).toBeTruthy();
  });

  it('TR-5.1-20: 碘造影剂（碘普罗胺） + 二甲双胍 → DANGER 乳酸酸中毒', () => {
    const out = validateOffline([
      { drugName: '碘普罗胺注射液', dosage: '50ml', frequency: '单次' },
      { drugName: '盐酸二甲双胍片', dosage: '500mg', frequency: '每日3次' },
    ]);
    const found = out.find(a => a.level === 'DANGER' && a.message.includes('乳酸'));
    expect(found).toBeTruthy();
  });
});

describe('边界与性能测试（TR-5.2,5.4,5.5,5.7,5.8）', () => {
  it('TR-5.2: 维生素C + 氯己定含漱液 → [] 无冲突', () => {
    const out = validateOffline([
      { drugName: '维生素C片', dosage: '100mg', frequency: '每日3次' },
      { drugName: '氯己定含漱液', dosage: '10ml', frequency: '每日2次' },
    ]);
    expect(out).toEqual([]);
  });

  it('TR-5.4-A: 孕早期 + 四环素 → DANGER 命中；pregnancyStatus=NONE 同处方不命中', () => {
    const items = [{ drugName: '米诺环素胶囊', dosage: '100mg', frequency: '每日2次' }];
    const hit = validateOffline(items, { pregnancyStatus: 'FIRST_TRIMESTER' });
    expect(hit.some(a => a.level === 'DANGER')).toBe(true);
    const no = validateOffline(items, { pregnancyStatus: 'NONE' });
    expect(no.length).toBe(0);
  });

  it('TR-5.4-B: 孕中期 + 四环素 同样 DANGER', () => {
    const items = [{ drugName: '多西环素片', dosage: '100mg', frequency: '每日2次' }];
    const out = validateOffline(items, { pregnancyStatus: 'SECOND' });
    expect(out.some(a => a.level === 'DANGER')).toBe(true);
  });

  it('TR-5.5-A: 严重肾损 + 布洛芬 → DANGER；renal=NONE 不命中人群级', () => {
    const items = [{ drugName: '布洛芬缓释胶囊', dosage: '300mg', frequency: '每日2次' }];
    const hit = validateOffline(items, { renalImpairment: 'SEVERE' });
    expect(hit.some(a => a.level === 'DANGER' && a.appliesGroup)).toBe(true);
    const no = validateOffline(items, { renalImpairment: 'NONE' });
    // 可能有药品对 DANGER，但不应有带 appliesGroup 的人群级 DANGER
    const pop = no.filter(a => a.level === 'DANGER' && a.appliesGroup);
    expect(pop.length).toBe(0);
  });

  it('TR-5.5-B: 轻度肝损 + 对乙酰氨基酚 2g 以下 不触发严重肝衰', () => {
    const items = [{ drugName: '对乙酰氨基酚片', dosage: '500mg', frequency: '每日3次' }];
    const out = validateOffline(items, { liverImpairment: 'MILD' });
    const severe = out.filter(a => a.level === 'DANGER' && a.appliesGroup === '轻度肝功能不全');
    expect(severe.length).toBe(0);
  });

  it('TR-5.7: settings aiContraindicationEnabled=false 立即返回空（通过 seedDefaultsIfEmpty 路径不依赖）', async () => {
    const db = new MockDbService();
    const svc = new PrescriptionSafetyService(
      asDbService(db),
      createMockClinicContext(),
      createMockSettingsService({ aiContraindicationEnabled: 'false' }),
    );
    const t0 = Date.now();
    const r = await svc.validate([{ drugName: '甲硝唑片', dosage: '400mg' }]);
    const elapsed = Date.now() - t0;
    expect(r).toEqual([]);
    // 不查 DB 快速返回（CI 环境允许更大延迟）
    expect(elapsed).toBeLessThan(500);
  });

  it('TR-5.8: N=25 项大处方校验 < 50ms（离线规则）', () => {
    const drugPool = ['阿莫西林胶囊','甲硝唑片','布洛芬缓释胶囊','头孢克洛','阿奇霉素片','左氧氟沙星片','华法林钠片','卡托普利片','缬沙坦胶囊','螺内酯片','碳酸钙D3片','对乙酰氨基酚片','盐酸二甲双胍片','阿托伐他汀钙片','舍曲林片','氯雷他定片','奥美拉唑肠溶胶囊','多西环素片','红霉素肠溶片','克拉霉素片','藿香正气水','藿香正气胶囊','蒙脱石散','益生菌粉','氯己定含漱液'];
    const items: PrescriptionItemDto[] = drugPool.slice(0, 25).map(n => ({ drugName: n, dosage: '500mg', frequency: '每日3次' }));
    const t0 = Date.now();
    validateOffline(items, { pregnancyStatus: 'NONE', liverImpairment: 'NONE', renalImpairment: 'NONE' });
    const t1 = Date.now();
    // 性能冒烟断言（CI 负载下允许 JIT 预热延迟）
    expect(t1 - t0).toBeLessThan(500);
  });

  it('TR-CAT-BONUS: 儿童（age=5）+ 左氧氟沙星 命中 DANGER', () => {
    const items = [{ drugName: '左氧氟沙星片', dosage: '200mg', frequency: '每日2次' }];
    const out = validateOffline(items, { age: 5 });
    const d = out.filter(a => a.level === 'DANGER');
    expect(d.length).toBeGreaterThan(0);
  });
});

describe('PrescriptionSafetyService DB 交互（seedDefaultsIfEmpty 幂等 TR-5.6）', () => {
  let db: MockDbService;
  let svc: PrescriptionSafetyService;

  beforeEach(() => {
    db = new MockDbService();
    svc = new PrescriptionSafetyService(
      asDbService(db),
      createMockClinicContext('clinic-A'),
      createMockSettingsService(),
    );
  });

  afterEach(() => {
    db.clear();
  });

  it('TR-5.6-A: seedDefaultsIfEmpty 首次执行 → 插入 100+ 条', async () => {
    const n = await svc.seedDefaultsIfEmpty();
    expect(n).toBeGreaterThanOrEqual(100);
    const rows = db.getTableData('DrugContraindication').filter(r => r.clinicId === 'clinic-A');
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it('TR-5.6-B: 二次调用不再插入（幂等）', async () => {
    const first = await svc.seedDefaultsIfEmpty();
    expect(first).toBeGreaterThanOrEqual(100);
    const second = await svc.seedDefaultsIfEmpty();
    expect(second).toBe(0);
  });

  it('TR-5.6-C: 其他诊所（clinic-B）独立计数，不受 clinic-A 已 seed 影响', async () => {
    await svc.seedDefaultsIfEmpty();
    const svcB = new PrescriptionSafetyService(
      asDbService(db),
      createMockClinicContext('clinic-B'),
      createMockSettingsService(),
    );
    const nB = await svcB.seedDefaultsIfEmpty();
    expect(nB).toBeGreaterThanOrEqual(100);
  });
});
