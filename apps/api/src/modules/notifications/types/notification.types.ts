// 通知类型枚举
export enum NotificationType {
  // 系统通知
  SYSTEM = 'system',
  // 预约提醒
  APPOINTMENT = 'appointment',
  // 收费通知
  CHARGE = 'charge',
  // 库存预警
  INVENTORY = 'inventory',
  // 患者相关
  PATIENT = 'patient',
  // 临床相关
  CLINICAL = 'clinical',
  // 财务相关
  FINANCIAL = 'financial',
  // 设备相关
  EQUIPMENT = 'equipment',
}

// 通知优先级枚举
export enum NotificationPriority {
  // 低
  LOW = 'low',
  // 普通
  NORMAL = 'normal',
  // 高
  HIGH = 'high',
  // 紧急
  URGENT = 'urgent',
}

// 通知负载接口
export interface NotificationPayload {
  // 通知类型
  type: NotificationType;
  // 通知标题
  title: string;
  // 通知内容
  content: string;
  // 优先级
  priority: NotificationPriority;
  // 扩展数据（JSON）
  data?: Record<string, unknown>;
  // 接收用户 ID（为空则发送给诊所所有用户）
  userId?: string;
  // 诊所 ID
  clinicId?: string;
}

// 通知实体接口
export interface Notification {
  id: string;
  clinicId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  content: string;
  priority: NotificationPriority;
  readAt: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// 通知列表查询参数
export interface NotificationQueryOptions {
  type?: NotificationType;
  priority?: NotificationPriority;
  isRead?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

// 未读统计结果
export interface UnreadCountResult {
  total: number;
  byType: Record<NotificationType, number>;
  byPriority: Record<NotificationPriority, number>;
}
