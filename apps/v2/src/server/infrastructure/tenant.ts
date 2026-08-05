/**
 * Shared tenant-scope helpers.
 *
 * Rows are strictly matched against a scoped request's clinic; null clinicId
 * rows were backfilled by migration 121, so no OR NULL fallback is emitted.
 * An unscoped global context (clinicId null) intentionally sees every row and
 * matches every row; it is only used by legacy/system paths.
 */

export type DbParam = string | number | null | bigint | Buffer;

export interface TenantFilter {
  sql: string;
  params: DbParam[];
}

export function tenantWhere(clinicId: string | null | undefined, column = 'clinicId'): TenantFilter {
  return clinicId
    ? { sql: `(${column} = ?)`, params: [clinicId] }
    : { sql: '', params: [] };
}

export function tenantParams(clinicId: string | null | undefined): DbParam[] {
  return tenantWhere(clinicId).params;
}

export function tenantMatches(rowClinicId: unknown, clinicId: string | null | undefined): boolean {
  if (!clinicId) return true;
  return rowClinicId !== null && rowClinicId !== undefined && String(rowClinicId) === clinicId;
}

export function tenantAnd(clinicId: string | null | undefined, column = 'clinicId'): string {
  const clause = tenantWhere(clinicId, column).sql;
  return clause ? ` AND ${clause}` : '';
}
