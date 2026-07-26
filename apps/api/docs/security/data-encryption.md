# 数据加密方案

## 1. 加密总览

### 1.1 加密目标

- **数据保密性**：防止敏感数据在数据库泄露、备份丢失时被直接读取
- **合规性要求**：满足医疗行业对患者隐私数据的保护要求
- **分层防护**：传输加密 + 存储加密 + 访问控制，构建多层安全体系

### 1.2 加密原则

- **最小权限**：仅在必要场景解密，列表展示默认脱敏
- **审计留痕**：访问敏感明文数据必须记录审计日志
- **密钥分离**：密钥与加密数据分开存储
- **幂等迁移**：加密数据迁移可重复执行，出错可回滚
- **向前兼容**：支持旧密钥解密，新密钥重新加密（密钥轮换）

### 1.3 加密范围

| 数据类型 | 加密方式 | 说明 |
|----------|----------|------|
| 患者身份证号 | AES-256-GCM 字段加密 | 数据库存储密文 |
| 用户密码 | bcrypt 哈希 | 单向哈希，不可解密 |
| 数据库备份文件 | AES-256-GCM 文件加密 | 备份文件整体加密 |
| 传输数据 | HTTPS | 传输层加密 |
| 日志敏感字段 | 脱敏（部分掩码） | 不存储明文，不做可恢复加密 |

---

## 2. 加密算法选择

### 2.1 对称加密（AES-256-GCM）

**算法**：AES-256-GCM

**选择理由**：
- 256 位密钥，安全性高
- GCM 模式提供**认证加密**（同时保证机密性和完整性）
- 内置认证标签（Auth Tag），可检测密文被篡改
- NIST 推荐，业界标准

**参数配置**（`src/common/utils/security/encryption.ts`）：

```typescript
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;           // GCM 推荐 12 字节 IV
const AUTH_TAG_LENGTH = 16;     // 认证标签长度（128 位）
```

**密文存储格式**：

```
<iv_hex>:<authTag_hex>:<ciphertext_hex>
```

三部分用冒号分隔，均为十六进制字符串：
- `iv`：初始化向量，每次加密随机生成（12 字节 → 24 hex 字符）
- `authTag`：认证标签，用于完整性校验（16 字节 → 32 hex 字符）
- `ciphertext`：加密后的密文

### 2.2 哈希算法

| 算法 | 用途 | 说明 |
|------|------|------|
| **bcrypt** | 用户密码哈希 | 自适应哈希，含盐值，可配置强度 |
| **SHA-256** | refresh token 哈希 | 快速哈希，用于令牌指纹存储 |
| **SHA-256** | 密钥派生（备选） | 当 ENCRYPTION_KEY 不是 64 位 hex 时，用 SHA-256 派生 |

### 2.3 算法选择依据

| 场景 | 推荐算法 | 为什么不用其他 |
|------|----------|----------------|
| 字段加密（可解密） | AES-256-GCM | ECB 不安全；CBC 无完整性校验；GCM 是认证加密标准 |
| 用户密码 | bcrypt | MD5/SHA-1 已破解；SHA-256 太快易被暴力破解；bcrypt 自适应且含盐 |
| 令牌指纹 | SHA-256 | 不需要解密，只需快速比对；bcrypt 太慢没必要 |
| 传输加密 | TLS 1.2+ / HTTPS | 应用层不重复造轮子 |

---

## 3. 密钥管理

### 3.1 密钥生成

**密钥长度**：256 位（32 字节），十六进制表示为 64 字符。

**生成命令**：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

或使用 OpenSSL：

```bash
openssl rand -hex 32
```

### 3.2 密钥存储

**环境变量配置**（`.env`）：

```dotenv
# 64 位十六进制字符串（32 字节密钥）
ENCRYPTION_KEY=your-64-character-hex-encryption-key-000000000000000000000000
```

**密钥加载逻辑**（`src/common/utils/security/encryption.ts`）：

1. 优先从环境变量 `ENCRYPTION_KEY` 读取
2. 若环境变量未设置，尝试读取数据目录下的 `.encryption-key` 文件（自动生成的安全网）
3. 若密钥是 64 位十六进制，直接作为密钥；否则用 SHA-256 派生为 32 字节密钥
4. 若无任何密钥，自动生成并保存到 `.encryption-key`，然后**终止进程**，要求配置后重启

```typescript
function getEncryptionKey(): Buffer {
  if (_key) return _key;

  let envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    // 尝试从 .encryption-key 文件读取
    const keyFile = path.join(getDataDir(), '.encryption-key');
    if (fs.existsSync(keyFile)) {
      envKey = fs.readFileSync(keyFile, 'utf8').trim();
    }
  }

  if (envKey && envKey.length >= 32) {
    if (envKey.length === 64 && /^[a-f0-9]{64}$/i.test(envKey)) {
      _key = Buffer.from(envKey, 'hex');
    } else {
      _key = crypto.createHash('sha256').update(envKey).digest();
    }
    return _key;
  }

  // 无密钥 → 自动生成 + 保存 + 退出
  const newKeyHex = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKeyHex + '\n', { mode: 0o600 });
  process.exit(1);
}
```

> **重要**：`.encryption-key` 文件权限为 `0600`（仅所有者可读写）。生产环境强烈建议配置环境变量，不要依赖自动生成的文件。

### 3.3 密钥轮换

支持通过**旧密钥（legacy key）**进行数据迁移，实现零停机密钥轮换。

**环境变量**：

```dotenv
# 新的主密钥（用于新加密）
ENCRYPTION_KEY=new-encryption-key...

# 旧密钥（用于解密旧数据，迁移完成后可移除）
LEGACY_ENCRYPTION_KEY=old-encryption-key...
```

**迁移入口**（`src/bootstrap/encryption-migration.ts`）：

```typescript
import { runEncryptionMigration } from './bootstrap/encryption-migration';

// 应用启动时执行
runEncryptionMigration(dbService, process.env.LEGACY_ENCRYPTION_KEY);
```

**迁移逻辑**：
1. 设置 legacy key
2. 遍历所有加密字段
3. 用当前密钥解密 → 成功则跳过
4. 用旧密钥解密 → 成功则用新密钥重新加密
5. 记录迁移成功/失败数量

### 3.4 密钥备份

- 密钥必须离线备份（如密码管理器、加密U盘、纸质打印）
- 至少保存 2 份，分开存放
- 密钥丢失 = 加密数据永久不可恢复
- 新环境部署前，先确认密钥可用再导入加密数据

---

## 4. 敏感字段加密

### 4.1 患者敏感字段清单

当前已实现加密的字段：

| 字段 | 表名 | 加密状态 | 说明 |
|------|------|----------|------|
| `idCard` | `Patient` | ✅ 已加密 | 身份证号 |

**建议后续扩展加密的字段**（根据合规要求评估）：

| 字段 | 表名 | 敏感度 | 说明 |
|------|------|--------|------|
| `phone` | `Patient` | 中高 | 手机号（当前明文存储，列表脱敏） |
| `address` | `Patient` | 中 | 住址 |
| `emergencyPhone` | `Patient` | 中 | 紧急联系人电话 |
| `email` | - | 中 | 邮箱（如有） |

> **注意**：加密字段会影响查询性能（无法直接用索引）。是否加密需要在安全与性能间权衡。

### 4.2 加密实现方式

**加密**（`src/common/utils/security/encryption.ts`）：

```typescript
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    throw new EncryptionError('Cannot encrypt null or undefined value', 'E_NULL_INPUT');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = (cipher as crypto.CipherGCM).getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
```

**解密**：

```typescript
export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) {
    return null;
  }
  const result = decryptWithFallback(ciphertext);
  return result.plaintext;
}
```

### 4.3 数据库存储格式

- 字段类型：`TEXT`
- 存储内容：`iv_hex:authTag_hex:ciphertext_hex`
- 长度估算：原文长度 + 约 80 字符 overhead（24 + 1 + 32 + 1 + 密文 hex）

**示例**：

```
a1b2c3d4e5f6a7b8c9d0e1f2:1234567890abcdef1234567890abcdef:f8e9d0c1b2a3948576978675...
```

### 4.4 查询方式

由于密文是随机的（每次加密 IV 不同，相同明文密文不同），**无法直接对加密字段进行精确查询或范围查询**。

**可选方案**：

1. **盲索引（Blind Index）**：对原文做 HMAC 或慢速哈希，存储一个可查询的"指纹"字段
   - 优点：可精确查询
   - 缺点：增加存储，需额外维护，存在频率分析风险

2. **解密后过滤**：先按其他条件缩小范围，再在应用层解密过滤
   - 优点：实现简单
   - 缺点：大数据量下性能差

3. **全库扫描 + 应用层过滤**：不推荐，性能太差

**当前实现**：身份证号支持前缀搜索（见 patients.service.ts），但因为 idCard 是加密存储的，实际上无法通过密文搜索。如果需要按身份证号查询，建议增加盲索引字段。

---

## 5. 密码加密

### 5.1 bcrypt 算法

**库**：`bcryptjs`（纯 JavaScript 实现，无原生依赖）

**配置**（`src/modules/auth/auth.service.ts`）：

```typescript
private get bcryptRounds(): number {
  const rounds = this.config.get<string>('BCRYPT_ROUNDS');
  return rounds ? Math.max(4, Math.min(15, parseInt(rounds, 10))) : 10;
}
```

**环境变量**：

```dotenv
# bcrypt 轮数（默认 10，建议生产环境 12）
BCRYPT_ROUNDS=12
```

### 5.2 盐值管理

- bcrypt 自动生成盐值，包含在哈希结果中
- 存储格式：`$2a$10$...`（算法 + 轮数 + 盐 + 哈希）
- 无需单独存储盐值

**哈希生成**：

```typescript
const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
```

**密码验证**：

```typescript
const ok = await bcrypt.compare(password, hash);
```

### 5.3 密码强度要求

| 要求项 | 规则 |
|--------|------|
| 最小长度 | 6 位（建议 8 位以上） |
| 临时密码 | 4 位数字 PIN，首次登录强制修改 |
| 复杂度 | 当前未强制（建议后续增加大小写+数字+特殊字符要求） |
| 防暴力破解 | 登录失败 5 次锁定 |

**登录锁定配置**（`src/config/constants.ts`）：
- `LOGIN_MAX_ATTEMPTS`：最大尝试次数
- `LOGIN_LOCK_DURATION_MS`：锁定时长

---

## 6. 传输加密

### 6.1 HTTPS 配置

**生产环境必须配置 HTTPS**，建议通过反向代理（Nginx）实现 TLS 终止：

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

**Node.js 直连 HTTPS（不推荐生产环境）**：

```typescript
import * as https from 'https';
import * as fs from 'fs';

const options = {
  key: fs.readFileSync('privkey.pem'),
  cert: fs.readFileSync('fullchain.pem'),
};

https.createServer(options, app.callback()).listen(3001);
```

### 6.2 HSTS

生产环境建议启用 HSTS（HTTP Strict Transport Security）：

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

---

## 7. 日志脱敏

### 7.1 脱敏规则

**两级脱敏策略**：

1. **日志/操作日志**：全量替换为 `***`（不可恢复）
2. **业务展示脱敏**：保留部分信息（如 `138****8000`），由 `mask.ts` 提供

### 7.2 脱敏字段清单

统一维护在 `src/common/utils/security/sensitive-fields.ts`：

```typescript
export const SENSITIVE_FIELDS: readonly string[] = [
  // 凭证类
  'password',
  'passwordhash',
  'token',
  'secret',
  'key',
  'jwtsecret',
  'refreshtoken',
  // 患者隐私类
  'idcard',
  '身份证',
  'phone',
  'email',
  'emergencyphone',
  'emergencycontact',
  'address',
  'cardno',
  'openid',
];

const SENSITIVE_KEYWORDS: readonly string[] = [
  ...SENSITIVE_FIELDS,
  'creditcard',
  'authorization',
  'cookie',
  'credential',
  'ssn',
  'cvv',
];
```

### 7.3 实现方式

**字段名检测**（精确匹配，大小写不敏感）：

```typescript
export function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lower === keyword);
}
```

**业务展示脱敏工具**（`src/common/utils/security/mask.ts`）：

```typescript
// 身份证号：前6后4，中间8位用 *
maskIdCard('110101199001011234')  // → '110101********1234'

// 手机号：前3后4，中间4位用 *
maskPhone('13800138000')          // → '138****8000'

// 邮箱：用户名前2位 + *** + 域名
maskEmail('zhangsan@example.com') // → 'zh***@example.com'

// 姓名：保留第1个字，其余用 *
maskName('张三')                   // → '张*'
maskName('欧阳修')                 // → '欧**'
```

### 7.4 患者列表脱敏实现

`src/modules/patients/patients.service.ts`：

```typescript
private decryptPatient(patient: Patient): Patient {
  if (!patient) return patient;
  const result = { ...patient };
  if (result.idCard && result.idCard.includes(':')) {
    const decrypted = decryptField(result.idCard);
    result.idCard = maskIdCard(decrypted) ?? decrypted;
  }
  // 列表展示时也对 phone 脱敏
  if (result.phone) {
    result.phone = maskPhone(result.phone) ?? result.phone;
  }
  return result;
}
```

**获取完整敏感数据**需调用专用接口并记录审计日志：

```typescript
async getFullPhone(patientId: string): Promise<string | null> {
  // 审计留痕
  this.dbService.prepare(
    "INSERT INTO AuditLog (id, type, targetId, targetType, ...) VALUES (...)"
  ).run(...);
  const patient = await super.findOne(patientId);
  return patient?.phone ?? null;
}
```

---

## 8. 备份加密

### 8.1 备份文件加密

备份文件使用 AES-256-GCM 整体加密（`src/common/utils/security/encryption.ts`）。

**加密格式**：

```
+----------+---------+------+----------+------------+
|  Magic   | Version |  IV  | Auth Tag | Ciphertext |
|  (4B)       (1B)    (12B)   (16B)       (N B)
+----------+---------+------+----------+------------+
```

- Magic：`DBAK`（4 字节），标识加密备份文件
- Version：`0x01`（1 字节），版本号用于未来升级兼容
- IV：12 字节随机初始化向量
- Auth Tag：16 字节 GCM 认证标签
- Ciphertext：加密后的备份数据

**加密函数**：

```typescript
export function encryptBuffer(data: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = (cipher as crypto.CipherGCM).getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_VERSION]), iv, authTag, encrypted]);
}
```

**检测是否加密**：

```typescript
export function isEncryptedBuffer(data: Buffer): boolean {
  return data.length >= 5 && Buffer.from(data.subarray(0, 4)).equals(BACKUP_MAGIC);
}
```

### 8.2 加密密钥管理

- 备份加密使用与字段加密**相同的密钥**（`ENCRYPTION_KEY`）
- 备份迁移到其他环境时，需确保目标环境有相同的加密密钥
- 密钥丢失 = 备份文件无法恢复

---

## 9. 加密迁移

### 9.1 迁移场景

| 场景 | 触发方式 |
|------|----------|
| 首次启用加密（明文 → 密文） | 数据迁移脚本 |
| 密钥轮换（旧密钥 → 新密钥） | 设置 `LEGACY_ENCRYPTION_KEY`，启动时自动迁移 |
| 算法升级 | 新增版本号，编写专用迁移脚本 |

### 9.2 迁移步骤（密钥轮换）

1. **准备新密钥**：生成新的 64 位 hex 密钥
2. **配置双密钥**：
   ```dotenv
   ENCRYPTION_KEY=<new-key>
   LEGACY_ENCRYPTION_KEY=<old-key>
   ```
3. **启动应用**：`runEncryptionMigration()` 自动执行
4. **验证数据**：抽查几条记录确认解密正常
5. **移除旧密钥**：确认迁移完成后，移除 `LEGACY_ENCRYPTION_KEY`
6. **重启验证**：重启应用，确认无 legacy key 也能正常运行

### 9.3 回滚方案

如果迁移出现问题：

1. **停止应用**
2. **恢复旧密钥配置**：
   ```dotenv
   ENCRYPTION_KEY=<old-key>
   # 移除 LEGACY_ENCRYPTION_KEY
   ```
3. **从备份恢复**：如数据已损坏，使用迁移前的备份恢复
4. **重启验证**：确认数据可读

> **设计保障**：迁移是幂等的，且逐行处理。一行失败不影响其他行，崩溃后重跑即可。

---

## 10. 安全最佳实践

### 10.1 不要硬编码密钥

- ❌ 禁止在代码中写死密钥
- ❌ 禁止提交 `.env` 到版本库
- ✅ 使用环境变量或密钥管理服务
- ✅ `.env.example` 只放占位符，不放真实值

### 10.2 定期密钥轮换

- 建议**每 6-12 个月**轮换一次加密密钥
- 轮换前先备份数据库
- 使用 legacy key 机制实现平滑迁移
- 轮换完成后审计所有加密字段是否均已用新密钥

### 10.3 加密审计

- 访问完整敏感数据（如完整手机号、完整身份证号）必须记录审计日志
- 审计日志包括：操作人、操作类型、目标对象、时间、IP、User-Agent
- 定期审计敏感数据访问日志，发现异常访问

### 10.4 性能影响评估

| 操作 | 性能影响 | 说明 |
|------|----------|------|
| 字段加密/解密 | 低 | AES-GCM 很快，单字段微秒级 |
| 密码哈希（bcrypt 10轮） | 中 | 约 100ms/次，仅登录/改密时发生 |
| 备份文件加密 | 高 | 与文件大小成正比，异步执行 |
| 加密字段查询 | 高 | 无法用索引，需特殊设计（盲索引） |

**建议**：
- 不要对所有字段加密，只加密真正敏感的
- 加密字段不要作为查询条件，或增加盲索引
- 列表接口默认返回脱敏数据，减少解密次数

---

## 11. 附录

### 11.1 常用加密工具函数

```typescript
// 字段加密
import { encryptField, decryptField } from '@common/utils/security/encryption';

const ciphertext = encryptField('110101199001011234');
const plaintext = decryptField(ciphertext);

// 解密并检测是否需要重新加密（迁移用）
import { decryptFieldWithFlag } from '@common/utils/security/encryption';

const { plaintext, needsReencrypt } = decryptFieldWithFlag(ciphertext);
if (needsReencrypt) {
  const newCiphertext = encryptField(plaintext);
}

// 密码哈希
import * as bcrypt from 'bcryptjs';

const hash = await bcrypt.hash(password, 10);
const isValid = await bcrypt.compare(password, hash);

// 脱敏
import { maskPhone, maskIdCard, maskName, maskEmail } from '@common/utils/security/mask';

maskPhone('13800138000');     // '138****8000'
maskIdCard('110101199001011234'); // '110101********1234'
maskName('张三');              // '张*'
maskEmail('a@b.com');          // 'a***@b.com'

// 敏感字段检测
import { isSensitiveField } from '@common/utils/security/sensitive-fields';

isSensitiveField('password');  // true
isSensitiveField('username');  // false

// 备份文件加密
import { encryptBuffer, decryptBufferIfEncrypted, isEncryptedBuffer } from '@common/utils/security/encryption';

const encrypted = encryptBuffer(Buffer.from('backup data'));
isEncryptedBuffer(encrypted);  // true
const decrypted = decryptBufferIfEncrypted(encrypted);
```

### 11.2 常见问题解答

**Q: 加密密钥忘了怎么办？**
A: 加密数据将永久无法解密。请务必离线备份密钥，至少保存 2 份。

**Q: 能对加密字段做模糊搜索吗？**
A: 不能直接搜索。可选方案：增加盲索引字段、先按其他条件过滤再在应用层搜索、使用专用的可搜索加密方案（复杂度高）。

**Q: 加密后数据库体积增加多少？**
A: 每个加密字段增加约 80 字节（IV + auth tag + hex 编码开销）。对整体数据库影响很小。

**Q: 可以在 SQL 里解密吗？**
A: 不可以。解密在应用层（Node.js）完成，数据库只存密文。这样即使数据库被攻破，没有密钥也读不到明文。

**Q: bcrypt 和 AES 有什么区别？**
A: bcrypt 是**单向哈希**（不可逆，用于密码），AES 是**对称加密**（可逆，用于需要解密的字段）。密码不需要解密，所以用 bcrypt；身份证号有时需要查看完整内容，所以用 AES。

**Q: 为什么用 bcryptjs 而不是 bcrypt？**
A: bcryptjs 是纯 JavaScript 实现，不需要编译原生模块，在 Electron 打包等场景下兼容性更好。性能略低于原生 bcrypt，但对登录场景（不频繁）影响可忽略。

**Q: IV 是什么？为什么每次加密都不一样？**
A: IV（初始化向量）是一个随机数，作用是让相同明文每次加密得到不同密文。这样攻击者无法通过密文判断两条记录的明文是否相同。IV 不需要保密，和密文存在一起即可。

**Q: GCM 模式和 CBC 模式有什么区别？**
A: GCM 是认证加密模式，同时提供机密性和完整性校验。如果密文被篡改，GCM 解密会失败并抛出错误。CBC 模式只提供机密性，篡改密文可能导致解密出垃圾数据但不报错，存在安全风险。
