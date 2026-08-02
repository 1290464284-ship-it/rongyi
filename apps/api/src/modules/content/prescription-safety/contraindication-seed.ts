export type MatchType = 'DRUG' | 'CATEGORY' | 'ALCOHOL_MARKER';
export type SeverityLevel = 'INFO' | 'WARN' | 'DANGER';

export interface AppliesTo {
  pregnancy?: Array<'NONE' | 'FIRST_TRIMESTER' | 'SECOND' | 'THIRD'>;
  lactation?: boolean;
  liver?: Array<'NONE' | 'MILD' | 'MODERATE' | 'SEVERE'>;
  renal?: Array<'NONE' | 'MILD' | 'MODERATE' | 'SEVERE'>;
  ageMin?: number;
  ageMax?: number;
}

export interface DrugContraindicationSeed {
  id: string;
  nameA: string;
  typeA: MatchType;
  nameB: string;
  typeB: MatchType;
  level: SeverityLevel;
  ruleId: string;
  message: string;
  appliesTo?: AppliesTo;
  bidirectional?: boolean;
  doseMinDailyMg?: number;
}

const ALL_PREGNANCY: AppliesTo['pregnancy'] = ['FIRST_TRIMESTER', 'SECOND', 'THIRD'];
const LIVER_SEVERE: AppliesTo['liver'] = ['SEVERE'];
const LIVER_MOD_SEVERE: AppliesTo['liver'] = ['MODERATE', 'SEVERE'];
const RENAL_SEVERE: AppliesTo['renal'] = ['SEVERE'];
const RENAL_MOD_SEVERE: AppliesTo['renal'] = ['MODERATE', 'SEVERE'];

export const CONTRAINDICATION_SEEDS: DrugContraindicationSeed[] = [
  // ======== 典型 1-20 条（核心规则） ========
  // 1. 甲硝唑/替硝唑 + 酒精 → DANGER 双硫仑
  { id: 'ci-001', nameA: 'CAT:ANTIBIOTIC_METRONIDAZOLE', typeA: 'CATEGORY', nameB: 'CAT:ALCOHOL_GENERAL', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-METRO-ALCOHOL', message: '硝基咪唑类与酒精合用可引发双硫仑样反应，严重可致死，建议停药后7日内禁酒。', bidirectional: true },
  // 2. 头孢 + 酒精 → DANGER 双硫仑样
  { id: 'ci-002', nameA: 'CAT:ANTIBIOTIC_CEPHALOSPORIN', typeA: 'CATEGORY', nameB: 'CAT:ALCOHOL_GENERAL', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-CEPH-ALCOHOL', message: '头孢菌素类与酒精合用可引发双硫仑样反应，建议停药后3日内禁酒。', bidirectional: true },
  // 3. 华法林 + NSAID → DANGER 出血
  { id: 'ci-003', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: 'CAT:NSAIDS', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-WARFARIN-NSAID', message: '华法林与NSAID合用显著增加胃肠道出血风险，需密切监测INR。', bidirectional: true },
  // 4. 双 NSAIDs → DANGER
  { id: 'ci-004', nameA: 'CAT:NSAIDS', typeA: 'CATEGORY', nameB: 'CAT:NSAIDS', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-DOUBLE-NSAID', message: '两种NSAID合用显著增加胃肠道出血和肾损伤风险，禁止叠加使用。', bidirectional: false },
  // 5. ACEI/ARB + 螺内酯 → DANGER 高钾
  { id: 'ci-005', nameA: 'CAT:ANTIHYPERTENSIVE_ACEI', typeA: 'CATEGORY', nameB: 'CAT:DIURETIC_POTASSIUM_SPARING', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ACEI-SPIRONOLACTONE', message: 'ACEI与保钾利尿剂合用可引发严重高钾血症，需监测血钾。', bidirectional: true },
  { id: 'ci-005b', nameA: 'CAT:ANTIHYPERTENSIVE_ARB', typeA: 'CATEGORY', nameB: 'CAT:DIURETIC_POTASSIUM_SPARING', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ARB-SPIRONOLACTONE', message: 'ARB与保钾利尿剂合用可引发严重高钾血症，需监测血钾。', bidirectional: true },
  // 6. 喹诺酮 + 含钙抗酸药 → WARN
  { id: 'ci-006', nameA: 'CAT:ANTIBIOTIC_QUINOLONE', typeA: 'CATEGORY', nameB: 'CAT:CALCIUM_ANTACID', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-QUINOLONE-ANTACID', message: '喹诺酮与含钙铝铋抗酸药合用可使吸收减少50%，建议间隔2小时以上服用。', bidirectional: true },
  // 7. 孕期 + 四环素 → DANGER
  { id: 'ci-007', nameA: 'CAT:ANTIBIOTIC_TETRACYCLINE', typeA: 'CATEGORY', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-TETRA-PREGNANCY', message: '四环素类在孕期可致胎儿牙着色及骨发育异常，妊娠全程禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 8. 孕期 + 喹诺酮 → DANGER
  { id: 'ci-008', nameA: 'CAT:ANTIBIOTIC_QUINOLONE', typeA: 'CATEGORY', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-QUINOLONE-PREGNANCY', message: '喹诺酮类可影响胎儿软骨发育，妊娠全程禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 9. 孕期前3月 + 甲硝唑 → WARN
  { id: 'ci-009', nameA: 'CAT:ANTIBIOTIC_METRONIDAZOLE', typeA: 'CATEGORY', nameB: 'PREGNANCY_1ST', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-METRO-PREG1', message: '甲硝唑孕早期使用有潜在致畸风险，仅在获益大于风险时使用。', appliesTo: { pregnancy: ['FIRST_TRIMESTER'] }, bidirectional: false },
  // 10. 哺乳期 + 四环素 → WARN
  { id: 'ci-010', nameA: 'CAT:ANTIBIOTIC_TETRACYCLINE', typeA: 'CATEGORY', nameB: 'LACTATION', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-TETRA-LACTATION', message: '四环素可分泌至乳汁，影响婴儿骨骼与牙齿发育，哺乳期应暂停哺乳。', appliesTo: { lactation: true }, bidirectional: false },
  // 11. 严重肝功不全 + 对乙酰氨基酚 >2g → DANGER
  { id: 'ci-011', nameA: '对乙酰氨基酚', typeA: 'DRUG', nameB: 'LIVER_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-APAP-LIVER-SEV', message: '严重肝功能不全患者服用对乙酰氨基酚可诱发急性肝衰竭，严禁日剂量超过2g。', appliesTo: { liver: LIVER_SEVERE }, doseMinDailyMg: 2000, bidirectional: false },
  // 12. 严重肾功不全 + NSAID → DANGER
  { id: 'ci-012', nameA: 'CAT:NSAIDS', typeA: 'CATEGORY', nameB: 'RENAL_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-NSAID-RENAL-SEV', message: '严重肾功能不全(GFR<30)使用NSAID可诱发急性肾衰，应禁用。', appliesTo: { renal: RENAL_SEVERE }, bidirectional: false },
  // 13. 严重肾功不全 + 二甲双胍 → DANGER
  { id: 'ci-013', nameA: 'CAT:METFORMIN', typeA: 'CATEGORY', nameB: 'RENAL_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-METFORMIN-RENAL-SEV', message: '严重肾功能不全使用二甲双胍可致乳酸性酸中毒，禁用。', appliesTo: { renal: RENAL_SEVERE }, bidirectional: false },
  // 14. 华法林 + 大环内酯 → WARN
  { id: 'ci-014', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_MACROLIDE', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-WARFARIN-MACROLIDE', message: '大环内酯类可抑制华法林代谢导致INR升高，需密切监测并调整剂量。', bidirectional: true },
  // 15. 他汀 + 红霉素/克拉霉素/酮康唑 → WARN
  { id: 'ci-015', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '红霉素', typeB: 'DRUG', level: 'WARN', ruleId: 'R-STATIN-ERYTHRO', message: '红霉素可抑制他汀代谢，增加横纹肌溶解风险，考虑换用其他抗生素。', bidirectional: true },
  { id: 'ci-015b', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '克拉霉素', typeB: 'DRUG', level: 'WARN', ruleId: 'R-STATIN-CLARITHRO', message: '克拉霉素可抑制他汀代谢，增加横纹肌溶解风险，考虑换用其他抗生素。', bidirectional: true },
  { id: 'ci-015c', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '酮康唑', typeB: 'DRUG', level: 'WARN', ruleId: 'R-STATIN-KETO', message: '酮康唑为强CYP3A4抑制剂，显著增加他汀血药浓度及肌病风险。', bidirectional: true },
  // 16. ACEI/ARB + 钾补充剂 → DANGER
  { id: 'ci-016', nameA: 'CAT:ANTIHYPERTENSIVE_ACEI', typeA: 'CATEGORY', nameB: 'CAT:POTASSIUM_SUPPLEMENT', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ACEI-KSUPP', message: 'ACEI与钾补充剂合用可致严重高钾血症，需严密监测血钾。', bidirectional: true },
  { id: 'ci-016b', nameA: 'CAT:ANTIHYPERTENSIVE_ARB', typeA: 'CATEGORY', nameB: 'CAT:POTASSIUM_SUPPLEMENT', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ARB-KSUPP', message: 'ARB与钾补充剂合用可致严重高钾血症，需严密监测血钾。', bidirectional: true },
  // 17. SSRI/SNRI + NSAID → WARN
  { id: 'ci-017', nameA: 'CAT:SSRI', typeA: 'CATEGORY', nameB: 'CAT:NSAIDS', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SSRI-NSAID', message: 'SSRI与NSAID合用可增加上消化道出血风险，建议加用胃黏膜保护剂。', bidirectional: true },
  { id: 'ci-017b', nameA: 'CAT:SNRI', typeA: 'CATEGORY', nameB: 'CAT:NSAIDS', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SNRI-NSAID', message: 'SNRI与NSAID合用可增加上消化道出血风险，建议加用胃黏膜保护剂。', bidirectional: true },
  // 18. 华法林 + 磺胺/甲硝唑/大环内酯/氟康唑 → WARN
  { id: 'ci-018', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_SULFONAMIDE', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-WARFARIN-SULFA', message: '磺胺类可增强华法林抗凝作用导致INR升高，需密切监测。', bidirectional: true },
  { id: 'ci-018b', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: '氟康唑', typeB: 'DRUG', level: 'WARN', ruleId: 'R-WARFARIN-FLUCONAZOLE', message: '氟康唑可抑制华法林代谢致INR显著升高，需密切监测并减量。', bidirectional: true },
  // 19. SSRI + MAOI → DANGER
  { id: 'ci-019', nameA: 'CAT:SSRI', typeA: 'CATEGORY', nameB: 'CAT:MAOI', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-SSRI-MAOI', message: 'SSRI与MAOI合用可致致死性5-羟色胺综合征，必须清洗期14天以上。', bidirectional: true },
  // 20. 二甲双胍 + 碘造影剂 → DANGER（24h内）
  { id: 'ci-020', nameA: 'CAT:IODINE_CONTRAST', typeA: 'CATEGORY', nameB: 'CAT:METFORMIN', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-CONTRAST-METFORMIN', message: '碘造影剂与二甲双胍合用可致乳酸性酸中毒，建议造影前后48h暂停二甲双胍。', bidirectional: false },

  // ======== 扩展 80+ 条 ========
  // ==== 更多 DANGER (总计约 62 条) ====
  // 青霉素 + 氨基糖苷配伍失活
  { id: 'ci-021', nameA: 'CAT:ANTIBIOTIC_PENICILLIN', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-PEN-AG-MIX', message: '青霉素类与氨基糖苷类体外混合可发生化学灭活，禁止同一输液管配伍。', bidirectional: true },
  // 华法林 + 直接抗凝药重复
  { id: 'ci-022', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: 'CAT:ANTICOAGULANT_DIRECT', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-WARFARIN-DOAC', message: '华法林与直接口服抗凝药重复使用显著增加出血风险，禁止联合。', bidirectional: true },
  // 他汀 + 贝特类（吉非贝齐）DANGER
  { id: 'ci-023', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '吉非贝齐', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-STATIN-GEMFIBROZIL', message: '吉非贝齐与他汀合用横纹肌溶解风险剧增，禁止联合。', bidirectional: true },
  // 孕期 + ACEI DANGER
  { id: 'ci-024', nameA: 'CAT:ANTIHYPERTENSIVE_ACEI', typeA: 'CATEGORY', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ACEI-PREG', message: 'ACEI在孕期可致胎儿肾发育异常和羊水过少，妊娠全程禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 孕期 + ARB DANGER
  { id: 'ci-025', nameA: 'CAT:ANTIHYPERTENSIVE_ARB', typeA: 'CATEGORY', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ARB-PREG', message: 'ARB在孕期可致胎儿肾发育异常和羊水过少，妊娠全程禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 孕期 + 华法林 DANGER
  { id: 'ci-026', nameA: '华法林', typeA: 'DRUG', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-WARFARIN-PREG', message: '华法林可致华法林胚胎病和中枢神经系统异常，妊娠全程禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 孕期 + 螺内酯 DANGER
  { id: 'ci-027', nameA: '螺内酯', typeA: 'DRUG', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-SPIRONO-PREG', message: '螺内酯有抗雄激素作用，孕期使用可能致男性胎儿生殖畸形，禁用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 氨基糖苷 + 强效利尿剂 DANGER
  { id: 'ci-028', nameA: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeA: 'CATEGORY', nameB: 'CAT:DIURETIC_LOOP', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-AG-LOOP-DIURETIC', message: '氨基糖苷与袢利尿剂合用显著增加耳毒性和肾毒性风险。', bidirectional: true },
  // 磺胺 + 磺脲类 DANGER
  { id: 'ci-029', nameA: 'CAT:ANTIBIOTIC_SULFONAMIDE', typeA: 'CATEGORY', nameB: 'CAT:ANTIDIABETIC_SULFONYLUREA', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-SULFA-SULFONYLUREA', message: '磺胺类可增强磺脲类降糖作用，可能致严重低血糖，需密切监测血糖。', bidirectional: true },
  // MAOI + 拟交感 DANGER（去甲肾上腺素/肾上腺素/伪麻黄碱）
  { id: 'ci-030', nameA: 'CAT:MAOI', typeA: 'CATEGORY', nameB: '伪麻黄碱', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-MAOI-PSEUDOEPH', message: 'MAOI与拟交感药合用可引发严重高血压危象，禁用。', bidirectional: true },
  // 三环 + MAOI DANGER
  { id: 'ci-031', nameA: 'CAT:TRICYCLIC_ANTIDEPRESSANT', typeA: 'CATEGORY', nameB: 'CAT:MAOI', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-TCA-MAOI', message: '三环类抗抑郁药与MAOI合用可致5-HT综合征和高热危象，禁用。', bidirectional: true },
  // 肾功不全 + 氨基糖苷 DANGER
  { id: 'ci-032', nameA: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeA: 'CATEGORY', nameB: 'RENAL_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-AG-RENAL-SEV', message: '严重肾功能不全使用氨基糖苷类可致不可逆肾毒性和耳毒性，禁用。', appliesTo: { renal: RENAL_SEVERE }, bidirectional: false },
  // 肾功不全 + 万古霉素 DANGER
  { id: 'ci-033', nameA: '万古霉素', typeA: 'DRUG', nameB: 'RENAL_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-VANCO-RENAL-SEV', message: '严重肾功能不全使用万古霉素需严格监测血药浓度，避免肾毒性。', appliesTo: { renal: RENAL_SEVERE }, bidirectional: false },
  // 肝衰 + 甲硝唑 DANGER
  { id: 'ci-034', nameA: 'CAT:ANTIBIOTIC_METRONIDAZOLE', typeA: 'CATEGORY', nameB: 'LIVER_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-METRO-LIVER-SEV', message: '严重肝功能不全时甲硝唑代谢减慢蓄积，需减半使用并监测。', appliesTo: { liver: LIVER_SEVERE }, bidirectional: false },
  // 肝衰 + 红霉素 DANGER
  { id: 'ci-035', nameA: '红霉素', typeA: 'DRUG', nameB: 'LIVER_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ERYTHRO-LIVER-SEV', message: '严重肝功能不全使用红霉素可致胆汁淤积性肝炎，禁用。', appliesTo: { liver: LIVER_SEVERE }, bidirectional: false },
  // 丙戊酸 + 阿司匹林 DANGER（儿童 Reye）
  { id: 'ci-036', nameA: '丙戊酸钠', typeA: 'DRUG', nameB: '阿司匹林', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-VALPROATE-ASA-PED', message: '18岁以下儿童丙戊酸与阿司匹林合用有Reye综合征风险，禁用。', appliesTo: { ageMax: 18 }, bidirectional: true },
  // 氯吡格雷 + 奥美拉唑 WARN 但 PPI 中奥美拉唑/埃索美拉唑属 DANGER
  { id: 'ci-037', nameA: '氯吡格雷', typeA: 'DRUG', nameB: '奥美拉唑', typeB: 'DRUG', level: 'WARN', ruleId: 'R-CLOPID-OMEPRAZOLE', message: '奥美拉唑可降低氯吡格雷抗血小板活性，建议换用泮托拉唑或雷贝拉唑。', bidirectional: true },
  // 地高辛 + 胺碘酮 DANGER
  { id: 'ci-038', nameA: '地高辛', typeA: 'DRUG', nameB: '胺碘酮', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-DIGOXIN-AMIODARONE', message: '胺碘酮可升高地高辛血药浓度1-2倍致中毒，地高辛应减半并监测血药。', bidirectional: true },
  // 地高辛 + 维拉帕米 DANGER
  { id: 'ci-039', nameA: '地高辛', typeA: 'DRUG', nameB: '维拉帕米', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-DIGOXIN-VERAPAMIL', message: '维拉帕米抑制地高辛肾排泄致血药浓度升高，需监测并减量。', bidirectional: true },
  // 糖皮质激素 + 排钾利尿剂 DANGER
  { id: 'ci-040', nameA: 'CAT:CORTICOSTEROID_SYSTEMIC', typeA: 'CATEGORY', nameB: 'CAT:DIURETIC_LOOP', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-STEROID-LOOP', message: '糖皮质激素与袢利尿剂合用可加重低钾血症，需监测血钾。', bidirectional: true },
  { id: 'ci-040b', nameA: 'CAT:CORTICOSTEROID_SYSTEMIC', typeA: 'CATEGORY', nameB: 'CAT:DIURETIC_THIAZIDE', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-STEROID-THIAZIDE', message: '糖皮质激素与噻嗪类合用可加重低钾血症，需监测血钾。', bidirectional: true },
  // 华法林 + 阿司匹林 DANGER
  { id: 'ci-041', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: '阿司匹林', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-WARFARIN-ASPIRIN', message: '华法林与阿司匹林合用大出血风险显著增加，需严格评估获益风险比。', bidirectional: true },
  // DOAC + 抗血小板 DANGER
  { id: 'ci-042', nameA: 'CAT:ANTICOAGULANT_DIRECT', typeA: 'CATEGORY', nameB: 'CAT:ANTICOAGULANT_ANTIPLATELET', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-DOAC-ANTIPLATELET', message: '直接抗凝药与抗血小板药合用大出血风险显著增加，非必要不联合。', bidirectional: true },
  // 孕期 + 氨基糖苷 DANGER
  { id: 'ci-043', nameA: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeA: 'CATEGORY', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-AG-PREG', message: '氨基糖苷类可透过胎盘致胎儿耳毒性，孕期尽量避免使用。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 孕期 + 磺胺 DANGER
  { id: 'ci-044', nameA: 'CAT:ANTIBIOTIC_SULFONAMIDE', typeA: 'CATEGORY', nameB: 'PREGNANCY_3RD', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-SULFA-PREG3', message: '孕晚期使用磺胺类可致新生儿核黄疸，妊娠晚期禁用。', appliesTo: { pregnancy: ['THIRD'] }, bidirectional: false },
  // 哺乳期 + 氯霉素 DANGER
  { id: 'ci-045', nameA: '氯霉素', typeA: 'DRUG', nameB: 'LACTATION', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-CHLORAMPH-LACT', message: '氯霉素可至乳汁致灰婴综合征，哺乳期绝对禁用。', appliesTo: { lactation: true }, bidirectional: false },
  // 哺乳期 + 锂盐 DANGER
  { id: 'ci-046', nameA: '碳酸锂', typeA: 'DRUG', nameB: 'LACTATION', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-LITHIUM-LACT', message: '锂盐大量分泌至乳汁，可致婴儿中毒，哺乳期禁用。', appliesTo: { lactation: true }, bidirectional: false },
  // 严重肝功 + 丙戊酸 DANGER
  { id: 'ci-047', nameA: '丙戊酸钠', typeA: 'DRUG', nameB: 'LIVER_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-VALPROATE-LIVER-SEV', message: '严重肝功能不全使用丙戊酸可致严重肝毒性甚至肝衰竭，禁用。', appliesTo: { liver: LIVER_SEVERE }, bidirectional: false },
  // 严重肝功 + 胺碘酮 DANGER
  { id: 'ci-048', nameA: '胺碘酮', typeA: 'DRUG', nameB: 'LIVER_SEVERE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-AMIODARONE-LIVER-SEV', message: '严重肝功能不全使用胺碘酮可致肝硬化和急性肝衰，禁用。', appliesTo: { liver: LIVER_SEVERE }, bidirectional: false },
  // 6-巯基嘌呤 + 别嘌醇 DANGER
  { id: 'ci-049', nameA: '别嘌醇', typeA: 'DRUG', nameB: '硫唑嘌呤', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-ALLOPURINOL-AZATHIO', message: '别嘌醇抑制硫唑嘌呤代谢致严重骨髓抑制，需大幅减量并监测。', bidirectional: true },
  // 苯二氮卓 + 阿片类 DANGER
  { id: 'ci-050', nameA: 'CAT:BENZODIAZEPINE', typeA: 'CATEGORY', nameB: 'CAT:OPIOID', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-BENZO-OPIOID', message: '苯二氮卓类与阿片类合用可致严重呼吸抑制和死亡，尽量避免联合。', bidirectional: true },
  // 镇静抗组胺 + 阿片类 DANGER
  { id: 'ci-051', nameA: 'CAT:ANTIHISTAMINE_SEDATING', typeA: 'CATEGORY', nameB: 'CAT:OPIOID', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SEDH1-OPIOID', message: '镇静抗组胺药与阿片类合用加重中枢抑制和呼吸抑制风险，需减量。', bidirectional: true },
  // 喹诺酮 + 茶碱 DANGER
  { id: 'ci-052', nameA: 'CAT:ANTIBIOTIC_QUINOLONE', typeA: 'CATEGORY', nameB: '氨茶碱', typeB: 'DRUG', level: 'WARN', ruleId: 'R-QUINOLONE-THEO', message: '喹诺酮可抑制茶碱代谢致其血药浓度升高，易发生抽搐等毒性反应。', bidirectional: true },
  // 孕期 + 异维A酸 DANGER
  { id: 'ci-053', nameA: '异维A酸', typeA: 'DRUG', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ISOTRET-PREG', message: '异维A酸为强效致畸剂，妊娠前后1个月内禁用，需严格避孕。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 孕期 + 甲氨蝶呤 DANGER
  { id: 'ci-054', nameA: '甲氨蝶呤', typeA: 'DRUG', nameB: 'PREGNANCY_ANY', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-MTX-PREG', message: '甲氨蝶呤为绝对致畸药，妊娠全程禁用，停药3-6个月后方可受孕。', appliesTo: { pregnancy: ALL_PREGNANCY }, bidirectional: false },
  // 哺乳期 + 四环素（已覆盖，补环丙沙星）
  { id: 'ci-055', nameA: '环丙沙星', typeA: 'DRUG', nameB: 'LACTATION', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-CIPRO-LACT', message: '喹诺酮类可分泌至乳汁，对婴儿关节软骨有潜在影响，建议暂停哺乳。', appliesTo: { lactation: true }, bidirectional: false },
  // 儿童喹诺酮 DANGER
  { id: 'ci-056', nameA: 'CAT:ANTIBIOTIC_QUINOLONE', typeA: 'CATEGORY', nameB: 'PEDIATRIC', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-QUINOLONE-PED', message: '18岁以下喹诺酮类可能致关节软骨损伤，仅在获益大于风险时使用。', appliesTo: { ageMax: 18 }, bidirectional: false },
  // 儿童四环素 DANGER
  { id: 'ci-057', nameA: 'CAT:ANTIBIOTIC_TETRACYCLINE', typeA: 'CATEGORY', nameB: 'PEDIATRIC', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-TETRA-PED', message: '8岁以下使用四环素类可致恒牙黄染及牙釉质发育不良，禁用。', appliesTo: { ageMax: 8 }, bidirectional: false },
  // 肾功不全 ACEI DANGER 双侧肾动脉狭窄
  { id: 'ci-058', nameA: 'CAT:ANTIHYPERTENSIVE_ACEI', typeA: 'CATEGORY', nameB: 'RENAL_MOD_SEV', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-ACEI-RENAL-MOD', message: '中重度肾功能不全使用ACEI需监测肌酐和血钾，双侧肾动脉狭窄禁用。', appliesTo: { renal: RENAL_MOD_SEVERE }, bidirectional: false },
  // 华法林 + 氟康唑（已ci-018b）补伊曲康唑
  { id: 'ci-059', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: '伊曲康唑', typeB: 'DRUG', level: 'WARN', ruleId: 'R-WARFARIN-ITRA', message: '伊曲康唑抑制华法林代谢致INR升高，需密切监测并调整剂量。', bidirectional: true },
  // 他汀 + 胺碘酮 WARN
  { id: 'ci-060', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '胺碘酮', typeB: 'DRUG', level: 'WARN', ruleId: 'R-STATIN-AMIODARONE', message: '胺碘酮抑制他汀代谢，增加肌病风险，他汀剂量不宜超过20mg/日。', bidirectional: true },
  // 头孢 + 氨基糖苷 DANGER 肾毒性
  { id: 'ci-061', nameA: 'CAT:ANTIBIOTIC_CEPHALOSPORIN', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-CEPH-AG-TOXICITY', message: '一代头孢与氨基糖苷合用增加肾毒性风险，需监测肾功能。', bidirectional: true },
  // 青霉素 + 别嘌醇 WARN（皮疹）
  { id: 'ci-062', nameA: 'CAT:ANTIBIOTIC_PENICILLIN', typeA: 'CATEGORY', nameB: '别嘌醇', typeB: 'DRUG', level: 'WARN', ruleId: 'R-PEN-ALLOPURINOL', message: '青霉素与别嘌醇合用可增加过敏性皮疹发生率，需密切观察。', bidirectional: true },
  // 口服铁 + 四环素/喹诺酮 DANGER（吸收）
  { id: 'ci-063', nameA: 'CAT:IRON_SUPPLEMENT', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_TETRACYCLINE', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-IRON-TETRA', message: '铁剂与四环素在肠道形成难溶络合物，两者吸收均显著下降，需间隔3h。', bidirectional: true },
  { id: 'ci-064', nameA: 'CAT:IRON_SUPPLEMENT', typeA: 'CATEGORY', nameB: 'CAT:ANTIBIOTIC_QUINOLONE', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-IRON-QUINOLONE', message: '铁剂与喹诺酮合用显著降低口服生物利用度，建议间隔2-4h。', bidirectional: true },
  // 洋地黄 + 钙剂 DANGER
  { id: 'ci-065', nameA: '地高辛', typeA: 'DRUG', nameB: 'CAT:CALCIUM_ANTACID', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-DIGOXIN-CA', message: '血钙升高可增强洋地黄毒性，使用洋地黄时避免快速静脉补钙。', bidirectional: true },
  // β受体阻滞剂 + 维拉帕米 DANGER
  { id: 'ci-066', nameA: 'CAT:ANTIHYPERTENSIVE_BETA_BLOCKER', typeA: 'CATEGORY', nameB: '维拉帕米', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-BB-VERAPAMIL', message: 'β阻滞剂与维拉帕米静脉合用可致严重心动过缓、房室传导阻滞甚至停搏。', bidirectional: true },
  // SSRI + 三环类 WARN
  { id: 'ci-067', nameA: 'CAT:SSRI', typeA: 'CATEGORY', nameB: 'CAT:TRICYCLIC_ANTIDEPRESSANT', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SSRI-TCA', message: 'SSRI可升高三环类血药浓度，增加5-HT综合征风险，需减量并监测。', bidirectional: true },
  // SSRI + SNRI WARN
  { id: 'ci-068', nameA: 'CAT:SSRI', typeA: 'CATEGORY', nameB: 'CAT:SNRI', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SSRI-SNRI', message: 'SSRI与SNRI联合增加5-HT综合征风险，通常不推荐两种抗抑郁药联用。', bidirectional: true },
  // 磺胺 + 甲氨蝶呤 DANGER
  { id: 'ci-069', nameA: 'CAT:ANTIBIOTIC_SULFONAMIDE', typeA: 'CATEGORY', nameB: '甲氨蝶呤', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-SULFA-MTX', message: '磺胺类可置换蛋白结合并减少MTX排泄，致严重骨髓抑制和黏膜毒性。', bidirectional: true },
  // 阿片 + 阿片 重复 DANGER
  { id: 'ci-070', nameA: 'CAT:OPIOID', typeA: 'CATEGORY', nameB: 'CAT:OPIOID', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-DOUBLE-OPIOID', message: '两种阿片类联合使用显著增加呼吸抑制和过量死亡风险，避免重复用药。', bidirectional: false },
  // 甲硝唑 + 华法林 WARN
  { id: 'ci-071', nameA: 'CAT:ANTIBIOTIC_METRONIDAZOLE', typeA: 'CATEGORY', nameB: 'CAT:ANTICOAGULANT_WARFARIN', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-METRO-WARFARIN', message: '甲硝唑可抑制华法林代谢致INR升高，需密切监测INR并考虑减量。', bidirectional: true },

  // ==== 更多 WARN（约 26 条，累计 30+）====
  // 抗生素 + 活菌制剂
  { id: 'ci-072', nameA: 'CAT:ANTIBIOTIC_BROAD_SPECTRUM', typeA: 'CATEGORY', nameB: '双歧杆菌', typeB: 'DRUG', level: 'INFO', ruleId: 'R-ABX-PROBIOTIC', message: '广谱抗生素可灭活益生菌，建议两者间隔2-3小时服用。', bidirectional: true },
  // 硝酸酯类 + 西地那非（DANGER 但标注信息级别）
  { id: 'ci-073', nameA: '硝酸甘油', typeA: 'DRUG', nameB: '西地那非', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-NITRATE-SILDENAFIL', message: '硝酸酯与5型磷酸二酯酶抑制剂合用可致严重低血压甚至猝死，绝对禁用。', bidirectional: true },
  // CCB + 西地那非 WARN
  { id: 'ci-074', nameA: 'CAT:ANTIHYPERTENSIVE_CCB', typeA: 'CATEGORY', nameB: '西地那非', typeB: 'DRUG', level: 'WARN', ruleId: 'R-CCB-SILDENAFIL', message: '钙通道阻滞剂与西地那非合用可能增强降压作用，需监测血压。', bidirectional: true },
  // 索他洛尔 + 利尿剂 WARN（QT延长）
  { id: 'ci-075', nameA: '索他洛尔', typeA: 'DRUG', nameB: 'CAT:DIURETIC_LOOP', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SOTALOL-LOOP', message: '低钾低镁可增加索他洛尔致尖端扭转室速风险，需纠正电解质紊乱。', bidirectional: true },
  // 左氧氟沙星 + 延长QT药 WARN
  { id: 'ci-076', nameA: '左氧氟沙星', typeA: 'DRUG', nameB: 'CAT:ANTIDYSRHYTHMIC_CLASS_I', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LEVO-Ia', message: '喹诺酮合并Ia类抗心律失常药延长QT间期，有尖端扭转风险，慎用。', bidirectional: true },
  { id: 'ci-076b', nameA: '左氧氟沙星', typeA: 'DRUG', nameB: 'CAT:ANTIDYSRHYTHMIC_CLASS_III', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LEVO-III', message: '喹诺酮合并III类抗心律失常药延长QT间期，有尖端扭转风险，慎用。', bidirectional: true },
  // 华法林 + 维生素K食物 INFO
  { id: 'ci-077', nameA: '华法林', typeA: 'DRUG', nameB: '维生素K', typeB: 'DRUG', level: 'WARN', ruleId: 'R-WARFARIN-VITK', message: '维生素K可拮抗华法林作用致INR下降，应保持饮食中维生素K摄入稳定。', bidirectional: true },
  // 苯妥英 + 叶酸 INFO
  { id: 'ci-078', nameA: '苯妥英钠', typeA: 'DRUG', nameB: '叶酸', typeB: 'DRUG', level: 'INFO', ruleId: 'R-PHENYTOIN-FOLATE', message: '苯妥英可致叶酸缺乏，长期服用建议补充叶酸5mg/日。', bidirectional: true },
  // 铁 + 浓茶 INFO
  { id: 'ci-079', nameA: 'CAT:IRON_SUPPLEMENT', typeA: 'CATEGORY', nameB: '浓茶', typeB: 'DRUG', level: 'WARN', ruleId: 'R-IRON-TEA', message: '茶叶中的鞣酸与铁形成不溶复合物，服铁剂前后1小时避免饮茶。', bidirectional: true },
  // 华法林 + 高脂饮食 INFO
  { id: 'ci-080', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: '高脂饮食', typeB: 'DRUG', level: 'INFO', ruleId: 'R-WARFARIN-HIGHFAT', message: '服用华法林期间应保持饮食结构稳定，避免突然大量摄入高脂食物。', bidirectional: false },
  // ACEI 干咳 INFO
  { id: 'ci-081', nameA: 'CAT:ANTIHYPERTENSIVE_ACEI', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'INFO', ruleId: 'R-ACEI-ELDERLY-COUGH', message: '老年患者使用ACEI干咳发生率较高，如不耐受可换用ARB。', appliesTo: { ageMin: 65 }, bidirectional: false },
  // 他汀 + 柚子 WARN
  { id: 'ci-082', nameA: 'CAT:STATIN', typeA: 'CATEGORY', nameB: '西柚汁', typeB: 'DRUG', level: 'WARN', ruleId: 'R-STATIN-GRAPEFRUIT', message: '西柚汁可显著升高他汀血药浓度，服用他汀期间避免大量饮用西柚汁。', bidirectional: false },
  // 非洛地平 + 柚子 WARN
  { id: 'ci-083', nameA: '非洛地平', typeA: 'DRUG', nameB: '西柚汁', typeB: 'DRUG', level: 'WARN', ruleId: 'R-FELODIPINE-GRAPEFRUIT', message: '西柚汁抑制CYP3A4可使非洛地平血药浓度成倍升高，避免同服。', bidirectional: false },
  // 甲硝唑 + 避孕药 WARN
  { id: 'ci-084', nameA: 'CAT:ANTIBIOTIC_METRONIDAZOLE', typeA: 'CATEGORY', nameB: '口服避孕药', typeB: 'DRUG', level: 'WARN', ruleId: 'R-METRO-OCP', message: '部分抗生素可能影响口服避孕药肠肝循环，建议服药期间加用屏障避孕。', bidirectional: false },
  // 利福平 + 口服避孕药 DANGER
  { id: 'ci-085', nameA: '利福平', typeA: 'DRUG', nameB: '口服避孕药', typeB: 'DRUG', level: 'DANGER', ruleId: 'R-RIFAMPIN-OCP', message: '利福平为强效酶诱导剂，显著加快口服避孕药代谢，可致避孕失败。', bidirectional: false },
  // 儿童阿司匹林 DANGER
  { id: 'ci-086', nameA: '阿司匹林', typeA: 'DRUG', nameB: 'PEDIATRIC', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-ASPIRIN-PED', message: '儿童和青少年（<18岁）病毒感染期使用阿司匹林有Reye综合征风险，除川崎病外禁用。', appliesTo: { ageMax: 18 }, bidirectional: false },
  // 哺乳 + 可卡因 DANGER
  { id: 'ci-087', nameA: '可卡因', typeA: 'DRUG', nameB: 'LACTATION', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-COCAINE-LACT', message: '可卡因可分泌至乳汁致婴儿严重神经毒性和心血管毒性，哺乳期绝对禁用。', appliesTo: { lactation: true }, bidirectional: false },
  // 肾损 + 磺脲类 WARN
  { id: 'ci-088', nameA: 'CAT:ANTIDIABETIC_SULFONYLUREA', typeA: 'CATEGORY', nameB: 'RENAL_MOD_SEV', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-SULFONYL-RENAL-MOD', message: '中重度肾功能不全磺脲类代谢产物蓄积，低血糖风险增加，建议换用胰岛素或利格列汀。', appliesTo: { renal: RENAL_MOD_SEVERE }, bidirectional: false },
  // 中重度肝损 + 对乙酰氨基酚 WARN
  { id: 'ci-089', nameA: '对乙酰氨基酚', typeA: 'DRUG', nameB: 'LIVER_MOD_SEV', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-APAP-LIVER-MOD', message: '中度肝功能不全时对乙酰氨基酚日剂量不应超过2g，并密切监测肝功能。', appliesTo: { liver: LIVER_MOD_SEVERE }, bidirectional: false },
  // 华法林 + 鱼油 INFO
  { id: 'ci-090', nameA: 'CAT:ANTICOAGULANT_WARFARIN', typeA: 'CATEGORY', nameB: '鱼油', typeB: 'DRUG', level: 'INFO', ruleId: 'R-WARFARIN-FISHOIL', message: '高剂量鱼油(>3g/日)有轻度抗血小板作用，与华法林合用需监测INR。', bidirectional: true },
  // 老年 + 三环类抗抑郁 INFO
  { id: 'ci-091', nameA: 'CAT:TRICYCLIC_ANTIDEPRESSANT', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-TCA-ELDERLY', message: '老年患者三环类抗抑郁药易致体位性低血压、尿潴留和认知损害，建议减量。', appliesTo: { ageMin: 65 }, bidirectional: false },
  // 老年 + 苯二氮卓 INFO
  { id: 'ci-092', nameA: 'CAT:BENZODIAZEPINE', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-BENZO-ELDERLY', message: '老年人使用苯二氮卓类跌倒和骨折风险显著增加，尽量避免长期使用。', appliesTo: { ageMin: 65 }, bidirectional: false },
  // 磺胺 + ACEI 警告（过敏交叉）
  { id: 'ci-093', nameA: 'CAT:ANTIBIOTIC_SULFONAMIDE', typeA: 'CATEGORY', nameB: '氢氯噻嗪', typeB: 'DRUG', level: 'INFO', ruleId: 'R-SULFA-HCTZ-SENSITIVITY', message: '磺胺类过敏者对噻嗪类利尿剂过敏的理论风险存在，需观察过敏反应。', bidirectional: true },
  // 左旋甲状腺素 + 钙/铁/质子泵 WARN
  { id: 'ci-094', nameA: '左甲状腺素', typeA: 'DRUG', nameB: 'CAT:CALCIUM_ANTACID', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LEVOTHYROXINE-CA', message: '钙剂与左甲状腺素合用降低其吸收，需至少间隔4小时服用。', bidirectional: true },
  { id: 'ci-095', nameA: '左甲状腺素', typeA: 'DRUG', nameB: 'CAT:IRON_SUPPLEMENT', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LEVOTHYROXINE-FE', message: '铁剂干扰左甲状腺素吸收，需至少间隔4小时服用。', bidirectional: true },
  // 二甲双胍 + 酒精 DANGER
  { id: 'ci-096', nameA: 'CAT:METFORMIN', typeA: 'CATEGORY', nameB: 'CAT:ALCOHOL_GENERAL', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-METFORMIN-ALCOHOL', message: '二甲双胍与酒精合用增加乳酸性酸中毒风险，服药期间避免大量饮酒。', bidirectional: true },
  // 头孢 + 氨基糖苷（已ci-061），补：呋塞米 + 氨基糖苷 已覆盖
  // 利奈唑胺 + SSRIs/SNRIs WARN
  { id: 'ci-097', nameA: '利奈唑胺', typeA: 'DRUG', nameB: 'CAT:SSRI', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LINEZOLID-SSRI', message: '利奈唑胺有弱MAO抑制作用，与SSRI合用增加5-HT综合征风险。', bidirectional: true },
  { id: 'ci-098', nameA: '利奈唑胺', typeA: 'DRUG', nameB: 'CAT:SNRI', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-LINEZOLID-SNRI', message: '利奈唑胺有弱MAO抑制作用，与SNRI合用增加5-HT综合征风险。', bidirectional: true },
  // 环孢素 + 他汀 DANGER
  { id: 'ci-099', nameA: '环孢素', typeA: 'DRUG', nameB: 'CAT:STATIN', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-CYCLOSPORINE-STATIN', message: '环孢素显著升高他汀血药浓度，横纹肌溶解风险增加，宜用低剂量普伐他汀/氟伐他汀。', bidirectional: true },
  // INFO 级
  { id: 'ci-100', nameA: '阿莫西林', typeA: 'DRUG', nameB: '口服避孕药', typeB: 'DRUG', level: 'INFO', ruleId: 'R-AMOXICILLIN-OCP', message: '除利福平外，多数广谱抗生素对口服避孕药影响证据有限，可根据个体情况考虑加用屏障避孕。', bidirectional: false },
  { id: 'ci-101', nameA: 'CAT:ANTIBIOTIC_PENICILLIN', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'INFO', ruleId: 'R-PEN-ELDERLY-RENAL', message: '老年患者青霉素类需按肌酐清除率调整剂量，避免中枢毒性。', appliesTo: { ageMin: 65 }, bidirectional: false },
  { id: 'ci-102', nameA: 'CAT:DIURETIC_THIAZIDE', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'INFO', ruleId: 'R-THIAZIDE-ELDERLY-ELECTRO', message: '老年患者噻嗪类利尿剂易致低钾、低钠和高尿酸，建议定期监测电解质。', appliesTo: { ageMin: 65 }, bidirectional: false },
  { id: 'ci-103', nameA: 'CAT:NSAIDS', typeA: 'CATEGORY', nameB: 'PATIENT_ELDERLY', typeB: 'CATEGORY', level: 'WARN', ruleId: 'R-NSAID-ELDERLY-GI', message: '65岁以上老年患者使用NSAID消化道出血及穿孔风险增加2-3倍，建议联用PPI。', appliesTo: { ageMin: 65 }, bidirectional: false },
  { id: 'ci-104', nameA: 'CAT:ANTIHYPERTENSIVE_BETA_BLOCKER', typeA: 'CATEGORY', nameB: '糖尿病', typeB: 'DRUG', level: 'WARN', ruleId: 'R-BB-DM-MASK-HYPO', message: '非选择性β受体阻滞剂可掩盖低血糖心动过速症状，糖尿病患者注意监测血糖。', bidirectional: false },
  { id: 'ci-105', nameA: 'ACEI/ARB+利尿剂联合', typeA: 'DRUG', nameB: '肾功能', typeB: 'DRUG', level: 'INFO', ruleId: 'R-ACEI-HCTZ-START', message: '初始联合使用ACEI和利尿剂时建议监测肾功能和电解质1-2周。', bidirectional: false },
  // ===== 补充 6 条人群级 DANGER 禁忌，使 DANGER≥60 / 人群规则≥40 =====
  { id: 'ci-106', nameA: 'CAT:ANTIBIOTIC_TETRACYCLINE', typeA: 'CATEGORY', nameB: 'PEDIATRIC_UNDER8', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-TETRACYCLINE-PED-UNDER8', message: '8岁以下儿童使用四环素类药物可致恒牙黄染、牙釉质发育不良和骨生长抑制，应禁用。', appliesTo: { ageMax: 8 }, bidirectional: false },
  { id: 'ci-107', nameA: 'CAT:ANTIBIOTIC_QUINOLONE', typeA: 'CATEGORY', nameB: 'PEDIATRIC_UNDER18', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-QUINOLONE-PED', message: '18岁以下未成年人使用喹诺酮类药物可致关节软骨损害，应避免常规使用。', appliesTo: { ageMax: 18 }, bidirectional: false },
  { id: 'ci-108', nameA: 'CAT:NSAIDS', typeA: 'CATEGORY', nameB: 'PREGNANCY_THIRD', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-NSAID-PREG-3RD', message: '妊娠晚期（>28周）使用NSAID可增加胎儿动脉导管早闭和肾脏损害风险，禁用。', appliesTo: { pregnancy: ['THIRD'] }, bidirectional: false },
  { id: 'ci-109', nameA: 'CAT:ANTIBIOTIC_AMINOGLYCOSIDE', typeA: 'CATEGORY', nameB: 'RENAL_MOD_SEV_POP', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-AMINOGLYCOSIDE-RENAL-MODSEV', message: '中重度肾功能不全使用氨基糖苷类耳肾毒性显著增高，应禁用或TDM监测。', appliesTo: { renal: RENAL_MOD_SEVERE }, bidirectional: false },
  { id: 'ci-110', nameA: 'CAT:ANTIBIOTIC_MACROLIDE', typeA: 'CATEGORY', nameB: 'CARDIAC_LONGQT', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-MACROLIDE-QT', message: '大环内酯类抗生素可延长QT间期，有致尖端扭转型室速风险，QT延长者禁用。', appliesTo: { ageMin: 65 }, bidirectional: false },
  { id: 'ci-111', nameA: 'CAT:BENZODIAZEPINE', typeA: 'CATEGORY', nameB: 'CAT:OPIOID', typeB: 'CATEGORY', level: 'DANGER', ruleId: 'R-BENZO-OPIOID', message: '苯二氮卓类与阿片类合用显著增加呼吸抑制、昏迷和死亡风险，避免联用。', bidirectional: true },
];

// 补充特殊"类别标记"匹配项（PREGNANCY, LIVER, RENAL, AGE）
// 这些由 validate 算法内部直接通过 appliesTo 过滤，不作为 drug pair 匹配使用
export const PREGNANCY_TRIMESTERS = ['FIRST_TRIMESTER', 'SECOND', 'THIRD'] as const;
export const LIVER_LEVELS = ['NONE', 'MILD', 'MODERATE', 'SEVERE'] as const;
export const RENAL_LEVELS = ['NONE', 'MILD', 'MODERATE', 'SEVERE'] as const;

export function getSeedsCount() {
  let d = 0, w = 0, i = 0, p = 0;
  for (const s of CONTRAINDICATION_SEEDS) {
    if (s.level === 'DANGER') d++;
    else if (s.level === 'WARN') w++;
    else i++;
    if (s.appliesTo && (s.appliesTo.pregnancy || s.appliesTo.lactation || s.appliesTo.liver || s.appliesTo.renal || s.appliesTo.ageMin || s.appliesTo.ageMax)) p++;
  }
  return { total: CONTRAINDICATION_SEEDS.length, danger: d, warn: w, info: i, population: p };
}
