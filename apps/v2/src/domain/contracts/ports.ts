// Use case and repository ports（M-04：由 contracts.ts 拆分）
import type { ID } from './shared';
import type { Page, PageQuery } from './shared';
import type { UserRole } from './enums';

export interface AppContext {
  userId: ID;
  clinicId: ID | null;
  role: UserRole;
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
}

export interface IUnitOfWork {
  run<T>(fn: () => T): T;
}
