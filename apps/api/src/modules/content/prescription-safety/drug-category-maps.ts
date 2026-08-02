const CATEGORY_RULES: Record<string, string[]> = {
  NSAIDS: [
    '双氯芬酸', '布洛芬', '洛索洛芬', '对乙酰氨基酚', '阿司匹林',
    '塞来昔布', '依托考昔', '吲哚美辛', '萘普生', '酮咯酸',
    '美洛昔康', '吡罗昔康', '尼美舒利', '氟比洛芬', '奥沙普秦',
    '芬布芬', '舒林酸', '安乃近', '保泰松', '氯诺昔康',
  ],
  ANTIBIOTIC_BROAD_SPECTRUM: [
    '头孢氨苄', '头孢拉定', '头孢克洛', '头孢呋辛', '头孢克肟',
    '头孢地尼', '头孢曲松', '头孢噻肟', '阿莫西林', '氨苄西林',
    '哌拉西林', '美罗培南', '亚胺培南', '左氧氟沙星', '环丙沙星',
    '莫西沙星', '阿奇霉素', '克拉霉素', '多西环素', '米诺环素',
  ],
  ANTIBIOTIC_CEPHALOSPORIN: [
    '头孢氨苄', '头孢拉定', '头孢克洛', '头孢呋辛', '头孢克肟',
    '头孢地尼', '头孢曲松', '头孢噻肟', '头孢他啶', '头孢哌酮',
    '头孢吡肟', '头孢托仑', '头孢丙烯', '头孢唑林', '头孢硫脒',
  ],
  ANTIBIOTIC_PENICILLIN: [
    '阿莫西林', '氨苄西林', '哌拉西林', '青霉素', '阿莫西林克拉维酸',
    '氨苄西林舒巴坦', '哌拉西林他唑巴坦', '氟氯西林', '苯唑西林',
  ],
  ANTIBIOTIC_METRONIDAZOLE: [
    '甲硝唑', '替硝唑', '奥硝唑', '左奥硝唑', '塞克硝唑',
  ],
  ANTIBIOTIC_QUINOLONE: [
    '左氧氟沙星', '环丙沙星', '莫西沙星', '诺氟沙星', '氧氟沙星',
    '培氟沙星', '洛美沙星', '依诺沙星', '司帕沙星', '加替沙星',
  ],
  ANTIBIOTIC_TETRACYCLINE: [
    '四环素', '多西环素', '米诺环素', '土霉素', '金霉素',
  ],
  ANTIBIOTIC_MACROLIDE: [
    '红霉素', '阿奇霉素', '克拉霉素', '罗红霉素', '地红霉素',
    '交沙霉素', '麦迪霉素', '乙酰螺旋霉素',
  ],
  ANTIBIOTIC_SULFONAMIDE: [
    '磺胺甲恶唑', '磺胺嘧啶', '复方磺胺甲恶唑', '甲氧苄啶', '柳氮磺吡啶',
  ],
  ANTIBIOTIC_AMINOGLYCOSIDE: [
    '庆大霉素', '阿米卡星', '妥布霉素', '奈替米星', '链霉素', '异帕米星',
  ],
  ANTIBIOTIC_GLYCOPEPTIDE: [
    '万古霉素', '去甲万古霉素', '替考拉宁',
  ],
  ANTIBIOTIC_AZOLE: [
    '氟康唑', '伊曲康唑', '伏立康唑', '酮康唑', '咪康唑', '克霉唑',
  ],
  ANTICOAGULANT_WARFARIN: ['华法林'],
  ANTICOAGULANT_DIRECT: [
    '利伐沙班', '阿哌沙班', '达比加群', '依度沙班',
  ],
  ANTICOAGULANT_ANTIPLATELET: [
    '阿司匹林', '氯吡格雷', '替格瑞洛', '噻氯匹定', '双嘧达莫',
  ],
  ANTIHYPERTENSIVE_ACEI: [
    '卡托普利', '依那普利', '贝那普利', '培哚普利', '赖诺普利',
    '雷米普利', '福辛普利', '西拉普利', '咪达普利', '群多普利',
  ],
  ANTIHYPERTENSIVE_ARB: [
    '缬沙坦', '氯沙坦', '厄贝沙坦', '替米沙坦', '奥美沙坦',
    '坎地沙坦', '替米沙坦', '阿齐沙坦', '依普罗沙坦',
  ],
  ANTIHYPERTENSIVE_BETA_BLOCKER: [
    '美托洛尔', '比索洛尔', '普萘洛尔', '阿替洛尔', '卡维地洛',
    '拉贝洛尔', '索他洛尔',
  ],
  ANTIHYPERTENSIVE_CCB: [
    '硝苯地平', '氨氯地平', '非洛地平', '尼莫地平', '地尔硫卓',
    '维拉帕米', '左旋氨氯地平',
  ],
  DIURETIC_LOOP: [
    '呋塞米', '托拉塞米', '布美他尼', '依他尼酸',
  ],
  DIURETIC_THIAZIDE: [
    '氢氯噻嗪', '吲达帕胺', '苄氟噻嗪', '氯噻酮',
  ],
  DIURETIC_POTASSIUM_SPARING: [
    '螺内酯', '氨苯蝶啶', '阿米洛利',
  ],
  POTASSIUM_SUPPLEMENT: [
    '氯化钾', '枸橼酸钾', '门冬氨酸钾镁', '氯化钾缓释',
  ],
  CALCIUM_ANTACID: [
    '碳酸钙', '氢氧化铝', '铝碳酸镁', '枸橼酸铋', '次碳酸铋',
    '硫糖铝', '氢氧化镁', '三硅酸镁', '雷尼替丁含铝', '抗酸',
    '胃舒平', '达喜',
  ],
  IRON_SUPPLEMENT: [
    '硫酸亚铁', '富马酸亚铁', '琥珀酸亚铁', '右旋糖酐铁', '多糖铁复合物',
  ],
  ALCOHOL_GENERAL: [
    '酒精', '乙醇', '药酒', '藿香正气水', '十滴水',
    '国公酒', '冯了性风湿跌打药酒', '木瓜酒', '风湿液', '骨刺消痛液',
    '跌打万花油', '正骨水', '云香精',
  ],
  SSRI: [
    '舍曲林', '氟西汀', '帕罗西汀', '氟伏沙明', '西酞普兰', '艾司西酞普兰',
  ],
  SNRI: [
    '文拉法辛', '度洛西汀', '米那普仑', '左旋米那普仑',
  ],
  MAOI: [
    '苯乙肼', '司来吉兰', '吗氯贝胺', '反苯环丙胺', '异卡波肼',
  ],
  TRICYCLIC_ANTIDEPRESSANT: [
    '阿米替林', '丙米嗪', '氯米帕明', '多塞平', '地昔帕明', '去甲替林',
  ],
  STATIN: [
    '阿托伐他汀', '瑞舒伐他汀', '辛伐他汀', '洛伐他汀', '普伐他汀',
    '氟伐他汀', '匹伐他汀',
  ],
  FIBRATE: [
    '非诺贝特', '苯扎贝特', '吉非贝齐', '氯贝丁酯',
  ],
  ANTIFUNGAL_AZOLE_SYSTEMIC: [
    '酮康唑', '伊曲康唑', '氟康唑', '伏立康唑', '泊沙康唑',
  ],
  ANTIHISTAMINE_SEDATING: [
    '氯苯那敏', '苯海拉明', '异丙嗪', '赛庚啶', '酮替芬',
  ],
  BENZODIAZEPINE: [
    '地西泮', '阿普唑仑', '艾司唑仑', '氯硝西泮', '劳拉西泮',
    '奥沙西泮', '咪达唑仑', '三唑仑',
  ],
  OPIOID: [
    '吗啡', '哌替啶', '芬太尼', '舒芬太尼', '瑞芬太尼',
    '羟考酮', '氢吗啡酮', '曲马多', '可待因', '布桂嗪',
  ],
  METFORMIN: ['二甲双胍', '格华止'],
  IODINE_CONTRAST: ['碘造影剂', '泛影葡胺', '碘海醇', '碘帕醇', '碘普罗胺'],
  PREGNANCY_CATEGORY_D_X: [
    '四环素', '多西环素', '米诺环素', '左氧氟沙星', '环丙沙星',
    '莫西沙星', '甲硝唑', '华法林', '卡托普利', '依那普利',
    '贝那普利', '培哚普利', '赖诺普利', '缬沙坦', '氯沙坦',
    '厄贝沙坦', '替米沙坦', '奥美沙坦', '螺内酯', '异维A酸',
    '利巴韦林', '甲氨蝶呤', '环磷酰胺', '丙戊酸钠', '苯妥英钠',
    '卡马西平', '苯巴比妥', '锂盐', '胺碘酮', '氟喹诺酮',
  ],
  LACTATION_RISK: [
    '四环素', '多西环素', '米诺环素', '左氧氟沙星', '环丙沙星',
    '莫西沙星', '甲硝唑', '华法林', '氯霉素', '胺碘酮',
    '锂盐', '苯二氮卓', '地西泮', '阿普唑仑', '艾司唑仑',
    '氟西汀', '帕罗西汀', '舍曲林慎用',
  ],
  LIVER_IMPAIRMENT_RISK: [
    '对乙酰氨基酚', '甲硝唑', '氟康唑', '红霉素', '四环素',
    '胺碘酮', '异烟肼', '利福平', '丙戊酸钠', '卡马西平',
    '苯妥英钠', '阿托伐他汀', '辛伐他汀', '瑞舒伐他汀',
    '对氨基水杨酸', '甲氨蝶呤', '硫唑嘌呤',
  ],
  RENAL_IMPAIRMENT_RISK: [
    '双氯芬酸', '布洛芬', '洛索洛芬', '对乙酰氨基酚', '阿司匹林',
    '塞来昔布', '依托考昔', '吲哚美辛', '萘普生', '酮咯酸',
    '庆大霉素', '阿米卡星', '妥布霉素', '万古霉素', '二甲双胍',
    '卡托普利', '依那普利', '贝那普利', '培哚普利', '赖诺普利',
    '缬沙坦', '氯沙坦', '厄贝沙坦', '替米沙坦', '奥美沙坦',
    '顺铂', '环孢素', '他克莫司',
  ],
  ANTIDIABETIC_SULFONYLUREA: [
    '格列本脲', '格列齐特', '格列吡嗪', '格列喹酮', '格列美脲',
  ],
  ANTIDYSRHYTHMIC_CLASS_I: [
    '普罗帕酮', '美西律', '利多卡因', '奎尼丁', '普鲁卡因胺',
  ],
  ANTIDYSRHYTHMIC_CLASS_III: [
    '胺碘酮', '索他洛尔', '多非利特', '伊布利特',
  ],
  CORTICOSTEROID_SYSTEMIC: [
    '泼尼松', '泼尼松龙', '甲泼尼龙', '地塞米松', '氢化可的松',
    '倍他米松', '曲安西龙',
  ],
};

export function drugToCategories(drugName: string, drugCode?: string): Set<string> {
  const categories = new Set<string>();
  const normalized = (drugName || '').trim();
  if (!normalized) return categories;

  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        categories.add(category);
        break;
      }
    }
  }

  if (drugCode) {
    const codeUpper = drugCode.toUpperCase();
    if (codeUpper.includes('NSAID')) categories.add('NSAIDS');
    if (codeUpper.includes('CEPH')) categories.add('ANTIBIOTIC_CEPHALOSPORIN');
    if (codeUpper.includes('QUINOLONE') || codeUpper.includes('FQ')) categories.add('ANTIBIOTIC_QUINOLONE');
    if (codeUpper.includes('ACEI')) categories.add('ANTIHYPERTENSIVE_ACEI');
    if (codeUpper.includes('ARB')) categories.add('ANTIHYPERTENSIVE_ARB');
    if (codeUpper.includes('ALCOHOL') || codeUpper.includes('ETOH')) categories.add('ALCOHOL_GENERAL');
  }

  return categories;
}

export function isAlcoholPresent(drugName: string): boolean {
  return CATEGORY_RULES.ALCOHOL_GENERAL.some(kw => (drugName || '').trim().includes(kw));
}

export const CATEGORY_LABELS: Record<string, string> = {
  NSAIDS: '非甾体抗炎药',
  ANTIBIOTIC_BROAD_SPECTRUM: '广谱抗生素',
  ANTIBIOTIC_CEPHALOSPORIN: '头孢菌素类',
  ANTIBIOTIC_PENICILLIN: '青霉素类',
  ANTIBIOTIC_METRONIDAZOLE: '硝基咪唑类',
  ANTIBIOTIC_QUINOLONE: '喹诺酮类',
  ANTIBIOTIC_TETRACYCLINE: '四环素类',
  ANTIBIOTIC_MACROLIDE: '大环内酯类',
  ANTIBIOTIC_SULFONAMIDE: '磺胺类',
  ANTIBIOTIC_AMINOGLYCOSIDE: '氨基糖苷类',
  ANTIBIOTIC_GLYCOPEPTIDE: '糖肽类',
  ANTIBIOTIC_AZOLE: '唑类抗真菌',
  ANTICOAGULANT_WARFARIN: '华法林类',
  ANTICOAGULANT_DIRECT: '直接口服抗凝药',
  ANTICOAGULANT_ANTIPLATELET: '抗血小板药',
  ANTIHYPERTENSIVE_ACEI: 'ACEI 类降压药',
  ANTIHYPERTENSIVE_ARB: 'ARB 类降压药',
  ANTIHYPERTENSIVE_BETA_BLOCKER: 'β受体阻滞剂',
  ANTIHYPERTENSIVE_CCB: '钙通道阻滞剂',
  DIURETIC_LOOP: '袢利尿剂',
  DIURETIC_THIAZIDE: '噻嗪类利尿剂',
  DIURETIC_POTASSIUM_SPARING: '保钾利尿剂',
  POTASSIUM_SUPPLEMENT: '钾补充剂',
  CALCIUM_ANTACID: '含钙/铝/铋抗酸药',
  IRON_SUPPLEMENT: '铁剂',
  ALCOHOL_GENERAL: '含酒精制剂',
  SSRI: 'SSRI 抗抑郁药',
  SNRI: 'SNRI 抗抑郁药',
  MAOI: 'MAOI 抗抑郁药',
  TRICYCLIC_ANTIDEPRESSANT: '三环类抗抑郁药',
  STATIN: '他汀类调脂药',
  FIBRATE: '贝特类调脂药',
  ANTIFUNGAL_AZOLE_SYSTEMIC: '系统唑类抗真菌',
  ANTIHISTAMINE_SEDATING: '镇静抗组胺药',
  BENZODIAZEPINE: '苯二氮卓类',
  OPIOID: '阿片类镇痛药',
  METFORMIN: '二甲双胍类',
  IODINE_CONTRAST: '碘造影剂',
  PREGNANCY_CATEGORY_D_X: '妊娠 D/X 级',
  LACTATION_RISK: '哺乳期风险',
  LIVER_IMPAIRMENT_RISK: '肝功能不全风险',
  RENAL_IMPAIRMENT_RISK: '肾功能不全风险',
  ANTIDIABETIC_SULFONYLUREA: '磺脲类降糖药',
  ANTIDYSRHYTHMIC_CLASS_I: 'I类抗心律失常',
  ANTIDYSRHYTHMIC_CLASS_III: 'III类抗心律失常',
  CORTICOSTEROID_SYSTEMIC: '系统糖皮质激素',
};
