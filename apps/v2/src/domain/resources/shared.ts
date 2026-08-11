import type { ResourceField, ResourceDefinition, UserRole } from '../contracts';

/** 角色常量：资源定义中的默认角色集合 */
export const boss: UserRole[] = ['BOSS', 'ADMIN'];
export const staff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];
export const clinical: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];
export const reception: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];

/** 字段声明辅助：{ name, type, ...options } */
export function f(
  name: string,
  type: ResourceField['type'],
  options: Partial<ResourceField> = {},
): ResourceField {
  return { name, type, ...options };
}

/** 资源声明辅助：默认 searchableFields/defaultSort/capabilities/roles/audit */
export function crud(
  name: string,
  table: string,
  fields: ResourceField[],
  options: Partial<ResourceDefinition> = {},
): ResourceDefinition {
  return {
    name,
    table,
    fields,
    searchableFields: fields.filter((field) => field.searchable).map((field) => field.name),
    defaultSort: { field: 'createdAt', order: 'DESC' },
    capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
    roles: staff,
    audit: false,
    ...options,
  };
}
