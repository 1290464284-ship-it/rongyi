import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resourceRegistry } from '../../domain/resources';
import { UserRole } from '../../domain/contracts';
import { ROLE_DEFAULT_PERMISSIONS } from './service-modules/permissions';
import { ROLE_MANAGEMENT_LEVEL } from './service-modules/common';
import { SEARCH_UPSERT_SQL } from '../infrastructure/search-index';
import { navigationForRole } from '../http/route-policy';

const applicationDir = path.resolve(import.meta.dirname);
const infrastructureDir = path.resolve(applicationDir, '..', 'infrastructure');
const repositoriesDir = path.resolve(infrastructureDir, 'repositories');
const httpDir = path.resolve(applicationDir, '..', 'http');
const SYNC_TABLE_WRITE_RE =
  /\b(INSERT INTO|UPDATE|DELETE FROM)\s+(Patient|Appointment|Charge|InventoryItem|FollowUp|PurchaseOrder)\b/;

describe('architecture boundaries', () => {
  it('keeps application service modules under a maintainable size', () => {
    const serviceDir = path.join(applicationDir, 'service-modules');
    const maxLines = 450;
    for (const relative of fs.readdirSync(serviceDir, { recursive: true }) as string[]) {
      if (!relative.endsWith('.ts') || relative.endsWith('.spec.ts')) continue;
      const content = fs.readFileSync(path.join(serviceDir, relative), 'utf8');
      const lines = content.split('\n').length;
      expect(lines, path.join('service-modules', relative)).toBeLessThanOrEqual(maxLines);
    }
  });

  it('application use cases must not import legacy schema adapters', () => {
    const files = fs.readdirSync(applicationDir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(applicationDir, file), 'utf8');
      expect(content).not.toContain('legacy-registry');
      expect(content).not.toContain('../infrastructure/database');
    }
  });

  it('legacy adapters stay in infrastructure and depend only on domain contracts', () => {
    const file = path.join(infrastructureDir, 'legacy-registry.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('application/');
    expect(content).toContain('../../domain/contracts');
  });

  it('keeps financial and inventory resources read-only through generic CRUD', () => {
    const readOnly = [
      'charges',
      'chargeItems',
      'debtRecords',
      'memberCardLogs',
      'memberPointLogs',
      'refunds',
      'inventoryTransactions',
    ];
    for (const name of readOnly) {
      const capabilities = resourceRegistry.get(name)?.capabilities;
      expect(capabilities, name).toMatchObject({
        create: false,
        update: false,
        delete: false,
      });
    }
    expect(resourceRegistry.get('inventoryItems')?.capabilities).toMatchObject({
      create: true,
      update: true,
      delete: false,
    });
  });

  it('prevents generic state transitions on workflow resources', () => {
    const workflowResources = [
      'registrations',
      // treatmentPlans/prescriptions 已放开软删除（delete+softDelete），供创建失败时客户端清理孤儿记录（R2-P1-19）
      'followUps',
      'wechatMessages',
      'satisfactionSurveys',
      'leaveRequests',
      'notifications',
    ];
    for (const name of workflowResources) {
      const capabilities = resourceRegistry.get(name)?.capabilities;
      expect(capabilities, name).toMatchObject({
        update: false,
        delete: false,
      });
    }
  });

  it('keeps ADMIN access aligned with BOSS for every registered resource', () => {
    for (const definition of resourceRegistry.all()) {
      if (definition.roles.includes('BOSS')) {
        expect(definition.roles, definition.name).toContain('ADMIN');
      }
    }
  });

  it('keeps role configuration complete across hierarchy, permissions, and navigation', () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_MANAGEMENT_LEVEL, role).toHaveProperty(role);
      expect(ROLE_DEFAULT_PERMISSIONS, role).toHaveProperty(role);
      expect(ROLE_DEFAULT_PERMISSIONS[role].length, role).toBeGreaterThan(0);
      expect(navigationForRole(role), role).toContain('dashboard');
    }
    expect(navigationForRole('ADMIN')).toEqual(navigationForRole('BOSS'));
  });

  it('keeps search index resources aligned with the registry', () => {
    for (const definition of resourceRegistry.all()) {
      if (definition.searchIndexResource) {
        expect(SEARCH_UPSERT_SQL, definition.name).toHaveProperty(definition.searchIndexResource);
      }
    }
    for (const resource of Object.keys(SEARCH_UPSERT_SQL)) {
      expect(resourceRegistry.all().some((definition) => definition.searchIndexResource === resource), resource).toBe(true);
    }
  });

  it('does not introduce new unscoped clinic filters in business repositories', () => {
    const allowedFiles = new Set(['operations.ts', 'database.ts']);
    const dirs = [
      path.resolve(import.meta.dirname, '..', 'application'),
      path.resolve(import.meta.dirname, '..', 'infrastructure'),
    ];
    for (const dir of dirs) {
      for (const file of fs.readdirSync(dir, { recursive: true }) as string[]) {
        if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
        if (allowedFiles.has(path.basename(file))) continue;
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        expect(content, path.join(dir, file)).not.toMatch(/(?<![A-Za-z0-9_.])clinicId\s*=\s*\?/);
      }
    }
  });

  it('every direct writer of a sync-allowed table records SyncChange', () => {
    const dirs = [applicationDir, repositoriesDir, httpDir];
    for (const dir of dirs) {
      for (const relative of fs.readdirSync(dir, { recursive: true }) as string[]) {
        if (!relative.endsWith('.ts') || relative.endsWith('.spec.ts')) continue;
        const file = path.join(dir, relative);
        const content = fs.readFileSync(file, 'utf8');
        if (SYNC_TABLE_WRITE_RE.test(content)) {
          expect(content, file).toMatch(/recordSyncChange|trackResourceWrite/);
        }
      }
    }
  });
});
