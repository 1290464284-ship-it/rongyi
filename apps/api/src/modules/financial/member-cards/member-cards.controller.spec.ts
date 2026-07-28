import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsService } from './member-cards.service';


describe('MemberCardsController', () => {
  let controller: MemberCardsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findByPatient: jest.fn(),
      getLogs: jest.fn(),
      createForPatient: jest.fn(),
      recharge: jest.fn(),
      findPointLogs: jest.fn(),
      addPoints: jest.fn(),
      deductPoints: jest.fn(),
      consume: jest.fn(),
      refund: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberCardsController],
      providers: [{ provide: MemberCardsService, useValue: service }],
    }).compile();

    controller = module.get(MemberCardsController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 page/pageSize', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 10 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany('2', '10');
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findMany();
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  describe('findByPatient', () => {
    it('调用 service.findByPatient 传入 patientId', async () => {
      const expected = { id: 'mc-1', patientId: 'p-1', balance: 100 };
      service.findByPatient.mockResolvedValue(expected);

      const result = await controller.findByPatient('p-1');
      expect(result).toEqual(expected);
      expect(service.findByPatient).toHaveBeenCalledWith('p-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findByPatient.mockRejectedValue(new BusinessNotFoundException('MemberCard不存在'));
      await expect(controller.findByPatient('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('getLogs', () => {
    it('调用 service.getLogs 传入 id', async () => {
      const expected = [{ id: 'log-1', action: 'RECHARGE' }];
      service.getLogs.mockResolvedValue(expected);

      const result = await controller.getLogs('mc-1');
      expect(result).toEqual(expected);
      expect(service.getLogs).toHaveBeenCalledWith('mc-1');
    });
  });

  describe('createForPatient', () => {
    it('调用 service.createForPatient 传入 patientId', async () => {
      const expected = { id: 'mc-1', patientId: 'p-1', balance: 0 };
      service.createForPatient.mockResolvedValue(expected);

      const result = await controller.createForPatient('p-1');
      expect(result).toEqual(expected);
      expect(service.createForPatient).toHaveBeenCalledWith('p-1');
    });
  });

  describe('recharge', () => {
    it('调用 service.recharge 传入 id/amount/requestId', async () => {
      const dto = { amount: 100 };
      const expected = { id: 'mc-1', balance: 100 };
      service.recharge.mockResolvedValue(expected);

      const result = await controller.recharge('mc-1', dto);
      expect(result).toEqual(expected);
      expect(service.recharge).toHaveBeenCalledWith('mc-1', 100, undefined);
    });

    it('透传 requestId 到 service 激活幂等保护', async () => {
      const dto = { amount: 100, requestId: 'req-uuid-001' };
      service.recharge.mockResolvedValue({ id: 'mc-1', balance: 100 });

      await controller.recharge('mc-1', dto);
      expect(service.recharge).toHaveBeenCalledWith('mc-1', 100, 'req-uuid-001');
    });

    it('amount 为负数时透传 BusinessValidationException', async () => {
      service.recharge.mockRejectedValue(new BusinessValidationException('金额必须大于0'));
      await expect(controller.recharge('mc-1', { amount: -1 } as any)).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('findPointLogs', () => {
    it('调用 service.findPointLogs 传入 id', async () => {
      const expected = [{ id: 'pl-1', points: 10 }];
      service.findPointLogs.mockResolvedValue(expected);

      const result = await controller.findPointLogs('mc-1');
      expect(result).toEqual(expected);
      expect(service.findPointLogs).toHaveBeenCalledWith('mc-1');
    });
  });

  describe('addPoints', () => {
    it('调用 service.addPoints 传入 id/points/chargeId/remark/requestId', async () => {
      const dto = { points: 10, chargeId: 'c-1', remark: '充值送积分' };
      service.addPoints.mockResolvedValue({ id: 'mc-1', points: 10 });

      const result = await controller.addPoints('mc-1', dto);
      expect(result).toEqual({ id: 'mc-1', points: 10 });
      expect(service.addPoints).toHaveBeenCalledWith('mc-1', 10, 'c-1', '充值送积分', undefined);
    });

    it('透传 requestId 到 service 激活幂等保护', async () => {
      const dto = { points: 10, requestId: 'req-uuid-002' };
      service.addPoints.mockResolvedValue({ id: 'mc-1', points: 10 });

      await controller.addPoints('mc-1', dto);
      expect(service.addPoints).toHaveBeenCalledWith('mc-1', 10, undefined, undefined, 'req-uuid-002');
    });
  });

  describe('deductPoints', () => {
    it('调用 service.deductPoints 传入 id/points/remark/requestId', async () => {
      const dto = { points: 5, remark: '消费扣减' };
      service.deductPoints.mockResolvedValue({ id: 'mc-1', points: 5 });

      const result = await controller.deductPoints('mc-1', dto);
      expect(result).toEqual({ id: 'mc-1', points: 5 });
      expect(service.deductPoints).toHaveBeenCalledWith('mc-1', 5, '消费扣减', undefined);
    });

    it('透传 requestId 到 service 激活幂等保护', async () => {
      const dto = { points: 5, requestId: 'req-uuid-003' };
      service.deductPoints.mockResolvedValue({ id: 'mc-1', points: 5 });

      await controller.deductPoints('mc-1', dto);
      expect(service.deductPoints).toHaveBeenCalledWith('mc-1', 5, undefined, 'req-uuid-003');
    });
  });

  describe('consume', () => {
    it('调用 service.consume 传入 id/amount/chargeId/remark/requestId', async () => {
      const dto = { amount: 50, chargeId: 'c-1', remark: '消费' };
      service.consume.mockResolvedValue({ id: 'mc-1', balance: 50 });

      const result = await controller.consume('mc-1', dto);
      expect(result).toEqual({ id: 'mc-1', balance: 50 });
      expect(service.consume).toHaveBeenCalledWith('mc-1', 50, 'c-1', '消费', undefined);
    });

    it('透传 requestId 到 service 激活幂等保护', async () => {
      const dto = { amount: 50, requestId: 'req-uuid-004' };
      service.consume.mockResolvedValue({ id: 'mc-1', balance: 50 });

      await controller.consume('mc-1', dto);
      expect(service.consume).toHaveBeenCalledWith('mc-1', 50, undefined, undefined, 'req-uuid-004');
    });
  });

  describe('refund', () => {
    it('调用 service.refund 传入 id/amount/chargeId/remark/requestId', async () => {
      const dto = { amount: 30, chargeId: 'c-1', remark: '退款返还' };
      service.refund.mockResolvedValue({ id: 'mc-1', balance: 130 });

      const result = await controller.refund('mc-1', dto);
      expect(result).toEqual({ id: 'mc-1', balance: 130 });
      expect(service.refund).toHaveBeenCalledWith('mc-1', 30, 'c-1', '退款返还', undefined);
    });

    it('透传 requestId 到 service 激活幂等保护', async () => {
      const dto = { amount: 30, requestId: 'req-uuid-005' };
      service.refund.mockResolvedValue({ id: 'mc-1', balance: 130 });

      await controller.refund('mc-1', dto);
      expect(service.refund).toHaveBeenCalledWith('mc-1', 30, undefined, undefined, 'req-uuid-005');
    });
  });
});
