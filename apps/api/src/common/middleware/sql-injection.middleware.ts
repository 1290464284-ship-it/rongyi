import { Injectable, NestMiddleware, HttpException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SQL_INJECTION_KEYWORDS = [
  'select from',
  'insert into',
  'update set',
  'delete from',
  'drop table',
  'alter table',
  'create table',
  'truncate table',
  'union select',
  'union all select',
];

const SQL_INJECTION_PATTERNS = [
  /\bor\s+['"\d]+=['"\d]+\b/i,
  /\band\s+['"\d]+=['"\d]+\b/i,
  /\bxp_\w+\b/i,
  /\bsp_\w+\b/i,
];

// 登录接口不再排除：登录字段（username/password）同样需要检测 SQL 注入，
// 检测规则为多词 SQL 短语和特定模式，正常用户名/密码不会误报。
const PATHS_TO_SKIP = [
  // 文档接口包含 SQL 示例语句，会被检测规则误判
  '/api/docs',
  // refresh token 为随机字符串，不参与 SQL 拼接，保留排除以避免 token 误报
  '/api/auth/refresh',
];

@Injectable()
export class SqlInjectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SqlInjectionMiddleware.name);

  private detectSqlInjection(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    if (value.length < 5) return false;

    const lowerValue = value.toLowerCase();

    for (const keyword of SQL_INJECTION_KEYWORDS) {
      if (lowerValue.includes(keyword)) {
        return true;
      }
    }

    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return true;
      }
    }
    return false;
  }

  private scanObject(obj: unknown, path: string = ''): string | null {
    if (obj === null || obj === undefined) return null;

    if (typeof obj === 'string') {
      if (this.detectSqlInjection(obj)) {
        return path || 'root';
      }
      return null;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const result = this.scanObject(obj[i], `${path}[${i}]`);
        if (result) return result;
      }
      return null;
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const result = this.scanObject(value, path ? `${path}.${key}` : key);
        if (result) return result;
      }
    }

    return null;
  }

  use(req: Request, res: Response, next: NextFunction) {
    const requestPath = req.path;

    if (PATHS_TO_SKIP.some((p) => requestPath.startsWith(p))) {
      return next();
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const queryResult = this.scanObject(req.query, 'query');
      if (queryResult) {
        this.logger.warn(`SQL injection detected in query params: ${queryResult}, IP: ${req.ip}`);
        throw new HttpException('请求包含非法字符', 400);
      }

      const paramsResult = this.scanObject(req.params, 'params');
      if (paramsResult) {
        this.logger.warn(`SQL injection detected in path params: ${paramsResult}, IP: ${req.ip}`);
        throw new HttpException('请求包含非法字符', 400);
      }
    }

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      if (req.body && typeof req.body === 'object') {
        const bodyResult = this.scanObject(req.body, 'body');
        if (bodyResult) {
          this.logger.warn(`SQL injection detected in request body: ${bodyResult}, IP: ${req.ip}`);
          throw new HttpException('请求包含非法字符', 400);
        }
      }
    }

    next();
  }
}
