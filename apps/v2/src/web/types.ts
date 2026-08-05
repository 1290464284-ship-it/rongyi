import type { Page as DomainPage } from '../domain/contracts';
import type { FieldFormat, FieldInputType } from '../domain/contracts';

export type Page<T> = DomainPage<T>;

export interface ResourceField {
  name: string;
  type: 'text' | 'longText' | 'number' | 'money' | 'date' | 'datetime' | 'boolean' | 'enum' | 'json' | 'relation' | 'decimal';
  required?: boolean;
  enumValues?: readonly string[];
  relation?: { resource: string; labelField: string };
  maxLength?: number;
  label?: string;
  enumLabels?: Readonly<Record<string, string>>;
  format?: FieldFormat;
  inputType?: FieldInputType;
  hidden?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ResourceDefinition {
  name: string;
  label?: string;
  table: string;
  fields: ResourceField[];
  capabilities: { create: boolean; update: boolean; delete: boolean; softDelete: boolean };
}
