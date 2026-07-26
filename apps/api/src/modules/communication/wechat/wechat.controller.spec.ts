import { Test, TestingModule } from '@nestjs/testing';
import { WechatController } from './wechat.controller';
import { WechatService } from './wechat.service';

describe('WechatController', () => {
  let controller: WechatController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      getBirthdayPatients: jest.fn(),
      getAppointmentReminders: jest.fn(),
      send: jest.fn(),
      sendBatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WechatController],
      providers: [{ provide: WechatService, useValue: service }],
    }).compile();

    controller = module.get(WechatController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 q/page/pageSize', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 10 };
      service.findMany.mockResolvedValue(expected);
      const q = { patientId: 'p-1' } as any;

      const result = await controller.findMany(q, '2', '10');
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q, 2, 10);
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({}, 1, 20);
    });
  });

  describe('getBirthdayPatients', () => {
    it('调用 service.getBirthdayPatients', async () => {
      const expected = [{ patientId: 'p-1', name: '张三' }];
      service.getBirthdayPatients.mockResolvedValue(expected);

      const result = await controller.getBirthdayPatients();
      expect(result).toEqual(expected);
      expect(service.getBirthdayPatients).toHaveBeenCalledWith();
    });
  });

  describe('getAppointmentReminders', () => {
    it('调用 service.getAppointmentReminders', async () => {
      const expected = [{ patientId: 'p-1', appointmentTime: '2026-01-01' }];
      service.getAppointmentReminders.mockResolvedValue(expected);

      const result = await controller.getAppointmentReminders();
      expect(result).toEqual(expected);
      expect(service.getAppointmentReminders).toHaveBeenCalledWith();
    });
  });

  describe('send', () => {
    it('调用 service.send 传入 dto', async () => {
      const dto = { patientId: 'p-1', content: '提醒内容' };
      const sent = { success: true, messageId: 'm-1' };
      service.send.mockResolvedValue(sent);

      const result = await controller.send(dto);
      expect(result).toEqual(sent);
      expect(service.send).toHaveBeenCalledWith(dto);
    });
  });

  describe('sendBatch', () => {
    it('调用 service.sendBatch 传入 dto', async () => {
      const dto = { patientIds: ['p-1', 'p-2'], content: '批量内容' };
      const sent = { success: true, count: 2 };
      service.sendBatch.mockResolvedValue(sent);

      const result = await controller.sendBatch(dto);
      expect(result).toEqual(sent);
      expect(service.sendBatch).toHaveBeenCalledWith(dto);
    });
  });
});
