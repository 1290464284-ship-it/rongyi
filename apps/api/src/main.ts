import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import { json, urlencoded } from 'express';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TraceMiddleware } from './common/middleware/trace.middleware';
import { AppLogger } from './common/services/logger.service';

const WEAK_SECRETS = ['your-secret-key-here', 'secret', 'jwt-secret', 'change-me', ''];

function validateJwtSecret(secret: string | undefined): void {
  if (!secret || WEAK_SECRETS.includes(secret)) {
    console.error('\n========================================');
    console.error('严重安全错误: JWT_SECRET 未配置或使用了默认弱值！');
    console.error('请在 .env 文件中设置一个至少32位的随机字符串。');
    console.error('生成方式: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('========================================\n');
    process.exit(1);
  }
  if (secret.length < 16) {
    console.warn('\n警告: JWT_SECRET 长度不足16位，建议使用更长的随机字符串。\n');
  }
}

async function bootstrap() {
  // initDb() 和 seedDb() 已在 DbService.onModuleInit() 中调用，无需重复

  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = app.get(AppLogger);

  app.useLogger(logger);

  validateJwtSecret(config.get<string>('JWT_SECRET'));

  // P1 修复：原代码创建了两个 TraceMiddleware 实例，应共用一个
  const traceMiddleware = new TraceMiddleware();
  app.use(traceMiddleware.use.bind(traceMiddleware));

  // P1 修复（限流在反向代理后失效）：信任反向代理以正确读取真实客户端 IP
  if (config.get('TRUST_PROXY') === '1') {
    // INestApplication 没有 .set()，需通过 HttpAdapter 取底层 Express 实例
    const expressInstance = app.getHttpAdapter().getInstance() as import('express').Express;
    expressInstance.set('trust proxy', 1);
  }

  app.use(helmet.default({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Cookie parser for httpOnly cookie-based authentication
  app.use(cookieParser());

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  // P1 修复（CORS 生产环境默认回退到开发值）：生产环境必须显式配置 CORS_ORIGIN
  const corsOriginEnv = config.get<string>('CORS_ORIGIN');
  let corsOrigin: string[];
  if (corsOriginEnv) {
    corsOrigin = corsOriginEnv.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (config.get('NODE_ENV') === 'production') {
    console.error('\n========================================');
    console.error('严重安全错误: 生产环境未配置 CORS_ORIGIN！');
    console.error('请在 .env 文件中设置 CORS_ORIGIN 为允许的前端域名（逗号分隔）。');
    console.error('========================================\n');
    process.exit(1);
  } else {
    corsOrigin = ['http://localhost:5173', 'http://localhost:3000'];
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
      .setDescription('Dental Clinic Management System - RESTful API 文档')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'JWT', in: 'header' },
        'JWT-auth',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.get('PORT', 3001));
}
bootstrap();
