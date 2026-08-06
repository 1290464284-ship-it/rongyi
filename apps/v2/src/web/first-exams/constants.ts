export const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  CANCELLED: '已取消',
};

export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  NONE: '未追踪',
  PENDING: '待跟进',
  HORIZONTAL_SHOULD: '需横向转诊',
  HORIZONTAL_DONE: '横向已转',
  LOST: '已流失',
};

export const DENTITION_LABELS: Record<string, string> = {
  DECIDUOUS: '乳牙列',
  PERMANENT: '恒牙列',
  MIXED: '混合牙列',
};

export const CHIEF_MARK_LABELS: Record<string, string> = {
  NONE: '无',
  HORIZONTAL_SHOULD: '横向应',
  HORIZONTAL_DONE: '横向做',
};
