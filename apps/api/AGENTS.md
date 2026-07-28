# AGENTS.md — @dental/api (NestJS 后端)

## 模块结构

```
src/
├── app.module.ts              # 根模块，注册所有子模块
├── bootstrap/                 # 启动引导（加密迁移等）
├── cli/                       # CLI 工具（reset-password）
├── common/                    # 公共基础设施
│   ├── constants/             # 业务常量（角色、状态、缓存键、表名）
│   ├── decorators/            # 自定义装饰器（@CurrentUser, @Roles, @Public）
│   ├── domain/                # 领域值对象（Money, Result）
│   ├── dto/                   # 公共 DTO（分页）
│   ├── errors/                # 业务异常 + 错误码
│   ├── filters/               # 全局异常过滤器
│   ├── guards/                # 权限守卫（Roles, RateLimit, ResourceOwner）
│   ├── interceptors/          # 拦截器（诊所上下文、指标、TraceId）
│   ├── middleware/            # 中间件（限流、超时、SQL注入防护、Trace）
│   ├── monitoring/            # Sentry 监控
│   ├── repositories/          # BaseRepository（通用 CRUD）
│   ├── services/              # 公共服务（Cache, Logger, Config, Idempotency, Alert, SoftDelete）
│   ├── test-helpers/          # 测试工具（MockDb, 并发工具, 故障注入）
│   ├── types/                 # 品牌类型
│   └── utils/                 # 工具函数（SQL Builder, 断言, 上下文）
├── db/                        # 数据库层
│   ├── schema.ts              # 表结构定义
│   ├── migrations.ts          # 迁移脚本
│   ├── db.service.ts          # DbService（prepared statement + 事务）
│   └── seed/                  # 种子数据
└── modules/                   # 业务模块
    ├── auth/                  # 认证（JWT, Passport）
    ├── patients/              # 患者管理
    ├── scheduling/            # 排班（appointments, chairs）
    ├── clinical/              # 临床（first-exams, oral-examinations, periodontal-records, registrations, visits, treatments, treatment-plans, medical-records）
    ├── financial/             # 财务（charge, refunds, member-cards）
    ├── inventory/             # 库存（inventory, suppliers, purchase-orders, processing-orders）
    ├── content/               # 内容（drug-catalog, imaging, prescriptions, tooth-records）
    ├── communication/         # 沟通（follow-ups, wechat）
    ├── equipment/             # 设备
    ├── notifications/         # 通知
    └── system/                # 系统（backups, clinics, health, metrics, operation-logs, search, settings, stats）
```

## 模块所有者速查

| 要做什么 | 去哪里 |
|---------|--------|
| 登录/注册/Token | `modules/auth/` |
| 患者 CRUD | `modules/patients/` |
| 预约/椅位 | `modules/scheduling/` |
| 初诊/口检/牙周/病历/挂号/就诊/治疗/方案 | `modules/clinical/` |
| 收费/退费/会员卡 | `modules/financial/` |
| 库存/供应商/采购/加工单 | `modules/inventory/` |
| 药品/影像/处方/牙位记录 | `modules/content/` |
| 随访/微信 | `modules/communication/` |
| 设备管理 | `modules/equipment/` |
| 备份/日志/统计/搜索/设置/诊所 | `modules/system/` |
| 权限/守卫/中间件 | `common/guards/`, `common/middleware/` |
| 数据库变更 | `db/migrations.ts` + `db/schema.ts` |
| 缓存 | `common/services/cache.service.ts` |

## 验证命令

```bash
pnpm test              # Jest 单元测试
pnpm test:cov          # 带覆盖率
pnpm test:e2e          # E2E 测试（supertest + better-sqlite3）
pnpm test:smoke        # 冒烟测试
pnpm test:migration    # 迁移测试
pnpm lint:strict       # ESLint 零警告
pnpm typecheck         # tsc --noEmit
pnpm verify            # typecheck + lint + test（提交前最小验证）
pnpm verify:full       # 全量（含 e2e + smoke + migration）
```

## 关键约束

> **规范来源声明**：以下约束的详细规范定义在 `.qoder/rules/` 目录中，此处仅作摘要。修改约束时请更新对应的 rule 文件。

1. **原生 SQL only** → 详见 `.qoder/rules/no-orm-usage.md`
2. **模块边界** → 详见 `.qoder/rules/nestjs-module-boundary.md`
3. **BaseRepository / BaseService**：通用 CRUD 继承自 `common/repositories/` 和 `common/services/base.service.ts`
4. **诊所隔离**：通过 `ClinicContextInterceptor` + `ClinicContextService` 实现多诊所数据隔离
5. **软删除** → 详见 `.qoder/rules/soft-delete-enforcement.md`
6. **JWT 认证**：Passport JWT Strategy，`@Public()` 装饰器标记公开端点
7. **角色权限**：`@Roles()` + `RolesGuard`，角色常量统一来自 `@dental/shared`（`ROLES` / `ROLE_LEVELS` / `hasRoleLevel` / `SharedRole`），API 侧禁止在本地重复定义
8. **API 前缀**：所有端点以 `/api` 开头
9. **验证**：入参使用 class-validator DTO
10. **测试**：使用 Jest + `@nestjs/testing`，Mock DbService 用 `common/test-helpers/mock-db-factory.ts`

## 禁止事项

> 以下每条约束只有一个规范来源（rule 文件），修改时请更新对应 rule 文件。

- ❌ **不引入 ORM** → 详见 `.qoder/rules/no-orm-usage.md`
- ❌ **不手动运行 migration** → 详见 `.qoder/rules/no-manual-migration.md`
- ❌ **不在 SQL 中拼接字符串** → 详见 `.qoder/rules/sql-parameterization.md`
- ❌ **不绕过 Module 边界** → 详见 `.qoder/rules/nestjs-module-boundary.md`
- ❌ 不跳过 `verify` 直接提交代码
- ❌ 不在 controller 中写业务逻辑 — 委托给 service
- ❌ 不硬编码配置值 — 使用 ConfigService
