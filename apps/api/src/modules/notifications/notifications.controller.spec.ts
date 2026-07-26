import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotFoundException } from '@nestjs/common';
import { NotificationType, NotificationPriority } from './types/notification.types';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      getUnreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get(NotificationsController);
  });

  describe('findMany - 分页获取通知列表', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany(
        { type: NotificationType.SYSTEM, keyword: '测试' },
        '2',
        '10',
      );
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        type: NotificationType.SYSTEM,
        priority: undefined,
        isRead: undefined,
        keyword: '测试',
        page: 2,
        pageSize: 10,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({
        type: undefined,
        priority: undefined,
        isRead: undefined,
        keyword: undefined,
        page: 1,
        pageSize: 20,
      });
    });
  });

  describe('getUnreadCount - 获取未读数量', () => {
    it('调用 service.getUnreadCount', async () => {
      const expected = {
        total: 5,
        byType: { system: 2, appointment: 1, charge: 1, inventory: 1, patient: 0, clinical: 0, financial: 0, equipment: 0 },
        byPriority: { low: 1, normal: 2, high: 1, urgent: 1 },
      };
      service.getUnreadCount.mockResolvedValue(expected);
      const result = await controller.getUnreadCount();
      expect(result).toEqual(expected);
      expect(service.getUnreadCount).toHaveBeenCalled();
    });
  });

  describe('findOne - 获取单条通知', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = {
        id: 'notif-1',
        type: NotificationType.SYSTEM,
        title: '系统通知',
        content: '内容',
        priority: NotificationPriority.NORMAL,
      };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('notif-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('notif-1');
    });

    it('service 抛出 NotFoundException 时透传', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('通知不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAsRead - 标记单条已读', () => {
    it('调用 service.markAsRead 传入 id', async () => {
      const expected = {
        id: 'notif-1',
        readAt: new Date().toISOString(),
      };
      service.markAsRead.mockResolvedValue(expected);

      const result = await controller.markAsRead('notif-1');
      expect(result).toEqual(expected);
      expect(service.markAsRead).toHaveBeenCalledWith('notif-1');
    });
  });

  describe('markAllAsRead - 标记全部已读', () => {
    it('调用 service.markAllAsRead', async () => {
      const expected = { count: 5 };
      service.markAllAsRead.mockResolvedValue(expected);

      const result = await controller.markAllAsRead();
      expect(result).toEqual(expected);
      expect(service.markAllAsRead).toHaveBeenCalled();
    });
  });

  describe('remove - 删除通知', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue(undefined);
      await controller.remove('notif-1');
      expect(service.remove).toHaveBeenCalledWith('notif-1');
    });
  });
});
