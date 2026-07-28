import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';


describe('FollowUpsController', () => {
  let controller: FollowUpsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      complete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowUpsController],
      providers: [{ provide: FollowUpsService, useValue: service }],
    }).compile();

    controller = module.get(FollowUpsController);
  });

  describe('findAll', () => {
    it('调用 service.findAll', async () => {
      const expected = [{ id: 'fu-1', result: 'OK' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();
      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith();
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'fu-1', result: 'OK' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('fu-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('fu-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('FollowUp不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', content: '随访内容' };
      const created = { id: 'fu-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { result: '已完成' };
      const updated = { id: 'fu-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('fu-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('fu-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue('fu-1');
      const result = await controller.remove('fu-1');
      expect(result).toBe('fu-1');
      expect(service.remove).toHaveBeenCalledWith('fu-1');
    });
  });

  describe('complete', () => {
    it('调用 service.complete 传入 id 和 result', async () => {
      const dto = { result: '已完成' };
      const completed = { id: 'fu-1', status: 'COMPLETED', result: '已完成' };
      service.complete.mockResolvedValue(completed);

      const result = await controller.complete('fu-1', dto);
      expect(result).toEqual(completed);
      expect(service.complete).toHaveBeenCalledWith('fu-1', '已完成');
    });
  });
});
