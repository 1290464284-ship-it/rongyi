import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  let controller: SearchController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: service }],
    }).compile();

    controller = module.get(SearchController);
  });

  describe('search', () => {
    it('关键字为空时返回空数组，不调用 service', () => {
      const result = controller.search('');
      expect(result).toEqual([]);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('关键字为空白时返回空数组，不调用 service', () => {
      const result = controller.search('   ');
      expect(result).toEqual([]);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('关键字长度小于 2 时返回空数组，不调用 service', () => {
      const result = controller.search('a');
      expect(result).toEqual([]);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('关键字长度为 1 且带空格 trim 后小于 2 时返回空数组', () => {
      const result = controller.search(' a ');
      expect(result).toEqual([]);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('关键字有效时调用 service.search 并传入 trim 后的关键字', async () => {
      const expected = { patients: [], appointments: [], total: 0 };
      service.search.mockResolvedValue(expected);

      const result = await controller.search('  张三  ');
      expect(result).toEqual(expected);
      expect(service.search).toHaveBeenCalledWith('张三');
    });

    it('关键字长度 >= 2 时正常调用 service', async () => {
      const expected = { patients: [{ id: 'p-1', name: '张三' }], appointments: [], total: 1 };
      service.search.mockResolvedValue(expected);

      const result = await controller.search('张三');
      expect(result).toEqual(expected);
      expect(service.search).toHaveBeenCalledWith('张三');
    });
  });
});
