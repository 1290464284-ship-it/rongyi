import { Test, TestingModule } from '@nestjs/testing';
import { ClinicsController } from './clinics.controller';
import { ClinicsService } from './clinics.service';
import { BadRequestException } from '@nestjs/common';

describe('ClinicsController', () => {
  let controller: ClinicsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findActive: jest.fn(),
      getCurrentClinic: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClinicsController],
      providers: [{ provide: ClinicsService, useValue: service }],
    }).compile();

    controller = module.get(ClinicsController);
  });

  describe('findAll', () => {
    it('调用 service.findMany 传入默认分页参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findAll();
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 50, skipClinicFilter: true });
    });

    it('调用 service.findMany 传入指定的分页参数', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 10 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findAll(2, 10);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 2, pageSize: 10, skipClinicFilter: true });
    });

    it('字符串形式的分页参数会被转换为数字', async () => {
      const expected = { items: [], total: 0, page: 3, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findAll('3' as any, '20' as any);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 3, pageSize: 20, skipClinicFilter: true });
    });
  });

  describe('findActive', () => {
    it('调用 service.findActive 获取活跃诊所列表', async () => {
      const expected = [{ id: 'c-1', name: '诊所A', code: 'A001' }];
      service.findActive.mockResolvedValue(expected);

      const result = await controller.findActive();
      expect(result).toEqual(expected);
      expect(service.findActive).toHaveBeenCalled();
    });
  });

  describe('getCurrentClinic', () => {
    it('调用 service.getCurrentClinic 获取当前用户诊所', async () => {
      const expected = { id: 'c-1', name: '当前诊所' };
      service.getCurrentClinic.mockResolvedValue(expected);

      const result = await controller.getCurrentClinic();
      expect(result).toEqual(expected);
      expect(service.getCurrentClinic).toHaveBeenCalled();
    });

    it('未设置当前诊所时返回 null', async () => {
      service.getCurrentClinic.mockResolvedValue(null);

      const result = await controller.getCurrentClinic();
      expect(result).toBeNull();
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'c-1', name: '诊所A' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('c-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('c-1');
    });

    it('不存在时透传 BadRequestException', async () => {
      service.findOne.mockRejectedValue(new BadRequestException('诊所不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '新诊所', code: 'NEW001' };
      const created = { id: 'c-1', ...dto, isActive: 1, createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { name: '更新后的诊所' };
      const updated = { id: 'c-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('c-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('c-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.softDelete 传入 id', async () => {
      service.softDelete.mockResolvedValue(undefined);
      await controller.remove('c-1');
      expect(service.softDelete).toHaveBeenCalledWith('c-1');
    });
  });
});
