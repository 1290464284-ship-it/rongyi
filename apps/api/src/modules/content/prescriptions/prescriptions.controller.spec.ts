import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';


describe('PrescriptionsController', () => {
  let controller: PrescriptionsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrescriptionsController],
      providers: [{ provide: PrescriptionsService, useValue: service }],
    }).compile();

    controller = module.get(PrescriptionsController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      const q = { patientId: 'p-1', status: 'ACTIVE' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });

    it('空查询参数也调用 service.findMany', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({});
    });

    it('查询结果含多条处方时正常返回', async () => {
      const expected = {
        items: [
          { id: 'rx-1', patientId: 'p-1' },
          { id: 'rx-2', patientId: 'p-1' },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      };
      service.findMany.mockResolvedValue(expected);
      const result = await controller.findMany({ patientId: 'p-1' });
      expect(result.items.length).toBe(2);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'rx-1', patientId: 'p-1', doctorId: 'd-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('rx-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('rx-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Prescription不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = {
        patientId: 'p-1',
        doctorId: 'd-1',
        items: [{ drugName: '阿莫西林', spec: '0.25g', dosage: '0.5g', frequency: 'tid', days: 5, quantity: 30, unit: '粒' }],
      };
      const created = { id: 'rx-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('处方明细为空时透传 BusinessValidationException', async () => {
      service.create.mockRejectedValue(new BusinessValidationException('处方明细不能为空'));
      await expect(controller.create({ patientId: 'p-1', doctorId: 'd-1', items: [] } as any))
        .rejects.toThrow(BusinessValidationException);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { remark: '更新备注' };
      const updated = { id: 'rx-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('rx-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('rx-1', dto);
    });

    it('更新不存在的处方时透传 BusinessNotFoundException', async () => {
      service.update.mockRejectedValue(new BusinessNotFoundException('Prescription不存在'));
      await expect(controller.update('non-existent', { remark: 'x' } as any))
        .rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('rx-1');
      const result = await controller.remove('rx-1');
      expect(result).toBe('rx-1');
      expect(service.remove).toHaveBeenCalledWith('rx-1');
    });

    it('删除不存在的处方时透传 BusinessNotFoundException', async () => {
      service.remove.mockRejectedValue(new BusinessNotFoundException('Prescription不存在'));
      await expect(controller.remove('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });
});
