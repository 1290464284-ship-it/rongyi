import type { Page as DomainPage } from '../domain/contracts';
import type { ResourceDefinition, ResourceField } from '../domain/contracts';

export type Page<T> = DomainPage<T>;

// ResourceField / ResourceDefinition 直接复用 domain/contracts 的唯一声明，
// 避免前后端 DTO 双写漂移（round7 H-02）。前端不再维护自有副本。
export type { ResourceField, ResourceDefinition };
