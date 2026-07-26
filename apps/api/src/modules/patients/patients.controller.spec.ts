import { Test, TestingModule } from '@nestjs/testing';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { NotFoundException } from '@nestjs/common';

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
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '张三', phone: '13800000000' };
      const created = { id: 'p-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      const q = { keyword: '张', page: '1' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'p-1', name: '张三' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('p-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('p-1');
    });

    it('不存在时透传 NotFoundException', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('Patient不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFullIdCard', () => {
    it('返回 { idCard } 对象', async () => {
      service.getFullIdCard.mockResolvedValue('110101199001011234');
      const result = await controller.getFullIdCard('p-1');
      expect(result).toEqual({ idCard: '110101199001011234' });
      expect(service.getFullIdCard).toHaveBeenCalledWith('p-1');
    });

    it('未查询到时返回 null', async () => {
      service.getFullIdCard.mockResolvedValue(null);
      const result = await controller.getFullIdCard('p-1');
      expect(result).toEqual({ idCard: null });
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { name: '李四' };
      const updated = { id: 'p-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('p-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('p-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('p-1');
      const result = await controller.remove('p-1');
      expect(result).toBe('p-1');
      expect(service.remove).toHaveBeenCalledWith('p-1');
    });
  });
});
