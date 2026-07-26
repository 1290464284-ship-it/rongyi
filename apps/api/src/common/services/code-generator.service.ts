import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { escapeLike } from '../utils/db/validate-name';

/**
 * 业务编码生成器 - 从 BaseService 拆分而来
 *
 * 职责：
 *  - 使用事务 + MAX(code) 提高并发安全性
 *  - 生成形如 `PREFIX000001` 的递增编码（6 位补零）
 *
 * 设计说明：
 *  - 标记为 @Injectable 以便未来可通过 Nest DI 使用
 *  - 同时支持通过构造函数直接实例化（BaseService 内部使用，避免破坏 28 个子类的 super() 调用）
 *  - 调用方仍需对 INSERT 添加唯一约束重试以应对极端并发场景
 */
@Injectable()
export class CodeGenerator {
  /**
   * 生成业务编码：使用事务 + MAX(code) 提高并发安全性
   *
   * @param dbService 数据库服务（提供 transaction 能力）
   * @param tableName 表名
   * @param prefix 编码前缀（如 'P'、'C'）
   * @param clinicClause 诊所过滤子句（由调用方通过 buildClinicClause 构造）
   * @returns 形如 `P000001` 的编码字符串
   */
  generateCode(
    dbService: DbService,
    tableName: string,
    prefix: string,
    clinicClause: { clause: string; params: unknown[] },
  ): string {
    return dbService.transaction((db) => {
      const escapedPrefix = escapeLike(prefix);
      const whereClinic = clinicClause.clause
        ? ` AND ${clinicClause.clause.replace(/^\s*AND\s+/i, '')}`
        : '';
      const row = db.prepare(
        `SELECT code FROM ${tableName} WHERE code LIKE ? ESCAPE '\\'${whereClinic} ORDER BY code DESC LIMIT 1`
      ).get(`${escapedPrefix}%`, ...clinicClause.params) as { code: string } | undefined;

      let nextSeq = 1;
      if (row?.code) {
        // 注意：此处正则转义 prefix 中可能的正则元字符，与上面 escapeLike 的 LIKE 转义是两套独立机制
        const escapedPrefixForRegex = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = row.code.match(new RegExp(`^${escapedPrefixForRegex}(\\d+)$`));
        if (match) {
          nextSeq = parseInt(match[1], 10) + 1;
        }
      }
      return `${prefix}${String(nextSeq).padStart(6, '0')}`;
    });
  }
}
