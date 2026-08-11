import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { CustomFieldService } from './custom-fields';

describe('custom fields', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-09T10:00:00.000Z';
  const context = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'test-trace',
    now: () => new Date(now),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-custom-fields-spec-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates and lists definitions ordered by sortOrder', () => {
    const service = new CustomFieldService(db);
    service.createDefinition('patient', {
      label: '过敏史备注',
      fieldName: 'allergyNote',
      fieldType: 'TEXT',
      sortOrder: 2,
    }, context);
    service.createDefinition('patient', {
      label: '是否医保',
      fieldName: 'isInsurance',
      fieldType: 'BOOLEAN',
      sortOrder: 1,
    }, context);
    const definitions = service.listDefinitions('patient', context);
    expect(definitions.map((field) => field.fieldName)).toEqual(['isInsurance', 'allergyNote']);
  });

  it('rejects duplicate field names and unsupported types', () => {
    const service = new CustomFieldService(db);
    try {
      service.createDefinition('patient', {
        label: '重复',
        fieldName: 'isInsurance',
        fieldType: 'TEXT',
      }, context);
      throw new Error('expected validation error');
    } catch (error) {
      expect((error as AppError).status).toBe(400);
    }
    try {
      service.createDefinition('patient', {
        label: '坏类型',
        fieldName: 'badType',
        fieldType: 'DATE',
      }, context);
      throw new Error('expected validation error');
    } catch (error) {
      expect((error as AppError).status).toBe(400);
    }
  });

  it('stores and replaces values for an entity instance', () => {
    const service = new CustomFieldService(db);
    const definitions = service.listDefinitions('patient', context);
    const values = service.setValues('patient', 'patient-custom-1', definitions.map((field) => ({
      fieldId: field.id,
      value: field.fieldType === 'BOOLEAN' ? true : '自定义值',
    })), context);
    expect(Object.keys(values)).toHaveLength(definitions.length);

    const listed = service.listValues('patient', 'patient-custom-1', context);
    expect(listed.definitions).toHaveLength(definitions.length);
    expect(Object.values(listed.values).filter(Boolean)).toHaveLength(definitions.length);

    service.setValues('patient', 'patient-custom-1', definitions.map((field) => ({
      fieldId: field.id,
      value: null,
    })), context);
    const after = service.listValues('patient', 'patient-custom-1', context);
    expect(Object.values(after.values).every((value) => value === null)).toBe(true);
  });

  it('soft deletes a definition and its values', () => {
    const service = new CustomFieldService(db);
    const definitions = service.listDefinitions('patient', context);
    const [target] = definitions;
    service.setValues('patient', 'patient-custom-2', definitions.map((field) => ({
      fieldId: field.id,
      value: field.id === target.id ? 'x' : null,
    })), context);
    service.deleteDefinition(target.id, context);
    expect(service.listDefinitions('patient', context).some((field) => field.id === target.id)).toBe(false);
    const listed = service.listValues('patient', 'patient-custom-2', context);
    expect(listed.values[target.id]).toBeUndefined();
  });

  it('validates definition and value edge cases', () => {
    const service = new CustomFieldService(db);
    expect(() => service.createDefinition('patient', {
      label: '',
      fieldName: 'noLabel',
      fieldType: 'TEXT',
    }, context)).toThrow('label and fieldName are required');
    expect(() => service.createDefinition('patient', {
      label: '坏字段名',
      fieldName: '1bad-name',
      fieldType: 'TEXT',
    }, context)).toThrow();
    expect(() => service.createDefinition('patient', {
      label: '空选项下拉',
      fieldName: 'emptySelect',
      fieldType: 'SELECT',
      options: [],
    }, context)).toThrow('SELECT fields require at least one option');
    expect(() => service.createDefinition('unknownEntity', {
      label: 'x',
      fieldName: 'xField',
      fieldType: 'TEXT',
    }, context)).toThrow();
    expect(() => service.setValues('patient', '', [], context)).toThrow('entityId is required');

    const field = service.createDefinition('patient', {
      label: '值校验',
      fieldName: 'valueCheck',
      fieldType: 'TEXT',
    }, context);
    expect(() => service.setValues('patient', 'patient-custom-3', [
      { fieldId: 'missing-field', value: 'x' },
    ], context)).toThrow('Unknown custom field');
    expect(() => service.setValues('patient', 'patient-custom-3', [
      { fieldId: field.id, value: 'a' },
      { fieldId: field.id, value: 'b' },
    ], context)).toThrow('Duplicate custom field');
  });
});
