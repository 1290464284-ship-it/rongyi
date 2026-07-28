import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

import { FirstExamsController } from './first-exams.controller';
import { FirstExamsService } from './first-exams.service';
import { QueryFirstExamDto } from './dto/query-first-exam.dto';
import { ToothDiseaseDto } from './dto/tooth-disease.dto';

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
    it('将分页字符串参数转为数字并传递给 service', async () => {
      const q: QueryFirstExamDto = { patientId: 'p-1', status: 'DRAFT' };
      service.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.findMany(q, '1', '50');

      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: 'p-1', status: 'DRAFT' },
        page: 1,
        pageSize: 50,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.findMany({} as QueryFirstExamDto);

      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: undefined, status: undefined },
        page: 1,
        pageSize: 50,
      });
    });

    it('无效 page 参数回退到默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.findMany({} as QueryFirstExamDto, 'abc', 'xyz');

      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: undefined, status: undefined },
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('stats', () => {
    it('返回初诊统计数据', async () => {
      const expected = { total: 10, completed: 5, draft: 5 };
      service.stats.mockResolvedValue(expected);

      const result = await controller.stats();
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('初诊记录不存在'));

      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('创建初诊记录并返回结果', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', chiefComplaint: '牙痛' };
      const expected = { id: 'e-1', ...dto, status: 'DRAFT' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateTooth', () => {
    it('将 toothId 字符串转换为数字后传递', async () => {
      const dto: Partial<ToothDiseaseDto> = { toothStatus: '龋坏' };
      service.updateTooth.mockResolvedValue({ toothNumber: 11, toothStatus: '龋坏' });

      await controller.updateTooth('e-1', '11', dto);
      expect(service.updateTooth).toHaveBeenCalledWith('e-1', 11, dto);
    });

    it('无效 toothId 透传错误', async () => {
      service.updateTooth.mockRejectedValue(new BusinessValidationException('无效牙位号'));

      await expect(
        controller.updateTooth('e-1', 'invalid', { toothStatus: '龋坏' } as Partial<ToothDiseaseDto>),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('batchUpdateTeeth', () => {
    it('批量更新牙齿信息', async () => {
      const teeth: ToothDiseaseDto[] = [{ toothNumber: 11, toothStatus: '健康' }];
      const expected = [{ toothNumber: 11, toothStatus: '健康' }];
      service.batchUpdateTeeth.mockResolvedValue(expected);

      const result = await controller.batchUpdateTeeth('e-1', teeth);
      expect(result).toEqual(expected);
    });
  });

  describe('restart / complete', () => {
    it('restart 将状态重置为 DRAFT', async () => {
      const expected = { id: 'e-1', status: 'DRAFT' };
      service.restart.mockResolvedValue(expected);

      const result = await controller.restart('e-1');
      expect(result).toEqual(expected);
    });

    it('complete 标记初诊为 COMPLETED', async () => {
      const expected = { id: 'e-1', status: 'COMPLETED' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete('e-1');
      expect(result).toEqual(expected);
    });

    it('不存在的记录 restart 失败', async () => {
      service.restart.mockRejectedValue(new BusinessNotFoundException('记录不存在'));

      await expect(controller.restart('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });
});