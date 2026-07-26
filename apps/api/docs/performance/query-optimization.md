# 查询优化与 N+1 问题治理

本文档记录 API 项目中 N+1 查询问题的识别方法、已实施的优化措施，以及缓存策略的落地实践。
通用性能基准与 PRAGMA 配置请参阅 [性能优化指南](./optimization-guide.md)。

---

## 1. N+1 查询问题识别

### 1.1 什么是 N+1

查询列表数据（1 次查询）后，在循环中逐条查询关联数据（N 次查询），总查询次数为 N+1。
当列表条数较多或关联查询本身较慢时，会显著拖慢接口响应。

### 1.2 识别方法

| 方法 | 说明 |
|------|------|
| 代码扫描 | 检查 Service 中 `for...of` / `map` 循环内是否调用了 `dbService.prepare` 或其他 Service 的单条查询方法 |
| 慢查询日志 | `DbService.timedQuery()` 会记录 >100ms 的 SQL；短时间内大量相似 SQL 即为 N+1 信号 |
| SQL verbose 模式 | 开发环境启用 SQLite verbose，观察一次请求产生的 SQL 条数 |
| 集成测试断言 | 使用 `MockDbService` 断言查询次数，防止回归 |

### 1.3 批量查询工具

项目在 `BaseService` / `BaseRepository` 中已提供批量查询原语，优先使用：

- `BaseService.batchResolve(ids, fetcher)` — 按 ID 列表批量加载实体，返回 `Map<id, entity>`
- `BaseService.batchFindByIds(ids)` — 按 ID 列表批量查询单表实体

典型用法：

```typescript
// ❌ N+1：循环内逐条查询
const items = await this.findMany(query);
for (const item of items) {
  item.patient = await this.patientService.findOne(item.patientId);
}

// ✅ 批量加载：2 次查询
const items = await this.findMany(query);
const patientIds = [...new Set(items.map(i => i.patientId))];
const patientMap = await this.patientService.batchResolve(patientIds, (ids) =>
  this.dbService.prepare(`SELECT * FROM Patient WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
);
for (const item of items) {
  item.patient = patientMap.get(item.patientId);
}
```

---

## 2. 已实施的 N+1 查询优化

### 2.1 预约列表 - 医生信息批量查询（P5-1）

**问题**：`AppointmentsService.queryAppointments` 在获取预约列表后，循环中逐条查询患者和医生信息，导致 N+1 查询问题。

**优化**：使用 IN 子句批量查询患者和医生信息，通过 Map 存储结果，避免循环查询。

| 文件 | 变更 |
|------|------|
| `src/modules/scheduling/appointments/appointments.service.ts` | `queryAppointments` 方法中添加医生信息批量查询，使用 Map 存储查询结果 |

**优化效果**：查询次数从 N+2 降低到 3（列表查询 + 患者批量查询 + 医生批量查询）。

### 2.2 治疗列表 - 患者信息批量查询（P5-2）

**问题**：`TreatmentsService.findMany` 在获取治疗列表后，循环中逐条查询患者信息。

**优化**：使用 IN 子句批量查询患者信息。

| 文件 | 变更 |
|------|------|
| `src/modules/clinical/treatments/treatments.service.ts` | `findMany` 方法中添加患者信息批量查询 |

### 2.3 病历列表 - 患者和医生信息批量查询（P5-3）

**问题**：`MedicalRecordsService.findMany` 在获取病历列表后，循环中逐条查询患者和医生信息。

**优化**：添加自定义 `queryRecords` 方法，实现患者和医生信息的批量查询。

| 文件 | 变更 |
|------|------|
| `src/modules/clinical/medical-records/medical-records.service.ts` | 添加 `queryRecords` 方法，批量查询患者和医生信息 |

### 2.4 收费列表 - 患者信息批量查询（P5-4）

**问题**：`ChargeService.listCharges` 在获取收费列表后，循环中逐条查询患者信息，并对金额字段进行单位转换。

**优化**：重写 `listCharges` 方法，实现患者信息批量查询和金额字段单位转换。

| 文件 | 变更 |
|------|------|
| `src/modules/financial/charge/charge.service.ts` | 重写 `listCharges` 方法，批量查询患者信息 |

---

## 3. 已实施的缓存优化

### 3.1 用户信息缓存（P4-1）

**问题**：`JwtStrategy.validate` 对每个受保护的请求都调用 `AuthService.validateById`，
原先每次都执行 `SELECT ... FROM User WHERE id = ?`，是全系统最高频的 DB 查询。

**优化**：为 `validateById` 增加进程内缓存（TTL 30s）。

| 文件 | 变更 |
|------|------|
| `src/modules/auth/auth.service.ts` | 注入 `CacheService`，`validateById` 先查缓存再查 DB；缓存值附带 `tokenVersion` 用于命中时复核 |

**缓存键**：`user:{userId}`（见 `CACHE_PREFIXES.USER`）
**TTL**：`USER_INFO_CACHE_TTL_MS`（30 秒，兼顾 `tokenVersion` 实时性）

**tokenVersion 安全复核**：

缓存命中后必须复核 `tokenVersion`。若调用方提供的 `tokenVersion` 与缓存中的不一致，
说明 token 已被吊销（登出 / 改密 / 删用户），删除脏缓存并返回 `null`。
这保证了即便缓存未被主动失效，也不会放过已吊销的 token。

**主动失效点**：

| 方法 | 失效原因 |
|------|---------|
| `logout` | `tokenVersion + 1`，旧 token 全部失效 |
| `changePassword` | `tokenVersion + 1`，强制重新登录 |
| `deleteUser` | 软删 + `tokenVersion + 1` |
| `updateUser` | `name` / `role` / `active` 变更会影响缓存中的 `UserInfo` |
| `refreshToken`（复用检测分支） | 检测到 refresh token 复用时 `tokenVersion + 1`，吊销全部 token |

### 2.2 治疗目录缓存（P4-2）

**问题**：`TreatmentsService.findCatalog` 是字典类接口（前端开单时频繁拉取），
每次都执行 `SELECT * FROM TreatmentCatalog WHERE deletedAt IS NULL AND clinicId = ? ORDER BY code LIMIT ? OFFSET ?`。

**优化**：按诊所 + 分页参数缓存，TTL 30 分钟。

| 文件 | 变更 |
|------|------|
| `src/modules/clinical/treatments/treatments.service.ts` | 注入 `CacheService`，`findCatalog` 先查缓存；新增 `invalidateCatalogCache` 私有方法 |

**缓存键**：`dict:treatmentCatalog:{clinicId}:p{page}:s{pageSize}`
**TTL**：`TREATMENT_CATALOG_CACHE_TTL_MS`（30 分钟）

**失效策略**：`delPattern('dict:treatmentCatalog:{clinicId}:')` 清除该诊所所有分页变体。
失效点：`createCatalog` / `updateCatalog` / `deleteCatalog`。

### 3.3 病历字典缓存（P4-3）

**问题**：`MedicalRecordsService.listPhrases` / `listTemplates` 是字典类接口，
前端病历编辑器加载时频繁拉取，每次都执行全量查询。

**优化**：按诊所缓存，TTL 30 分钟。

| 文件 | 变更 |
|------|------|
| `src/modules/clinical/medical-records/medical-records.service.ts` | 注入 `CacheService`，`listPhrases` / `listTemplates` 先查缓存；新增 `invalidateDictionaryCache` 私有方法 |

**缓存键**：
- 常用语：`dict:medicalRecordPhrases:{clinicId}`
- 模板：`dict:medicalRecordTemplates:{clinicId}`

**TTL**：`MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS`（30 分钟）

**失效策略**：`delPattern('dict:{category}:{clinicId}')`。
失效点：
- 常用语：`createPhrase` / `updatePhrase` / `deletePhrase`
- 模板：`createTemplate` / `updateTemplate` / `deleteTemplate`

> 注意：当前 `listPhrases` / `listTemplates` 未使用 `_userId` / `_category` 参数做过滤，
> 缓存键仅需 `clinicId`。若未来引入按 `category` 过滤，需将 `category` 纳入缓存键。

### 3.4 用户权限和角色缓存（P5-5）

**问题**：用户权限和角色信息在多个接口中频繁查询，每次都执行数据库查询。

**优化**：创建 `UserPermissionCacheService` 服务，统一管理用户权限和角色缓存。

| 文件 | 变更 |
|------|------|
| `src/common/services/user-permission-cache.service.ts` | 新增服务，提供获取、设置、失效用户权限和角色缓存的方法 |

**缓存键**：
- 用户权限：`user:permission:{userId}:{clinicId}`
- 用户角色：`user:role:{userId}:{clinicId}`

**TTL**：`USER_PERMISSION_CACHE_TTL_MS`（5 分钟）、`USER_ROLE_CACHE_TTL_MS`（5 分钟）

**失效策略**：权限或角色变更时主动失效，支持按用户 ID 或诊所 ID 失效。

### 3.5 字典数据缓存服务（P5-6）

**问题**：科室、职称、药品目录、支付方式、会员卡类型等字典数据在多个接口中频繁查询。

**优化**：创建 `DictionaryCacheService` 服务，统一管理字典数据缓存。

| 文件 | 变更 |
|------|------|
| `src/common/services/dictionary-cache.service.ts` | 新增服务，提供获取、设置、失效科室、职称、药品目录、支付方式、会员卡类型缓存的方法 |

**缓存键**：
- 科室：`dict:department:{clinicId}`
- 职称：`dict:title:{clinicId}`
- 药品目录：`dict:drugCatalog:{clinicId}`
- 支付方式：`dict:paymentMethod:{clinicId}`
- 会员卡类型：`dict:memberCardType:{clinicId}`

**TTL**：
- 科室/职称：`DEPARTMENT_CACHE_TTL_MS` / `TITLE_CACHE_TTL_MS`（1 小时）
- 药品目录：`DRUG_CATALOG_CACHE_TTL_MS`（30 分钟）
- 支付方式：`PAYMENT_METHOD_CACHE_TTL_MS`（2 小时）
- 会员卡类型：`MEMBER_CARD_TYPE_CACHE_TTL_MS`（2 小时）

**失效策略**：字典数据变更时主动失效，支持按诊所 ID 失效或全局失效。

---

## 4. 缓存键规范

所有缓存键通过 `src/common/constants/cache-keys.ts` 集中管理，避免硬编码和冲突。

### 4.1 前缀

| 前缀 | 常量 | 用途 |
|------|------|------|
| `user:` | `CACHE_PREFIXES.USER` | 用户信息 |
| `patient:` | `CACHE_PREFIXES.PATIENT` | 患者数据 |
| `dict:` | `CACHE_PREFIXES.DICTIONARY` | 字典类数据（治疗目录、病历常用语、模板等） |
| `stats:` | `CACHE_PREFIXES.STATS` | 统计数据 |
| `search:` | `CACHE_PREFIXES.SEARCH` | 搜索结果 |
| `settings:` | `CACHE_PREFIXES.SETTINGS` | 诊所配置 |

### 4.2 构建函数

| 函数 | 签名 | 示例输出 |
|------|------|---------|
| `buildCacheKey(prefix, id)` | `(CachePrefix, string) => string` | `user:abc-123` |
| `buildStatsCacheKey(category, clinicId, ...parts)` | `(StatsCacheKey, string, ...string[]) => string` | `stats:revenue:clinic-1:2026-07` |
| `buildDictionaryCacheKey(category, clinicId)` | `(DictionaryCacheKey, string) => string` | `dict:treatmentCatalog:clinic-1` |
| `buildUserPermissionCacheKey(userId, clinicId)` | `(string, string) => string` | `user:permission:user-1:clinic-1` |
| `buildUserRoleCacheKey(userId, clinicId)` | `(string, string) => string` | `user:role:user-1:clinic-1` |

### 4.3 字典类缓存键后缀

```typescript
export const DICTIONARY_CACHE_KEYS = {
  TREATMENT_CATALOG: 'treatmentCatalog',
  MEDICAL_RECORD_PHRASES: 'medicalRecordPhrases',
  MEDICAL_RECORD_TEMPLATES: 'medicalRecordTemplates',
  DEPARTMENT: 'department',
  TITLE: 'title',
  DRUG_CATALOG: 'drugCatalog',
  PAYMENT_METHOD: 'paymentMethod',
  MEMBER_CARD_TYPE: 'memberCardType',
} as const;
```

---

## 5. 缓存失效原则

### 5.1 主动失效优先

对于写操作（增删改）后立即可见的数据，**必须**在写操作后主动失效缓存，
不要仅依赖 TTL 过期。原因：

- TTL 窗口内用户看到脏数据会导致困惑
- 字典类数据 TTL 较长（30 分钟），脏数据窗口不可接受

### 5.2 按诊所隔离

所有缓存键必须包含 `clinicId`，防止跨诊所缓存污染。
`invalidateDictionaryCache` / `invalidateCatalogCache` 在 `clinicId` 为 `null` 时跳过失效（防御性）。

### 5.3 delPattern 批量失效

当缓存键包含可变后缀（如分页参数 `:p{page}:s{pageSize}`）时，
使用 `delPattern(prefix)` 清除所有变体，避免逐个删除遗漏。

---

## 6. TTL 选型参考

| 数据特征 | 推荐 TTL | 示例 |
|---------|---------|------|
| 每请求都查、且有安全性约束 | 30s | 用户信息（`validateById`） |
| 用户权限/角色（变更频率低） | 5min | 用户权限、用户角色 |
| 字典类数据（变更频率低） | 30min ~ 2h | 治疗目录、病历常用语、模板、科室、职称、药品目录、支付方式、会员卡类型 |
| 统计数据（可容忍短暂不一致） | 10s ~ 5min | 仪表盘、收入统计 |
| 搜索结果 | 30s | 患者搜索 |
| 诊所配置 | 5min | 诊所信息 |

---

## 7. 后续待优化项

以下接口存在潜在 N+1 或可缓存空间，按优先级排列：

| 优先级 | 接口 | 现状 | 建议 |
|--------|------|------|------|
| 中 | 收费单列表 | 明细逐条查询 | 使用 `batchResolve` 批量加载收费项明细 |
| 中 | 库存列表 | 可能存在关联查询 | 检查 `inventory.service.ts` 中的列表查询 |
| 中 | 随访列表 | 可能存在关联查询 | 检查 `follow-ups.service.ts` 中的列表查询 |
| 中 | 影像列表 | 可能存在关联查询 | 检查 `imaging.service.ts` 中的列表查询 |
| 低 | 患者基本信息缓存 | 未实现 | 添加短 TTL（5 分钟）的患者基本信息缓存 |
| 低 | 医生排班缓存 | 未实现 | 添加医生排班缓存 |

> 优化原则：只优化明确的 N+1 问题，不过度优化；保持接口返回格式不变；
> 添加注释说明优化原因；运行 `npx tsc --noEmit` 确认类型正确。

---

## 相关文档

- [性能优化指南](./optimization-guide.md) — 通用性能基准、PRAGMA 配置、监控指标
- `src/common/services/user-permission-cache.service.ts` — 用户权限和角色缓存服务
- `src/common/services/dictionary-cache.service.ts` — 字典数据缓存服务
- [SQLite 优化配置](../database/sqlite-optimization.md) — WAL 模式、索引策略
- [索引策略](../database/index-strategy.md) — 复合索引设计
- `src/common/services/cache.service.ts` — 缓存服务实现
- `src/common/constants/cache-keys.ts` — 缓存键常量
- `src/config/constants.ts` — 缓存 TTL 常量
