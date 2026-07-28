import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { ConflictException } from '@nestjs/common';

describe('SuppliersController', () => {
  let controller: SuppliersController;
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
      controllers: [SuppliersController],
      providers: [{ provide: SuppliersService, useValue: service }],
    }).compile();

    controller = module.get(SuppliersController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);
      const q = { keyword: '供应商' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 's-1', name: '供应商A' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('s-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('s-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Supplier不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '供应商A', contactPerson: '张三', phone: '13800000000' };
      const created = { id: 's-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('name 重复时透传 ConflictException', async () => {
      service.create.mockRejectedValue(new ConflictException('名称重复'));
      await expect(controller.create({ name: '重复' } as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { name: '更新名称' };
      const updated = { id: 's-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('s-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('s-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('s-1');
      const result = await controller.remove('s-1');
      expect(result).toBe('s-1');
      expect(service.remove).toHaveBeenCalledWith('s-1');
    });
  });
});
