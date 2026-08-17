/**
 * 专用列表 keyset 分页工具（S-2，2026-08-16）。
 *
 * 背景：通用仓储（repository.ts）已实现 `v:` 游标 + 复合游标，但大量专用列表
 * （发药/退款/盘点/采购审核/麻醉登记/随访/告警/通知）仍 `LIMIT ? OFFSET ?`，
 * 深分页时退化为全表扫描。本工具统一这些列表的游标语义：
 *
 * - 游标格式：`<排序列1>|<排序列2>|...|<id>`（URL 编码前为原始值，逐列以 | 分隔）。
 * - 排序约定：排序列与 id 同向（DESC 列表即 `createdAt DESC, id DESC`），
 *   保证等值排序值下翻页不重不漏。
 * - 截断判定：游标模式取 pageSize+1 行，由 nextCursorFrom 判定是否还有下一页。
 * - 兼容：无 cursor 时调用方继续走原 OFFSET 路径，旧客户端不受影响。
 */

export interface KeysetSpec {
  /** 排序列（含表别名，如 'D.createdAt'）；可多级（如记录日期 + 创建时间）。 */
  columns: Array<{ column: string; key: string }>;
  /** id 决胜列（含表别名，如 'D.id'）。 */
  idColumn: string;
  direction: 'ASC' | 'DESC';
}

/** 解析游标并生成 keyset WHERE 条件；游标非法/缺失时返回空条件（走 OFFSET 回退）。 */
export function keysetCondition(
  cursor: string | null | undefined,
  spec: KeysetSpec,
): { where: string; params: string[] } {
  if (!cursor) return { where: '', params: [] };
  const parts = cursor.split('|');
  if (parts.length !== spec.columns.length + 1) return { where: '', params: [] };
  const op = spec.direction === 'DESC' ? '<' : '>';
  // (c1 op ? OR (c1 = ? AND (c2 op ? OR (... (cn = ? AND id op ?) ...))))
  let where = `(${spec.columns[0].column} ${op} ?`;
  const params = [parts[0]];
  for (let index = 1; index < spec.columns.length; index += 1) {
    where += ` OR (${spec.columns[index - 1].column} = ? AND ${spec.columns[index].column} ${op} ?`;
    params.push(parts[index - 1], parts[index]);
  }
  where += ` OR (${spec.columns[spec.columns.length - 1].column} = ? AND ${spec.idColumn} ${op} ?)`;
  params.push(parts[spec.columns.length - 1], parts[spec.columns.length]);
  where += ')'.repeat(spec.columns.length);
  return { where: ` AND ${where}`, params };
}

/** keyset 模式的 ORDER BY（排序列 + id 同向决胜）。 */
export function keysetOrder(spec: KeysetSpec): string {
  const sorted = spec.columns.map((column) => `${column.column} ${spec.direction}`);
  return `ORDER BY ${sorted.join(', ')}, ${spec.idColumn} ${spec.direction}`;
}

/** 由 pageSize+1 行生成 nextCursor；不足一页返回 null（无更多数据）。 */
export function nextCursorFrom(
  rows: Array<Record<string, unknown>>,
  pageSize: number,
  spec: KeysetSpec,
): string | null {
  if (rows.length <= pageSize) return null;
  const last = rows[pageSize - 1];
  const parts = spec.columns.map((column) => String(last[column.key] ?? ''));
  parts.push(String(last.id ?? ''));
  return parts.join('|');
}
