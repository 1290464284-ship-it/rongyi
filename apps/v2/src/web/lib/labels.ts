/**
 * 集中式中文 label 字典（M-03）。
 * 所有状态/方法/类型枚举的中文文案统一在此定义，
 * 页面与模块文件从这里导入或 re-export，避免同名常量分散定义导致文案不一致。
 * 领域枚举类型定义仍保留在各自 types.ts / constants.ts，此处只集中 label 文案。
 */

/** 预约状态（AppointmentsPage 与 AppointmentBoardPage 共用，文案必须一致） */
export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '未到诊',
};

/** 预约类型 */
export const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  REGULAR: '常规预约',
  FOLLOW_UP: '随访预约',
  EMERGENCY: '急诊',
  CONSULTATION: '咨询',
};

/** 收费单状态 */
export const CHARGE_STATUS_LABELS: Record<string, string> = {
  UNPAID: '未付款',
  PARTIAL: '部分付款',
  PAID: '已付款',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

/** 支付方式 */
export const PAY_METHOD_LABELS: Record<string, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '银行卡',
  DEBT: '欠费',
  MEMBER_CARD: '会员卡',
  UNIONPAY: '银联',
  INSURANCE: '医保',
  OTHER: '其他',
};

/** 临床工作台状态（挂号/分诊/计划/预约混合枚举） */
export const CLINICAL_STATUS_LABELS: Record<string, string> = {
  REGISTERED: '已挂号',
  TRIAGED: '已分诊',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  PLANNED: '已计划',
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  NO_SHOW: '未到诊',
  PENDING: '待处理',
};

/** 发药单状态 */
export const DISPENSE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待发药',
  PARTIAL: '部分发药',
  DISPENSED: '已发药',
  RETURNED: '已退药',
};

/** 影像报告状态 */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  COMPLETED: '已完成',
  FINAL: '最终',
};

/** 初检记录状态 */
export const FIRST_EXAM_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  CANCELLED: '已取消',
};

/** 初检随访状态 */
export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  NONE: '未追踪',
  PENDING: '待跟进',
  HORIZONTAL_SHOULD: '需横向转诊',
  HORIZONTAL_DONE: '横向已转',
  LOST: '已流失',
};

/** 牙列类型 */
export const DENTITION_LABELS: Record<string, string> = {
  DECIDUOUS: '乳牙列',
  PERMANENT: '恒牙列',
  MIXED: '混合牙列',
};

/** 主诉标记 */
export const CHIEF_MARK_LABELS: Record<string, string> = {
  NONE: '无',
  HORIZONTAL_SHOULD: '横向应',
  HORIZONTAL_DONE: '横向做',
};

/** 加工单状态 */
export const PROCESSING_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

/** 加工流转步骤状态 */
export const PROCESSING_FLOW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
};

/** 请假审批状态 */
export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
};

/** 库存加工单状态（InventoryWorkflowPage 工作台视图） */
export const INVENTORY_PROCESSING_STATUS_LABELS: Record<string, string> = {
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
};

/** 采购单状态 */
export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

/** 盘点单状态 */
export const STOCKTAKE_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: '进行中',
  LOCKED: '已锁定',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};
