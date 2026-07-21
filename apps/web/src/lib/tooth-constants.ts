// FDI 牙位编号常量（32 颗恒牙）
// 上排（从左到右）：右上象限 18-11 + 左上象限 21-28
// 下排（从左到右）：右下象限 48-41 + 左下象限 31-38
export const UPPER_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
];

export const LOWER_TEETH = [
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
];

export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

// 牙位状态颜色映射（背景色 / 文字色）
export const TOOTH_STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  SOUND:      { bg: '#FFFFFF', text: '#1C1917', label: '健康' },
  FILLED:     { bg: '#3B82F6', text: '#FFFFFF', label: '已补' },
  DECAYED:    { bg: '#EF4444', text: '#FFFFFF', label: '龋齿' },
  CROWNED:    { bg: '#F59E0B', text: '#FFFFFF', label: '已冠' },
  MISSING:    { bg: '#9CA3AF', text: '#FFFFFF', label: '缺失' },
  ROOT_CANAL: { bg: '#8B5CF6', text: '#FFFFFF', label: '根管' },
  EXTRACTED:  { bg: '#4B5563', text: '#FFFFFF', label: '已拔' },
  IMPLANT:    { bg: '#10B981', text: '#FFFFFF', label: '种植' },
  BRIDGE:     { bg: '#06B6D4', text: '#FFFFFF', label: '桥体' },
};

// 牙位条件角标映射（条件 -> 角标颜色）
export const TOOTH_CONDITION_DOT: Record<string, string> = {
  DECAY: '#EF4444',
  FILLING: '#3B82F6',
  CROWN: '#F59E0B',
  BRIDGE: '#06B6D4',
  IMPLANT: '#10B981',
  ROOT_CANAL: '#8B5CF6',
  EXTRACTION: '#4B5563',
  MOBILITY: '#F97316',
  CALCULUS: '#84CC16',
  BLEEDING: '#EC4899',
  FURCATION: '#A855F7',
  OTHER: '#6B7280',
};

// 象限名称
export const QUADRANT_LABELS: Record<string, string> = {
  upperRight: '上颌右',
  upperLeft: '上颌左',
  lowerRight: '下颌右',
  lowerLeft: '下颌左',
};
