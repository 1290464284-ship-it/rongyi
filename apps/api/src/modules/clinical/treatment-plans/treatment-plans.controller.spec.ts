import { Test, TestingModule } from '@nestjs/testing';
import { TreatmentPlansController } from './treatment-plans.controller';
import { TreatmentPlansService } from './treatment-plans.service';

describe('TreatmentPlansController', () => {
  let controller: TreatmentPlansController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      updateItemStatus: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TreatmentPlansController],
      providers: [{ provide: TreatmentPlansService, useValue: service }],
    }).compile();

    controller = module.get(TreatmentPlansController);
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', items: [] };
      const expected = { id: 'tp-1', ...dto, status: 'DRAFT' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('传入 query 和 page/pageSize 字符串', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findAll(
        { patientId: 'p-1' },
        '1',
        '50',
      );
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        patientId: 'p-1',
        page: 1,
        pageSize: 50,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.findAll({});
      expect(service.findMany).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'tp-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('tp-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('tp-1');
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { diagnosis: '更新诊断' };
      const expected = { id: 'tp-1', diagnosis: '更新诊断' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('tp-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('tp-1', dto);
    });
  });

  describe('updateStatus', () => {
    it('调用 service.updateStatus 传入 id 和 dto', async () => {
      const dto = { status: 'CONFIRMED' };
      const expected = { id: 'tp-1', status: 'CONFIRMED' };
      service.updateStatus.mockResolvedValue(expected);

      const result = await controller.updateStatus('tp-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.updateStatus).toHaveBeenCalledWith('tp-1', dto);
    });
  });

  describe('updateItemStatus', () => {
    it('调用 service.updateItemStatus 传入 planId、itemId 和 dto', async () => {
      const dto = { status: 'COMPLETED' };
      const expected = { id: 'item-1', status: 'COMPLETED' };
      service.updateItemStatus.mockResolvedValue(expected);

      const result = await controller.updateItemStatus('tp-1', 'item-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.updateItemStatus).toHaveBeenCalledWith('tp-1', 'item-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      const expected = { success: true };
      service.remove.mockResolvedValue(expected);

      const result = await controller.remove('tp-1');
      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('tp-1');
    });
  });
});
