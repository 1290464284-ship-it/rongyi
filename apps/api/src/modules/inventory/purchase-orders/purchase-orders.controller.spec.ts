import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PurchaseOrdersController', () => {
  let controller: PurchaseOrdersController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      createOrder: jest.fn(),
      receive: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [{ provide: PurchaseOrdersService, useValue: service }],
    }).compile();

    controller = module.get(PurchaseOrdersController);
  });

  describe('findMany', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0 };
      service.findMany.mockResolvedValue(expected);
      const q = { status: 'PENDING', supplierId: 's-1' } as any;

      const result = await controller.findMany(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith(q);
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'po-1', status: 'PENDING' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('po-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('po-1');
    });

    it('不存在时透传 NotFoundException', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('PurchaseOrder不存在'));
      await expect(controller.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('调用 service.createOrder 传入 dto 和 user', async () => {
      const dto = { supplierId: 's-1', items: [] };
      const user = { id: 'u-1', name: '管理员' };
      service.createOrder.mockResolvedValue({ id: 'po-1', ...dto });

      const result = await controller.create(dto, { user } as any);
      expect(result).toEqual({ id: 'po-1', ...dto });
      expect(service.createOrder).toHaveBeenCalledWith(dto, user);
    });

    it('req.user 为 undefined 时仍调用 service.createOrder', async () => {
      const dto = { supplierId: 's-1', items: [] };
      service.createOrder.mockResolvedValue({ id: 'po-1' });
      await controller.create(dto, {} as any);
      expect(service.createOrder).toHaveBeenCalledWith(dto, undefined);
    });

    it('参数错误时透传 BadRequestException', async () => {
      service.createOrder.mockRejectedValue(new BadRequestException('供应商不能为空'));
      await expect(controller.create({} as any, {} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('receive', () => {
    it('调用 service.receive 传入 id 和 user', async () => {
      const user = { id: 'u-1' };
      service.receive.mockResolvedValue({ id: 'po-1', status: 'RECEIVED' });

      const result = await controller.receive('po-1', { user } as any);
      expect(result).toEqual({ id: 'po-1', status: 'RECEIVED' });
      expect(service.receive).toHaveBeenCalledWith('po-1', user);
    });
  });

  describe('cancel', () => {
    it('调用 service.cancel 传入 id', async () => {
      service.cancel.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' });
      const result = await controller.cancel('po-1');
      expect(result).toEqual({ id: 'po-1', status: 'CANCELLED' });
      expect(service.cancel).toHaveBeenCalledWith('po-1');
    });
  });
});
