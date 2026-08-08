import type Database from 'better-sqlite3';
import { Logger } from '../../infrastructure/logger';
import { createRouteDependencies, type RouteDependencies } from './deps';

export interface BuildRouteDepsOptions {
  dbPath?: string;
  backupDir?: string;
}

/**
 * 测试用 RouteDependencies 构造器（L-02：统一 registerXxxRoutes(app, deps)
 * 单签名）。镜像 app.ts 组合根的服务实例化，仅供路由 spec 使用；logger
 * 无 logDir，只打到控制台。需要替换个别服务时传覆盖对象。
 */
export function buildRouteDeps(
  db: Database.Database,
  options: BuildRouteDepsOptions = {},
  overrides: Partial<RouteDependencies> = {},
): RouteDependencies {
  const base = createRouteDependencies({
    db,
    dbPath: options.dbPath ?? 'v2.sqlite',
    backupDir: options.backupDir ?? 'backups',
    logger: new Logger(),
    logDir: '',
  });
  return { ...base, ...overrides };
}
