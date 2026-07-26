import { Injectable } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { DbService } from '../../db/db.service';
import { PAGINATION } from '../../common/constants/pagination';
import * as crypto from 'node:crypto';

export enum AlertLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export enum AlertCategory {
  BACKUP = 'BACKUP',
  DATABASE = 'DATABASE',
  CONFIG = 'CONFIG',
  SYSTEM = 'SYSTEM',
  BUSINESS = 'BUSINESS',
}

export interface SystemAlert {
  id: string;
  level: AlertLevel;
  category: AlertCategory;
  title: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  resolvedAt?: string;
  consecutiveFailures?: number;
  metadata?: Record<string, unknown>;
  clinicId?: string;
}

export interface AlertQueryOptions {
  level?: AlertLevel;
  category?: AlertCategory;
  resolved?: boolean;
  clinicId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedAlerts {
  items: SystemAlert[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_CACHE_ALERTS = 100;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

@Injectable()
export class AlertService {
  private readonly logger = new AppLogger(AlertService.name);
  private recentAlerts: SystemAlert[] = [];
  private failureCounters: Map<string, number> = new Map();

  constructor(private dbService: DbService) {}

  recordAlert(
    level: AlertLevel,
    category: AlertCategory,
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
    clinicId?: string,
  ): SystemAlert {
    const now = new Date().toISOString();
    const alert: SystemAlert = {
      id: this.generateId(),
      level,
      category,
      title,
      message,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      metadata,
      clinicId,
    };

    try {
      this.dbService.prepare(
        `INSERT INTO SystemAlert (id, level, category, title, message, data, resolved, consecutiveFailures, clinicId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
      ).run(
        alert.id,
        alert.level,
        alert.category,
        alert.title,
        alert.message,
        metadata ? JSON.stringify(metadata) : null,
        clinicId || null,
        alert.createdAt,
        alert.updatedAt,
      );
    } catch (err: unknown) {
      this.logger.error('写入告警到数据库失败', err instanceof Error ? err.message : String(err));
    }

    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > MAX_CACHE_ALERTS) {
      this.recentAlerts = this.recentAlerts.slice(0, MAX_CACHE_ALERTS);
    }

    this.logger[level === AlertLevel.CRITICAL ? 'error' : level === AlertLevel.ERROR ? 'error' : 'warn'](
      `[${category}] ${title}: ${message}`,
    );

    return alert;
  }

  recordFailure(
    category: AlertCategory,
    key: string,
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
    clinicId?: string,
  ): SystemAlert {
    const currentCount = (this.failureCounters.get(key) || 0) + 1;
    this.failureCounters.set(key, currentCount);

    let level = AlertLevel.ERROR;
    if (currentCount >= CONSECUTIVE_FAILURE_THRESHOLD) {
      level = AlertLevel.CRITICAL;
    }

    const now = new Date().toISOString();
    const alert: SystemAlert = {
      id: this.generateId(),
      level,
      category,
      title,
      message,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      consecutiveFailures: currentCount,
      metadata,
      clinicId,
    };

    try {
      this.dbService.prepare(
        `INSERT INTO SystemAlert (id, level, category, title, message, data, resolved, resolvedAt, consecutiveFailures, clinicId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`
      ).run(
        alert.id,
        alert.level,
        alert.category,
        alert.title,
        alert.message,
        metadata ? JSON.stringify(metadata) : null,
        currentCount,
        clinicId || null,
        alert.createdAt,
        alert.updatedAt,
      );
    } catch (err: unknown) {
      this.logger.error('写入失败告警到数据库失败', err instanceof Error ? err.message : String(err));
    }

    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > MAX_CACHE_ALERTS) {
      this.recentAlerts = this.recentAlerts.slice(0, MAX_CACHE_ALERTS);
    }

    this.logger[level === AlertLevel.CRITICAL ? 'error' : 'warn'](
      `[${category}] ${title}: ${message} (连续失败: ${currentCount})`,
    );

    return alert;
  }

  recordSuccess(category: AlertCategory, key: string): void {
    this.failureCounters.delete(key);
  }

  getAlerts(
    options?: AlertQueryOptions,
  ): SystemAlert[] {
    if (options && (options.offset !== undefined || (options.limit && options.limit > MAX_CACHE_ALERTS))) {
      return this.queryAlertsFromDb(options);
    }

    if (!options || this.isSimpleQuery(options)) {
      let result = [...this.recentAlerts];

      if (options?.level) {
        result = result.filter((a) => a.level === options.level);
      }
      if (options?.category) {
        result = result.filter((a) => a.category === options.category);
      }
      if (options?.resolved !== undefined) {
        result = result.filter((a) => a.resolved === options.resolved);
      }
      if (options?.clinicId) {
        result = result.filter((a) => a.clinicId === options.clinicId);
      }
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }

      return result;
    }

    return this.queryAlertsFromDb(options);
  }

  getAlertsPaginated(
    page: number = 1,
    pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE,
    options?: Omit<AlertQueryOptions, 'limit' | 'offset'>,
  ): PaginatedAlerts {
    const offset = (page - 1) * pageSize;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (options?.level) {
      whereClauses.push('level = ?');
      params.push(options.level);
    }
    if (options?.category) {
      whereClauses.push('category = ?');
      params.push(options.category);
    }
    if (options?.resolved !== undefined) {
      whereClauses.push('resolved = ?');
      params.push(options.resolved ? 1 : 0);
    }
    if (options?.clinicId) {
      whereClauses.push('clinicId = ?');
      params.push(options.clinicId);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalRow = this.dbService.prepare(
      `SELECT COUNT(*) as count FROM SystemAlert ${whereSql}`
    ).get(...params) as { count: number };

    const rows = this.dbService.prepare(
      `SELECT id, level, category, title, message, createdAt, updatedAt, resolved, resolvedAt, consecutiveFailures, clinicId FROM SystemAlert ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;

    const items = rows.map((row) => this.mapRowToAlert(row));

    return {
      items,
      total: totalRow.count,
      page,
      pageSize,
    };
  }

  resolveAlert(id: string): boolean {
    const now = new Date().toISOString();

    try {
      const result = this.dbService.prepare(
        `UPDATE SystemAlert SET resolved = 1, resolvedAt = ?, updatedAt = ? WHERE id = ?`
      ).run(now, now, id);

      if ((result as { changes: number }).changes > 0) {
        const cached = this.recentAlerts.find((a) => a.id === id);
        if (cached) {
          cached.resolved = true;
          cached.resolvedAt = now;
          cached.updatedAt = now;
        }
        return true;
      }
    } catch (err: unknown) {
      this.logger.error('标记告警已解决失败', err instanceof Error ? err.message : String(err));
    }

    return false;
  }

  markAsResolved(id: string): boolean {
    return this.resolveAlert(id);
  }

  clearResolved(clinicId?: string): number {
    try {
      let result;
      if (clinicId) {
        result = this.dbService.prepare(
          `DELETE FROM SystemAlert WHERE resolved = 1 AND clinicId = ?`
        ).run(clinicId);
      } else {
        result = this.dbService.prepare(
          `DELETE FROM SystemAlert WHERE resolved = 1`
        ).run();
      }

      this.recentAlerts = this.recentAlerts.filter((a) => !a.resolved);
      return (result as { changes: number }).changes;
    } catch (err: unknown) {
      this.logger.error('清除已解决告警失败', err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  private queryAlertsFromDb(options: AlertQueryOptions): SystemAlert[] {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (options.level) {
      whereClauses.push('level = ?');
      params.push(options.level);
    }
    if (options.category) {
      whereClauses.push('category = ?');
      params.push(options.category);
    }
    if (options.resolved !== undefined) {
      whereClauses.push('resolved = ?');
      params.push(options.resolved ? 1 : 0);
    }
    if (options.clinicId) {
      whereClauses.push('clinicId = ?');
      params.push(options.clinicId);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limitSql = options.limit ? 'LIMIT ?' : '';
    const offsetSql = options.offset ? 'OFFSET ?' : '';

    if (options.limit) params.push(options.limit);
    if (options.offset) params.push(options.offset);

    try {
      const rows = this.dbService.prepare(
        `SELECT id, level, category, title, message, createdAt, updatedAt, resolved, resolvedAt, consecutiveFailures, clinicId FROM SystemAlert ${whereSql} ORDER BY createdAt DESC ${limitSql} ${offsetSql}`
      ).all(...params) as Array<Record<string, unknown>>;

      return rows.map((row) => this.mapRowToAlert(row));
    } catch (err: unknown) {
      this.logger.error('从数据库查询告警失败', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  private mapRowToAlert(row: Record<string, unknown>): SystemAlert {
    const alert: SystemAlert = {
      id: row.id as string,
      level: row.level as AlertLevel,
      category: row.category as AlertCategory,
      title: row.title as string,
      message: row.message as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      resolved: row.resolved === 1,
    };

    if (row.resolvedAt) {
      alert.resolvedAt = row.resolvedAt as string;
    }
    if (row.consecutiveFailures) {
      alert.consecutiveFailures = row.consecutiveFailures as number;
    }
    if (row.data) {
      try {
        alert.metadata = JSON.parse(row.data as string) as Record<string, unknown>;
      } catch {
        alert.metadata = { raw: row.data };
      }
    }
    if (row.clinicId) {
      alert.clinicId = row.clinicId as string;
    }

    return alert;
  }

  private isSimpleQuery(options: AlertQueryOptions): boolean {
    return !options.offset && (!options.limit || options.limit <= MAX_CACHE_ALERTS);
  }

  private generateId(): string {
    const buffer = crypto.randomBytes(8);
    const randomPart = buffer.toString('base64url').slice(0, 9);
    return Date.now().toString(36) + randomPart;
  }
}
