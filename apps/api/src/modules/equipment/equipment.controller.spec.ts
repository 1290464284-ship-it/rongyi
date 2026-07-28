import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { ConflictException } from '@nestjs/common';

describe('EquipmentController', () => {
  let controller: EquipmentController;
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
      controllers: [EquipmentController],
      providers: [{ provide: EquipmentService, useValue: service }],
    }).compile();

    controller = module.get(EquipmentController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 keyword/page/pageSize', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(
        { keyword: '牙科', name: '牙科' },
        '2',
        '10',
      );
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        filters: {},
        keyword: '牙科',
        page: 2,
        pageSize: 10,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      await controller.findMany({ keyword: undefined });
      expect(service.findMany).toHaveBeenCalledWith({
        filters: {},
        keyword: undefined,
        page: 1,
        pageSize: 20,
      });
    });

    it('同时存在 keyword 和 name 时优先使用 keyword', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany({ keyword: 'kw', name: 'nm' }, '1', '20');
      expect(service.findMany).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'kw' }));
    });

    it('未传 keyword 但有 name 时使用 name', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany({ name: '设备名' }, '1', '20');
      expect(service.findMany).toHaveBeenCalledWith(expect.objectContaining({ keyword: '设备名' }));
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'equip-1', name: '设备' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('equip-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('equip-1');
    });

    it('service 抛出 BusinessNotFoundException 时透传', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Equipment不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '新设备', model: 'M001', brand: '品牌X' };
      const created = { id: 'equip-1', ...dto };
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
      const dto = { name: '更新后', status: 'BROKEN' };
      const updated = { id: 'equip-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('equip-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('equip-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('equip-1');
      const result = await controller.remove('equip-1');
      expect(result).toBe('equip-1');
      expect(service.remove).toHaveBeenCalledWith('equip-1');
    });
  });
});
