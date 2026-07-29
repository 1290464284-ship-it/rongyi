import { CacheGroups, invalidateStatsCaches } from './cache-invalidation';

describe('cache-invalidation', () => {
  describe('CacheGroups', () => {
    it('应包含 financial 缓存组', () => {
      expect(CacheGroups.financial).toEqual([
        'dashboard', 'revenue', 'charge', 'doctorWorkload', 'revenueByDoctor', 'revenueByCategory',
      ]);
    });

    it('应包含 member 缓存组', () => {
      expect(CacheGroups.member).toEqual(['dashboard', 'member', 'revenue']);
    });

    it('应包含 appointment 缓存组', () => {
      expect(CacheGroups.appointment).toEqual(['dashboard', 'appointment', 'doctorWorkload']);
    });

    it('应包含 inventory 缓存组', () => {
      expect(CacheGroups.inventory).toEqual(['dashboard', 'inventory']);
    });

    it('应包含 patient 缓存组', () => {
      expect(CacheGroups.patient).toEqual(['dashboard', 'patient', 'patientGrowth']);
    });
  });

  describe('invalidateStatsCaches', () => {
    it('应批量调用 invalidateStatsCache', () => {
      const mockService = { invalidateStatsCache: jest.fn() };
      invalidateStatsCaches(mockService, ['dashboard', 'revenue', 'charge']);
      expect(mockService.invalidateStatsCache).toHaveBeenCalledTimes(3);
      expect(mockService.invalidateStatsCache).toHaveBeenNthCalledWith(1, 'dashboard');
      expect(mockService.invalidateStatsCache).toHaveBeenNthCalledWith(2, 'revenue');
      expect(mockService.invalidateStatsCache).toHaveBeenNthCalledWith(3, 'charge');
    });

    it('空数组时不调用', () => {
      const mockService = { invalidateStatsCache: jest.fn() };
      invalidateStatsCaches(mockService, []);
      expect(mockService.invalidateStatsCache).not.toHaveBeenCalled();
    });

    it('应支持 CacheGroups.financial', () => {
      const mockService = { invalidateStatsCache: jest.fn() };
      invalidateStatsCaches(mockService, CacheGroups.financial);
      expect(mockService.invalidateStatsCache).toHaveBeenCalledTimes(6);
    });
  });
});
