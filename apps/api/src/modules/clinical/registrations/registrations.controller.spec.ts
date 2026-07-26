import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

describe('RegistrationsController', () => {
  let controller: RegistrationsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      triage: jest.fn(),
      startVisit: jest.fn(),
      complete: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegistrationsController],
      providers: [{ provide: RegistrationsService, useValue: service }],
    }).compile();

    controller = module.get(RegistrationsController);
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', type: 'FIRST_VISIT', chiefComplaint: '牙痛' };
      const expected = { id: 'r-1', ...dto, status: 'REGISTERED' };
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
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      await controller.findAll({});
      expect(service.findMany).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'r-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('r-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('r-1');
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { chiefComplaint: '更新主诉' };
      const expected = { id: 'r-1', chiefComplaint: '更新主诉' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('r-1', dto);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('r-1', dto);
    });
  });

  describe('triage', () => {
    it('调用 service.triage 传入 id 和 dto', async () => {
      const dto = { triageNote: '稳定', chiefComplaint: '补牙' };
      const expected = { id: 'r-1', status: 'TRIAGED', triageNote: '稳定' };
      service.triage.mockResolvedValue(expected);

      const result = await controller.triage('r-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.triage).toHaveBeenCalledWith('r-1', dto);
    });
  });

  describe('startVisit', () => {
    it('调用 service.startVisit 传入 id', async () => {
      const expected = { id: 'r-1', status: 'IN_PROGRESS', visitId: 'v-1' };
      service.startVisit.mockResolvedValue(expected);

      const result = await controller.startVisit('r-1');
      expect(result).toEqual(expected);
      expect(service.startVisit).toHaveBeenCalledWith('r-1');
    });
  });

  describe('complete', () => {
    it('调用 service.complete 传入 id', async () => {
      const expected = { id: 'r-1', status: 'COMPLETED' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete('r-1');
      expect(result).toEqual(expected);
      expect(service.complete).toHaveBeenCalledWith('r-1');
    });
  });

  describe('cancel', () => {
    it('调用 service.cancel 传入 id', async () => {
      const expected = { id: 'r-1', status: 'CANCELLED' };
      service.cancel.mockResolvedValue(expected);

      const result = await controller.cancel('r-1');
      expect(result).toEqual(expected);
      expect(service.cancel).toHaveBeenCalledWith('r-1');
    });
  });
});
