import { DictionaryCacheService } from './dictionary-cache.service';
import { CacheService } from './cache.service';

describe('DictionaryCacheService', () => {
  let dictCache: DictionaryCacheService;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      delPattern: jest.fn(),
    } as any;
    dictCache = new DictionaryCacheService(cache as unknown as CacheService);
  });

  describe('buildClinicKey', () => {
    it('应拼接 key:clinicId', () => {
      expect(dictCache.buildClinicKey('clinic-1', 'dept')).toBe('dept:clinic-1');
    });
  });

  describe('departments', () => {
    it('getDepartments 应从缓存获取', async () => {
      cache.get.mockResolvedValue([{ id: '1', name: '内科' }]);
      const result = await dictCache.getDepartments('clinic-1');
      expect(cache.get).toHaveBeenCalled();
      expect(result).toEqual([{ id: '1', name: '内科' }]);
    });

    it('setDepartments 应设置缓存', () => {
      const items = [{ id: '1', name: '内科' }];
      dictCache.setDepartments('clinic-1', items);
      expect(cache.set).toHaveBeenCalled();
    });

    it('invalidateDepartments 指定 clinicId 时应 del', () => {
      dictCache.invalidateDepartments('clinic-1');
      expect(cache.del).toHaveBeenCalled();
    });

    it('invalidateDepartments 未指定 clinicId 时应 delPattern', () => {
      dictCache.invalidateDepartments();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('titles', () => {
    it('getTitles 应从缓存获取', async () => {
      cache.get.mockResolvedValue([{ id: '1', name: '主任医师' }]);
      const result = await dictCache.getTitles('clinic-1');
      expect(result).toEqual([{ id: '1', name: '主任医师' }]);
    });

    it('setTitles 应设置缓存', () => {
      dictCache.setTitles('clinic-1', [{ id: '1', name: '主任医师' }]);
      expect(cache.set).toHaveBeenCalled();
    });

    it('invalidateTitles 指定 clinicId 时应 del', () => {
      dictCache.invalidateTitles('clinic-1');
      expect(cache.del).toHaveBeenCalled();
    });

    it('invalidateTitles 未指定 clinicId 时应 delPattern', () => {
      dictCache.invalidateTitles();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('drugCatalog', () => {
    it('getDrugCatalog 应从缓存获取', async () => {
      cache.get.mockResolvedValue([{ id: '1', name: '阿莫西林' }]);
      const result = await dictCache.getDrugCatalog('clinic-1');
      expect(result).toEqual([{ id: '1', name: '阿莫西林' }]);
    });

    it('setDrugCatalog 应设置缓存', () => {
      dictCache.setDrugCatalog('clinic-1', [{ id: '1', name: '阿莫西林' }]);
      expect(cache.set).toHaveBeenCalled();
    });

    it('invalidateDrugCatalog 指定 clinicId 时应 del', () => {
      dictCache.invalidateDrugCatalog('clinic-1');
      expect(cache.del).toHaveBeenCalled();
    });

    it('invalidateDrugCatalog 未指定 clinicId 时应 delPattern', () => {
      dictCache.invalidateDrugCatalog();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('paymentMethods', () => {
    it('getPaymentMethods 应从缓存获取', async () => {
      cache.get.mockResolvedValue([{ id: '1', name: '现金' }]);
      const result = await dictCache.getPaymentMethods('clinic-1');
      expect(result).toEqual([{ id: '1', name: '现金' }]);
    });

    it('setPaymentMethods 应设置缓存', () => {
      dictCache.setPaymentMethods('clinic-1', [{ id: '1', name: '现金' }]);
      expect(cache.set).toHaveBeenCalled();
    });

    it('invalidatePaymentMethods 指定 clinicId 时应 del', () => {
      dictCache.invalidatePaymentMethods('clinic-1');
      expect(cache.del).toHaveBeenCalled();
    });

    it('invalidatePaymentMethods 未指定 clinicId 时应 delPattern', () => {
      dictCache.invalidatePaymentMethods();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('memberCardTypes', () => {
    it('getMemberCardTypes 应从缓存获取', async () => {
      cache.get.mockResolvedValue([{ id: '1', name: '金卡' }]);
      const result = await dictCache.getMemberCardTypes('clinic-1');
      expect(result).toEqual([{ id: '1', name: '金卡' }]);
    });

    it('setMemberCardTypes 应设置缓存', () => {
      dictCache.setMemberCardTypes('clinic-1', [{ id: '1', name: '金卡' }]);
      expect(cache.set).toHaveBeenCalled();
    });

    it('invalidateMemberCardTypes 指定 clinicId 时应 del', () => {
      dictCache.invalidateMemberCardTypes('clinic-1');
      expect(cache.del).toHaveBeenCalled();
    });

    it('invalidateMemberCardTypes 未指定 clinicId 时应 delPattern', () => {
      dictCache.invalidateMemberCardTypes();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('invalidateAllDictionaryCache', () => {
    it('指定 clinicId 时应清除所有类型缓存', () => {
      dictCache.invalidateAllDictionaryCache('clinic-1');
      expect(cache.del).toHaveBeenCalledTimes(5);
    });

    it('未指定 clinicId 时应清除所有模式缓存', () => {
      dictCache.invalidateAllDictionaryCache();
      expect(cache.delPattern).toHaveBeenCalledTimes(5);
    });
  });
});
