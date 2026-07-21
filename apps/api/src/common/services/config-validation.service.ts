import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ConfigValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger('ConfigValidation');

  constructor(private configService: ConfigService) {}

  onModuleInit(): void {
    const result = this.validate();
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => this.logger.warn(w));
    }
    if (result.errors.length > 0) {
      result.errors.forEach(e => this.logger.error(e));
      throw new Error('配置校验失败，请检查环境变量');
    }
    this.logger.log('配置校验通过');
  }

  validate(): ConfigValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      errors.push('JWT_SECRET 未设置');
    } else if (jwtSecret.length < 32 && process.env.NODE_ENV === 'production') {
      warnings.push('JWT_SECRET 长度不足 32 字符，生产环境建议使用更长的密钥');
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    if (!['development', 'production', 'test'].includes(nodeEnv)) {
      warnings.push(`NODE_ENV 为未知值: ${nodeEnv}`);
    }

    const port = this.configService.get<string>('PORT');
    if (port) {
      const portNum = Number(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push(`PORT 无效: ${port}`);
      }
    }

    const corsOrigin = this.configService.get<string>('CORS_ORIGIN');
    if (!corsOrigin && nodeEnv === 'production') {
      warnings.push('生产环境建议显式设置 CORS_ORIGIN，避免使用默认值');
    }

    const dataDir = this.configService.get<string>('DATA_DIR');
    const dbPath = this.configService.get<string>('DB_PATH');
    if (!dataDir && !dbPath && nodeEnv === 'production') {
      warnings.push('生产环境建议显式设置 DATA_DIR 或 DB_PATH');
    }

    return { valid: errors.length === 0, warnings, errors };
  }
}
