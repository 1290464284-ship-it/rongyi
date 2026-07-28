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

  describe('路径规范化边界条件', () => {
    it('空路径应返回 /', () => {
      service.incrementRequest('GET', '', 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/"');
    });

    it('undefined 路径应返回 /', () => {
      service.incrementRequest('GET', undefined as unknown as string, 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/"');
    });

    it('应去除查询字符串参数', () => {
      service.incrementRequest('GET', '/api/v1/patients?page=1&limit=10', 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/api/v1/patients"');
      expect(metrics).not.toContain('?page=1');
    });

    it('应规范化多个路径参数', () => {
      service.incrementRequest('GET', '/api/v1/patients/123/appointments/456', 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/api/v1/patients/{id}/appointments/{id}"');
    });

    it('应规范化 UUID 路径参数', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      service.incrementRequest('GET', `/api/v1/patients/${uuid}`, 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/api/v1/patients/{id}"');
    });

    it('混合路径参数（UUID + 数字）应正确规范化', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      service.incrementRequest('GET', `/api/v1/doctors/${uuid}/patients/12345`, 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('path="/api/v1/doctors/{id}/patients/{id}"');
    });
  });

  describe('重复创建指标幂等性', () => {
    it('重复创建同名计数器不应重复添加', () => {
      const initialCount = service.getMetrics().split('\n').filter(l => l.includes('http_requests_total')).length;
      service.onModuleInit();
      service.onModuleInit();
      const finalCount = service.getMetrics().split('\n').filter(l => l.includes('http_requests_total')).length;
      expect(finalCount).toBe(initialCount);
    });

    it('重复创建同名直方图不应重复添加', () => {
      const initialCount = service.getMetrics().split('\n').filter(l => l.includes('http_request_duration_ms')).length;
      service.onModuleInit();
      const finalCount = service.getMetrics().split('\n').filter(l => l.includes('http_request_duration_ms')).length;
      expect(finalCount).toBe(initialCount);
    });

    it('重复创建同名仪表不应重复添加', () => {
      const initialCount = service.getMetrics().split('\n').filter(l => l.includes('http_active_requests')).length;
      service.onModuleInit();
      const finalCount = service.getMetrics().split('\n').filter(l => l.includes('http_active_requests')).length;
      expect(finalCount).toBe(initialCount);
    });
  });

  describe('非已注册指标的早期返回', () => {
    it('增加不存在的计数器应静默忽略', () => {
      expect(() => {
        (service as any).incrementCounter('nonexistent_counter', {})
      }).not.toThrow();
    });

    it('观察不存在的直方图应静默忽略', () => {
      expect(() => {
        (service as any).observeHistogram('nonexistent_histogram', {}, 100)
      }).not.toThrow();
    });

    it('设置不存在的仪表应静默忽略', () => {
      expect(() => {
        (service as any).setGauge('nonexistent_gauge', 42)
      }).not.toThrow();
    });
  });

  describe('仪表带标签输出', () => {
    it('仪表带标签时应在 getMetrics 中正确输出', () => {
      const svc = new MetricsService();
      (svc as any).createGauge('labeled_gauge', 'A gauge with labels', { env: 'prod' });
      (svc as any).setGauge('labeled_gauge', 99);
      const metrics = svc.getMetrics();
      expect(metrics).toContain('labeled_gauge{env="prod"} 99');
    });
  });

  describe('事件循环延迟监控', () => {
    it('onModuleInit 应启动事件循环监控', () => {
      const svc = new MetricsService();
      svc.onModuleInit();
      expect((svc as any).eventLoopDelayInterval).not.toBeNull();
      svc.onModuleDestroy();
    });

    it('onModuleDestroy 应停止事件循环监控', () => {
      const svc = new MetricsService();
      svc.onModuleInit();
      svc.onModuleDestroy();
      expect((svc as any).eventLoopDelayInterval).toBeNull();
    });

    it('重复调用 onModuleDestroy 不应出错', () => {
      const svc = new MetricsService();
      svc.onModuleDestroy();
      svc.onModuleDestroy();
      expect((svc as any).eventLoopDelayInterval).toBeNull();
    });
  });

  describe('直方图边界值', () => {
    it('值等于 bucket 边界应计入该 bucket', () => {
      service.observeRequestDuration('GET', '/test', 50);
      const metrics = service.getMetrics();
      expect(metrics).toContain('http_request_duration_ms_bucket{method="GET",path="/test",le="50"} 1');
    });

    it('值大于最大 bucket 应归入 +Inf', () => {
      service.observeRequestDuration('GET', '/test', 10001);
      const metrics = service.getMetrics();
      expect(metrics).toContain('http_request_duration_ms_bucket{method="GET",path="/test",le="+Inf"} 1');
    });

    it('值为 0 应计入所有 bucket', () => {
      service.observeRequestDuration('GET', '/test', 0);
      const metrics = service.getMetrics();
      expect(metrics).toContain('http_request_duration_ms_bucket{method="GET",path="/test",le="5"} 1');
    });
  });

  describe('collectSystemMetrics', () => {
    it('应收集内存指标并更新仪表值', () => {
      const svc = new MetricsService();
      svc.onModuleInit();
      svc.collectSystemMetrics();
      const metrics = svc.getMetrics();
      expect(metrics).toContain('nodejs_heap_used_bytes');
      expect(metrics).toContain('nodejs_heap_total_bytes');
      expect(metrics).toContain('nodejs_rss_bytes');
      expect(metrics).toContain('nodejs_external_bytes');
      svc.onModuleDestroy();
    });
  });

  describe('getMetrics 输出格式', () => {
    it('空指标系统应输出有效空格式', () => {
      const svc = new MetricsService();
      const metrics = svc.getMetrics();
      expect(typeof metrics).toBe('string');
    });

    it('每个指标块之间应有空行分隔', () => {
      service.incrementRequest('GET', '/test', 200);
      service.incrementDbQuery('SELECT');
      const metrics = service.getMetrics();
      const lines = metrics.split('\n');
      const blankLines = lines.filter(l => l === '').length;
      expect(blankLines).toBeGreaterThanOrEqual(2);
    });

    it('getMetrics 应包含 HTTP 方法大写转换', () => {
      service.incrementRequest('get', '/test', 200);
      const metrics = service.getMetrics();
      expect(metrics).toContain('method="GET"');
    });
  });
});
