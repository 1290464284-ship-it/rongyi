import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      get: jest.fn(),
      updateClinicInfo: jest.fn(),
      upsertMany: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: service }],
    }).compile();

    controller = module.get(SettingsController);
  });

  describe('findAll', () => {
    it('调用 service.findAll 获取所有设置', async () => {
      const expected = { key1: 'value1', key2: 'value2' };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();
      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('getByKey', () => {
    it('调用 service.get 并返回 { key, value } 格式', async () => {
      service.get.mockResolvedValue('test-value');

      const result = await controller.getByKey('test-key');
      expect(result).toEqual({ key: 'test-key', value: 'test-value' });
      expect(service.get).toHaveBeenCalledWith('test-key');
    });

    it('设置不存在时 value 为 undefined', async () => {
      service.get.mockResolvedValue(undefined);

      const result = await controller.getByKey('non-existent');
      expect(result).toEqual({ key: 'non-existent', value: undefined });
      expect(service.get).toHaveBeenCalledWith('non-existent');
    });
  });

  describe('update', () => {
    it('调用 service.updateClinicInfo 传入 key 和 value', async () => {
      const dto = { value: 'new-value' };
      const updated = { key: 'test-key', value: 'new-value' };
      service.updateClinicInfo.mockResolvedValue(updated);

      const result = await controller.update('test-key', dto);
      expect(result).toEqual(updated);
      expect(service.updateClinicInfo).toHaveBeenCalledWith('test-key', 'new-value');
    });
  });

  describe('upsertMany', () => {
    it('调用 service.upsertMany 批量更新设置', async () => {
      const dto = { key1: 'value1', key2: 'value2' };
      const resultObj = { success: true, count: 2 };
      service.upsertMany.mockResolvedValue(resultObj);

      const result = await controller.upsertMany(dto);
      expect(result).toEqual(resultObj);
      expect(service.upsertMany).toHaveBeenCalledWith(dto);
    });
  });

  describe('delete', () => {
    it('调用 service.delete 删除指定设置', async () => {
      service.delete.mockResolvedValue(undefined);
      await controller.delete('test-key');
      expect(service.delete).toHaveBeenCalledWith('test-key');
    });
  });
});
