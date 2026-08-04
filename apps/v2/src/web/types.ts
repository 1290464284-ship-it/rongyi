export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ResourceField {
  name: string;
  type: 'text' | 'longText' | 'number' | 'money' | 'date' | 'datetime' | 'boolean' | 'enum' | 'json' | 'relation';
  required?: boolean;
  enumValues?: readonly string[];
  relation?: { resource: string; labelField: string };
  maxLength?: number;
}

export interface ResourceDefinition {
  name: string;
  table: string;
  fields: ResourceField[];
  capabilities: { create: boolean; update: boolean; delete: boolean; softDelete: boolean };
}
