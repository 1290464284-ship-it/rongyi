import { describe, expect, it } from 'vitest';
import type { ResourceDefinition } from '../../domain/contracts';
import { applyUiMeta } from './ui-meta';

function definition(fields: ResourceDefinition['fields']): ResourceDefinition {
  return {
    name: 'patients',
    table: 'Patient',
    fields,
    capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
    roles: ['BOSS'],
  };
}

describe('applyUiMeta', () => {
  it('adds Chinese labels, formats, input types, and defaults to every field', () => {
    const result = applyUiMeta(definition([
      { name: 'name', type: 'text', required: true },
      { name: 'gender', type: 'enum', enumValues: ['MALE', 'FEMALE'] },
      { name: 'birthDate', type: 'date' },
      { name: 'registeredAt', type: 'datetime' },
      { name: 'price', type: 'money' },
      { name: 'quantity', type: 'number' },
      { name: 'notes', type: 'longText' },
      { name: 'data', type: 'json' },
      { name: 'active', type: 'boolean' },
      { name: 'relationId', type: 'relation' },
    ]));

    expect(result.label).toBe('患者档案');
    expect(result.fields.map((field) => field.label)).toEqual([
      '名称',
      '性别',
      '出生日期',
      '登记时间',
      '单价',
      '数量',
      '备注',
      '数据',
      '启用',
      '关联 ID',
    ]);
    expect(result.fields[1].enumLabels?.MALE).toBe('男');
    expect(result.fields[3].format).toBe('datetime');
    expect(result.fields[4].format).toBe('money');
    expect(result.fields[5].inputType).toBe('number');
    expect(result.fields[6].inputType).toBe('textarea');
    expect(result.fields[7].inputType).toBe('textarea');
    expect(result.fields[8].inputType).toBe('checkbox');
    expect(result.fields[8].hidden).toBe(false);
    expect(result.fields[0].placeholder).toBe('名称');
  });

  it('hides internal and sensitive fields and marks financial fields read-only', () => {
    const result = applyUiMeta(definition([
      { name: 'id', type: 'text' },
      { name: 'clinicId', type: 'text' },
      { name: 'passwordHash', type: 'text' },
      { name: 'role', type: 'text' },
      { name: 'paidAmount', type: 'money' },
      { name: 'createdAt', type: 'datetime' },
    ]));

    for (const field of result.fields) {
      expect(field.hidden).toBe(true);
      expect(field.readOnly).toBe(true);
    }
  });

  it('honors explicit definition and field metadata overrides', () => {
    const result = applyUiMeta({
      name: 'custom',
      label: '自定义资源',
      table: 'Custom',
      fields: [
        {
          name: 'code',
          type: 'text',
          label: '自定义编号',
          format: 'text',
          inputType: 'text',
          hidden: false,
          readOnly: false,
          placeholder: '请输入',
          helpText: '帮助',
          enumLabels: { A: '甲' },
        },
      ],
      capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
      roles: ['BOSS'],
    });

    expect(result.label).toBe('自定义资源');
    expect(result.fields[0].label).toBe('自定义编号');
    expect(result.fields[0].placeholder).toBe('请输入');
    expect(result.fields[0].helpText).toBe('帮助');
    expect(result.fields[0].enumLabels?.A).toBe('甲');
  });

  it('falls back to humanized names for unknown resources and fields', () => {
    const result = applyUiMeta({
      name: 'patientProfile',
      table: 'PatientProfile',
      fields: [{ name: 'lastVisitAt', type: 'datetime' }],
      capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
      roles: ['BOSS'],
    });
    expect(result.label).toBe('Patient Profile');
    expect(result.fields[0].label).toBe('Last Visit At');
  });
});
