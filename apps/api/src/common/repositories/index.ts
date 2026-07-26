/**
 * Repository 层统一导出
 *
 * Repository 层从 BaseService 拆分而来，封装纯粹的 SQL 操作，
 * 不包含业务逻辑（诊所过滤、JSON/金额字段后处理等）。
 * 业务逻辑仍由 BaseService 层负责，BaseService 通过组合方式使用 BaseRepository。
 */
export * from './base.repository';
