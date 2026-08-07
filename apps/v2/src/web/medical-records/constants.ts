export const EDIT_STATUS_LABELS: Record<string, string> = {
  NONE: '无',
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

export const EDIT_STATUS_OPTIONS: Array<[string, string]> = [
  ['DRAFT', '草稿'],
  ['SUBMITTED', '已提交'],
  ['APPROVED', '已审核'],
];
