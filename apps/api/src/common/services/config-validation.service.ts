import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ConfigValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

const WEAK_SECRETS = [
  'your-secret-key-here',
  'secret',
  'jwt-secret',
  'change-me',
  'password',
  'password123',
  'admin',
  'admin123',
  '123456',
  '12345678',
  'qwerty',
  'abc123',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'login',
  'princess',
  'sunshine',
  '',
];

function isAllSameChar(str: string): boolean {
  if (str.length === 0) return true;
  const first = str[0];
  for (let i = 1; i < str.length; i++) {
    if (str[i] !== first) return false;
  }
  return true;
}

function hasCharDiversity(str: string, minLenForRelax: number = 48): boolean {
  if (str.length >= minLenForRelax) return true;
  const hasLetter = /[a-zA-Z]/.test(str);
  const hasDigit = /\d/.test(str);
  return hasLetter && hasDigit;
}

function isSequential(str: string): boolean {
  if (str.length < 6) return false;
  const lower = str.toLowerCase();
  const sequences = [
    '0123456789',
    '9876543210',
    'abcdefghijklmnopqrstuvwxyz',
    'zyxwvutsrqponmlkjihgfedcba',
  ];
  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - lower.length; i++) {
      if (seq.substring(i, i + lower.length) === lower) return true;
    }
  }
  return false;
}

@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

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

  /**
   * 启动时强制校验 JWT 密钥，失败则直接退出进程
   * 用于 main.ts 中在 NestFactory 创建后、app.listen 前调用
   */
  validateJwtSecretOrExit(): void {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret || WEAK_SECRETS.includes(secret.toLowerCase())) {
      const msg = [
        '========================================',
        '严重安全错误: JWT_SECRET 未配置或使用了默认弱值！',
        '请在 .env 文件中设置一个至少32位的随机字符串。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (secret.length < 32) {
      const msg = [
        '========================================',
        `严重安全错误: JWT_SECRET 长度不足32位（当前 ${secret.length} 位）！`,
        'HMAC-SHA256 密钥建议至少 32 字符以抵抗暴力破解。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (isAllSameChar(secret)) {
      const msg = [
        '========================================',
        '严重安全错误: JWT_SECRET 强度不足！',
        '密钥全部由相同字符组成，极易被暴力破解。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (isSequential(secret)) {
      const msg = [
        '========================================',
        '严重安全错误: JWT_SECRET 强度不足！',
        '密钥为顺序字符（如 123456、abcdef），极易被暴力破解。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (!hasCharDiversity(secret, 48)) {
      const msg = [
        '========================================',
        '严重安全错误: JWT_SECRET 字符多样性不足！',
        '长度小于 48 位时，密钥必须同时包含字母和数字。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
  }

  validateAllOrExit(): void {
    this.validateJwtSecretOrExit();
    this.validateEncryptionKeyOrExit();
  }

  validateEncryptionKeyOrExit(): void {
    const key = this.configService.get<string>('ENCRYPTION_KEY');
    if (!key) {
      const msg = [
        '========================================',
        '严重安全错误: ENCRYPTION_KEY 未配置！',
        '此密钥用于加密敏感数据和备份文件，丢失将导致数据永久不可解密。',
        '请在 .env 文件中设置一个64位的十六进制随机字符串。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      const msg = [
        '========================================',
        `严重安全错误: ENCRYPTION_KEY 格式不正确！`,
        '必须是 64 位十六进制字符串（对应 AES-256 密钥的 32 字节）。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (isAllSameChar(key)) {
      const msg = [
        '========================================',
        '严重安全错误: ENCRYPTION_KEY 强度不足！',
        '密钥全部由相同字符组成，极易被暴力破解。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
    if (isSequential(key)) {
      const msg = [
        '========================================',
        '严重安全错误: ENCRYPTION_KEY 强度不足！',
        '密钥为顺序字符（如 012345、abcdef），极易被暴力破解。',
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        '========================================',
      ].join('\n');
      console.error('\n' + msg + '\n');
      this.logger.error(msg);
      process.exit(1);
    }
  }

  validate(): ConfigValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      errors.push('JWT_SECRET 未设置');
    } else if (WEAK_SECRETS.includes(jwtSecret.toLowerCase())) {
      errors.push('JWT_SECRET 使用了默认弱值，请更换为随机字符串');
    } else if (jwtSecret.length < 32 && process.env.NODE_ENV === 'production') {
      warnings.push('JWT_SECRET 长度不足 32 字符，生产环境建议使用更长的密钥');
    } else if (isAllSameChar(jwtSecret)) {
      errors.push('JWT_SECRET 强度不足：全部由相同字符组成');
    } else if (isSequential(jwtSecret)) {
      errors.push('JWT_SECRET 强度不足：为顺序字符（如 123456、abcdef）');
    } else if (!hasCharDiversity(jwtSecret, 48)) {
      errors.push('JWT_SECRET 字符多样性不足：长度小于 48 位时必须同时包含字母和数字');
    }

    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey) {
      if (process.env.NODE_ENV === 'production') {
        errors.push('ENCRYPTION_KEY 未设置（生产环境必填）');
      }
    } else if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
      errors.push('ENCRYPTION_KEY 格式不正确，必须是 64 位十六进制字符串');
    } else if (isAllSameChar(encryptionKey)) {
      errors.push('ENCRYPTION_KEY 强度不足：全部由相同字符组成');
    } else if (isSequential(encryptionKey)) {
      errors.push('ENCRYPTION_KEY 强度不足：为顺序字符（如 012345、abcdef）');
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
