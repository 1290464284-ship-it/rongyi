import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
import type { ResourceDefinition } from '../../domain/contracts';
import { applyUiMeta } from './ui-meta';

export function resolveResource(_db: Database.Database, name: string): ResourceDefinition | undefined {
  const definition = resourceRegistry.get(name);
  return definition ? applyUiMeta(definition) : undefined;
}

export function listAllResources(_db: Database.Database): ResourceDefinition[] {
  return resourceRegistry.all().map(applyUiMeta);
}
