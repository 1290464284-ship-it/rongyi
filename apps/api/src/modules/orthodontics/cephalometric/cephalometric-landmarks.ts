export interface Point2D {
  x: number;
  y: number;
}

export interface Landmark {
  label: string;
  description: string;
  defaultReferencePlanes: string[];
}

export const LANDMARK_DICTIONARY: Record<string, Landmark> = {
  Nasion: {
    label: 'Nasion (N)',
    description: '鼻根点，鼻额缝最前点',
    defaultReferencePlanes: ['SN', 'FH'],
  },
  Sella: {
    label: 'Sella (S)',
    description: '蝶鞍中心点',
    defaultReferencePlanes: ['SN'],
  },
  Orbitale: {
    label: 'Orbitale (O)',
    description: '眶下缘最低点',
    defaultReferencePlanes: ['FH'],
  },
  Porion: {
    label: 'Porion (Pt)',
    description: '外耳道上缘点',
    defaultReferencePlanes: ['FH'],
  },
  'A-point': {
    label: 'A-point (A)',
    description: '上齿槽座点，前鼻棘与上齿槽缘间最凹点',
    defaultReferencePlanes: ['OP'],
  },
  'B-point': {
    label: 'B-point (B)',
    description: '下齿槽座点，下齿槽缘与颏前点间最凹点',
    defaultReferencePlanes: ['OP'],
  },
  Pogonion: {
    label: 'Pogonion (Pog)',
    description: '颏前点，下颌骨颏部最前点',
    defaultReferencePlanes: ['MP'],
  },
  Gnathion: {
    label: 'Gnathion (Gn)',
    description: '颏顶点，颏前点与颏下点之中点',
    defaultReferencePlanes: ['MP'],
  },
  Menton: {
    label: 'Menton (Me)',
    description: '颏下点，下颌骨颏部最低点',
    defaultReferencePlanes: ['MP'],
  },
  ANS: {
    label: 'ANS',
    description: '前鼻棘点',
    defaultReferencePlanes: ['PP'],
  },
  PNS: {
    label: 'PNS',
    description: '后鼻棘点',
    defaultReferencePlanes: ['PP'],
  },
  'Upper Incisor Edge': {
    label: 'Upper Incisor Edge (UI)',
    description: '上颌中切牙切缘点',
    defaultReferencePlanes: ['OP'],
  },
  'Upper Incisor Root': {
    label: 'Upper Incisor Root (UIR)',
    description: '上颌中切牙根尖点',
    defaultReferencePlanes: [],
  },
  'Lower Incisor Edge': {
    label: 'Lower Incisor Edge (LI)',
    description: '下颌中切牙切缘点',
    defaultReferencePlanes: ['OP'],
  },
  'Lower Incisor Root': {
    label: 'Lower Incisor Root (LIR)',
    description: '下颌中切牙根尖点',
    defaultReferencePlanes: [],
  },
  'Upper 1st Mesiobuccal': {
    label: 'Upper 1st Mesiobuccal (U6)',
    description: '上颌第一恒磨牙近中颊尖点',
    defaultReferencePlanes: ['OP'],
  },
  'Lower 1st Mesiobuccal': {
    label: 'Lower 1st Mesiobuccal (L6)',
    description: '下颌第一恒磨牙近中颊尖点',
    defaultReferencePlanes: ['OP'],
  },
  Gonion: {
    label: 'Gonion (Go)',
    description: '下颌角点，下颌体与升支后缘相交处',
    defaultReferencePlanes: ['MP'],
  },
  Condylion: {
    label: 'Condylion (Co)',
    description: '髁顶点，下颌髁突最上点',
    defaultReferencePlanes: [],
  },
  Articulare: {
    label: 'Articulare (Ar)',
    description: '关节点，颅底后缘与下颌升支后缘相交点',
    defaultReferencePlanes: [],
  },
  Basion: {
    label: 'Basion (Ba)',
    description: '颅底点，枕骨大孔前缘中点',
    defaultReferencePlanes: [],
  },
  Pterygomaxillary: {
    label: 'Pterygomaxillary (Ptm)',
    description: '翼上颌裂点，翼上颌裂轮廓最下点',
    defaultReferencePlanes: ['PP'],
  },
  'Point W': {
    label: 'Point W',
    description: 'Wits 分析参考点（上颌骨后部参照）',
    defaultReferencePlanes: ['OP'],
  },
};

export type LandmarkName = keyof typeof LANDMARK_DICTIONARY;

export interface Landmarks {
  [key: string]: { x: number; y: number; visible?: boolean } | null | undefined;
}

/**
 * 30 个标准标志点短代码常量（Task 19）
 * code: 短代码（用于 metrics-formula / landmark-set JSON）
 * label: 中文标签
 * required: 是否为必填点（缺则 validateLandmarks 报错）
 */
export interface ShortCodeLandmark {
  code: string;
  label: string;
  required: boolean;
}

export const SHORT_CODE_LANDMARKS: ShortCodeLandmark[] = [
  { code: 'S', label: '蝶鞍点', required: true },
  { code: 'N', label: '鼻根点', required: true },
  { code: 'A', label: '上齿槽座点', required: true },
  { code: 'B', label: '下齿槽座点', required: true },
  { code: 'Pog', label: '颏前点', required: true },
  { code: 'Gn', label: '颏顶点', required: false },
  { code: 'Me', label: '颏下点', required: true },
  { code: 'Go', label: '下颌角点', required: true },
  { code: 'Ar', label: '关节点', required: false },
  { code: 'Po', label: '耳点', required: true },
  { code: 'O', label: '眶点', required: true },
  { code: 'ANS', label: '前鼻棘', required: false },
  { code: 'PNS', label: '后鼻棘', required: false },
  { code: 'UIE', label: '上中切牙切缘', required: true },
  { code: 'UIA', label: '上中切牙根尖', required: false },
  { code: 'LIE', label: '下中切牙切缘', required: true },
  { code: 'LIA', label: '下中切牙根尖', required: false },
  { code: 'U6M', label: '上第一磨牙近中尖', required: false },
  { code: 'L6M', label: '下第一磨牙近中尖', required: false },
  { code: 'Co', label: '髁突点', required: false },
  { code: 'Ptm', label: '翼上颌裂点', required: false },
  { code: 'Xi', label: '下颌支中心', required: false },
  { code: 'DC', label: '髁突中心', required: false },
  { code: 'Ai', label: '上尖牙尖', required: false },
  { code: 'Bi', label: '下尖牙尖', required: false },
  { code: 'U6DB', label: '上第一磨牙远中尖', required: false },
  { code: 'L6DB', label: '下第一磨牙远中尖', required: false },
  { code: 'A6', label: '上第一磨牙近中颊尖', required: false },
  { code: 'B6', label: '下第一磨牙近中颊尖', required: false },
  { code: 'Sn', label: '鼻下点', required: false },
  { code: 'Is', label: '上唇缘', required: false },
];

/** 短代码 → 中文标签映射（快速查找） */
export const SHORT_CODE_LABEL_MAP: Record<string, string> = SHORT_CODE_LANDMARKS.reduce(
  (acc, lm) => {
    acc[lm.code] = lm.label;
    return acc;
  },
  {} as Record<string, string>,
);

/** 必填短代码列表 */
export const REQUIRED_SHORT_CODES: string[] = SHORT_CODE_LANDMARKS.filter(lm => lm.required).map(lm => lm.code);

/** 短代码标志点坐标字典（用于 metrics-formula 输入） */
export type ShortCodeLandmarks = Record<string, { x: number; y: number } | undefined>;
