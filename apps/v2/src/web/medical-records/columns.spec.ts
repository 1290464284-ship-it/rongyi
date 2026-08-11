// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { recordColumns } from './columns';
import type { MedicalRecordRow } from './types';

function renderColumn(key: string, row: MedicalRecordRow) {
  const column = recordColumns.find((entry) => entry.key === key);
  if (!column) throw new Error(`missing column ${key}`);
  return typeof column.render === 'function' ? column.render(row) : '';
}

describe('medical-records/columns', () => {
  it('falls back to ids when labels are missing', () => {
    expect(renderColumn('patientId', { id: 'mr-1', patientId: 'p-1' })).toBe('p-1');
    expect(renderColumn('patientId', { id: 'mr-1', patientId: 'p-1', patientIdLabel: '张三' })).toBe('张三');
    expect(renderColumn('doctorId', { id: 'mr-1', doctorId: 'd-1' })).toBe('d-1');
    expect(renderColumn('doctorId', { id: 'mr-1', doctorId: 'd-1', doctorIdLabel: '张医生' })).toBe('张医生');
  });

  it('maps edit request status labels with a fallback', () => {
    expect(renderColumn('editRequestStatus', { id: 'mr-1', editRequestStatus: 'PENDING' })).toBe('待审核');
    expect(renderColumn('editRequestStatus', { id: 'mr-1', editRequestStatus: null })).toBe('无');
    expect(renderColumn('editRequestStatus', { id: 'mr-1', editRequestStatus: 'CUSTOM' })).toBe('CUSTOM');
  });
});
