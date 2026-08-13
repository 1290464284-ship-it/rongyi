import { describe, expect, it } from 'vitest';
import { recordColumns } from './columns';

describe('medical record columns', () => {
  it('falls back to raw ids and unknown edit statuses', () => {
    const patient = recordColumns.find((column) => column.key === 'patientId');
    const doctor = recordColumns.find((column) => column.key === 'doctorId');
    const status = recordColumns.find((column) => column.key === 'editRequestStatus');
    expect(patient?.render?.({ patientId: 'p1' } as never)).toBe('p1');
    expect(patient?.render?.({} as never)).toBe('');
    expect(doctor?.render?.({ doctorId: 'd1' } as never)).toBe('d1');
    expect(status?.render?.({ editRequestStatus: 'WEIRD' } as never)).toBe('WEIRD');
    expect(status?.render?.({} as never)).toBe('无');
  });
});
