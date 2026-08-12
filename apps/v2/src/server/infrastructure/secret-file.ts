import fs from 'node:fs';

/** POSIX 上密钥文件必须仅当前用户可读写，否则 fail-closed 拒绝读取。Windows 靠 ACL 而非 POSIX mode 位。 */
export function assertOwnerOnlySecretFile(mode: number, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new Error('V2_SECRET_FILE permissions must be owner-only');
  }
}

// S-L2（第七轮）：Electron 主进程不再把 JWT/备份密钥经 spawn env 透传给 API
// 子进程（同用户进程可枚举子进程环境块），而是写入 os.tmpdir() 下随机名的
// 0o600 临时文件，经 V2_SECRET_FILE 只传路径；API 启动后读取一次并缓存，
// 主进程在 waitForApi 成功/失败后删除该文件。
// infrastructure 层提供此读取器，供 main.ts（启动校验）、application 层
// common.ts（JWT_SECRET / backupEncryptionKey）以及 http 层 files.ts、
// infrastructure 层 restore-apply.ts（S-L8 签名 URL / S-L5 restore marker
// 同源派生）复用，保证密钥来源唯一。
let _cache: {
  jwt: string;
  backupKey: string;
  wechatAppId?: string;
  wechatAppSecret?: string;
  adminPassword?: string;
} | null = null;

export function resetSecretFileCache(): void {
  _cache = null;
}

export function secretFileValue(
  key: 'jwt' | 'backupKey' | 'wechatAppId' | 'wechatAppSecret' | 'adminPassword',
): string | null {
  const file = process.env.V2_SECRET_FILE;
  if (!file) return null;
  if (!_cache) {
    let stats: fs.Stats | null = null;
    try {
      stats = fs.statSync(file);
    } catch {
      stats = null;
    }
    if (stats) assertOwnerOnlySecretFile(stats.mode);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      _cache = {
        jwt: typeof raw.jwt === 'string' ? raw.jwt : '',
        backupKey: typeof raw.backupKey === 'string' ? raw.backupKey : '',
        wechatAppId: typeof raw.wechatAppId === 'string' ? raw.wechatAppId : undefined,
        wechatAppSecret: typeof raw.wechatAppSecret === 'string' ? raw.wechatAppSecret : undefined,
        adminPassword: typeof raw.adminPassword === 'string' ? raw.adminPassword : undefined,
      };
    } catch {
      // 文件缺失/损坏：视为无密钥，调用方走各自回退（dev 随机 / production 抛错）
      _cache = { jwt: '', backupKey: '', wechatAppId: undefined, wechatAppSecret: undefined, adminPassword: undefined };
    }
  }
  return _cache[key] || null;
}
