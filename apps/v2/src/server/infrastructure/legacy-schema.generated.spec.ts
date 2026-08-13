import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCreateTableStatements, splitSqlStatements } from './legacy-schema';

describe('legacy schema generated SQL', () => {
  const schemaDir = path.resolve(import.meta.dirname, '..', '..', '..', 'legacy', 'schema');
  const generatedPath = path.join(schemaDir, 'legacy-schema.generated.sql');

  it('is committed and stays in sync with the .tables.ts sources', () => {
    expect(fs.existsSync(generatedPath)).toBe(true);
    const generated = fs.readFileSync(generatedPath, 'utf8')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const files = fs.readdirSync(schemaDir)
      .filter((name) => name.endsWith('.tables.ts'))
      .sort();
    const expected = files.flatMap((file) =>
      extractCreateTableStatements(fs.readFileSync(path.join(schemaDir, file), 'utf8'))
        .map((statement) => statement.trim()),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(generated).toEqual(expected);
  });

  it('splits SQL statements without treating semicolons inside quotes as boundaries', () => {
    const statements = splitSqlStatements(
      "CREATE TABLE T (a TEXT DEFAULT ';'); CREATE TABLE U (b TEXT);",
    );
    expect(statements).toEqual([
      "CREATE TABLE T (a TEXT DEFAULT ';')",
      'CREATE TABLE U (b TEXT)',
    ]);
  });

  it('splits SQL statements with double-quoted identifiers and quoted content', () => {
    const statements = splitSqlStatements(
      'CREATE TABLE "T" ("a" TEXT DEFAULT "x;y"); CREATE TABLE "U" (b TEXT);',
    );
    expect(statements).toEqual([
      'CREATE TABLE "T" ("a" TEXT DEFAULT "x;y")',
      'CREATE TABLE "U" (b TEXT)',
    ]);
  });
});
