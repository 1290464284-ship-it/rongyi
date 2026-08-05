export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const translations: Record<string, string> = {
    'Appointment not found': '预约不存在',
    'Account is temporarily locked': '账号暂时锁定，请稍后重试',
    'At least one charge item is required': '请至少填写一条收费明细',
    'Backup file not found': '备份文件不存在',
    'Backup integrity check failed before restore': '备份完整性校验失败，无法恢复',
    'Backup path is invalid': '备份路径无效',
    'Business alert not found': '业务告警不存在',
    'Business alert status update failed': '业务告警状态更新失败',
    'Cephalometric case not found': '头影测量记录不存在',
    'Charge not found': '收费单不存在',
    'Charge cannot be paid': '当前收费单不能收款',
    'Charge item name and category are required': '收费明细的名称和分类不能为空',
    'Charge item price must be a positive integer in cents': '收费明细单价必须大于 0',
    'Charge item quantity must be positive': '收费明细数量必须大于 0',
    'Chair not found': '椅位不存在',
    'Clinic not found': '诊所不存在',
    'CSV export failed': '导出失败，请稍后重试',
    'Create is not supported for this resource': '该资源不支持新建',
    'Debt record not found': '欠费记录不存在',
    'Delete is not supported for this resource': '该资源不支持删除',
    'Discount must be a non-negative integer cents value not exceeding the charge total': '优惠金额无效',
    'Doctor or chair is already booked in this time range': '医生或椅位在该时段已被预约',
    'Doctor not found': '医生不存在',
    'Each processing item requires a name, positive quantity, and non-negative unit price': '加工明细的名称、数量和单价无效',
    'Each purchase item requires a name, positive quantity, and non-negative unit price': '采购明细的名称、数量和单价无效',
    'Encrypted backup auth tag is missing': '加密备份文件缺少校验信息',
    'Encrypted backup file is too short': '加密备份文件不完整',
    'Encrypted backup header is invalid': '加密备份文件无效',
    'endTime must be later than startTime': '结束时间必须晚于开始时间',
    'Failed to fetch': '无法连接本地服务，请检查应用是否正常运行',
    'File upload failed': '文件上传失败，请稍后重试',
    'Follow-up cannot be completed from current status': '当前状态不能完成随访',
    'Follow-up export scope must be overdue, today, upcoming, or all': '随访导出范围无效',
    'Follow-up ids must be an array with 1 to 500 items': '随访记录选择无效',
    'Follow-up not found': '随访记录不存在',
    'Follow-up result must be at most 500 characters': '随访结果不能超过 500 字',
    'Forbidden resource': '无权访问该资源',
    'Insufficient member card balance': '会员卡余额不足',
    'Insufficient points': '积分不足',
    'Insufficient stock': '库存不足',
    'Internal server error': '服务器内部错误，请稍后重试',
    'Invalid debt payment amount': '欠费还款金额无效',
    'Invalid member card level': '会员卡等级无效',
    'Invalid member card status': '会员卡状态无效',
    'Invalid or expired token': '登录状态已失效，请重新登录',
    'Invalid appointment type': '预约类型无效',
    'Invalid payment method': '支付方式无效',
    'Invalid refresh token': '登录状态已失效，请重新登录',
    'Invalid username or password': '用户名或密码错误',
    'Inventory item not found': '库存项目不存在',
    'Leave request cannot be approved from current status': '当前状态不能审批该请假申请',
    'Leave request not found': '请假申请不存在',
    'Load failed': '网络请求失败，请重试',
    'Member card is not active': '会员卡未启用',
    'Member card not found': '会员卡不存在',
    'Member card number already exists': '会员卡号已存在',
    'Member card used for payment is not found': '支付使用的会员卡不存在',
    'Missing bearer token': '请先登录',
    'New password must be at least 8 characters': '新密码至少需要 8 位',
    'No active member card for patient': '该患者没有可用会员卡',
    'No applicable suggestions found': '没有可应用的补货建议',
    'Notification not found': '通知不存在',
    'Old password is incorrect': '原密码不正确',
    'One or more inventory items are not available': '部分库存项目不可用',
    'Operation is already in progress': '操作正在进行中，请勿重复提交',
    'Patient not found': '患者不存在',
    'Password must be at least 8 characters': '密码至少需要 8 位',
    'Payment amount must be a positive integer and not exceed the remaining balance': '收款金额无效',
    'Points must be a non-zero integer': '积分必须是大于 0 的整数',
    'Prescription not found': '处方不存在',
    'Processing order items must contain 1 to 500 entries': '加工明细需包含 1 至 500 条',
    'Processing order not found': '加工单不存在',
    'Processing order number is required': '请填写加工单号',
    'Processing order total fee must be non-negative': '加工单费用不能为负数',
    'Purchase order is not pending': '采购单当前状态不能收货',
    'Purchase order items must contain 1 to 500 entries': '采购明细需包含 1 至 500 条',
    'Purchase order not found': '采购单不存在',
    'Purchase order number is required': '请填写采购单号',
    'Recharge amount must be a positive integer in cents': '充值金额必须大于 0',
    'Refund amount must be a positive integer and not exceed the refundable amount': '退款金额无效',
    'Refresh token has expired': '登录状态已过期，请重新登录',
    'Refresh token is required': '登录状态已失效，请重新登录',
    'Route not found': '接口不存在',
    'Send batch ids must be an array with at most 500 items': '批量发送选择无效',
    'Session is missing refresh token': '登录状态已失效，请重新登录',
    'The database connection is not open': '数据库连接异常，请重启应用',
    'The operation was aborted due to timeout': '请求超时，请重试',
    'Too many requests': '请求过于频繁，请稍后重试',
    'Token is no longer valid': '登录状态已失效，请重新登录',
    'Treatment plan not found': '治疗计划不存在',
    'Unknown resource': '资源不存在',
    'Unsupported file type': '不支持的文件类型',
    'Update is not supported for this resource': '该资源不支持编辑',
    'User is disabled': '账号已停用',
    'User not found': '用户不存在',
    'Username already exists': '用户名已存在',
    'Username and name are required': '请填写用户名和姓名',
    'Visit does not belong to the patient': '就诊与患者不匹配',
    'Visit not found': '就诊不存在',
    'Wechat channel is not configured': '微信通道未配置',
    'Wechat channel send failed': '微信发送失败',
    'Wechat message cannot be sent from current status': '当前状态不能发送该微信消息',
    'Wechat message not found': '微信消息不存在',
  };
  const exact = translations[message];
  if (exact) return exact;
  if (/^Failed to fetch/.test(message)) return '无法连接本地服务，请检查应用是否正常运行';
  if (/^Request failed \(\d+\)$/.test(message)) return '请求失败，请稍后重试';
  if (/^Forbidden resource: /.test(message)) return '无权访问该资源';
  if (/^Resource cannot import: /.test(message)) return '该资源不支持批量导入';
  if (/^Bulk import is disabled for /.test(message)) return '该资源已禁用批量导入';
  if (/^Invalid user role: /.test(message)) return '用户角色无效';
  if (/^Unknown filter field: /.test(message)) return '筛选条件无效';
  if (/^Purchase order contains missing inventory items: /.test(message)) return '采购单包含不存在的库存项目';
  if (/^Sync change requires row data$/.test(message)) return '同步数据格式不正确';
  if (/^Sync record not found: /.test(message)) return '同步记录不存在';
  if (/^Table is not allowed for sync$/.test(message)) return '同步表不允许';
  if (/^Sync operation must be INSERT, UPDATE, or DELETE$/.test(message)) return '同步操作类型无效';
  if (/timed out|aborted/i.test(message)) return '请求超时，请重试';
  if (/^Cannot transition/.test(message)) return '当前状态不能执行该操作';
  if (message.endsWith('violates a unique field constraint')) return '记录已存在，请检查唯一字段';
  if (/not supported for this resource$/.test(message)) {
    return message.startsWith('Create') ? '该资源不支持新建' : '该资源不支持此操作';
  }
  const notFound = message.match(/^(.+?) not found(?::\s.*)?$/);
  if (notFound) return `${resourceName(notFound[1])}不存在`;
  if (/^[A-Za-z][A-Za-z ]* is required$/.test(message)) return '请填写必填项';
  if (/^[A-Za-z][A-Za-z ]* must be /.test(message)) return '输入内容格式不正确';
  if (/exceeds max length/.test(message)) return '输入内容超过长度限制';
  return message;
}

function resourceName(value: string): string {
  const names: Record<string, string> = {
    Appointment: '预约',
    Backup: '备份',
    'Business alert': '业务告警',
    BusinessAlert: '业务告警',
    'Cephalometric case': '头影测量记录',
    CephalometricCase: '头影测量记录',
    Charge: '收费单',
    Clinic: '诊所',
    Debt: '欠费记录',
    'Follow-up': '随访记录',
    FollowUp: '随访记录',
    'Inventory item': '库存项目',
    InventoryItem: '库存项目',
    'Leave request': '请假申请',
    LeaveRequest: '请假申请',
    'Medical record': '病历',
    MedicalRecord: '病历',
    'Member card': '会员卡',
    MemberCard: '会员卡',
    Notification: '通知',
    Patient: '患者',
    Prescription: '处方',
    'Print template': '打印模板',
    'Processing order': '加工单',
    ProcessingOrder: '加工单',
    'Purchase order': '采购单',
    PurchaseOrder: '采购单',
    'Sync record': '同步记录',
    'Treatment plan': '治疗计划',
    TreatmentPlan: '治疗计划',
    User: '用户',
    Visit: '就诊',
    'Wechat message': '微信消息',
    WechatMessage: '微信消息',
  };
  return names[value] ?? value;
}

export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const raw = error instanceof Error ? error.message : '';
  return raw ? friendlyError(raw) : fallback;
}
