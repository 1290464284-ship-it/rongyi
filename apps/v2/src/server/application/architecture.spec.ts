import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resourceRegistry } from '../../domain/resources';

const applicationDir = path.resolve(import.meta.dirname);
const infrastructureDir = path.resolve(applicationDir, '..', 'infrastructure');

describe('architecture boundaries', () => {
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
        expect(content, path.join(dir, file)).not.toContain('clinicId = ?');
      }
    }
  });
});
