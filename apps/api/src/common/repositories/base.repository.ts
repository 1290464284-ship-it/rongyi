import { Injectable } from '@nestjs/common';
import { validateColumnName } from '../utils/db/validate-name';

/**
 * 可执行 SQL 的最小接口约束。
 *
 * 设计说明：BaseRepository 的所有方法既需要支持事务外调用（传 DbService 实例），
 * 也需要支持事务内调用（传 IDatabase 实例，事务回调参数 db 是 IDatabase 类型）。
 * DbService 和 IDatabase 都满足此接口，因此统一用 SqlExecutor 接收，避免不安全的类型转换。
 */
export interface SqlExecutor {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint | string };
  };
}

/**
 * 查询条件构造结果
 */
export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * 分页查询构建结果（COUNT 和 DATA 共用 WHERE）
 */
export interface BuiltPaginatedQuery {
  countSql: string;
  dataSql: string;
  countParams: unknown[];
  dataParams: unknown[];
}

/**
 * BaseRepository - 从 BaseService 拆分而来
 *
 * 职责（仅封装纯粹的 SQL 构造与执行，不含业务逻辑）：
 *  - INSERT 语句构造与执行
 *  - SELECT 单条记录
 *  - SELECT 多条记录（带 WHERE / ORDER / LIMIT / OFFSET）
 *  - UPDATE 语句构造与执行
 *  - DELETE 语句执行
 *  - 分页查询 SQL 构造（COUNT + DATA，支持游标分页）
 *
 * 设计说明：
 *  - 标记为 @Injectable 以便未来可通过 Nest DI 使用
 *  - 同时支持通过构造函数直接实例化（BaseService 内部使用，避免破坏 28 个子类的 super() 调用）
 *  - 不持有可变状态，所有上下文通过参数显式传入
 *  - 所有列名 / 表名由调用方负责校验（BaseService 已通过 validateColumnName 校验）
 *  - 不负责 JSON / 金额字段的后处理，由调用方在 BaseService 层处理
 *  - 所有执行方法接收 SqlExecutor，可同时支持事务内（IDatabase）和事务外（DbService）调用
 */
@Injectable()
export class BaseRepository {
  /**
   * 执行 INSERT
   * @param db SQL 执行器（DbService 或事务内的 IDatabase）
   * @param tableName 表名
   * @param data 已经过校验和序列化的字段键值对
   */
  insert(
    db: SqlExecutor,
    tableName: string,
    data: Record<string, unknown>,
  ): void {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => data[k]);
    db.prepare(
      `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
    ).run(...values);
  }

  /**
   * 查询单条记录（按 id + 可选的额外 WHERE 条件）
   * @param db SQL 执行器
   * @param tableName 表名
   * @param selectColumns SELECT 字段列表（如 '*' 或 'id, name'）
   * @param id 主键值
   * @param extraConditions 额外的 WHERE 条件（不含 'WHERE' 关键字，使用 AND 拼接）
   * @param extraParams 额外条件对应的参数
   */
  findById<T = unknown>(
    db: SqlExecutor,
    tableName: string,
    selectColumns: string,
    id: string,
    extraConditions: string[] = [],
    extraParams: unknown[] = [],
  ): T | undefined {
    const conditions = ['id = ?', ...extraConditions];
    const params = [id, ...extraParams];
    return db.prepare(
      `SELECT ${selectColumns} FROM ${tableName} WHERE ${conditions.join(' AND ')}`,
    ).get(...params) as T | undefined;
  }

  /**
   * 执行 UPDATE（带诊所过滤）
   * @param db SQL 执行器
   * @param tableName 表名
   * @param updates SET 子句数组（如 ['name = ?', 'updatedAt = ?']）
   * @param params SET 子句参数（不含 id）
   * @param id 主键值
   * @param clinicClause 诊所过滤子句（含 ' AND ' 前缀）
   * @param clinicParams 诊所过滤参数
   */
  update(
    db: SqlExecutor,
    tableName: string,
    updates: string[],
    params: unknown[],
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    db.prepare(
      `UPDATE ${tableName} SET ${updates.join(', ')} WHERE id = ?${clinicClause}`,
    ).run(...params, id, ...clinicParams);
  }

  /**
   * 构造分页查询 SQL（COUNT + DATA），支持游标分页
   *
   * @param tableName 表名
   * @param selectColumns SELECT 字段列表
   * @param whereClause 完整的 WHERE 子句（含 'WHERE' 关键字），可为空字符串
   * @param params WHERE 子句参数
   * @param sortBy 排序字段（调用方已校验）
   * @param sortOrder 排序方向 'ASC' 或 'DESC'
   * @param cursor 游标 ID（可选）
   * @param pageSize 每页条数
   * @param page 当前页码（仅 OFFSET 模式使用）
   */
  buildPaginatedQuery(
    tableName: string,
    selectColumns: string,
    whereClause: string,
    params: unknown[],
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    cursor: string | undefined,
    pageSize: number,
    page: number,
  ): BuiltPaginatedQuery {
    if (!validateColumnName(sortBy)) {
      throw new Error(`无效的排序字段: ${sortBy}`);
    }
    const countSql = `SELECT COUNT(*) as total FROM ${tableName}${whereClause}`;
    const countParams = [...params];

    let dataSql = `SELECT ${selectColumns} FROM ${tableName}${whereClause}`;
    const dataParams: unknown[] = [...params];

    if (cursor) {
      // 游标分页：基于上一页最后一条记录的 id 继续
      const hasWhere = whereClause.length > 0;
      const whereOrAnd = hasWhere ? 'AND' : 'WHERE';
      const cursorOp = sortOrder === 'ASC' ? '>' : '<';
      dataSql += ` ${whereOrAnd} id ${cursorOp} ?`;
      dataParams.push(cursor);
      dataSql += ` ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder} LIMIT ?`;
      dataParams.push(pageSize);
    } else {
      dataSql += ` ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder} LIMIT ? OFFSET ?`;
      dataParams.push(pageSize, (page - 1) * pageSize);
    }

    return { countSql, dataSql, countParams, dataParams };
  }

  /**
   * 执行分页查询并返回结果
   * @param db SQL 执行器
   * @param query 由 buildPaginatedQuery 构造的查询对象
   */
  executePaginatedQuery<T = unknown>(
    db: SqlExecutor,
    query: BuiltPaginatedQuery,
  ): { items: T[]; total: number } {
    const countRow = db.prepare(query.countSql).get(...query.countParams) as { total: number } | null;
    const items = db.prepare(query.dataSql).all(...query.dataParams) as T[];
    return { items, total: countRow?.total || 0 };
  }

  /**
   * 批量关联查询（解决 N+1 问题）
   * @param db SQL 执行器
   * @param ids 待查询的外键 ID 列表（已去重）
   * @param targetTable 目标关联表名
   * @param fields 需要查询的字段（已校验的逗号分隔字符串）
   */
  batchFindByIds<T = unknown>(
    db: SqlExecutor,
    ids: unknown[],
    targetTable: string,
    fields: string,
  ): T[] {
    if (ids.length === 0) return [] as T[];
    const ph = ids.map(() => '?').join(',');
    return db.prepare(
      `SELECT ${fields} FROM ${targetTable} WHERE id IN (${ph})`,
    ).all(...ids) as T[];
  }

  /**
   * 执行任意参数化 SELECT 并返回单条记录
   * @param db SQL 执行器
   * @param sql 参数化 SQL（表名/列名已由调用方校验）
   * @param params 查询参数
   */
  queryOne<T = unknown>(db: SqlExecutor, sql: string, params: unknown[] = []): T | undefined {
    return db.prepare(sql).get(...params) as T | undefined;
  }

  /**
   * 执行任意参数化 SELECT 并返回多条记录
   * @param db SQL 执行器
   * @param sql 参数化 SQL（表名/列名已由调用方校验）
   * @param params 查询参数
   */
  queryAll<T = unknown>(db: SqlExecutor, sql: string, params: unknown[] = []): T[] {
    return db.prepare(sql).all(...params) as T[];
  }

  /**
   * 执行任意参数化写操作（INSERT / UPDATE / DELETE）
   * @param db SQL 执行器
   * @param sql 参数化 SQL（表名/列名已由调用方校验）
   * @param params 查询参数
   */
  execute(db: SqlExecutor, sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint | string } {
    return db.prepare(sql).run(...params);
  }

  /**
   * 构造带 WHERE 的分页查询（复用 buildPaginatedQuery，支持额外条件）
   * @param tableName 表名
   * @param selectColumns SELECT 字段列表
   * @param conditions WHERE 条件数组（不含 'WHERE'，使用 AND 拼接）
   * @param params 条件参数
   * @param sortBy 排序字段
   * @param sortOrder 排序方向
   * @param cursor 游标 ID
   * @param pageSize 每页条数
   * @param page 当前页码
   */
  buildPaginatedQueryWithConditions(
    tableName: string,
    selectColumns: string,
    conditions: string[],
    params: unknown[],
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    cursor: string | undefined,
    pageSize: number,
    page: number,
  ): BuiltPaginatedQuery {
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return this.buildPaginatedQuery(
      tableName,
      selectColumns,
      whereClause,
      params,
      sortBy,
      sortOrder,
      cursor,
      pageSize,
      page,
    );
  }

  /**
   * 校验列名（仅供调用方复用，BaseService 内部已校验）
   */
  isValidColumnName(name: string): boolean {
    return validateColumnName(name);
  }
}

