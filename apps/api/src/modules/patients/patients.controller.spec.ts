import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

import { Gender } from '@dental/shared';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { QueryPatientDto } from './dto/query-patient.dto';

describe('PatientsController', () => {
  let controller: PatientsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      getFullIdCard: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientsController],
      providers: [{ provide: PatientsService, useValue: service }],
    }).compile();

    controller = module.get(PatientsController);
  });

  describe('create', () => {
    it('创建患者并返回结果', async () => {
      const dto: CreatePatientDto = { name: '张三', phone: '13800000000', gender: Gender.MALE, birthDate: '1990-01-01' };
      const expected = { id: 'p-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('service 抛出异常时向上传播', async () => {
      service.create.mockRejectedValue(new BusinessValidationException('手机号已存在'));

      await expect(
        controller.create({ name: '张三', phone: '13800000000', gender: Gender.MALE, birthDate: '1990-01-01' } as CreatePatientDto),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('findMany', () => {
    it('透传查询参数', async () => {
      const q: QueryPatientDto = { keyword: '张' };
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('正常返回患者信息', async () => {
      const expected = { id: 'p-1', name: '张三' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('p-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('p-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('患者不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('getFullIdCard - Boss only', () => {
    it('返回 { idCard } 对象', async () => {
      service.getFullIdCard.mockResolvedValue('110101199001011234');
      const result = await controller.getFullIdCard('p-1');
      expect(result).toEqual({ idCard: '110101199001011234' });
      expect(service.getFullIdCard).toHaveBeenCalledWith('p-1');
    });

    it('未查询到时返回 { idCard: null }', async () => {
      service.getFullIdCard.mockResolvedValue(null);
      const result = await controller.getFullIdCard('p-1');
      expect(result).toEqual({ idCard: null });
    });
  });

  describe('update', () => {
    it('更新患者并返回结果', async () => {
      const dto: UpdatePatientDto = { name: '李四' };
      const updated = { id: 'p-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('p-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('p-1', dto);
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.update.mockRejectedValue(new BusinessNotFoundException('患者不存在'));

      await expect(controller.update('non-existent', { name: '李四' })).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('remove', () => {
    it('删除患者返回 id', async () => {
      service.remove.mockResolvedValue('p-1');
      const result = await controller.remove('p-1');
      expect(result).toBe('p-1');
      expect(service.remove).toHaveBeenCalledWith('p-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.remove.mockRejectedValue(new BusinessNotFoundException('患者不存在'));

      await expect(controller.remove('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });
});