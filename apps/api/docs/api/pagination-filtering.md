# API 分页/排序/过滤规范

## 1. 规范总览

### 1.1 设计原则

- **一致性**：所有列表查询接口遵循统一的分页、排序、过滤参数约定
- **安全性**：所有动态字段名必须经过白名单校验，防止 SQL 注入
- **性能**：合理的分页上限、索引优化建议，避免深分页性能问题
- **可扩展性**：参数设计预留扩展空间，支持未来增加游标分页、高级过滤等能力

### 1.2 适用范围

本规范适用于所有返回列表数据的 API 接口，包括但不限于：
- 患者列表
- 预约列表
- 收费列表
- 库存列表
- 操作日志
- 所有继承 `BaseService` 的模块查询接口

---

## 2. 分页规范

### 2.1 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `page` | number | 否 | 页码，从 1 开始 |
| `pageSize` | number | 否 | 每页条数 |
| `cursor` | string | 否 | 游标 ID（游标分页模式下使用，与 page 二选一） |

### 2.2 默认值和范围

常量定义在 `src/common/constants/pagination.ts`：

```typescript
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  DEFAULT_PAGE_SIZE_MEDIUM: 50,
  DEFAULT_PAGE_SIZE_LARGE: 100,
  DEFAULT_PAGE_SIZE_XLARGE: 500,
  MAX_PAGE_SIZE: 200,
} as const;
```

- 默认页码：`page = 1`
- 默认每页条数：`pageSize = 20`
- 最大每页条数：`MAX_PAGE_SIZE = 200`
- 超出范围的参数会被安全截断（见 2.5 安全处理）

### 2.3 响应格式

统一分页响应结构定义在 `src/common/dto/pagination.dto.ts`：

```typescript
export class PaginationResultDto<T> {
  items: T[];      // 当前页数据列表
  total: number;   // 总记录数
  page: number;    // 当前页码
  pageSize: number; // 每页条数
}
```

**响应示例：**

```json
{
  "items": [
    { "id": "1", "name": "张三", "phone": "138****8000" }
  ],
  "total": 156,
  "page": 1,
  "pageSize": 20
}
```

### 2.4 最大分页限制

- 单页最多返回 `200` 条记录，超过自动截断为 200
- 禁止使用 `pageSize = 0` 或负数查询全量数据
- 如需导出全量数据，应使用专用导出接口，走异步任务流程

### 2.5 安全处理

分页参数使用安全解析函数，防止 NaN 注入：

```typescript
// src/common/dto/pagination.dto.ts
export function safePage(rawPage: unknown, defaultPage = 1): number {
  const n = Number(rawPage);
  if (!Number.isFinite(n) || n < 1) return defaultPage;
  return Math.floor(n);
}

export function safePageSize(rawPageSize: unknown, defaultPageSize = 20): number {
  const n = Number(rawPageSize);
  if (!Number.isFinite(n) || n < 1) return defaultPageSize;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}
```

### 2.6 游标分页（可选）

对于大数据量、深分页场景，支持基于游标的分页方式，性能远优于 OFFSET 分页。

**请求参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `cursor` | string | 上一页最后一条记录的 ID |
| `pageSize` | number | 每页条数 |
| `sortBy` | string | 排序字段 |
| `sortOrder` | string | 排序方向 |

**实现原理**（`src/common/repositories/base.repository.ts`）：

```typescript
if (cursor) {
  const cursorOp = sortOrder === 'ASC' ? '>' : '<';
  dataSql += ` ${whereOrAnd} id ${cursorOp} ?`;
  dataParams.push(cursor);
  dataSql += ` ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder} LIMIT ?`;
  dataParams.push(pageSize);
}
```

**使用场景建议：**
- 数据量 > 10000 条的列表
- 无限滚动加载
- 对性能敏感的列表查询

---

## 3. 排序规范

### 3.1 sort 参数格式

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sortBy` | string | 否 | 排序字段名 |
| `sortOrder` | string | 否 | 排序方向：`ASC` / `DESC`（不区分大小写） |

**DTO 定义**（`src/common/dto/pagination.dto.ts`）：

```typescript
export class PaginationQueryDto {
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  sortOrder?: 'ASC' | 'DESC';
}
```

### 3.2 多字段排序

当前实现默认追加 `id` 作为第二排序字段，保证排序稳定性：

```sql
ORDER BY created_at DESC, id DESC
```

如需支持前端指定多个排序字段，可扩展为以下格式（待实现）：

```
sortBy=field1,-field2,field3
```

其中 `-` 前缀表示 DESC。

### 3.3 默认排序

各模块可根据业务场景设置默认排序，常见约定：

| 业务模块 | 默认 sortBy | 默认 sortOrder |
|----------|------------|----------------|
| 患者列表 | `createdAt` | `DESC` |
| 预约列表 | `appointmentTime` | `ASC` |
| 收费列表 | `createdAt` | `DESC` |
| 操作日志 | `createdAt` | `DESC` |

### 3.4 可排序字段白名单

**所有排序字段必须经过白名单校验**，防止 SQL 注入攻击。

校验函数在 `src/common/utils/db/validate-name.ts`：

```typescript
export const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}
```

**使用示例**（`src/modules/patients/patients.service.ts`）：

```typescript
if (!validateColumnName(sortBy)) {
  throw new BusinessValidationException(`无效的排序字段`);
}
```

**各模块应维护自己的可排序字段列表**，在 Service 层显式校验，例如：

```typescript
const ALLOWED_SORT_FIELDS = ['createdAt', 'name', 'code', 'birthDate'];
if (!ALLOWED_SORT_FIELDS.includes(sortBy)) {
  throw new BusinessValidationException('不支持的排序字段');
}
```

---

## 4. 过滤规范

### 4.1 过滤操作符

当前实现支持精确匹配（`eq`），未来可扩展以下操作符：

| 操作符 | 含义 | 示例 |
|--------|------|------|
| `eq` | 等于 | `status=eq:active` |
| `ne` | 不等于 | `status=ne:deleted` |
| `gt` | 大于 | `amount=gt:100` |
| `gte` | 大于等于 | `amount=gte:100` |
| `lt` | 小于 | `amount=lt:1000` |
| `lte` | 小于等于 | `amount=lte:1000` |
| `in` | 包含于 | `status=in:active,pending` |
| `contains` | 包含（模糊匹配） | `name=contains:张` |
| `like` | SQL LIKE | `name=like:张%` |

### 4.2 过滤参数格式

**当前实现**（精确匹配）：

使用 `filters` 对象，键为字段名，值为精确匹配值：

```typescript
// src/modules/patients/patients.service.ts
if (options.filters) {
  Object.entries(options.filters).forEach(([key, value]) => {
    if (!validateColumnName(key)) {
      throw new BusinessValidationException(`无效的筛选字段`);
    }
    if (value !== undefined && value !== null && value !== '') {
      conditions.push(`${key} = ?`);
      params.push(value);
    }
  });
}
```

**请求示例**（通过 filters 对象传递）：

```json
{
  "filters": {
    "gender": "MALE",
    "source": "WALK_IN"
  }
}
```

### 4.3 多条件组合

- 默认使用 `AND` 组合所有过滤条件
- `keyword` 搜索内部的多字段匹配使用 `OR` 组合
- 如需复杂 `AND/OR` 嵌套，建议新增专用查询接口或高级查询 DSL

### 4.4 时间范围过滤

时间范围过滤使用独立的日期范围 DTO：

```typescript
// src/common/dto/pagination.dto.ts
export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
```

**约定：**
- `startDate`：包含，`>= startDate 00:00:00`
- `endDate`：包含，`<= endDate 23:59:59`
- 格式：ISO 8601（`YYYY-MM-DD` 或完整时间戳）

---

## 5. 搜索规范

### 5.1 关键字搜索

使用 `keyword` 参数进行多字段前缀匹配搜索。

**实现示例**（`src/modules/patients/patients.service.ts`）：

```typescript
if (keyword && keyword.trim()) {
  const trimmed = keyword.trim();
  const escaped = escapeLike(trimmed);
  const prefixPattern = `${escaped}%`;

  const searchConditions: string[] = [];
  const searchParams: unknown[] = [];

  searchConditions.push("name LIKE ? ESCAPE '\\'");
  searchParams.push(prefixPattern);

  searchConditions.push("phone LIKE ? ESCAPE '\\'");
  searchParams.push(prefixPattern);

  searchConditions.push("code LIKE ? ESCAPE '\\'");
  searchParams.push(prefixPattern);

  if (/^\d+$/.test(trimmed) && trimmed.length >= 8) {
    searchConditions.push("idCard LIKE ? ESCAPE '\\'");
    searchParams.push(prefixPattern);
  }

  conditions.push(`(${searchConditions.join(' OR ')})`);
  params.push(...searchParams);
}
```

### 5.2 模糊搜索

- 默认使用**前缀匹配**（`keyword%`），可利用索引，性能较好
- LIKE 特殊字符（`%`, `_`, `\`）自动转义，防止注入

转义函数：

```typescript
// src/common/utils/db/validate-name.ts
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}
```

### 5.3 高级搜索

对于复杂的搜索需求（如组合条件、范围查询），建议：

1. 新增专用 DTO 类（如 `AdvancedPatientQueryDto`）
2. 在 Service 层构建查询条件
3. 仍复用 `BaseRepository` 的分页能力

---

## 6. 响应格式

### 6.1 统一分页响应结构

```typescript
interface PaginatedResponse<T> {
  items: T[];      // 数据列表
  total: number;   // 总记录数
  page: number;    // 当前页码
  pageSize: number; // 每页条数
}
```

### 6.2 元数据计算

前端可通过返回值计算：
- 总页数：`Math.ceil(total / pageSize)`
- 是否有下一页：`page * pageSize < total`
- 是否有上一页：`page > 1`

### 6.3 链接头信息（预留）

未来可在响应头中添加分页链接，遵循 [RFC 5988](https://tools.ietf.org/html/rfc5988) 规范：

```
Link: <https://api.example.com/patients?page=2&pageSize=20>; rel="next",
      <https://api.example.com/patients?page=10&pageSize=20>; rel="last"
```

---

## 7. 错误处理

### 7.1 参数验证错误

使用 `class-validator` 进行 DTO 校验，返回 400 错误：

```json
{
  "statusCode": 400,
  "message": [
    "pageSize must not be greater than 200",
    "sortOrder must be one of the following values: ASC, DESC, asc, desc"
  ],
  "error": "Bad Request"
}
```

### 7.2 非法字段处理

- 排序字段非法：抛出 `BusinessValidationException('无效的排序字段')`
- 过滤字段非法：抛出 `BusinessValidationException('无效的筛选字段')`
- 均通过 `validateColumnName()` 进行正则校验

### 7.3 分页越界处理

- 页码超出总页数：返回空数组 `items: []`，`total` 为真实总数
- 不返回 404 错误，由前端判断空状态展示

---

## 8. 示例

### 8.1 基本分页示例

**请求：**

```
GET /api/patients?page=2&pageSize=20
```

**响应：**

```json
{
  "items": [ ... ],
  "total": 156,
  "page": 2,
  "pageSize": 20
}
```

### 8.2 排序示例

**请求：**

```
GET /api/patients?sortBy=name&sortOrder=ASC
```

### 8.3 过滤示例

**请求（精确过滤）：**

```
POST /api/patients/query
Content-Type: application/json

{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "gender": "FEMALE",
    "source": "WALK_IN"
  }
}
```

### 8.4 组合查询示例

**请求：**

```
GET /api/patients?page=1&pageSize=20&keyword=张&sortBy=createdAt&sortOrder=DESC
```

**等效 SQL（简化）：**

```sql
SELECT * FROM Patient
WHERE clinicId = ?
  AND deletedAt IS NULL
  AND (name LIKE '张%' OR phone LIKE '张%' OR code LIKE '张%')
ORDER BY createdAt DESC, id DESC
LIMIT 20 OFFSET 0
```

---

## 9. 实现建议

### 9.1 后端实现要点

1. **继承 BaseService**：新模块优先继承 `BaseService`，复用分页/排序/搜索能力
2. **字段白名单**：每个模块维护自己的可排序、可过滤字段列表，显式校验
3. **参数化查询**：所有用户输入必须通过参数化查询传入，禁止字符串拼接
4. **诊所隔离**：所有查询默认追加 `clinicId = ?` 过滤，确保多租户数据隔离

### 9.2 性能优化建议

| 场景 | 优化方案 |
|------|----------|
| 深分页（page > 100） | 使用游标分页替代 OFFSET |
| 关键字搜索 | 在搜索字段上建立索引，使用前缀匹配 |
| 多条件组合过滤 | 分析常用查询模式，建立复合索引 |
| 大表 COUNT | 考虑缓存总数或使用估算值（接受轻微误差） |

### 9.3 索引建议

常用索引模式（SQLite）：

```sql
-- 患者表：按创建时间倒序分页
CREATE INDEX idx_patient_clinic_created ON Patient(clinicId, createdAt DESC);

-- 患者表：按姓名搜索（前缀匹配可利用索引）
CREATE INDEX idx_patient_clinic_name ON Patient(clinicId, name);

-- 患者表：按手机号搜索
CREATE INDEX idx_patient_clinic_phone ON Patient(clinicId, phone);

-- 预约表：按预约时间排序
CREATE INDEX idx_appointment_clinic_time ON Appointment(clinicId, appointmentTime);
```

> **注意**：索引不是越多越好，需根据实际查询模式权衡。索引会增加写入开销和存储空间。

---

## 附录：BaseRepository 分页 API

```typescript
// src/common/repositories/base.repository.ts
export class BaseRepository {
  buildPaginatedQuery(
    tableName: string,
    selectColumns: string,
    whereClause: string,   // 含 WHERE 关键字，空字符串表示无条件
    params: unknown[],
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    cursor: string | undefined,
    pageSize: number,
    page: number,
  ): BuiltPaginatedQuery;

  executePaginatedQuery<T>(
    db: SqlExecutor,
    query: BuiltPaginatedQuery,
  ): { items: T[]; total: number };
}
```
