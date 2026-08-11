import type { ResourceDefinition, ResourceRegistry } from '../contracts';
import { legacyResources } from '../legacy-resources.generated';
import { coreResources } from './core';
import { clinicalResources } from './clinical';
import { financeResources } from './finance';
import { inventoryResources } from './inventory';
import { operationsResources } from './operations';
import { r2Resources } from './r2';

/**
 * Declarative resource registry.
 *
 * Simple CRUD resources are expressed here instead of in duplicated routers and
 * repositories. Complex workflows still live in dedicated application use cases.
 *
 * 资源定义按业务域拆分为本目录子模块（core/clinical/finance/inventory/operations/r2），
 * 聚合后与 legacyResources（生成物）合并注册。
 *
 * 命名约定：resource.name 是路由/前端使用的复数资源名，table 是领域实体表名。
 * 少量例外（imaging / firstExamTeeth / memberCardLogs / memberPointLogs）由
 * ResourceDefinition.table 显式声明；新增资源时保持 name→table 一一映射即可。
 */

const resources: ResourceDefinition[] = [
  ...coreResources,
  ...clinicalResources,
  ...financeResources,
  ...inventoryResources,
  ...operationsResources,
  ...r2Resources,
];

export const INTERNAL_RESOURCE_TABLES = new Set([
  'BackupRecord',
  'IdempotencyRecord',
  'SyncChange',
  'SyncDevice',
  'UsedRefreshToken',
  'UserClinic',
]);

const registry = new Map(resources.map((resource) => [resource.name, resource]));
function withAdminRole(definition: ResourceDefinition): ResourceDefinition {
  return definition.roles.includes('BOSS') && !definition.roles.includes('ADMIN')
    ? { ...definition, roles: [...definition.roles, 'ADMIN'] }
    : definition;
}
/* v8 ignore start -- generated legacy definitions are pre-pruned; duplicate/internal rows are intentionally never registered. */
for (const resource of legacyResources) {
  const tableAlreadyDeclared = resources.some((candidate) => candidate.table === resource.table);
  if (!registry.has(resource.name) && !tableAlreadyDeclared && !INTERNAL_RESOURCE_TABLES.has(resource.table)) {
    registry.set(resource.name, withAdminRole(resource));
  }
}
/* v8 ignore stop */

for (const [name, definition] of [...registry]) {
  registry.set(name, withAdminRole(definition));
}

export const resourceRegistry: ResourceRegistry = {
  get(name) {
    return registry.get(name);
  },
  all() {
    return [...registry.values()];
  },
};
