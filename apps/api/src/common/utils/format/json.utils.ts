/**
 * 安全解析 JSON 字符串，解析失败时返回默认值
 * 用于数据库 JSON 字段读取等场景，避免脏数据导致的异常
 */
export function safeJsonParse<T = unknown>(
  value: string | null | undefined,
  defaultValue: T = null,
): T {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * 安全解析 JSON 数组，解析失败时返回空数组
 * 专门用于 teethNumbers、diseases 等数组类型的 JSON 字段
 */
export function safeJsonArray<T = unknown>(
  value: string | null | undefined,
): T[] {
  const parsed = safeJsonParse<T[]>(value, []);
  return Array.isArray(parsed) ? parsed : [];
}
