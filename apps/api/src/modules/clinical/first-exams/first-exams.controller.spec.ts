import { Test, TestingModule } from '@nestjs/testing';
import { FirstExamsController } from './first-exams.controller';
import { FirstExamsService } from './first-exams.service';

describe('FirstExamsController', () => {
  let controller: FirstExamsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      stats: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      restart: jest.fn(),
      complete: jest.fn(),
      getTeeth: jest.fn(),
      updateTooth: jest.fn(),
      batchUpdateTeeth: jest.fn(),
      listTracks: jest.fn(),
      getTrack: jest.fn(),
      updateTrack: jest.fn(),
      createFollowUp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FirstExamsController],
      providers: [{ provide: FirstExamsService, useValue: service }],
    }).compile();

    controller = module.get(FirstExamsController);
  });

  describe('findMany', () => {
    it('传入 query 和 page/pageSize 字符串调用 service.findMany', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(
        { patientId: 'p-1', status: 'DRAFT' },
        '1',
        '50',
      );
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: 'p-1', status: 'DRAFT' },
        page: 1,
        pageSize: 50,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: undefined, status: undefined },
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('stats', () => {
    it('调用 service.stats', async () => {
      const expected = { total: 10, completed: 5 };
      service.stats.mockResolvedValue(expected);

      const result = await controller.stats();
      expect(result).toEqual(expected);
      expect(service.stats).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'e-1', patientId: 'p-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('e-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('e-1');
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', chiefComplaint: '牙痛' };
      const expected = { id: 'e-1', ...dto, status: 'DRAFT' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { diagnosis: '龋齿' };
      const expected = { id: 'e-1', diagnosis: '龋齿' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('e-1', dto as any);
      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('e-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      const expected = { success: true };
      service.remove.mockResolvedValue(expected);

      const result = await controller.remove('e-1');
      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('e-1');
    });
  });

  describe('restart', () => {
    it('调用 service.restart 传入 id', async () => {
      const expected = { id: 'e-1', status: 'DRAFT' };
      service.restart.mockResolvedValue(expected);

      const result = await controller.restart('e-1');
      expect(result).toEqual(expected);
      expect(service.restart).toHaveBeenCalledWith('e-1');
    });
  });

  describe('complete', () => {
    it('调用 service.complete 传入 id', async () => {
      const expected = { id: 'e-1', status: 'COMPLETED' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete('e-1');
      expect(result).toEqual(expected);
      expect(service.complete).toHaveBeenCalledWith('e-1');
    });
  });

  describe('getTeeth', () => {
    it('调用 service.getTeeth 传入 id', async () => {
      const expected = [{ toothNumber: 11, currentStatus: 'SOUND' }];
      service.getTeeth.mockResolvedValue(expected);

      const result = await controller.getTeeth('e-1');
      expect(result).toEqual(expected);
      expect(service.getTeeth).toHaveBeenCalledWith('e-1');
    });
  });

  describe('updateTooth', () => {
    it('调用 service.updateTooth 传入 id、toothId（转换为数字）和 dto', async () => {
      const dto = { currentStatus: 'CARIES' };
      const expected = { toothNumber: 11, currentStatus: 'CARIES' };
      service.updateTooth.mockResolvedValue(expected);

      const result = await controller.updateTooth('e-1', '11', dto as any);
      expect(result).toEqual(expected);
      expect(service.updateTooth).toHaveBeenCalledWith('e-1', 11, dto);
    });
  });

  describe('batchUpdateTeeth', () => {
    it('调用 service.batchUpdateTeeth 传入 id 和牙齿数组', async () => {
      const teeth = [{ toothNumber: 11, toothStatus: '健康' }, { toothNumber: 16, toothStatus: '龋坏' }];
      const expected = [{ toothNumber: 11, toothStatus: '健康' }];
      service.batchUpdateTeeth.mockResolvedValue(expected);

      const result = await controller.batchUpdateTeeth('e-1', teeth);
      expect(result).toEqual(expected);
      expect(service.batchUpdateTeeth).toHaveBeenCalledWith('e-1', teeth);
    });
  });

  describe('listTracks', () => {
    it('调用 service.listTracks 传入 examId', async () => {
      const expected = [{ id: 't-1', examId: 'e-1' }];
      service.listTracks.mockResolvedValue(expected);

      const result = await controller.listTracks('e-1');
      expect(result).toEqual(expected);
      expect(service.listTracks).toHaveBeenCalledWith('e-1');
    });
  });

  describe('getTrack', () => {
    it('调用 service.getTrack 传入 id', async () => {
      const expected = { id: 't-1', examId: 'e-1' };
      service.getTrack.mockResolvedValue(expected);

      const result = await controller.getTrack('t-1');
      expect(result).toEqual(expected);
      expect(service.getTrack).toHaveBeenCalledWith('t-1');
    });
  });

  describe('updateTrack', () => {
    it('调用 service.updateTrack 传入 id 和 dto', async () => {
      const dto = { status: 'FOLLOWING', leaderSuggestion: '建议治疗' };
      const expected = { id: 't-1', status: 'FOLLOWING' };
      service.updateTrack.mockResolvedValue(expected);

      const result = await controller.updateTrack('t-1', dto);
      expect(result).toEqual(expected);
      expect(service.updateTrack).toHaveBeenCalledWith('t-1', dto);
    });
  });

  describe('createFollowUp', () => {
    it('调用 service.createFollowUp 传入 id 和 dto', async () => {
      const dto = { content: '一周后复查', dueDate: '2026-08-01' };
      const expected = { id: 'f-1', content: '一周后复查' };
      service.createFollowUp.mockResolvedValue(expected);

      const result = await controller.createFollowUp('t-1', dto);
      expect(result).toEqual(expected);
      expect(service.createFollowUp).toHaveBeenCalledWith('t-1', dto);
    });
  });
});
