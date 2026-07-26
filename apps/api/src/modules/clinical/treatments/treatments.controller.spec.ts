import { Test, TestingModule } from '@nestjs/testing';
import { TreatmentsController } from './treatments.controller';
import { TreatmentsService } from './treatments.service';

describe('TreatmentsController', () => {
  let controller: TreatmentsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findCatalog: jest.fn(),
      createCatalog: jest.fn(),
      updateCatalog: jest.fn(),
      deleteCatalog: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TreatmentsController],
      providers: [{ provide: TreatmentsService, useValue: service }],
    }).compile();

    controller = module.get(TreatmentsController);
  });

  describe('findCatalog', () => {
    it('调用 service.findCatalog', async () => {
      const expected = [{ id: 'c-1', name: '洗牙' }];
      service.findCatalog.mockResolvedValue(expected);

      const result = await controller.findCatalog();
      expect(result).toEqual(expected);
      expect(service.findCatalog).toHaveBeenCalled();
    });
  });

  describe('createCatalog', () => {
    it('调用 service.createCatalog 传入 dto', async () => {
      const dto = { name: '根管治疗', price: 500 };
      const expected = { id: 'c-1', ...dto };
      service.createCatalog.mockResolvedValue(expected);

      const result = await controller.createCatalog(dto as any);
      expect(result).toEqual(expected);
      expect(service.createCatalog).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateCatalog', () => {
    it('调用 service.updateCatalog 传入 id 和 dto', async () => {
      const dto = { price: 600 };
      const expected = { id: 'c-1', price: 600 };
      service.updateCatalog.mockResolvedValue(expected);

      const result = await controller.updateCatalog('c-1', dto);
      expect(result).toEqual(expected);
      expect(service.updateCatalog).toHaveBeenCalledWith('c-1', dto);
    });
  });

  describe('deleteCatalog', () => {
    it('调用 service.deleteCatalog 传入 id', async () => {
      const expected = { success: true };
      service.deleteCatalog.mockResolvedValue(expected);

      const result = await controller.deleteCatalog('c-1');
      expect(result).toEqual(expected);
      expect(service.deleteCatalog).toHaveBeenCalledWith('c-1');
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', visitId: 'v-1', catalogId: 'c-1' };
      const expected = { id: 't-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 query', async () => {
      const q = { patientId: 'p-1', status: 'COMPLETED' };
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(q as any);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 't-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('t-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('t-1');
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { status: 'COMPLETED' };
      const expected = { id: 't-1', status: 'COMPLETED' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('t-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('t-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      const expected = { success: true };
      service.remove.mockResolvedValue(expected);

      const result = await controller.remove('t-1');
      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('t-1');
    });
  });
});
