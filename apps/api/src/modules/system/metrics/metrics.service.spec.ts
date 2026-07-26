import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    service.onModuleInit();
  });

  describe('incrementRequest', () => {
    it('应该增加 HTTP 请求计数', () => {
      service.incrementRequest('GET', '/api/v1/health', 200);
      const metrics = service.getMetrics();

      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('path="/api/v1/health"');
      expect(metrics).toContain('status_code="200"');
    });

    it('应该按不同标签分别计数', () => {
      service.incrementRequest('GET', '/api/v1/health', 200);
      service.incrementRequest('GET', '/api/v1/health', 200);
      service.incrementRequest('POST', '/api/v1/patients', 201);

      const metrics = service.getMetrics();
      expect(metrics).toContain('http_requests_total');
    });

    it('应该规范化路径中的动态参数', () => {
      service.incrementRequest('GET', '/api/v1/patients/123e4567-e89b-12d3-a456-426614174000', 200);
      const metrics = service.getMetrics();

      expect(metrics).toContain('path="/api/v1/patients/{id}"');
    });

    it('应该规范化纯数字路径参数', () => {
      service.incrementRequest('GET', '/api/v1/patients/123', 200);
      const metrics = service.getMetrics();

      expect(metrics).toContain('path="/api/v1/patients/{id}"');
    });
  });

  describe('observeRequestDuration', () => {
    it('应该记录请求持续时间', () => {
      service.observeRequestDuration('GET', '/api/v1/health', 50);
      const metrics = service.getMetrics();

      expect(metrics).toContain('http_request_duration_ms');
      expect(metrics).toContain('http_request_duration_ms_sum');
      expect(metrics).toContain('http_request_duration_ms_count');
      expect(metrics).toContain('http_request_duration_ms_bucket');
    });

    it('应该正确累加持续时间和计数', () => {
      service.observeRequestDuration('GET', '/api/v1/health', 10);
      service.observeRequestDuration('GET', '/api/v1/health', 20);
      service.observeRequestDuration('GET', '/api/v1/health', 30);

      const metrics = service.getMetrics();
      expect(metrics).toContain('http_request_duration_ms_count{method="GET",path="/api/v1/health"} 3');
      expect(metrics).toContain('http_request_duration_ms_sum{method="GET",path="/api/v1/health"} 60');
    });
  });

  describe('活跃请求计数', () => {
    it('应该正确增减活跃请求数', () => {
      service.incrementActiveRequests();
      service.incrementActiveRequests();
      let metrics = service.getMetrics();
      expect(metrics).toContain('http_active_requests 2');

      service.decrementActiveRequests();
      metrics = service.getMetrics();
      expect(metrics).toContain('http_active_requests 1');
    });

    it('活跃请求数不应该小于 0', () => {
      service.decrementActiveRequests();
      service.decrementActiveRequests();
      const metrics = service.getMetrics();
      expect(metrics).toContain('http_active_requests 0');
    });
  });

  describe('数据库指标', () => {
    it('应该增加数据库查询计数', () => {
      service.incrementDbQuery('SELECT');
      service.incrementDbQuery('INSERT');
      service.incrementDbQuery('SELECT');

      const metrics = service.getMetrics();
      expect(metrics).toContain('db_queries_total');
      expect(metrics).toContain('operation="SELECT"');
      expect(metrics).toContain('operation="INSERT"');
    });
  });

  describe('业务指标', () => {
    it('应该设置业务指标值', () => {
      service.setBusinessMetrics(100, 50, 10000);
      const metrics = service.getMetrics();

      expect(metrics).toContain('business_patients_total 100');
      expect(metrics).toContain('business_appointments_total 50');
      expect(metrics).toContain('business_revenue_total_cents 10000');
    });
  });

  describe('系统指标', () => {
    it('应该包含内存使用指标', () => {
      const metrics = service.getMetrics();

      expect(metrics).toContain('nodejs_heap_used_bytes');
      expect(metrics).toContain('nodejs_heap_total_bytes');
      expect(metrics).toContain('nodejs_rss_bytes');
      expect(metrics).toContain('nodejs_external_bytes');
    });

    it('应该包含事件循环延迟指标', () => {
      const metrics = service.getMetrics();
      expect(metrics).toContain('nodejs_event_loop_delay_ms');
    });
  });

  describe('getMetrics', () => {
    it('应该返回 Prometheus 格式的指标', () => {
      service.incrementRequest('GET', '/health', 200);
      const metrics = service.getMetrics();

      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
      expect(metrics).toContain('counter');
      expect(metrics).toContain('gauge');
      expect(metrics).toContain('histogram');
    });

    it('应该包含正确的 HELP 和 TYPE 注释', () => {
      const metrics = service.getMetrics();

      expect(metrics).toContain('# HELP http_requests_total Total HTTP requests');
      expect(metrics).toContain('# TYPE http_requests_total counter');
    });
  });

  describe('resetMetrics', () => {
    it('应该重置所有计数器和直方图', () => {
      service.incrementRequest('GET', '/health', 200);
      service.observeRequestDuration('GET', '/health', 50);
      service.incrementActiveRequests();

      service.resetMetrics();
      const metrics = service.getMetrics();

      expect(metrics).not.toContain('http_requests_total{');
      expect(metrics).not.toContain('http_request_duration_ms_count{');
      expect(metrics).toContain('http_active_requests 0');
    });
  });

  describe('Prometheus 格式验证', () => {
    it('直方图应该包含 +Inf bucket', () => {
      service.observeRequestDuration('GET', '/health', 99999);
      const metrics = service.getMetrics();

      expect(metrics).toContain('le="+Inf"');
    });

    it('计数器值应该为数字', () => {
      service.incrementRequest('GET', '/health', 200);
      const metrics = service.getMetrics();

      const match = metrics.match(/http_requests_total{.*?} (\d+)/);
      expect(match).toBeTruthy();
      expect(Number(match?.[1])).toBeGreaterThan(0);
    });
  });
});
