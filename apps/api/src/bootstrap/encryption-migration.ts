import { Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  setLegacyEncryptionKey,
  decryptFieldWithFlag,
  encryptField,
} from '../common/utils/security/encryption';

const logger = new Logger('EncryptionMigration');

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function validateIdentifier(name: string, type: 'table' | 'column'): void {
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Invalid ${type} name: ${name}`);
  }
}

/**
 * Migrate encrypted fields from a legacy key to the active key.
 *
 * Should be called after `setLegacyEncryptionKey()` so that rows encrypted
 * with the legacy key can be decrypted and re-encrypted with the current key.
 * Returns the number of rows migrated and the number of errors encountered.
 */
export function migrateEncryptedData(dbService: DbService): { migrated: number; errors: number } {
  let migrated = 0;
  let errors = 0;

  // Currently the only encrypted field is Patient.idCard. Keep the list
  // explicit so adding future encrypted fields does not require guessing.
  const encryptedFields: Array<{ table: string; column: string; idColumn?: string }> = [
    { table: 'Patient', column: 'idCard' },
  ];

  for (const { table, column, idColumn = 'id' } of encryptedFields) {
    validateIdentifier(table, 'table');
    validateIdentifier(column, 'column');
    validateIdentifier(idColumn, 'column');

    const rows = dbService
      .prepare(`SELECT ${idColumn} as id, ${column} as value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all() as Array<{ id: string; value: string }>;

    // P3-1: 此处故意不使用事务 — 迁移是幂等的（已迁移行的 needsReencrypt=false），
    // 且需要逐行错误隔离（一行解密失败不应阻塞其他行）。崩溃后重跑即可。
    for (const row of rows) {
      try {
        const { plaintext, needsReencrypt } = decryptFieldWithFlag(row.value);
        if (needsReencrypt && plaintext !== null) {
          dbService.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`).run(encryptField(plaintext), row.id);
          migrated++;
        }
      } catch (err: unknown) {
        logger.error(`加密数据迁移失败，${table}.${column} ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }
  }

  return { migrated, errors };
}

export interface EncryptionMigrationResult {
  /** 是否跳过迁移（未配置 legacyKey） */
  skipped: boolean;
  /** 成功重新加密的行数 */
  migrated: number;
  /** 逐行解密/加密失败的行数 */
  errors: number;
}

/**
 * Configure the legacy encryption key and migrate encrypted fields.
 * Called once during application bootstrap after DbService is initialized.
 *
 * P1 修复：原先返回 void 且 skip 与 failure 不可区分，
 * 调用方只能用 try/catch + warn 静默吞没所有异常。
 * 现在返回结构化结果，让调用方区分「跳过」「部分失败」「成功」三种状态。
 */
export function runEncryptionMigration(dbService: DbService, legacyKey?: string): EncryptionMigrationResult {
  if (!legacyKey) {
    return { skipped: true, migrated: 0, errors: 0 };
  }

  setLegacyEncryptionKey(legacyKey);
  const result = migrateEncryptedData(dbService);
  if (result.migrated > 0 || result.errors > 0) {
    logger.log(`加密数据迁移完成: ${result.migrated} 条已重新加密, ${result.errors || 0} 条出错`);
  }
  return { skipped: false, ...result };
}
