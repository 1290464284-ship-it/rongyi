import { Test, TestingModule } from '@nestjs/testing';
import { ProcessingOrdersController } from './processing-orders.controller';
import { ProcessingOrdersService } from './processing-orders.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ProcessingOrdersController', () => {
  let controller: ProcessingOrdersController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      listFactories: jest.fn(),
      createFactory: jest.fn(),
      updateFactory: jest.fn(),
      deleteFactory: jest.fn(),
      listProducts: jest.fn(),
      createProduct: jest.fn(),
      updateProduct: jest.fn(),
      deleteProduct: jest.fn(),
      stats: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      updateStatus: jest.fn(),
      addFlowLog: jest.fn(),
      linkCharge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProcessingOrdersController],
      providers: [{ provide: ProcessingOrdersService, useValue: service }],
    }).compile();

    controller = module.get(ProcessingOrdersController);
  });

  // ==================== 工厂管理 ====================
  describe('listFactories', () => {
    it('调用 service.listFactories', async () => {
      const expected = [{ id: 'f-1', name: '加工厂A' }];
      service.listFactories.mockResolvedValue(expected);
      const result = await controller.listFactories();
      expect(result).toEqual(expected);
      expect(service.listFactories).toHaveBeenCalledWith();
    });
  });

  describe('createFactory', () => {
    it('调用 service.createFactory 传入 dto', async () => {
      const dto = { name: '加工厂A', contactPerson: '张三' };
      service.createFactory.mockResolvedValue({ id: 'f-1', ...dto });
      const result = await controller.createFactory(dto);
      expect(result).toEqual({ id: 'f-1', ...dto });
      expect(service.createFactory).toHaveBeenCalledWith(dto);
    });

    it('未传 name 时透传 BadRequestException', async () => {
      service.createFactory.mockRejectedValue(new BadRequestException('工厂名称不能为空'));
      await expect(controller.createFactory({} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateFactory', () => {
    it('调用 service.updateFactory 传入 id 和 dto', async () => {
      const dto = { name: '更新厂名' };
      service.updateFactory.mockResolvedValue({ id: 'f-1', ...dto });
      const result = await controller.updateFactory('f-1', dto);
      expect(result).toEqual({ id: 'f-1', ...dto });
      expect(service.updateFactory).toHaveBeenCalledWith('f-1', dto);
    });
  });

  describe('deleteFactory', () => {
    it('调用 service.deleteFactory 传入 id', async () => {
      service.deleteFactory.mockResolvedValue({ id: 'f-1' });
      const result = await controller.deleteFactory('f-1');
      expect(result).toEqual({ id: 'f-1' });
      expect(service.deleteFactory).toHaveBeenCalledWith('f-1');
    });

    it('不存在时透传 NotFoundException', async () => {
      service.deleteFactory.mockRejectedValue(new NotFoundException('工厂不存在'));
      await expect(controller.deleteFactory('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== 产品管理 ====================
  describe('listAllProducts', () => {
    it('传 factoryId 时调用 service.listProducts 传入 factoryId', async () => {
      const expected = [{ id: 'p-1', name: '产品A' }];
      service.listProducts.mockResolvedValue(expected);
      const result = await controller.listAllProducts('f-1');
      expect(result).toEqual(expected);
      expect(service.listProducts).toHaveBeenCalledWith('f-1');
    });

    it('未传 factoryId 时调用 service.listProducts 传入 undefined', async () => {
      service.listProducts.mockResolvedValue([]);
      await controller.listAllProducts();
      expect(service.listProducts).toHaveBeenCalledWith(undefined);
    });
  });

  describe('listProducts', () => {
    it('调用 service.listProducts 传入 factoryId（来自 path）', async () => {
      const expected = [{ id: 'p-1', name: '产品A' }];
      service.listProducts.mockResolvedValue(expected);
      const result = await controller.listProducts('f-1');
      expect(result).toEqual(expected);
      expect(service.listProducts).toHaveBeenCalledWith('f-1');
    });
  });

  describe('createProduct', () => {
    it('调用 service.createProduct 传入 dto', async () => {
      const dto = { factoryId: 'f-1', name: '产品A', price: 100 };
      service.createProduct.mockResolvedValue({ id: 'p-1', ...dto });
      const result = await controller.createProduct(dto);
      expect(result).toEqual({ id: 'p-1', ...dto });
      expect(service.createProduct).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateProduct', () => {
    it('调用 service.updateProduct 传入 id 和 dto', async () => {
      const dto = { name: '更新产品' };
      service.updateProduct.mockResolvedValue({ id: 'p-1', ...dto });
      const result = await controller.updateProduct('p-1', dto);
      expect(result).toEqual({ id: 'p-1', ...dto });
      expect(service.updateProduct).toHaveBeenCalledWith('p-1', dto);
    });
  });

  describe('deleteProduct', () => {
    it('调用 service.deleteProduct 传入 id', async () => {
      service.deleteProduct.mockResolvedValue({ id: 'p-1' });
      const result = await controller.deleteProduct('p-1');
      expect(result).toEqual({ id: 'p-1' });
      expect(service.deleteProduct).toHaveBeenCalledWith('p-1');
    });
  });

  // ==================== 统计 ====================
  describe('stats', () => {
    it('调用 service.stats', async () => {
      const expected = { total: 10, completed: 5, pending: 5 };
      service.stats.mockResolvedValue(expected);
      const result = await controller.stats();
      expect(result).toEqual(expected);
      expect(service.stats).toHaveBeenCalledWith();
    });
  });

  // ==================== 加工单 ====================
  describe('findAll', () => {
    it('调用 service.findMany 传入查询参数', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 10 };
      service.findMany.mockResolvedValue(expected);
      const q = { patientId: 'p-1', status: 'SENT' } as any;

      const result = await controller.findAll(q, '2', '10');
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ patientId: 'p-1', status: 'SENT', page: 2, pageSize: 10 });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      await controller.findAll({});
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });
  });

  describe('findOne', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'po-1', status: 'SENT' };
      service.findOne.mockResolvedValue(expected);
      const result = await controller.findOne('po-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('po-1');
    });
  });

  describe('create', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { patientId: 'p-1', factoryId: 'f-1', teethNumbers: ['11'] };
      service.create.mockResolvedValue({ id: 'po-1', ...dto });
      const result = await controller.create(dto as any);
      expect(result).toEqual({ id: 'po-1', ...dto });
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { shade: 'A2', totalFee: 1000 };
      service.update.mockResolvedValue({ id: 'po-1', ...dto });
      const result = await controller.update('po-1', dto);
      expect(result).toEqual({ id: 'po-1', ...dto });
      expect(service.update).toHaveBeenCalledWith('po-1', dto);
    });
  });

  describe('remove', () => {
    it('调用 service.remove 传入 id', async () => {
      service.remove.mockResolvedValue({ id: 'po-1' });
      const result = await controller.remove('po-1');
      expect(result).toEqual({ id: 'po-1' });
      expect(service.remove).toHaveBeenCalledWith('po-1');
    });
  });

  describe('updateStatus', () => {
    it('调用 service.updateStatus 传入 id 和 status', async () => {
      const dto = { status: 'IN_PROGRESS' };
      service.updateStatus.mockResolvedValue({ id: 'po-1', status: 'IN_PROGRESS' });
      const result = await controller.updateStatus('po-1', dto);
      expect(result).toEqual({ id: 'po-1', status: 'IN_PROGRESS' });
      expect(service.updateStatus).toHaveBeenCalledWith('po-1', 'IN_PROGRESS');
    });

    it('非法状态转换时透传 BadRequestException', async () => {
      service.updateStatus.mockRejectedValue(new BadRequestException('非法的状态转换'));
      await expect(controller.updateStatus('po-1', { status: 'COMPLETED' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addFlowLog', () => {
    it('调用 service.addFlowLog 传入 id 和 dto', async () => {
      const dto = { status: 'IN_PROGRESS', remark: '开始加工' };
      service.addFlowLog.mockResolvedValue({ id: 'fl-1', orderId: 'po-1', status: 'IN_PROGRESS' });
      const result = await controller.addFlowLog('po-1', dto);
      expect(result).toEqual({ id: 'fl-1', orderId: 'po-1', status: 'IN_PROGRESS' });
      expect(service.addFlowLog).toHaveBeenCalledWith('po-1', dto);
    });
  });

  describe('linkCharge', () => {
    it('调用 service.linkCharge 传入 id 和 chargeId', async () => {
      const dto = { chargeId: 'c-1' };
      service.linkCharge.mockResolvedValue({ id: 'po-1', chargeId: 'c-1' });
      const result = await controller.linkCharge('po-1', dto);
      expect(result).toEqual({ id: 'po-1', chargeId: 'c-1' });
      expect(service.linkCharge).toHaveBeenCalledWith('po-1', 'c-1');
    });
  });
});
