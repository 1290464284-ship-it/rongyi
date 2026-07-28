import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { ImagingController } from './imaging.controller';
import { ImagingService } from './imaging.service';


describe('ImagingController', () => {
  let controller: ImagingController;
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
      controllers: [ImagingController],
      providers: [{ provide: ImagingService, useValue: service }],
    }).compile();

    controller = module.get(ImagingController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      const q = { patientId: 'p-1', type: 'X_RAY' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });

    it('空查询参数也调用 service.findMany', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({});
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'img-1', type: 'X_RAY' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('img-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('img-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Imaging不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', type: 'X_RAY', url: 'https://x' };
      const created = { id: 'img-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { remark: '更新备注' };
      const updated = { id: 'img-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('img-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('img-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('img-1');
      const result = await controller.remove('img-1');
      expect(result).toBe('img-1');
      expect(service.remove).toHaveBeenCalledWith('img-1');
    });
  });
});
