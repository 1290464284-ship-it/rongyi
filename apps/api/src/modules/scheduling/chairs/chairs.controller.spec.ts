import { Test, TestingModule } from '@nestjs/testing';
import { ChairsController } from './chairs.controller';
import { ChairsService } from './chairs.service';
import { ConflictException } from '@nestjs/common';

describe('ChairsController', () => {
  let controller: ChairsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChairsController],
      providers: [{ provide: ChairsService, useValue: service }],
    }).compile();

    controller = module.get(ChairsController);
  });

  describe('findAll', () => {
    it('调用 service.findAll', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();
      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith();
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '1号椅', location: 'A区' };
      const created = { id: 'chair-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('create 抛错时传递错误', async () => {
      service.create.mockRejectedValue(new ConflictException('编码重复'));
      await expect(controller.create({ name: '1号椅' } as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { name: '新名字' };
      const updated = { id: 'chair-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('chair-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('chair-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue(undefined);
      await controller.remove('chair-1');
      expect(service.remove).toHaveBeenCalledWith('chair-1');
    });
  });
});
