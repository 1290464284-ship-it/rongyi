import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

import { QueryVisitDto } from './dto/query-visit.dto';

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
    it('创建就诊记录并返回结果', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', chiefComplaint: '牙痛' };
      const expected = { id: 'v-1', ...dto, status: 'IN_PROGRESS' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('service 抛出异常时向上传播', async () => {
      service.create.mockRejectedValue(new BusinessValidationException('患者ID不能为空'));

      await expect(
        controller.create({ patientId: '', doctorId: 'd-1' }),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('findMany', () => {
    it('透传查询参数并返回分页结果', async () => {
      const q: QueryVisitDto = { patientId: 'p-1', status: 'IN_PROGRESS' };
      const expected = { items: [{ id: 'v-1' }], total: 1 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });

    it('空查询参数也能正常处理', async () => {
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany({} as QueryVisitDto);
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('存在时返回就诊详情', async () => {
      const expected = { id: 'v-1', patientId: 'p-1', status: 'IN_PROGRESS' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('v-1');
      expect(result).toEqual(expected);
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('就诊记录不存在'));

      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('complete', () => {
    it('接诊完成后返回更新结果', async () => {
      const dto = { diagnosis: '牙髓炎', treatmentSummary: '开髓引流' };
      const expected = { id: 'v-1', status: 'COMPLETED', diagnosis: '牙髓炎' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete('v-1', dto);
      expect(result).toEqual(expected);
      expect(service.complete).toHaveBeenCalledWith('v-1', dto);
    });

    it('不存在的就诊记录接诊失败', async () => {
      service.complete.mockRejectedValue(new BusinessNotFoundException('就诊记录不存在'));

      await expect(
        controller.complete('non-existent', { diagnosis: 'test' }),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });
});