import { Test, TestingModule } from '@nestjs/testing';
import { ToothRecordsController } from './tooth-records.controller';
import { ToothRecordsService } from './tooth-records.service';
import { BadRequestException } from '@nestjs/common';

describe('ToothRecordsController', () => {
  let controller: ToothRecordsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findByPatient: jest.fn(),
      findByTooth: jest.fn(),
      upsert: jest.fn(),
      removeByTooth: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ToothRecordsController],
      providers: [{ provide: ToothRecordsService, useValue: service }],
    }).compile();

    controller = module.get(ToothRecordsController);
  });

  describe('findMany', () => {
    it('调用 service.findByPatient 传入 patientId', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 100 };
      service.findByPatient.mockResolvedValue(expected);

      const result = await controller.findMany({ patientId: 'p-1' });
      expect(result).toEqual(expected);
      expect(service.findByPatient).toHaveBeenCalledWith('p-1');
    });
  });

  describe('findOne', () => {
    it('调用 service.findByTooth 传入 patientId 和 toothNumber', async () => {
      const expected = { id: 'tr-1', patientId: 'p-1', toothNumber: 11 };
      service.findByTooth.mockResolvedValue(expected);

      const result = await controller.findOne('p-1', 11);
      expect(result).toEqual(expected);
      expect(service.findByTooth).toHaveBeenCalledWith('p-1', 11);
    });

    it('toothNumber 字符串会被 Number 转换', async () => {
      service.findByTooth.mockResolvedValue({ id: 'tr-1' });
      await controller.findOne('p-1', '21' as any);
      expect(service.findByTooth).toHaveBeenCalledWith('p-1', 21);
    });

    it('无效牙位号透传 BadRequestException', async () => {
      service.findByTooth.mockRejectedValue(new BadRequestException('无效的牙位号: 99'));
      await expect(controller.findOne('p-1', 99 as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('upsert', () => {
    it('调用 service.upsert 传入 patientId/toothNumber/dto', async () => {
      const dto = { patientId: 'p-1', toothNumber: 11, currentStatus: 'SOUND', conditions: ['CARIES'] };
      const created = { id: 'tr-1', ...dto };
      service.upsert.mockResolvedValue(created);

      const result = await controller.upsert(dto as any);
      expect(result).toEqual(created);
      expect(service.upsert).toHaveBeenCalledWith('p-1', 11, dto);
    });

    it('未传 currentStatus 时透传默认值逻辑（service 处理）', async () => {
      const dto = { patientId: 'p-1', toothNumber: 11 };
      service.upsert.mockResolvedValue({ id: 'tr-1', currentStatus: 'SOUND' });
      await controller.upsert(dto);
      expect(service.upsert).toHaveBeenCalledWith('p-1', 11, dto);
    });
  });

  describe('remove', () => {
    it('调用 service.removeByTooth 传入 patientId 和 toothNumber', async () => {
      service.removeByTooth.mockResolvedValue({ success: true });
      const result = await controller.remove('p-1', 11);
      expect(result).toEqual({ success: true });
      expect(service.removeByTooth).toHaveBeenCalledWith('p-1', 11);
    });

    it('toothNumber 字符串会被 Number 转换', async () => {
      service.removeByTooth.mockResolvedValue({ success: true });
      await controller.remove('p-1', '21' as any);
      expect(service.removeByTooth).toHaveBeenCalledWith('p-1', 21);
    });
  });
});
