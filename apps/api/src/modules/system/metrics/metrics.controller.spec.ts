import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  let metricsService: MetricsService;

  const createMockResponse = () => {
    let sentBody: unknown;
    const headers: Record<string, string> = {};
    return {
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      send: jest.fn((body: unknown) => {
        sentBody = body;
      }),
      getSentBody: () => sentBody,
      getHeaders: () => headers,
    };
  };

  beforeEach(() => {
    metricsService = new MetricsService();
    metricsService.onModuleInit();
    controller = new MetricsController(metricsService);
  });

  describe('getMetrics', () => {
    it('应该返回 Prometheus 格式的指标', () => {
      const mockResponse = createMockResponse();

      controller.getMetrics(mockResponse as any);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(mockResponse.send).toHaveBeenCalled();
      const sentMetrics = mockResponse.getSentBody() as string;
      expect(typeof sentMetrics).toBe('string');
      expect(sentMetrics).toContain('# HELP');
      expect(sentMetrics).toContain('# TYPE');
    });

    it('应该包含系统指标', () => {
      const mockResponse = createMockResponse();

      controller.getMetrics(mockResponse as any);

      const sentMetrics = mockResponse.getSentBody() as string;
      expect(sentMetrics).toContain('nodejs_heap_used_bytes');
      expect(sentMetrics).toContain('nodejs_heap_total_bytes');
      expect(sentMetrics).toContain('nodejs_rss_bytes');
      expect(sentMetrics).toContain('http_active_requests');
    });
  });

  describe('resetMetrics', () => {
    it('应该调用 metricsService.resetMetrics', () => {
      const resetSpy = jest.spyOn(metricsService, 'resetMetrics');
      const result = controller.resetMetrics();

      expect(resetSpy).toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: '指标已重置' });
    });

    it('重置后指标应该被清空', () => {
      metricsService.incrementRequest('GET', '/health', 200);

      controller.resetMetrics();

      const mockResponse = createMockResponse();

      controller.getMetrics(mockResponse as any);
      const sentMetrics = mockResponse.getSentBody() as string;
      expect(sentMetrics).not.toContain('http_requests_total{');
    });
  });
});
