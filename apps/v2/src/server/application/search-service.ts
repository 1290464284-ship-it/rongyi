// 搜索服务（M-04：由 read-services.ts 拆分）
import type Database from 'better-sqlite3';
import type { AppContext } from '../../domain/contracts';
import { buildFtsQuery } from '../infrastructure/search-index';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';

export class SearchService {
  constructor(private readonly db: Database.Database) {}

  search(query: string, context: AppContext): Array<Record<string, unknown>> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const clinicClause = tenantAnd(context.clinicId);
    const ftsParams = [ftsQuery, ...tenantParams(context.clinicId)];
    const matches = this.db.prepare(
      `SELECT resource, recordId
       FROM SearchIndex
       WHERE SearchIndex MATCH ?${clinicClause}
       LIMIT 500`,
    ).all(...ftsParams) as Array<{ resource: string; recordId: string }>;
    const idsByResource = new Map<string, string[]>();
    for (const match of matches) {
      const key = searchResourceName(match.resource);
      const ids = idsByResource.get(key) ?? [];
      ids.push(match.recordId);
      idsByResource.set(key, ids);
    }

    const results: Array<Record<string, unknown>> = [];
    const searches: Array<{
      resource: string;
      rows: Array<Record<string, unknown>>;
      label: (row: Record<string, unknown>) => string;
    }> = [
      {
        resource: 'patients',
        rows: this.rowsByIds('patients', 'SELECT id, name, phone, code FROM Patient', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'appointments',
        rows: this.rowsByIds(
          'appointments',
          `SELECT A.id, P.name AS patientName, A.startTime, A.status
           FROM Appointment A
           LEFT JOIN Patient P ON P.id = A.patientId`,
          'A.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'A.clinicId',
          'A.id',
        ),
        label: (row) => String(row.patientName ?? ''),
      },
      {
        resource: 'charges',
        rows: this.rowsByIds(
          'charges',
          `SELECT C.id, P.name AS patientName, C.number, C.status
           FROM Charge C
           LEFT JOIN Patient P ON P.id = C.patientId`,
          'C.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'C.clinicId',
          'C.id',
        ),
        label: (row) => String(row.number ?? ''),
      },
      {
        resource: 'inventoryItems',
        rows: this.rowsByIds('inventoryItems', 'SELECT id, name, code, category, stock FROM InventoryItem', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'suppliers',
        rows: this.rowsByIds('suppliers', 'SELECT id, name, code, phone FROM Supplier', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? ''),
      },
      {
        resource: 'followUps',
        rows: this.rowsByIds(
          'followUps',
          `SELECT F.id, P.name AS patientName, P.phone AS phone, F.content, F.status
           FROM FollowUp F
           LEFT JOIN Patient P ON P.id = F.patientId`,
          'F.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'F.clinicId',
          'F.id',
        ),
        label: (row) => String(row.patientName ?? ''),
      },
    ];

    for (const search of searches) {
      for (const row of search.rows) {
        results.push({
          resource: search.resource,
          id: row.id,
          label: search.label(row),
          detail: row,
        });
      }
    }
    return results;
  }

  private rowsByIds(
    resource: string,
    selectFrom: string,
    whereBase: string,
    idsByResource: Map<string, string[]>,
    context: AppContext,
    tenantColumn = 'clinicId',
    idColumn = 'id',
  ): Array<Record<string, unknown>> {
    const ids = idsByResource.get(resource) ?? [];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `${selectFrom} WHERE ${whereBase} AND ${idColumn} IN (${placeholders})${tenantAnd(context.clinicId, tenantColumn)}`;
    return this.db.prepare(sql).all(...ids, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
  }

}
function searchResourceName(resource: string): string {
  switch (resource) {
    case 'Patient':
      return 'patients';
    case 'Appointment':
      return 'appointments';
    case 'Charge':
      return 'charges';
    case 'InventoryItem':
      return 'inventoryItems';
    case 'Supplier':
      return 'suppliers';
    case 'FollowUp':
      return 'followUps';
    default:
      return resource;
  }
}
