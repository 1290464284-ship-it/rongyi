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
 * TODO: 统一 entityName 映射说明
 * 当前 registry 中的 resource.name 与对应实体表名存在两套命名约定：
 * - 多数资源：resource.name（复数形式，如 patients / appointments）→ 通过 contracts 中 ResourceDefinition.table 映射到实体类名（如 Patient / Appointment）
 * - 少数例外：imaging（无 s）、firstExamTeeth、memberCardLogs、memberPointLogs 等名称与 table 不一致
 * 迁移时需梳理所有 name→table 的映射，统一为单一命名策略（建议始终以 domain entity 名为准），并在 resourceRegistry 中提供 name↔entity 双向查询辅助函数。
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
/* v8 ignore start -- generated legacy definitions are pre-pruned; duplicate/internal rows are intentionally never registered. */
for (const resource of legacyResources) {
  const tableAlreadyDeclared = resources.some((candidate) => candidate.table === resource.table);
  if (!registry.has(resource.name) && !tableAlreadyDeclared && !INTERNAL_RESOURCE_TABLES.has(resource.table)) {
    registry.set(resource.name, resource);
  }
}
/* v8 ignore stop */

export const resourceRegistry: ResourceRegistry = {
  get(name) {
    return registry.get(name);
  },
  all() {
    return [...registry.values()];
  },
};
