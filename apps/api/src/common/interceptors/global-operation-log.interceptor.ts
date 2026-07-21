import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { OperationLogsService } from '../../modules/system/operation-logs/operation-logs.service';
import { AppLogger } from '../services/logger.service';
// P2 修复（日志脱敏有三套实现，敏感字段列表不一致）：统一引用共享常量
import { isSensitiveField } from '../utils/sensitive-fields';

const logger = new AppLogger('GlobalOperationLogInterceptor');

const ACTION_MAP: Record<string, string> = {
  POST: '创建',
  PATCH: '更新',
  PUT: '更新',
  DELETE: '删除',
};

const SKIP_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/health',
  '/operation-logs/batch',
];

function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const result: any = {};
  for (const [key, value] of Object.entries(body)) {
    if (isSensitiveField(key)) {
      result[key] = '***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeBody(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function extractActionName(path: string, method: string): string {
  const methodAction = ACTION_MAP[method] || method;
  const pathParts = path.split('/').filter(Boolean);
  const resource = pathParts.length > 0 ? pathParts[0] : 'unknown';
  const resourceMap: Record<string, string> = {
    'charge-v2': '收费',
    'patients': '患者',
    'refunds': '退款',
    'member-cards': '会员卡',
    'appointments': '预约',
    'treatments': '治疗',
    'inventory': '库存',
    'purchase-orders': '采购单',
    'processing-orders': '加工单',
    'suppliers': '供应商',
    'medical-records': '病历',
    'tooth-records': '牙位记录',
    'imaging': '影像',
    'prescriptions': '处方',
    'first-exams': '初诊',
    'oral-examinations': '口腔检查',
    'periodontal-records': '牙周记录',
    'treatment-plans': '治疗计划',
    'visits': '就诊',
    'registrations': '挂号',
    'chairs': '椅位',
    'equipment': '设备',
    'follow-ups-v2': '随访',
    'wechat': '微信',
    'settings': '设置',
    'backups': '备份',
    'auth': '用户',
    'stats': '统计',
    'search': '搜索',
  };
  const resourceName = resourceMap[resource] || resource;
  return `${methodAction}${resourceName}`;
}

@Injectable()
export class GlobalOperationLogInterceptor implements NestInterceptor {
  private operationLogsService: OperationLogsService | null = null;

  constructor(private moduleRef: ModuleRef) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path = request.route?.path || request.url;
    if (SKIP_PATHS.some(p => path.includes(p))) {
      return next.handle();
    }

    if (!this.operationLogsService) {
      try {
        this.operationLogsService = this.moduleRef.get(OperationLogsService, { strict: false });
      } catch (e) {
        return next.handle();
      }
    }

    const user = request.user;
    const action = extractActionName(path, method);
    const target = path;
    const ip = request.ip;

    let bodySnapshot: any;
    try {
      bodySnapshot = JSON.stringify(sanitizeBody(request.body));
      if (bodySnapshot.length > 2000) {
        bodySnapshot = bodySnapshot.substring(0, 2000) + '...';
      }
    } catch {
      bodySnapshot = '无法序列化';
    }

    return next.handle().pipe(
      tap({
        next: (result) => {
          if (!this.operationLogsService) return;
          try {
            const resultInfo = result?.id ? ` ID: ${result.id}` : '';
            this.operationLogsService.create({
              userId: user?.id || user?.userId,
              userName: user?.username || user?.name || user?.userId || 'unknown',
              action: action,
              target: target,
              detail: bodySnapshot + resultInfo,
              ip,
            });
          } catch (e) {
            logger.warn('Failed to create operation log', e);
          }
        },
        error: (error) => {
          if (!this.operationLogsService) return;
          try {
            this.operationLogsService.create({
              userId: user?.id || user?.userId,
              userName: user?.username || user?.name || user?.userId || 'unknown',
              action: `${action} [失败]`,
              target: target,
              detail: `错误: ${error.message} | 请求: ${bodySnapshot}`,
              ip,
            });
          } catch (e) {
            logger.warn('Failed to create operation log for failure', e);
          }
        },
      }),
    );
  }
}
