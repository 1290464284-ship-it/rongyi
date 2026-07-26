import { Test, TestingModule } from '@nestjs/testing';
import { PeriodontalRecordsController } from './periodontal-records.controller';
import { PeriodontalRecordsService } from './periodontal-records.service';

describe('PeriodontalRecordsController', () => {
  let controller: PeriodontalRecordsController;
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
      controllers: [PeriodontalRecordsController],
      providers: [{ provide: PeriodontalRecordsService, useValue: service }],
    }).compile();

    controller = module.get(PeriodontalRecordsController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 filters', async () => {
      const q = { patientId: 'p-1', visitId: 'v-1' };
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: 'p-1', visitId: 'v-1' },
      });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'pr-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('pr-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('pr-1');
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', visitId: 'v-1', bleedingIndex: 1 };
      const expected = { id: 'pr-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { bleedingIndex: 2 };
      const expected = { id: 'pr-1', bleedingIndex: 2 };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('pr-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('pr-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      const expected = { success: true };
      service.remove.mockResolvedValue(expected);

      const result = await controller.remove('pr-1');
      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('pr-1');
    });
  });
});
