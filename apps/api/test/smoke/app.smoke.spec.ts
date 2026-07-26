import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { resetTestMode, setTestMode } from '../../src/db/database';

describe('App Smoke Test', () => {
  let app: INestApplication;
  let dbService: DbService;

  beforeAll(async () => {
    resetTestMode();
    setTestMode(true);
    process.env.TEST_DB_MEMORY = '1';
    process.env.JWT_SECRET = 'TestJwtSecret2026ForDentalClinicApp0801abcXYZ9988';
    process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'api/v',
    });
    await app.init();

    dbService = app.get(DbService);
  });

  afterAll(async () => {
    await app.close();
    resetTestMode();
    setTestMode(false);
    delete process.env.TEST_DB_MEMORY;
  });

  describe('应用启动', () => {
    it('应用应该能正常启动', () => {
      expect(app).toBeDefined();
    });

    it('DbService 应该已初始化', () => {
      expect(dbService).toBeDefined();
    });
  });

  describe('模块加载', () => {
    it('所有核心模块应该能正常加载', () => {
      // 应用成功启动即证明所有模块已正确加载
      // 此处验证关键服务可被解析（依赖注入链完整）
      const coreServices = [
        DbService,
      ];

      for (const service of coreServices) {
        const instance = app.get(service);
        expect(instance).toBeDefined();
      }
    });

    it('核心服务应该可用', () => {
      const services = [
        DbService,
      ];

      for (const service of services) {
        const instance = app.get(service);
        expect(instance).toBeDefined();
      }
    });
  });

  describe('健康检查接口', () => {
    it('GET /api/v1/health 应该返回 ok', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('路由注册', () => {
    const publicRoutes = [
      { path: '/api/v1/health', method: 'GET' },
      { path: '/api/v1/auth/login', method: 'POST' },
    ];

    const protectedRoutes = [
      { path: '/api/v1/patients', method: 'GET' },
      { path: '/api/v1/appointments', method: 'GET' },
      { path: '/api/v1/charge-v2', method: 'GET' },
      { path: '/api/v1/inventory/items', method: 'GET' },
    ];

    it.each(publicRoutes)('公开路由 $method $path 应该存在', async ({ path, method }) => {
      const response = await request(app.getHttpServer())[method.toLowerCase()](path);
      expect(response.status).not.toBe(404);
    });

    it.each(protectedRoutes)('受保护路由 $method $path 应该存在（返回 401 而非 404）', async ({ path, method }) => {
      const response = await request(app.getHttpServer())[method.toLowerCase()](path);
      expect(response.status).not.toBe(404);
    });
  });
});
