import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrescription, updatePrescription } from './api';
import { apiRequest, fetchAllPages } from '../lib/api';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  fetchAllPages: vi.fn(),
}));

function validForm() {
  return {
    patientId: 'p-1',
    doctorId: 'd-1',
    remark: '',
    status: 'DRAFT',
    items: [
      { id: 'local-1', name: '阿莫西林', days: '3', quantity: '2', price: '100', remark: '' },
    ],
  };
}

describe('prescriptions/api', () => {
  afterEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchAllPages).mockReset();
  });

  it('cleans up orphan prescription items when a detail fails after the master is created', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/prescriptions' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return { id: 'pres-1' };
      }
      if (path === '/resources/prescriptionItems' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        throw new Error('detail failed');
      }
      return {};
    });

    await expect(createPrescription(validForm() as never)).rejects.toThrow('detail failed');
    expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions/pres-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws when updating a prescription without an id and keeps empty remark undefined', async () => {
    await expect(updatePrescription(validForm() as never, null)).rejects.toThrow('处方 ID 缺失');
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
