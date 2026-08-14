export const CATEGORY_TYPE_LABELS: Record<string, string> = {
  ORTHODONTIC: '正畸',
  AESTHETIC: '美学',
  PLASTER: '石膏',
  OTHER: '其他',
};

export const PHASE_LABELS: Record<string, string> = {
  INITIAL: '初诊',
  IN_PROGRESS: '治疗中',
  FINISHED: '完成',
  RETENTION: '保持期',
  OTHER: '其他',
};

export const PHASE_OPTIONS = [
  { value: 'INITIAL', label: '初诊' },
  { value: 'IN_PROGRESS', label: '治疗中' },
  { value: 'FINISHED', label: '完成' },
  { value: 'RETENTION', label: '保持期' },
  { value: 'OTHER', label: '其他' },
];

export const CATEGORIES_LIST_PATH = '/resources/imagingCategories?page=1&pageSize=100';
