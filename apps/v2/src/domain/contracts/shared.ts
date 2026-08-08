// Cross-cutting primitives（M-04：由 contracts.ts 拆分）

export type ID = string;
export type UTCDateTime = string;
export type ClinicDate = string;
export type Cents = number;
export const CLINIC_TZ_OFFSET_HOURS = 8;

export interface Entity {
  id: ID;
  clinicId?: ID | null;
  createdAt: UTCDateTime;
  updatedAt: UTCDateTime;
}

export interface SoftDeletable {
  deletedAt?: UTCDateTime | null;
}

export type StoredEntity<T extends Entity> = T & SoftDeletable;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** 列表是否因服务端上限被截断（例如管理台账超过单页上限）。 */
  truncated?: boolean;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppErrorLike };

export interface AppErrorLike {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  traceId?: string;
}
