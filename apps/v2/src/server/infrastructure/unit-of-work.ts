import type Database from 'better-sqlite3';
import type { IUnitOfWork } from '../../domain/contracts';

export class SqliteUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: Database.Database) {}

  run<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

