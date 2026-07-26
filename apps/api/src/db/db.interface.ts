/**
 * 领域层数据库抽象接口。
 *
 * 目的：隔离业务 Service 对 better-sqlite3 具体类型的直接依赖，
 * 所有事务回调、数据库连接引用均通过 IDatabase / IStatement 操作。
 */
export interface IStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint | string };
}

export interface IDatabase {
  readonly name: string;
  prepare(sql: string): IStatement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
  backup(destination: string): Promise<unknown>;
}
