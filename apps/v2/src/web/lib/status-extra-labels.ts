export const MEMBER_CARD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  DISABLED: '禁用',
  FROZEN: '冻结',
  EXPIRED: '过期',
};

export const REFUND_STATUS_LABELS: Record<string, string> = {
  REQUESTED: '待审核',
  PENDING_REFUND: '待退款',
  COMPLETED: '已完成',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
};

export const TREATMENT_STATUS_LABELS: Record<string, string> = {
  PLANNED: '已计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const VISIT_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};
