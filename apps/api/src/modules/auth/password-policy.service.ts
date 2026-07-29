import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

/**
 * 密码策略服务 - 负责密码哈希、验证和变更策略判断
 */
@Injectable()
export class PasswordPolicyService {
  constructor(private config: ConfigService) {}

  /** P2-1: bcrypt 轮数可配置化 */
  get bcryptRounds(): number {
    const rounds = this.config.get<string>('BCRYPT_ROUNDS');
    if (!rounds) return 10;
    const parsed = parseInt(rounds, 10);
    if (Number.isNaN(parsed)) return 10;
    return Math.max(8, Math.min(15, parsed));
  }

  /** 对明文密码进行 bcrypt 哈希 */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.bcryptRounds);
  }

  /** 比较明文密码与哈希是否匹配 */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /** 判断用户是否需要修改密码 */
  needsPasswordChange(password: string, isTempPassword: boolean, passwordChangedAt: string | null): boolean {
    const is4DigitPin = /^\d{4}$/.test(password);
    const isFirstLogin = !passwordChangedAt;
    return is4DigitPin || isTempPassword || isFirstLogin;
  }

  /** 判断密码是否为临时密码格式（4位数字） */
  isTempPasswordFormat(password: string): boolean {
    return /^\d{4}$/.test(password);
  }
}
