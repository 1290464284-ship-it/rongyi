// Legacy schema 同步（M-04：由 database.ts 拆分）
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { INTERNAL_RESOURCE_TABLES, resourceRegistry } from '../../domain/resources';

export function extractCreateTableStatements(text: string): string[] {
  const statements: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('CREATE TABLE IF NOT EXISTS', cursor);
    if (start === -1) break;
    const parenStart = text.indexOf('(', start);
    if (parenStart === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = parenStart; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    statements.push(text.slice(start, end + 1));
    cursor = end + 1;
  }
  return statements;
}

export function syncLegacySchema(db: Database.Database, schemaDir: string): void {
  // 条件化：测试环境跳过；schema 目录不存在时跳过
  if (process.env.NODE_ENV === 'test') return;
  if (!fs.existsSync(schemaDir)) return;
  const allowedTables = new Set([
    ...resourceRegistry.all().map((resource) => resource.table),
    ...INTERNAL_RESOURCE_TABLES,
  ]);
  const files = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.tables.ts'));
  if (files.length === 0) return;
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      const content = fs.readFileSync(path.join(schemaDir, file), 'utf8');
      for (const statement of extractCreateTableStatements(content)) {
        const tableMatch = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(statement);
        if (!tableMatch || !allowedTables.has(tableMatch[1])) continue;
        db.exec(`${statement};`);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
