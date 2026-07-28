import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';


describe('InventoryController', () => {
  let controller: InventoryController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      findMany: jest.fn(),
      findLowStockItems: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findTransactions: jest.fn(),
      stockAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: service }],
    }).compile();

    controller = module.get(InventoryController);
  });

  describe('findItems', () => {
    it('调用 service.findMany 传入 keyword/page/pageSize/filters', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);
      const q = { keyword: '牙科', category: '材料', page: '2', pageSize: '10' } as any;

      const result = await controller.findItems(q);
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({
        keyword: '牙科',
        page: 2,
        pageSize: 10,
        filters: { category: '材料' },
      });
    });

    it('未传 page/pageSize 时使用默认值', async () => {
      service.findMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await controller.findItems({});
      expect(service.findMany).toHaveBeenCalledWith({
        keyword: undefined,
        page: 1,
        pageSize: 20,
        filters: { category: undefined },
      });
    });
  });

  describe('findLowStockItems', () => {
    it('调用 service.findLowStockItems', async () => {
      const expected = [{ id: 'inv-1', name: '麻药', stock: 1, minStock: 5 }];
      service.findLowStockItems.mockResolvedValue(expected);

      const result = await controller.findLowStockItems();
      expect(result).toEqual(expected);
      expect(service.findLowStockItems).toHaveBeenCalledWith();
    });
  });

  describe('findOneItem', () => {
    it('调用 service.findOne 传入 id', async () => {
      const expected = { id: 'inv-1', name: '麻药' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOneItem('inv-1');
      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('inv-1');
    });

    it('不存在时透传 BusinessNotFoundException', async () => {
      service.findOne.mockRejectedValue(new BusinessNotFoundException('InventoryItem不存在'));
      await expect(controller.findOneItem('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('createItem', () => {
    it('调用 service.create 传入 dto', async () => {
      const dto = { name: '麻药', code: 'M001', spec: '10ml', unit: '瓶', stock: 100, minStock: 10, price: 50 };
      const created = { id: 'inv-1', ...dto };
      service.create.mockResolvedValue(created);

      const result = await controller.createItem(dto as any);
      expect(result).toEqual(created);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateItem', () => {
    it('调用 service.update 传入 id 和 dto', async () => {
      const dto = { name: '更新名称' };
      const updated = { id: 'inv-1', ...dto };
      service.update.mockResolvedValue(updated);

      const result = await controller.updateItem('inv-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('inv-1', dto);
    });

    it('尝试修改 stock 时透传 BusinessValidationException', async () => {
      service.update.mockRejectedValue(new BusinessValidationException('禁止直接修改库存数量'));
      await expect(controller.updateItem('inv-1', { stock: 100 } as any)).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('deleteItem', () => {
    it('调用 service.softDelete 传入 id', async () => {
      service.softDelete.mockResolvedValue(undefined);
      await controller.deleteItem('inv-1');
      expect(service.softDelete).toHaveBeenCalledWith('inv-1');
    });
  });

  describe('findTransactions', () => {
    it('传 itemId 时调用 service.findTransactions 传入 itemId 和分页参数', async () => {
      const expected = [{ id: 't-1', type: 'IN', quantity: 10 }];
      service.findTransactions.mockResolvedValue(expected);

      const result = await controller.findTransactions('inv-1', '1', '20');
      expect(result).toEqual(expected);
      expect(service.findTransactions).toHaveBeenCalledWith('inv-1', { limit: 20, offset: 0 });
    });

    it('未传 itemId 时调用 service.findTransactions 传入 undefined 和默认分页', async () => {
      service.findTransactions.mockResolvedValue([]);
      await controller.findTransactions();
      expect(service.findTransactions).toHaveBeenCalledWith(undefined, { limit: 50, offset: 0 });
    });
  });

  describe('stockAction', () => {
    it('调用 service.stockAction 传入 dto 和操作者信息', async () => {
      const dto = { itemId: 'inv-1', type: 'IN', quantity: 10, unitPrice: 50 };
      service.stockAction.mockResolvedValue({ id: 't-1', stock: 110 });

      const result = await controller.stockAction(dto as any, { user: { id: 'u-1', name: '管理员' } } as any);
      expect(result).toEqual({ id: 't-1', stock: 110 });
      expect(service.stockAction).toHaveBeenCalledWith({
        itemId: 'inv-1',
        type: 'IN',
        quantity: 10,
        unitPrice: 50,
        operatorId: 'u-1',
        operatorName: '管理员',
      });
    });

    it('quantity <= 0 时透传 BusinessValidationException', async () => {
      service.stockAction.mockRejectedValue(new BusinessValidationException('数量必须大于0'));
      await expect(controller.stockAction({ itemId: 'inv-1', type: 'IN', quantity: 0 } as any, {} as any)).rejects.toThrow(BusinessValidationException);
    });

    it('req.user 为 undefined 时 operator 信息为 undefined', async () => {
      service.stockAction.mockResolvedValue({ id: 't-1', stock: 100 });
      await controller.stockAction({ itemId: 'inv-1', type: 'IN', quantity: 5 } as any, {} as any);
      expect(service.stockAction).toHaveBeenCalledWith(expect.objectContaining({
        operatorId: undefined,
        operatorName: undefined,
      }));
    });
  });
});
