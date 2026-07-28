import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException } from '@common/errors';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';


describe('RefundsController', () => {
  let controller: RefundsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      createRefund: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [{ provide: RefundsService, useValue: service }],
    }).compile();

    controller = module.get(RefundsController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入 filters/page/pageSize', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 10 };
      service.findMany.mockResolvedValue(expected);
      const q = { patientId: 'p-1', chargeId: 'c-1' } as any;

      const result = await controller.findMany(q, '2', '10');
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: 'p-1', chargeId: 'c-1' },
        page: 2,
        pageSize: 10,
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      await controller.findMany({});
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: undefined, chargeId: undefined },
        page: 1,
        pageSize: 50,
      });
    });

    it('只传 patientId 时只过滤 patientId', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      await controller.findMany({ patientId: 'p-1' }, '1', '50');
      expect(service.findMany).toHaveBeenCalledWith({
        filters: { patientId: 'p-1', chargeId: undefined },
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'r-1', amount: 100 };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('r-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('r-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('Refund不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.createRefund 传入 dto 和 user', async () => {
      const dto = { chargeId: 'c-1', amount: 100, reason: '退款原因' };
      const user = { id: 'u-1', name: '管理员' };
      const created = { id: 'r-1', ...dto };
      service.createRefund.mockResolvedValue(created);

      const result = await controller.create(dto as any, { user } as any);
      expect(result).toEqual(created);
      expect(service.createRefund).toHaveBeenCalledWith(dto, user);
    });

    it('req.user 为 undefined 时仍调用 service.createRefund', async () => {
      const dto = { chargeId: 'c-1', amount: 100 };
      service.createRefund.mockResolvedValue({ id: 'r-1' });
      await controller.create(dto as any, {} as any);
      expect(service.createRefund).toHaveBeenCalledWith(dto, undefined);
    });
  });
});
