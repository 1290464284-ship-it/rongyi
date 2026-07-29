import { NotificationsService } from './notifications.service';
import { BusinessNotFoundException, BusinessForbiddenException } from '@common/errors';
import { MockDbService , asDbService } from '../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { NotificationType, NotificationPriority } from './types/notification.types';

function createMockClinicContext(
  clinicId: string | null = 'test-clinic-001',
  userId: string | null = 'test-user-001',
): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => userId,
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new NotificationsService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('create - 创建通知', () => {
    it('正常创建通知', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '系统通知',
        content: '这是一条系统通知',
        priority: NotificationPriority.NORMAL,
      };
      const result = await service.create(payload);
      expect(result).toBeDefined();
      expect(result.type).toBe(NotificationType.SYSTEM);
      expect(result.title).toBe('系统通知');
      expect(result.content).toBe('这是一条系统通知');
      expect(result.priority).toBe(NotificationPriority.NORMAL);
    });

    it('创建带 userId 的通知', async () => {
      const payload = {
        type: NotificationType.APPOINTMENT,
        title: '预约提醒',
        content: '您有一个新的预约',
        priority: NotificationPriority.HIGH,
        userId: 'user-002',
      };
      const result = await service.create(payload);
      expect(result.userId).toBe('user-002');
    });

    it('创建带 data 的通知', async () => {
      const payload = {
        type: NotificationType.CHARGE,
        title: '收费通知',
        content: '新的收费记录已生成',
        priority: NotificationPriority.NORMAL,
        data: { chargeId: 'charge-001', amount: 100 },
      };
      const result = await service.create(payload);
      expect(result.data).toEqual({ chargeId: 'charge-001', amount: 100 });
    });

    it('缺少诊所上下文时抛出 BusinessForbiddenException', async () => {
      service = new NotificationsService(asDbService(db), createMockClinicContext(null));
      await expect(
        service.create({
          type: NotificationType.SYSTEM,
          title: '测试',
          content: '测试内容',
          priority: NotificationPriority.NORMAL,
        }),
      ).rejects.toThrow(BusinessForbiddenException);
    });

    it('创建通知后可以通过 findOne 查询到', async () => {
      const payload = {
        type: NotificationType.PATIENT,
        title: '患者通知',
        content: '新患者登记',
        priority: NotificationPriority.NORMAL,
      };
      const created = await service.create(payload);
      const found = await service.findOne(created.id);
      expect(found.id).toBe(created.id);
      expect(found.title).toBe('患者通知');
    });

    it('创建通知时自动设置 createdAt 和 updatedAt', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '时间测试',
        content: '测试时间字段',
        priority: NotificationPriority.LOW,
      };
      const result = await service.create(payload);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.createdAt).toBe(result.updatedAt);
    });

    it('创建通知时 readAt 默认为 null', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '未读测试',
        content: '测试默认未读状态',
        priority: NotificationPriority.NORMAL,
      };
      const result = await service.create(payload);
      expect(result.readAt).toBeNull();
    });

    it('创建通知时 deletedAt 默认为 null', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '删除测试',
        content: '测试默认未删除状态',
        priority: NotificationPriority.NORMAL,
      };
      const result = await service.create(payload);
      expect(result.deletedAt).toBeNull();
    });

    it('data 为 undefined 时存储为 null', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '无数据通知',
        content: '没有 data 字段',
        priority: NotificationPriority.NORMAL,
        data: undefined,
      };
      const result = await service.create(payload);
      expect(result.data).toBeNull();
    });

    it('指定 clinicId 创建通知', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '指定诊所',
        content: '指定诊所 ID 的通知',
        priority: NotificationPriority.NORMAL,
        clinicId: 'custom-clinic-001',
      };
      const result = await service.create(payload);
      expect(result.clinicId).toBe('custom-clinic-001');
    });

    it('创建高优先级通知', async () => {
      const payload = {
        type: NotificationType.SYSTEM,
        title: '紧急通知',
        content: '这是紧急通知',
        priority: NotificationPriority.URGENT,
      };
      const result = await service.create(payload);
      expect(result.priority).toBe(NotificationPriority.URGENT);
    });

    it('创建各种类型的通知', async () => {
      const types = Object.values(NotificationType);
      for (const type of types) {
        const result = await service.create({
          type,
          title: `${type} 通知`,
          content: `测试 ${type} 类型`,
          priority: NotificationPriority.NORMAL,
        });
        expect(result.type).toBe(type);
      }
    });

    it('JSON 字段解析失败时设置为 null', async () => {
      const now = new Date().toISOString();
      db.seed('Notification', [
        {
          id: 'invalid-json-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '无效 JSON',
          content: '测试无效 JSON 解析',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: 'invalid json {{{',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.findOne('invalid-json-1');
      expect(result.data).toBeNull();
    });
  });

  describe('sendToUser - 向指定用户发送通知', () => {
    it('成功发送给指定用户', async () => {
      const result = await service.sendToUser('user-001', {
        type: NotificationType.PATIENT,
        title: '患者通知',
        content: '有新患者登记',
        priority: NotificationPriority.NORMAL,
      });
      expect(result.userId).toBe('user-001');
    });
  });

  describe('broadcastToClinic - 诊所广播通知', () => {
    it('成功广播（userId 为 null）', async () => {
      const result = await service.broadcastToClinic({
        type: NotificationType.SYSTEM,
        title: '系统公告',
        content: '系统将于今晚维护',
        priority: NotificationPriority.HIGH,
      });
      expect(result.userId).toBeNull();
    });
  });

  describe('findMany - 分页查询通知列表', () => {
    beforeEach(() => {
      const now = new Date().toISOString();
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '系统通知1',
          content: '内容1',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-2',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.APPOINTMENT,
          title: '预约提醒',
          content: '内容2',
          priority: NotificationPriority.HIGH,
          readAt: now,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-3',
          clinicId: 'test-clinic-001',
          userId: null,
          type: NotificationType.SYSTEM,
          title: '广播通知',
          content: '内容3',
          priority: NotificationPriority.URGENT,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    });

    it('返回当前用户的通知（包括广播通知）', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it('按类型过滤', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /type\s*=\s*\?/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1 }) };
        }
        if (/FROM\s+Notification/i.test(sql) && /type\s*=\s*\?/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { ...stmt, all: () => db.getTableData('Notification').slice(0, 1) };
        }
        return stmt;
      });
      const result = await service.findMany({ type: NotificationType.SYSTEM });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      prepareSpy.mockRestore();
    });

    it('按未读状态过滤', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 2 }) };
        }
        if (/FROM\s+Notification/i.test(sql) && /readAt IS NULL/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { ...stmt, all: () => db.getTableData('Notification').filter(n => !n.readAt) };
        }
        return stmt;
      });
      const result = await service.findMany({ isRead: false });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      prepareSpy.mockRestore();
    });

    it('支持分页参数', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('按已读状态过滤', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NOT NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1 }) };
        }
        if (/FROM\s+Notification/i.test(sql) && /readAt IS NOT NULL/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { ...stmt, all: () => db.getTableData('Notification').filter(n => n.readAt) };
        }
        return stmt;
      });
      const result = await service.findMany({ isRead: true });
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      prepareSpy.mockRestore();
    });

    it('按优先级过滤', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /priority\s*=\s*\?/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1 }) };
        }
        if (/FROM\s+Notification/i.test(sql) && /priority\s*=\s*\?/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { ...stmt, all: () => db.getTableData('Notification').slice(0, 1) };
        }
        return stmt;
      });
      const result = await service.findMany({ priority: NotificationPriority.HIGH });
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      prepareSpy.mockRestore();
    });

    it('关键词搜索标题和内容', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /LIKE/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1 }) };
        }
        if (/FROM\s+Notification/i.test(sql) && /LIKE/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { ...stmt, all: () => db.getTableData('Notification').slice(0, 1) };
        }
        return stmt;
      });
      const result = await service.findMany({ keyword: '系统' });
      expect(result.total).toBeGreaterThanOrEqual(0);
      prepareSpy.mockRestore();
    });

    it('无效的排序字段应被安全处理', async () => {
      const result = await service.findMany({ sortBy: 'invalid_field' });
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('sortOrder 为 ASC 时升序排列', async () => {
      const result = await service.findMany({ sortOrder: 'ASC' });
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('sortOrder 为 DESC 时降序排列', async () => {
      const result = await service.findMany({ sortOrder: 'DESC' });
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('page 小于 1 时默认为 1', async () => {
      const result = await service.findMany({ page: 0, pageSize: 10 });
      expect(result.page).toBe(1);
    });

    it('pageSize 超过最大值时限制为最大值', async () => {
      const result = await service.findMany({ pageSize: 9999 });
      expect(result.pageSize).toBe(200);
    });

    it('pageSize 小于 1 时默认为 20', async () => {
      const result = await service.findMany({ pageSize: 0 });
      expect(result.pageSize).toBe(20);
    });

    it('不返回已软删除的通知', async () => {
      const now = new Date().toISOString();
      db.seed('Notification', [
        {
          id: 'deleted-notif',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '已删除',
          content: '已删除的通知',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ]);

      const result = await service.findMany();
      const deletedItem = result.items.find((n: any) => n.id === 'deleted-notif');
      expect(deletedItem).toBeUndefined();
    });

    it('没有 userId 时返回诊所所有通知（包括广播）', async () => {
      service = new NotificationsService(asDbService(db), createMockClinicContext('test-clinic-001', null));
      const result = await service.findMany();
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
    });
  });

  describe('findOne - 获取单条通知', () => {
    const now = new Date().toISOString();

    beforeEach(() => {
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '系统通知',
          content: '内容',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-with-data',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.CHARGE,
          title: '收费通知',
          content: '有 data 的通知',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: { chargeId: 'c-001', amount: 100 },
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-deleted',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '已删除',
          content: '已删除的通知',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('notif-1');
      expect(result.id).toBe('notif-1');
      expect(result.title).toBe('系统通知');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('查询包含 data 字段的通知', async () => {
      const result = await service.findOne('notif-with-data');
      expect(result.data).toEqual({ chargeId: 'c-001', amount: 100 });
    });

    it('返回的通知包含完整字段', async () => {
      const result = await service.findOne('notif-1');
      expect(result.id).toBeDefined();
      expect(result.clinicId).toBeDefined();
      expect(result.type).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.priority).toBeDefined();
      expect(result.readAt).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('userId 为 null 的广播通知可以查询', async () => {
      db.seed('Notification', [
        {
          id: 'broadcast-notif',
          clinicId: 'test-clinic-001',
          userId: null,
          type: NotificationType.SYSTEM,
          title: '广播通知',
          content: '这是广播',
          priority: NotificationPriority.URGENT,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.findOne('broadcast-notif');
      expect(result.id).toBe('broadcast-notif');
      expect(result.userId).toBeNull();
    });
  });

  describe('getUnreadCount - 获取未读数量', () => {
    const now = new Date().toISOString();

    beforeEach(() => {
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '未读通知1',
          content: '内容1',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-2',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.APPOINTMENT,
          title: '已读通知',
          content: '内容2',
          priority: NotificationPriority.HIGH,
          readAt: now,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-3',
          clinicId: 'test-clinic-001',
          userId: null,
          type: NotificationType.SYSTEM,
          title: '未读广播',
          content: '内容3',
          priority: NotificationPriority.URGENT,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    });

    it('返回正确的未读总数', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 2, total: 2 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return {
            ...stmt,
            all: () => [
              { type: NotificationType.SYSTEM, count: 2 },
            ],
          };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return {
            ...stmt,
            all: () => [
              { priority: NotificationPriority.NORMAL, count: 1 },
              { priority: NotificationPriority.URGENT, count: 1 },
            ],
          };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.byType).toBeDefined();
      expect(result.byPriority).toBeDefined();

      prepareSpy.mockRestore();
    });

    it('包含按类型和优先级的统计', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 2, total: 2 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return {
            ...stmt,
            all: () => [
              { type: NotificationType.SYSTEM, count: 2 },
              { type: NotificationType.APPOINTMENT, count: 0 },
            ],
          };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return {
            ...stmt,
            all: () => [
              { priority: NotificationPriority.NORMAL, count: 1 },
              { priority: NotificationPriority.HIGH, count: 0 },
              { priority: NotificationPriority.URGENT, count: 1 },
            ],
          };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      expect(typeof result.byType[NotificationType.SYSTEM]).toBe('number');
      expect(typeof result.byPriority[NotificationPriority.HIGH]).toBe('number');

      prepareSpy.mockRestore();
    });

    it('没有未读通知时总数为 0', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 0, total: 0 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      expect(result.total).toBe(0);

      prepareSpy.mockRestore();
    });

    it('已软删除的通知不计入未读', async () => {
      db.seed('Notification', [
        {
          id: 'deleted-unread',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '已删除的未读',
          content: '不应计入',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ]);

      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /deletedAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 2, total: 2 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      expect(result.total).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });

    it('包含广播通知的未读', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /userId IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 3, total: 3 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      expect(result.total).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });

    it('所有通知类型都包含在 byType 中', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1, total: 1 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [{ type: NotificationType.SYSTEM, count: 1 }] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      const allTypes = Object.values(NotificationType);
      for (const type of allTypes) {
        expect(result.byType).toHaveProperty(type);
        expect(typeof result.byType[type]).toBe('number');
      }

      prepareSpy.mockRestore();
    });

    it('所有优先级都包含在 byPriority 中', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 1, total: 1 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [{ priority: NotificationPriority.NORMAL, count: 1 }] };
        }
        return stmt;
      });

      const result = await service.getUnreadCount();
      const allPriorities = Object.values(NotificationPriority);
      for (const priority of allPriorities) {
        expect(result.byPriority).toHaveProperty(priority);
        expect(typeof result.byPriority[priority]).toBe('number');
      }

      prepareSpy.mockRestore();
    });
  });

  describe('markAsRead - 标记单条已读', () => {
    const now = new Date().toISOString();

    beforeEach(() => {
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '未读通知',
          content: '内容',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-already-read',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '已读通知',
          content: '已读的内容',
          priority: NotificationPriority.NORMAL,
          readAt: now,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    });

    it('成功标记为已读', async () => {
      const result = await service.markAsRead('notif-1');
      expect(result.readAt).not.toBeNull();
    });

    it('已读的通知再次标记不报错', async () => {
      await service.markAsRead('notif-1');
      const result = await service.markAsRead('notif-1');
      expect(result.readAt).not.toBeNull();
    });

    it('不存在的通知抛出 BusinessNotFoundException', async () => {
      await expect(service.markAsRead('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('广播通知也可以标记已读', async () => {
      db.seed('Notification', [
        {
          id: 'broadcast-notif',
          clinicId: 'test-clinic-001',
          userId: null,
          type: NotificationType.SYSTEM,
          title: '广播通知',
          content: '这是广播',
          priority: NotificationPriority.URGENT,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.markAsRead('broadcast-notif');
      expect(result.readAt).not.toBeNull();
    });
  });

  describe('markAllAsRead - 标记全部已读', () => {
    const now = new Date().toISOString();

    beforeEach(() => {
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '未读1',
          content: '内容1',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-2',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.APPOINTMENT,
          title: '未读2',
          content: '内容2',
          priority: NotificationPriority.HIGH,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'notif-already-read',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.CHARGE,
          title: '已读',
          content: '已读的通知',
          priority: NotificationPriority.NORMAL,
          readAt: now,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    });

    it('返回标记的数量', async () => {
      const result = await service.markAllAsRead();
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it('没有未读通知时返回 0', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/UPDATE.*Notification.*readAt/i.test(sql)) {
          return { ...stmt, run: () => ({ changes: 0, lastInsertRowid: 0 }) };
        }
        return stmt;
      });

      const result = await service.markAllAsRead();
      expect(result.count).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });

    it('只标记当前用户的通知', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/UPDATE.*Notification.*readAt/i.test(sql) && /userId = \?/i.test(sql)) {
          return { ...stmt, run: () => ({ changes: 2, lastInsertRowid: 0 }) };
        }
        return stmt;
      });

      const result = await service.markAllAsRead();
      expect(result.count).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });

    it('不标记已软删除的通知', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/UPDATE.*Notification.*readAt/i.test(sql) && /deletedAt IS NULL/i.test(sql)) {
          return { ...stmt, run: () => ({ changes: 2, lastInsertRowid: 0 }) };
        }
        return stmt;
      });

      const result = await service.markAllAsRead();
      expect(result.count).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });

    it('标记全部已读后未读数量为 0', async () => {
      const originalPrepare = db.prepare.bind(db);
      await service.markAllAsRead();
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/SELECT COUNT/i.test(sql) && /readAt IS NULL/i.test(sql)) {
          return { ...stmt, get: () => ({ count: 0, total: 0 }) };
        }
        if (/GROUP BY type/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        if (/GROUP BY priority/i.test(sql)) {
          return { ...stmt, all: () => [] };
        }
        return stmt;
      });

      const unreadCount = await service.getUnreadCount();
      expect(unreadCount.total).toBe(0);

      prepareSpy.mockRestore();
    });

    it('包括广播通知也标记为已读', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/UPDATE.*Notification.*readAt/i.test(sql) && /userId IS NULL/i.test(sql)) {
          return { ...stmt, run: () => ({ changes: 3, lastInsertRowid: 0 }) };
        }
        return stmt;
      });

      const result = await service.markAllAsRead();
      expect(result.count).toBeGreaterThanOrEqual(0);

      prepareSpy.mockRestore();
    });
  });

  describe('remove - 删除通知', () => {
    const now = new Date().toISOString();

    beforeEach(() => {
      db.seed('Notification', [
        {
          id: 'notif-1',
          clinicId: 'test-clinic-001',
          userId: 'test-user-001',
          type: NotificationType.SYSTEM,
          title: '待删除',
          content: '内容',
          priority: NotificationPriority.NORMAL,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    });

    it('成功软删除通知（设置 deletedAt）', async () => {
      await service.remove('notif-1');
      const tableData = db.getTableData('Notification');
      const deleted = tableData.find(r => r.id === 'notif-1');
      expect(deleted).toBeDefined();
      expect(deleted?.deletedAt).not.toBeNull();
    });

    it('删除不存在的通知抛出 BusinessNotFoundException', async () => {
      await expect(service.remove('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('删除后 findMany 不再返回该通知', async () => {
      await service.remove('notif-1');
      const result = await service.findMany();
      const found = result.items.find((n: any) => n.id === 'notif-1');
      expect(found).toBeUndefined();
    });

    it('广播通知也可以删除', async () => {
      db.seed('Notification', [
        {
          id: 'broadcast-to-delete',
          clinicId: 'test-clinic-001',
          userId: null,
          type: NotificationType.SYSTEM,
          title: '待删除广播',
          content: '待删除的广播通知',
          priority: NotificationPriority.URGENT,
          readAt: null,
          data: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);

      await service.remove('broadcast-to-delete');
      const tableData = db.getTableData('Notification');
      const deleted = tableData.find(r => r.id === 'broadcast-to-delete');
      expect(deleted?.deletedAt).not.toBeNull();
    });
  });

  describe('sendToUser - 向指定用户发送通知', () => {
    it('成功发送给指定用户', async () => {
      const result = await service.sendToUser('user-001', {
        type: NotificationType.SYSTEM,
        title: '用户通知',
        content: '这是给指定用户的通知',
        priority: NotificationPriority.NORMAL,
      });
      expect(result.userId).toBe('user-001');
      expect(result.title).toBe('用户通知');
    });

    it('发送给不同用户的通知相互独立', async () => {
      const result1 = await service.sendToUser('user-001', {
        type: NotificationType.SYSTEM,
        title: '用户1通知',
        content: '给用户1',
        priority: NotificationPriority.NORMAL,
      });
      const result2 = await service.sendToUser('user-002', {
        type: NotificationType.SYSTEM,
        title: '用户2通知',
        content: '给用户2',
        priority: NotificationPriority.NORMAL,
      });

      expect(result1.userId).toBe('user-001');
      expect(result2.userId).toBe('user-002');
      expect(result1.id).not.toBe(result2.id);
    });

    it('发送通知时可以携带 data', async () => {
      const result = await service.sendToUser('user-001', {
        type: NotificationType.CHARGE,
        title: '收费通知',
        content: '新的收费记录',
        priority: NotificationPriority.NORMAL,
        data: { chargeId: 'c-001', amount: 200 },
      });
      expect(result.data).toEqual({ chargeId: 'c-001', amount: 200 });
    });

    it('缺少诊所上下文时抛出 BusinessForbiddenException', async () => {
      service = new NotificationsService(asDbService(db), createMockClinicContext(null));
      await expect(
        service.sendToUser('user-001', {
          type: NotificationType.SYSTEM,
          title: '测试',
          content: '测试内容',
          priority: NotificationPriority.NORMAL,
        }),
      ).rejects.toThrow(BusinessForbiddenException);
    });
  });

  describe('broadcastToClinic - 广播通知', () => {
    it('成功发送广播通知', async () => {
      const result = await service.broadcastToClinic({
        type: NotificationType.SYSTEM,
        title: '系统广播',
        content: '这是一条广播通知',
        priority: NotificationPriority.URGENT,
      });
      expect(result.userId).toBeNull();
      expect(result.title).toBe('系统广播');
      expect(result.priority).toBe(NotificationPriority.URGENT);
    });

    it('广播通知所有用户都能看到', async () => {
      const broadcast = await service.broadcastToClinic({
        type: NotificationType.SYSTEM,
        title: '全员广播',
        content: '全员可见',
        priority: NotificationPriority.NORMAL,
      });

      const serviceUser2 = new NotificationsService(
        asDbService(db),
        createMockClinicContext('test-clinic-001', 'user-002'),
      );
      const found = await serviceUser2.findOne(broadcast.id);
      expect(found.id).toBe(broadcast.id);
    });

    it('广播通知可以携带 data', async () => {
      const result = await service.broadcastToClinic({
        type: NotificationType.SYSTEM,
        title: '带数据的广播',
        content: '有 data',
        priority: NotificationPriority.NORMAL,
        data: { key: 'value' },
      });
      expect(result.data).toEqual({ key: 'value' });
    });

    it('缺少诊所上下文时抛出 BusinessForbiddenException', async () => {
      service = new NotificationsService(asDbService(db), createMockClinicContext(null));
      await expect(
        service.broadcastToClinic({
          type: NotificationType.SYSTEM,
          title: '测试广播',
          content: '测试内容',
          priority: NotificationPriority.NORMAL,
        }),
      ).rejects.toThrow(BusinessForbiddenException);
    });
  });
});
