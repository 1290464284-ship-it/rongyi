// Use case and repository ports（M-04：由 contracts.ts 拆分）
import type { ID } from './shared';
import type { Page, PageQuery } from './shared';
import type { UserRole } from './enums';

export interface AppContext {
  userId: ID;
  clinicId: ID | null;
  role: UserRole;
  /** 用户生效的模块权限键；BOSS 可逐用户覆盖。 */
  permissions?: string[];
  traceId: string;
  now: () => Date;
}

export interface IRepository<TEntity> {
  findById(id: ID, context: AppContext): Promise<TEntity | null>;
  findMany(query: RepositoryQuery, context: AppContext): Promise<Page<TEntity>>;
  insert(entity: TEntity, context: AppContext): Promise<void>;
  update(entity: TEntity, context: AppContext): Promise<void>;
  softDelete(id: ID, context: AppContext): Promise<void>;
}

export interface RepositoryQuery extends PageQuery {
  filters?: Record<string, unknown>;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  /** keyset 分页游标：按 id ASC 拉取 id > cursor 的下一页。 */
  cursor?: string;
}

export interface IUnitOfWork {
  run<T>(fn: () => T): T;
}
