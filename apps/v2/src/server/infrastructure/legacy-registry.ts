import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
import type { ResourceDefinition } from '../../domain/contracts';

export function resolveResource(_db: Database.Database, name: string): ResourceDefinition | undefined {
  return resourceRegistry.get(name);
}

export function listAllResources(_db: Database.Database): ResourceDefinition[] {
  return resourceRegistry.all();
}
