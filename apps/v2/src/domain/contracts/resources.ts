// Generic resource definition（M-04：由 contracts.ts 拆分）
import type { UserRole } from './enums';

export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum'
  | 'json'
  | 'relation'
  | 'decimal';

export type FieldFormat =
  | 'text'
  | 'money'
  | 'date'
  | 'datetime'
  | 'json';

export type FieldInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'json';

export interface ResourceField {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  label?: string;
  enumLabels?: Readonly<Record<string, string>>;
  format?: FieldFormat;
  inputType?: FieldInputType;
  hidden?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  helpText?: string;
  enumValues?: readonly string[];
  relation?: { resource: string; foreignKey: string; labelField: string };
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface ResourceCapabilities {
  list: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  softDelete: boolean;
}

export interface ResourceDefinition {
  name: string;
  label?: string;
  table: string;
  fields: ResourceField[];
  searchableFields?: string[];
  /** SearchIndex 表中该资源对应的 resource 值；声明后 findMany 的 search 走 FTS MATCH 而非 LIKE。 */
  searchIndexResource?: string;
  defaultSort?: { field: string; order: 'ASC' | 'DESC' };
  capabilities: ResourceCapabilities;
  roles: UserRole[];
  audit?: boolean;
}

export interface ResourceRegistry {
  get(name: string): ResourceDefinition | undefined;
  all(): ResourceDefinition[];
}
