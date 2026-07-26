import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { AppLogger } from '../../common/services/logger.service';
import { buildClinicFilter } from '../../common/utils/db/clinic-filter';
import { validateColumnName, escapeLike } from '../../common/utils/db/validate-name';
import {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationPayload,
  NotificationQueryOptions,
  UnreadCountResult,
} from './types/notification.types';
import { MAX_PAGE_SIZE, PAGINATION } from '../../common/constants/pagination';
import { BusinessNotFoundException, BusinessValidationException, BusinessForbiddenException } from '@common/errors';

const TABLE_NAME = 'Notification';
const JSON_FIELDS = ['data'];
const SEARCH_FIELDS = ['title', 'content'];

@Injectable()
export class NotificationsService {
  private readonly logger = new AppLogger(NotificationsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  // =========================================================================
  // 创建通知
  // =========================================================================

  /**
   * 创建一条通知
   * @param payload 通知负载
   * @returns 创建后的通知
   */
  async create(payload: NotificationPayload): Promise<Notification> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const clinicId = payload.clinicId || this.clinicContext.getClinicId();
    if (!clinicId) {
      throw new BusinessForbiddenException('缺少诊所信息，请重新登录');
    }

    const data = {
      id,
      clinicId,
      userId: payload.userId || null,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      priority: payload.priority,
      readAt: null,
      data: payload.data ? JSON.stringify(payload.data) : null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const columns = Object.keys(data).filter(k => validateColumnName(k));
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(k => data[k as keyof typeof data]);

    this.dbService.prepare(
      `INSERT INTO ${TABLE_NAME} (${columns.join(', ')}) VALUES (${placeholders})`,
    ).run(...values as [string, ...unknown[]]);

    return this.findOne(id);
  }

  /**
   * 向诊所所有用户发送广播通知
   * @param payload 通知负载（不包含 userId）
   * @returns 创建的通知
   */
  async broadcastToClinic(payload: Omit<NotificationPayload, 'userId'>): Promise<Notification> {
    return this.create({ ...payload, userId: undefined });
  }

  /**
   * 向指定用户发送通知
   * @param userId 接收用户 ID
   * @param payload 通知负载
   * @returns 创建的通知
   */
  async sendToUser(userId: string, payload: Omit<NotificationPayload, 'userId'>): Promise<Notification> {
    return this.create({ ...payload, userId });
  }

  // =========================================================================
  // 查询通知
  // =========================================================================

  /**
   * 分页查询当前用户的通知列表
   * @param options 查询选项
   * @returns 分页结果
   */
  async findMany(options: NotificationQueryOptions = {}): Promise<{
    items: Notification[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const {
      type,
      priority,
      isRead,
      keyword,
      page: rawPage = 1,
      pageSize: rawPageSize = PAGINATION.DEFAULT_PAGE_SIZE,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = options;

    const page = Math.max(1, Math.floor(Number(rawPage) || 1));
    const pageSize = Math.min(Math.max(1, Math.floor(Number(rawPageSize) || 20)), MAX_PAGE_SIZE);

    if (!validateColumnName(sortBy)) {
      throw new BusinessValidationException(`无效的排序字段: ${sortBy}`);
    }

    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: unknown[] = [];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    // 当前用户的通知（userId 为当前用户 ID 或 null（广播通知））
    const userId = this.clinicContext.getUserId();
    if (userId) {
      conditions.push('(userId = ? OR userId IS NULL)');
      params.push(userId);
    }

    // 软删除过滤
    conditions.push('deletedAt IS NULL');

    // 类型过滤
    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    // 优先级过滤
    if (priority) {
      conditions.push('priority = ?');
      params.push(priority);
    }

    // 已读/未读过滤
    if (isRead !== undefined) {
      if (isRead) {
        conditions.push('readAt IS NOT NULL');
      } else {
        conditions.push('readAt IS NULL');
      }
    }

    // 关键词搜索
    if (keyword && SEARCH_FIELDS.length > 0) {
      const escaped = escapeLike(keyword);
      const likeConditions = SEARCH_FIELDS.map(f => `${f} LIKE ? ESCAPE '\\'`);
      conditions.push(`(${likeConditions.join(' OR ')})`);
      params.push(...SEARCH_FIELDS.map(() => `%${escaped}%`));
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as count FROM ${TABLE_NAME}${whereClause}`;
    const total = (this.dbService.prepare(countSql).get(...params) as { count: number })?.count || 0;

    const dataSql = `SELECT id, userId, type, title, priority, readAt, createdAt FROM ${TABLE_NAME}${whereClause} ORDER BY ${sortBy} ${validSortOrder} LIMIT ? OFFSET ?`;
    const items = this.dbService.prepare(dataSql).all(...params, pageSize, (page - 1) * pageSize) as Notification[];

    this.parseJsonFields(items);

    return { items, total, page, pageSize };
  }

  /**
   * 获取单条通知详情
   * @param id 通知 ID
   * @returns 通知详情
   */
  async findOne(id: string): Promise<Notification> {
    const conditions: string[] = ['id = ?'];
    const params: unknown[] = [id];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    // 当前用户
    const userId = this.clinicContext.getUserId();
    if (userId) {
      conditions.push('(userId = ? OR userId IS NULL)');
      params.push(userId);
    }

    conditions.push('deletedAt IS NULL');

    const sql = `SELECT id, clinicId, userId, type, title, content, priority, readAt, data, createdAt, updatedAt, deletedAt FROM ${TABLE_NAME} WHERE ${conditions.join(' AND ')}`;
    const item = this.dbService.prepare(sql).get(...params) as Notification | undefined;

    if (!item) {
      throw new BusinessNotFoundException('通知不存在');
    }

    this.parseJsonFields([item]);
    return item;
  }

  /**
   * 获取未读通知数量
   * @returns 未读统计结果
   */
  async getUnreadCount(): Promise<UnreadCountResult> {
    const conditions: string[] = ['readAt IS NULL', 'deletedAt IS NULL'];
    const params: unknown[] = [];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    // 当前用户
    const userId = this.clinicContext.getUserId();
    if (userId) {
      conditions.push('(userId = ? OR userId IS NULL)');
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    // 总数
    const totalSql = `SELECT COUNT(*) as count FROM ${TABLE_NAME}${whereClause}`;
    const total = (this.dbService.prepare(totalSql).get(...params) as { count: number })?.count || 0;

    // 按类型统计
    const byTypeSql = `SELECT type, COUNT(*) as count FROM ${TABLE_NAME}${whereClause} GROUP BY type`;
    const byTypeRows = this.dbService.prepare(byTypeSql).all(...params) as { type: string; count: number }[];
    const byType = new Map<NotificationType, number>();
    for (const t of Object.values(NotificationType)) {
      byType.set(t, 0);
    }
    for (const row of byTypeRows) {
      const typeVal = row.type as NotificationType;
      if (byType.has(typeVal)) {
        byType.set(typeVal, row.count);
      }
    }

    // 按优先级统计
    const byPrioritySql = `SELECT priority, COUNT(*) as count FROM ${TABLE_NAME}${whereClause} GROUP BY priority`;
    const byPriorityRows = this.dbService.prepare(byPrioritySql).all(...params) as { priority: string; count: number }[];
    const byPriority = new Map<NotificationPriority, number>();
    for (const p of Object.values(NotificationPriority)) {
      byPriority.set(p, 0);
    }
    for (const row of byPriorityRows) {
      const priorityVal = row.priority as NotificationPriority;
      if (byPriority.has(priorityVal)) {
        byPriority.set(priorityVal, row.count);
      }
    }

    return {
      total,
      byType: Object.fromEntries(byType) as Record<NotificationType, number>,
      byPriority: Object.fromEntries(byPriority) as Record<NotificationPriority, number>,
    };
  }

  // =========================================================================
  // 标记已读
  // =========================================================================

  /**
   * 标记单条通知为已读
   * @param id 通知 ID
   * @returns 更新后的通知
   */
  async markAsRead(id: string): Promise<Notification> {
    const notification = await this.findOne(id);
    if (notification.readAt) {
      return notification;
    }

    const now = new Date().toISOString();
    const conditions: string[] = ['id = ?'];
    const params: unknown[] = [now, now, id];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    const sql = `UPDATE ${TABLE_NAME} SET readAt = ?, updatedAt = ? WHERE ${conditions.join(' AND ')}`;
    this.dbService.prepare(sql).run(...params);

    return this.findOne(id);
  }

  /**
   * 标记所有通知为已读
   * @returns 标记已读的数量
   */
  async markAllAsRead(): Promise<{ count: number }> {
    const now = new Date().toISOString();
    const conditions: string[] = ['readAt IS NULL', 'deletedAt IS NULL'];
    const params: unknown[] = [now, now];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    // 当前用户
    const userId = this.clinicContext.getUserId();
    if (userId) {
      conditions.push('(userId = ? OR userId IS NULL)');
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const updateSql = `UPDATE ${TABLE_NAME} SET readAt = ?, updatedAt = ?${whereClause}`;
    const result = this.dbService.prepare(updateSql).run(...params);

    return { count: result.changes };
  }

  // =========================================================================
  // 删除通知
  // =========================================================================

  /**
   * 软删除单条通知
   * @param id 通知 ID
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const now = new Date().toISOString();
    const conditions: string[] = ['id = ?'];
    const params: unknown[] = [now, now, id];

    // 诊所隔离
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (clinicClause) {
      conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
      params.push(...clinicParams);
    }

    const sql = `UPDATE ${TABLE_NAME} SET deletedAt = ?, updatedAt = ? WHERE ${conditions.join(' AND ')}`;
    this.dbService.prepare(sql).run(...params);
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  /**
   * 解析 JSON 字段
   */
  private parseJsonFields(items: Notification[]): void {
    items.forEach((item) => {
      JSON_FIELDS.forEach((field) => {
        const record = item as unknown as Record<string, unknown>;
        const value = record[field];
        if (typeof value === 'string') {
          try {
            record[field] = JSON.parse(value);
          } catch (err: unknown) {
            this.logger.warn(`解析 JSON 字段 '${field}' 失败: ${(err as Error)?.message}`);
            record[field] = null;
          }
        }
      });
    });
  }
}
