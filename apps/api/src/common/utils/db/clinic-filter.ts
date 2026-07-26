export interface ClinicFilter {
  clause: string;
  params: unknown[];
}

/**
 * 构建诊所过滤条件（强制多租户隔离）。
 *
 * - 当 clinicId 为有效字符串时，返回 AND clinicId = ? 过滤子句。
 * - 当 clinicId 为 null/undefined/空串时，抛出错误 —— 禁止返回全库数据。
 *   若确实需要跨诊所查询（如 BOSS 角色全局统计），请使用 buildClinicFilterOptional() 并自行做角色校验。
 */
export function buildClinicFilter(clinicId?: string | null): ClinicFilter {
  if (!clinicId) {
    throw new Error("CLINIC_CONTEXT_MISSING: 诊所上下文缺失，无法执行查询");
  }
  return { clause: " AND clinicId = ?", params: [clinicId] };
}

/**
 * 可选的诊所过滤条件（用于 BOSS 角色或跨诊所的全局查询）。
 *
 * - clinicId 有效 → 返回 AND clinicId = ?
 * - clinicId 为空 → 返回空过滤（全量数据）
 *
 * 注意：调用方必须自行校验调用者角色是否有权限查看全量数据！
 */
export function buildClinicFilterOptional(clinicId?: string | null): ClinicFilter {
  if (clinicId) return { clause: " AND clinicId = ?", params: [clinicId] };
  return { clause: "", params: [] };
}
