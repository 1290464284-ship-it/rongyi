// 认证/审计/预约服务 barrel（M-04：由单文件 auth.ts 拆分）。
// 保持 `export * from './service-modules/auth'` 兼容。
export { AuthService } from './auth.service';
export { AuditLogInput, AuditService } from './audit.service';
export { AppointmentService } from './appointment.service';
