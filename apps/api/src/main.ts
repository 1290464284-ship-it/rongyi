import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import { json, urlencoded } from 'express';
import cookieParser = require('cookie-parser');
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
  const dbService = app.get(DbService);
  try {
    runEncryptionMigration(dbService, config.get<string>('LEGACY_ENCRYPTION_KEY'));
  } catch (err: unknown) {
    loggerService.warn('Encryption migration skipped or failed: ' + (err instanceof Error ? err.message : String(err)));
  }

  // 1.3: JWT 校验逻辑集中到 ConfigValidationService
  const configValidation = app.get(ConfigValidationService);
  configValidation.validateJwtSecretOrExit();
  configValidation.validateEncryptionKeyOrExit();

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

  // Swagger 文档（仅在非生产环境启用）
  if (config.get('NODE_ENV') !== 'production') {
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
