/**
 * Shared tenant-scope helpers.
 *
 * Legacy rows may have a null clinicId. A scoped request always matches those
 * rows in addition to rows from its own clinic; an unscoped global context is
 * only used by legacy/system paths and intentionally sees every row.
 */

export type DbParam = string | number | null | bigint | Buffer;

export interface TenantFilter {
  sql: string;
  params: DbParam[];
}

export function tenantWhere(clinicId: string | null | undefined, column = 'clinicId'): TenantFilter {
  // OR clinicId IS NULL 仅兼容 legacy 行
  return clinicId
    ? { sql: `(${column} = ? OR ${column} IS NULL)`, params: [clinicId] }
    : { sql: '', params: [] };
}

export function tenantWhereStrict(clinicId: string | null | undefined, column = 'clinicId'): TenantFilter {
  return clinicId
    ? { sql: `(${column} = ?)`, params: [clinicId] }
    : { sql: '', params: [] };
}

export function tenantParams(clinicId: string | null | undefined): DbParam[] {
  return tenantWhere(clinicId).params;
}

export function tenantMatches(rowClinicId: unknown, clinicId: string | null | undefined): boolean {
  if (!clinicId) return true;
  return rowClinicId === null || rowClinicId === undefined || String(rowClinicId) === clinicId;
}

export function tenantAnd(clinicId: string | null | undefined, column = 'clinicId'): string {
  const clause = tenantWhere(clinicId, column).sql;
  return clause ? ` AND ${clause}` : '';
}
