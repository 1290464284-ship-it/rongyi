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

  it('rethrows a master creation failure without cleaning up', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/prescriptions' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        throw new Error('master failed');
      }
      return {};
    });

    await expect(createPrescription(validForm() as never)).rejects.toThrow('master failed');
    const deleteCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([, options]) => String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('throws when updating a prescription without an id and keeps empty remark undefined', async () => {
    await expect(updatePrescription(validForm() as never, null)).rejects.toThrow('处方 ID 缺失');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('sends the master and items in one atomic save request', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: 'pres-1' });
    const form = {
      ...validForm(),
      items: [{
        id: 'local-1',
        name: '阿莫西林',
        spec: '0.25g',
        dosage: '1粒',
        frequency: '每日三次',
        days: '5',
        quantity: '2',
        price: '12',
      }],
    };
    await updatePrescription(form as never, 'pres-1');
    expect(apiRequest).toHaveBeenCalledWith('/prescriptions/pres-1/save', expect.objectContaining({ method: 'PATCH' }));
    const body = JSON.parse(String(
      vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/prescriptions/pres-1/save')?.[1]?.body,
    ));
    expect(body).toMatchObject({
      patientId: 'p-1',
      items: [{ id: 'local-1', name: '阿莫西林', days: 5, quantity: 2, price: 1200 }],
    });
    expect(body.status).toBeUndefined();
  });

  it('omits the item id when the local row has none', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: 'pres-1' });
    const form = {
      ...validForm(),
      items: [{
        id: '',
        name: '阿莫西林',
        spec: '0.25g',
        dosage: '1粒',
        frequency: '每日三次',
        days: '5',
        quantity: '2',
        price: '12',
      }],
    };
    await updatePrescription(form as never, 'pres-1');
    const body = JSON.parse(String(
      vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/prescriptions/pres-1/save')?.[1]?.body,
    ));
    expect(body.items[0]).toMatchObject({ name: '阿莫西林', days: 5, quantity: 2, price: 1200 });
    expect(body.items[0].id).toBeUndefined();
  });

  it('rethrows save endpoint failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('save failed'));
    await expect(updatePrescription(validForm() as never, 'pres-1')).rejects.toThrow('save failed');
  });
});
