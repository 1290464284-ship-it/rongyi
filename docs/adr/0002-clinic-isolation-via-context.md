# ADR-0002: 通过 ClinicContext 实现多租户隔离

## 状态
已采纳

## 日期
2026-07-24

## 背景
诊所管理系统天然具有多租户特征：每个用户属于一个诊所，诊所之间数据完全隔离。

最初实现采用「在每个 Service 手动读取 `req.user.clinicId`，拼接到 SQL 中」的方式。
这种做法：
1. 容易遗漏（某个 Service 忘记过滤 → 数据泄露）
2. 代码重复（每个查询都要手动加 WHERE clinicId = ?）
3. 难测试（无法统一 mock）

## 决策
引入 `ClinicContextService`（基于 AsyncLocalStorage），
所有 Service 通过 `this.clinicContext.getClinicId()` 获取当前请求的 clinicId。

提供两个工具函数：
- `buildClinicFilter(clinicId)`：强制添加 WHERE clinicId = ?
- `buildClinicFilterOptional(clinicId)`：BOSS 角色可访问所有诊所

## 后果

### 正面
- 集中式租户隔离：单一来源真相
- 减少 SQL 注入风险（统一工具函数）
- 测试友好：可注入 Mock ClinicContext
- BOSS 角色可越权访问（但需明确审计）

### 负面
- 学习成本：开发者需要熟悉 `ClinicContextService`
- 隐式上下文：新人可能不知道 clinicId 从哪来

## 实施
- 拦截器：`src/common/interceptors/clinic-context.interceptor.ts`（从 token 解析）
- 服务：`src/common/services/clinic-context.service.ts`（AsyncLocalStorage 包装）
- 工具：`src/common/utils/db/clinic-filter.ts`（buildClinicFilter 等）

## 强制约束（已加入 project_memory）
- 数据库查询诊所特定数据必须使用 `buildClinicFilter` 或 `buildClinicFilterOptional`
