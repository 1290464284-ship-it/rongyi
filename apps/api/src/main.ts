import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import { json, urlencoded } from 'express';
import cookieParser = require('cookie-parser');
import * as jwt from 'jsonwebtoken';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TraceMiddleware } from './common/middleware/trace.middleware';
import { RequestTimeoutMiddleware } from './common/middleware/request-timeout.middleware';
import { SqlInjectionMiddleware } from './common/middleware/sql-injection.middleware';
import { AppLogger, shutdownLogger } from './common/services/logger.service';
import { ConfigValidationService } from './common/services/config-validation.service';
import { SentryService } from './common/monitoring/sentry.service';
import {
  DEFAULT_API_PORT,
  DEFAULT_CORS_ORIGINS,
} from './config/constants';
import { DbService } from './db/db.service';
import { runEncryptionMigration } from './bootstrap/encryption-migration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = app.get(AppLogger);
  const loggerService = new Logger('Bootstrap');
  const sentryService = app.get(SentryService);

  app.useLogger(logger);

  // 全局未捕获异常兜底（放在最前面，确保启动阶段也能捕获）
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Promise Rejection', reason instanceof Error ? reason.stack : String(reason), 'Process');
    if (sentryService.isEnabled()) {
      sentryService.captureException(reason, { type: 'unhandledRejection' });
    }
    // 不直接退出，给日志刷盘留时间；但若频繁发生，5s 后强制退出
    setTimeout(() => process.exit(1), 5000).unref();
  });
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught Exception', err.stack, 'Process');
    if (sentryService.isEnabled()) {
      sentryService.captureException(err, { type: 'uncaughtException' });
    }
    setTimeout(() => process.exit(1), 5000).unref();
  });

  // 在 DbService 初始化完成后执行加密数据迁移
  // P1 修复：原先用 warn 静默吞没所有异常，跳过与失败不可区分；
  // 现在区分三种状态：skipped（无需迁移）/ partial-failure（部分行失败）/ thrown-error（意外异常）
  const dbService = app.get(DbService);
  try {
    const migrationResult = runEncryptionMigration(dbService, config.get<string>('LEGACY_ENCRYPTION_KEY'));
    if (migrationResult.skipped) {
      loggerService.log('加密数据迁移：未配置 LEGACY_ENCRYPTION_KEY，跳过迁移');
    } else if (migrationResult.errors > 0) {
      // 部分行失败：数据可能处于混合状态（部分已重新加密，部分仍用旧密钥）
      // 不阻止启动（避免锁死运维），但必须 error 级别告警 + Sentry 上报
      const msg = `加密数据迁移部分失败: ${migrationResult.errors} 条记录无法重新加密，可能仍使用旧密钥。请检查日志并手动处理。`;
      loggerService.error(msg);
      if (sentryService.isEnabled()) {
        sentryService.captureException(new Error(msg), { type: 'encryption_migration_partial_failure', extra: { migrated: migrationResult.migrated, errors: migrationResult.errors } });
      }
    } else if (migrationResult.migrated > 0) {
      loggerService.log(`加密数据迁移完成: ${migrationResult.migrated} 条记录已重新加密`);
    }
  } catch (err: unknown) {
    // 意外异常（如 DB 连接问题）：迁移可能中途崩溃，数据状态未知
    // 必须 error 级别告警 + Sentry 上报，但不阻止启动以便运维排查
    const errMsg = '加密数据迁移发生意外异常: ' + (err instanceof Error ? err.message : String(err));
    loggerService.error(errMsg, err instanceof Error ? err.stack : undefined);
    if (sentryService.isEnabled()) {
      sentryService.captureException(err, { type: 'encryption_migration_fatal' });
    }
  }

  // 1.3: JWT 校验逻辑集中到 ConfigValidationService
  const configValidation = app.get(ConfigValidationService);
  configValidation.validateJwtSecretOrExit();
  configValidation.validateEncryptionKeyOrExit();
  configValidation.validateAdminInitialPasswordOrExit();

  const traceMiddleware = new TraceMiddleware();
  app.use(traceMiddleware.use.bind(traceMiddleware));

  // P1 修复（限流在反向代理后失效）：信任反向代理以正确读取真实客户端 IP
  if (config.get('TRUST_PROXY') === '1') {
    // INestApplication 没有 .set()，需通过 HttpAdapter 取底层 Express 实例
    const expressInstance = app.getHttpAdapter().getInstance() as import('express').Express;
    expressInstance.set('trust proxy', 1);
  }

  const isProduction = config.get('NODE_ENV') === 'production';

  app.use(helmet.default({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xContentTypeOptions: true,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    xFrameOptions: {
      action: 'deny',
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: {
      policy: 'same-origin',
    },
    crossOriginResourcePolicy: {
      policy: 'same-origin',
    },
    xDnsPrefetchControl: {
      allow: false,
    },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: {
      permittedPolicies: 'none',
    },
  }));

  const requestTimeoutMiddleware = new RequestTimeoutMiddleware();
  app.use(requestTimeoutMiddleware.use.bind(requestTimeoutMiddleware));

  // Cookie parser for httpOnly cookie-based authentication
  app.use(cookieParser());

  // 差异化请求体大小限制：先注册特定路由，再注册全局默认
  // 1. 认证等简单接口限制 1mb
  app.use('/api/v1/auth/login', json({ limit: '1mb' }));
  app.use('/api/v1/auth/refresh', json({ limit: '1mb' }));
  // 2. 批量同步/大数据接口限制 50mb
  app.use('/api/v1/sync/push', json({ limit: '50mb' }));
  // 3. 全局默认 10mb
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  const sqlInjectionMiddleware = new SqlInjectionMiddleware();
  app.use(sqlInjectionMiddleware.use.bind(sqlInjectionMiddleware));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(logger, sentryService));
  // P1 修复（CORS 生产环境默认回退到开发值）：生产环境必须显式配置 CORS_ORIGIN
  const corsOriginEnv = config.get<string>('CORS_ORIGIN');
  let corsOrigin: string[];
  if (corsOriginEnv) {
    corsOrigin = corsOriginEnv.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (config.get('NODE_ENV') === 'production') {
    const corsMsg = [
      '========================================',
      '严重安全错误: 生产环境未配置 CORS_ORIGIN！',
      '请在 .env 文件中设置 CORS_ORIGIN 为允许的前端域名（逗号分隔）。',
      '========================================',
    ].join('\n');
    // P1-4: 启动前校验同时输出到 console 和 logger
    console.error('\n' + corsMsg + '\n');
    logger.error(corsMsg);
    process.exit(1);
  } else {
    corsOrigin = [...DEFAULT_CORS_ORIGINS];
  }
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.setGlobalPrefix('');
  // API 版本控制
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  });

  // Swagger 文档访问控制
  // 生产环境默认禁用，需显式设置 SWAGGER_ENABLED=1 或 true
  // 开发/测试环境默认启用，可设置 SWAGGER_ENABLED=0 或 false 关闭
  const swaggerEnabledRaw = config.get<string>('SWAGGER_ENABLED');
  const swaggerExplicitlyEnabled = swaggerEnabledRaw === '1' || swaggerEnabledRaw === 'true';
  const swaggerExplicitlyDisabled = swaggerEnabledRaw === '0' || swaggerEnabledRaw === 'false';
  const swaggerEnabled = isProduction ? swaggerExplicitlyEnabled : !swaggerExplicitlyDisabled;

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('牙科诊所管理系统 API')
      .setDescription(
        '牙科诊所管理系统（Dental Clinic Management System）RESTful API 文档。\n\n' +
        '## 功能模块\n\n' +
        '- **认证管理** - 用户登录、注册、密码修改\n' +
        '- **患者管理** - 患者信息、口腔检查、病历记录\n' +
        '- **临床管理** - 初诊、就诊、治疗计划、牙周记录\n' +
        '- **预约排班** - 预约管理、牙椅管理\n' +
        '- **收费财务** - 收费、退费、会员卡、支付方式\n' +
        '- **库存管理** - 库存、采购订单、加工单、供应商\n' +
        '- **内容管理** - 处方、影像、药品目录、牙位记录\n' +
        '- **通讯管理** - 微信消息、随访管理\n' +
        '- **设备管理** - 设备信息管理\n' +
        '- **系统管理** - 诊所设置、操作日志、健康检查、统计数据、全局搜索\n\n' +
        '## 认证方式\n\n' +
        '使用 JWT Bearer Token 进行身份验证。登录后将返回的 accessToken 添加到请求头中：\n' +
        '`Authorization: Bearer <accessToken>`',
      )
      .setVersion('1.0.0')
      .setContact('开发团队', '', 'dev@dental-clinic.local')
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'JWT', in: 'header' },
        'JWT-auth',
      )
      .addTag('认证', '用户认证与授权相关接口')
      .addTag('患者', '患者信息管理相关接口')
      .addTag('临床', '临床业务相关接口')
      .addTag('预约', '预约排班相关接口')
      .addTag('财务', '收费与财务相关接口')
      .addTag('库存', '库存管理相关接口')
      .addTag('内容', '内容管理相关接口')
      .addTag('通讯', '消息通讯相关接口')
      .addTag('设备', '设备管理相关接口')
      .addTag('系统', '系统管理相关接口')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // 非开发环境对 Swagger 文档启用 Basic Auth + JWT 角色保护（仅管理员可访问）
    const isDevelopment = config.get('NODE_ENV') === 'development';
    if (!isDevelopment) {
      const swaggerUsername = config.get<string>('SWAGGER_USERNAME') || 'admin';
      const swaggerPassword = config.get<string>('SWAGGER_PASSWORD');
      if (!swaggerPassword) {
        logger.warn('Swagger 已启用但未配置 SWAGGER_PASSWORD，建议立即设置以避免未授权访问');
      }
      const expectedCredentials = Buffer.from(`${swaggerUsername}:${swaggerPassword || ''}`).toString('base64');
      const swaggerAuth = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
        // 1. Basic Auth 验证
        const authHeader = req.headers.authorization || '';
        const [type, credentials] = authHeader.split(' ');
        if (type !== 'Basic' || !credentials || credentials !== expectedCredentials) {
          res.set('WWW-Authenticate', 'Basic realm="Swagger API Docs"');
          return res.status(401).send('Unauthorized');
        }

        // 2. JWT 角色验证：仅 BOSS 或 ADMIN 可访问
        const token = req.cookies?.access_token || authHeader.replace('Bearer ', '');
        if (!token) {
          return res.status(401).send('需要登录后访问 Swagger 文档');
        }
        try {
          const payload = jwt.verify(token, config.get<string>('JWT_SECRET') || '') as { role?: string };
          const allowedRoles = ['BOSS', 'ADMIN'];
          if (!allowedRoles.includes(payload.role || '')) {
            return res.status(403).send('仅管理员角色可访问 Swagger 文档');
          }
          next();
        } catch {
          return res.status(401).send('登录已过期，请重新登录');
        }
      };
      const expressInstance = app.getHttpAdapter().getInstance() as import('express').Express;
      expressInstance.use('/api/docs', swaggerAuth);
      expressInstance.use('/api/docs-json', swaggerAuth);
    }

    SwaggerModule.setup('api/docs', app, document);
  }

  // 优雅关闭处理
  const shutdown = async (signal: string) => {
    loggerService.log(`接收到 ${signal} 信号，开始优雅关闭...`);
    try {
      await app.close();
      loggerService.log('应用已关闭');
    } catch (err: unknown) {
      loggerService.error('关闭过程中出错', err instanceof Error ? err.stack : String(err));
    } finally {
      shutdownLogger();
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen(config.get('PORT', DEFAULT_API_PORT));
  loggerService.log(`应用已启动，监听端口 ${config.get('PORT', DEFAULT_API_PORT)}`);
}
bootstrap().catch(err => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
