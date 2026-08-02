export const SUMMARY_TEMPLATES: Record<string, string> = {
  T0: '本次一般检查，未见特殊处理；建议保持口腔卫生，半年复查',
  T1: '{tooth} 诊断为{disease}，行根管治疗{action}完成；建议 2 周后复诊行冠修复',
  T2: '{tooth}拔除术顺利，压迫止血；注意医嘱，3 月后建议修复缺失牙',
  T3: '全口洁治 + 抛光，牙周袋冲洗上药；建议 6 月后复诊/牙周复查，改善口腔卫生习惯',
  T4: '{tooth}{depth}龋去腐后树脂充填，调颌抛光完成；建议半年复查',
  T5: '{tooth}{material}冠/嵌体粘接完成，调颌抛光；建议勿咬硬物，1 周后复诊检查',
  T6: '{tooth}种植{phase}顺利，创口愈合良好；建议 2 周后复查',
  T7: '正畸{adjustment}完成，咬合关系评估良好；建议 4~6 周后复诊（如有不适随时联系）',
  T8: '{tooth}乳牙{action}，口腔卫生宣教到位；建议 3 月后复查并加强家长监督',
  T9: '初诊全面口腔检查，{issue}；已制定治疗方案，待患者确认后预约下次就诊',
  T10: '复查口腔情况，未见明显异常；建议继续保持，半年后复诊',
  T11: '{tooth}{surgery}顺利，创口缝合良好；建议 1 周后拆线/复查',
  T12: '{tooth}外伤{action}处理；建议 2 周/1 月/3 月后定期复查牙髓活力',
  T13: '{tooth}干髓术后充填；建议密切观察，有症状及时行根管治疗',
  T14: '{items}；{summary}',
};

export const TREATMENT_KEYWORDS: Array<{
  keys: string[];
  templateId: keyof typeof SUMMARY_TEMPLATES;
  category: TreatmentCategory;
  extractors?: {
    action?: (name: string) => string;
    disease?: (diagnosis: string) => string;
    depth?: (name: string, diagnosis: string) => string;
    material?: (name: string) => string;
    phase?: (name: string) => string;
    adjustment?: (name: string) => string;
    surgery?: (name: string) => string;
    issue?: (chiefComplaint: string, diagnosis: string) => string;
  };
}> = [
  {
    keys: ['根管'],
    templateId: 'T1',
    category: 'ROOT_CANAL',
    extractors: {
      action: (name: string) => {
        if (name.includes('充填')) return '充填';
        if (name.includes('预备')) return '预备';
        if (name.includes('消毒')) return '消毒';
        return '';
      },
      disease: (diagnosis: string) => {
        if (!diagnosis) return '牙髓炎';
        if (diagnosis.includes('根尖')) return '慢性根尖周炎';
        if (diagnosis.includes('牙髓')) return diagnosis;
        return diagnosis.split(/[，,、]/)[0] || '牙髓炎';
      },
    },
  },
  {
    keys: ['拔', '拔除'],
    templateId: 'T2',
    category: 'EXTRACTION',
  },
  {
    keys: ['洁', '洗牙', '洁治', '牙周'],
    templateId: 'T3',
    category: 'SCALING',
  },
  {
    keys: ['乳牙'],
    templateId: 'T8',
    category: 'PEDIATRIC',
    extractors: {
      action: (name: string) => {
        if (name.includes('充填')) return '充填';
        if (name.includes('根管') || name.includes('牙髓')) return '根管';
        if (name.includes('拔')) return '拔除';
        return '治疗';
      },
    },
  },
  {
    keys: ['充填', '补牙', '树脂'],
    templateId: 'T4',
    category: 'FILLING',
    extractors: {
      depth: (_name: string, diagnosis: string) => {
        if (!diagnosis) return '中';
        if (diagnosis.includes('深')) return '深';
        if (diagnosis.includes('中')) return '中';
        if (diagnosis.includes('浅')) return '浅';
        return '中';
      },
    },
  },
  {
    keys: ['冠', '嵌体', '全瓷', '锆', '钴铬'],
    templateId: 'T5',
    category: 'CROWN',
    extractors: {
      material: (name: string) => {
        if (name.includes('全瓷')) return '全瓷';
        if (name.includes('锆') || name.includes('氧化锆')) return '锆';
        if (name.includes('钴铬')) return '钴铬';
        return '全瓷';
      },
    },
  },
  {
    keys: ['种植', '植入', '基台'],
    templateId: 'T6',
    category: 'IMPLANT_PHASE1',
    extractors: {
      phase: (name: string) => {
        if (name.includes('二期') || name.includes('基台')) return '二期愈合基台更换';
        return '一期植入';
      },
    },
  },
  {
    keys: ['正畸', '弓丝', '托槽', '附件'],
    templateId: 'T7',
    category: 'ORTHO_VISIT',
    extractors: {
      adjustment: (name: string) => {
        if (name.includes('弓丝')) return '弓丝更换';
        if (name.includes('附件')) return '附件调整';
        return '调整';
      },
    },
  },
  {
    keys: ['初诊', '检查'],
    templateId: 'T9',
    category: 'CHECKUP',
    extractors: {
      issue: (chiefComplaint: string, diagnosis: string) => {
        const content = chiefComplaint || diagnosis;
        if (!content) return '口腔常规检查';
        return content.slice(0, 30);
      },
    },
  },
  {
    keys: ['复查', '随访', '复诊'],
    templateId: 'T10',
    category: 'CHECKUP',
  },
  {
    keys: ['根尖切除', '搔刮', '小手术', '切除'],
    templateId: 'T11',
    category: 'SURGERY',
    extractors: {
      surgery: (name: string) => {
        if (name.includes('根尖切除')) return '根尖切除';
        if (name.includes('搔刮')) return '搔刮';
        return '小手术';
      },
    },
  },
  {
    keys: ['外伤', '固定', '脱敏', '盖髓'],
    templateId: 'T12',
    category: 'TRAUMA',
    extractors: {
      action: (name: string) => {
        if (name.includes('固定')) return '固定';
        if (name.includes('脱敏')) return '脱敏';
        if (name.includes('盖髓')) return '盖髓';
        return '固定';
      },
    },
  },
  {
    keys: ['干髓', '塑化'],
    templateId: 'T13',
    category: 'OTHER',
  },
];

export const DIAGNOSIS_KEYWORDS: Array<{
  keys: string[];
  templateId: keyof typeof SUMMARY_TEMPLATES;
  category: TreatmentCategory;
}> = [
  { keys: ['龋'], templateId: 'T4', category: 'FILLING' },
  { keys: ['根尖', '牙髓'], templateId: 'T1', category: 'ROOT_CANAL' },
  { keys: ['牙周'], templateId: 'T3', category: 'SCALING' },
];

export type TreatmentCategory =
  | 'ROOT_CANAL'
  | 'EXTRACTION'
  | 'SCALING'
  | 'FILLING'
  | 'CROWN'
  | 'IMPLANT_PHASE1'
  | 'IMPLANT_PHASE2'
  | 'ORTHO_VISIT'
  | 'PEDIATRIC'
  | 'SURGERY'
  | 'TRAUMA'
  | 'CHECKUP'
  | 'OTHER';

export const RETURN_INTERVAL_DAYS: Record<TreatmentCategory, number> = {
  ROOT_CANAL: 14,
  EXTRACTION: 90,
  SCALING: 180,
  FILLING: 180,
  CROWN: 7,
  IMPLANT_PHASE1: 14,
  IMPLANT_PHASE2: 14,
  ORTHO_VISIT: 35,
  PEDIATRIC: 90,
  SURGERY: 7,
  TRAUMA: 14,
  CHECKUP: 180,
  OTHER: 30,
};

export const MAX_SUMMARY_LENGTH = 100;
