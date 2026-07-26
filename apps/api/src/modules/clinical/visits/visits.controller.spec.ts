import { Test, TestingModule } from '@nestjs/testing';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

describe('VisitsController', () => {
  let controller: VisitsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      complete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VisitsController],
      providers: [{ provide: VisitsService, useValue: service }],
    }).compile();

    controller = module.get(VisitsController);
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1' };
      const expected = { id: 'v-1', ...dto, status: 'IN_PROGRESS' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 query', async () => {
      const q = { patientId: 'p-1', status: 'IN_PROGRESS' };
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(q as any);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'v-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('v-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('v-1');
    });
  });

  describe('complete', () => {
    it('调用 service.complete 传入 id 和 dto', async () => {
      const dto = { diagnosis: '康复', treatmentSummary: '完成治疗' };
      const expected = { id: 'v-1', status: 'COMPLETED' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete('v-1', dto);
      expect(result).toEqual(expected);
      expect(service.complete).toHaveBeenCalledWith('v-1', dto);
    });
  });
});
