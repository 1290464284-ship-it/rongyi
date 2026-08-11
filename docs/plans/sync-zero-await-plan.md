# sync 批事务“零 await”改造方案

状态：已登记待实施（第 15-18 轮保留项）。

## 现状与为什么现在能工作

- `sync.ts` 的 `executePush` 与 `executeResolveConflict` 在显式 `BEGIN IMMEDIATE` 内调用
  `SqliteRepository.findById/insert/update/softDelete`（均为 `async`，SQL 在已 resolve 的微任务链中同步执行）。
- `better-sqlite3` 是同步驱动，同一连接上的 SQL 不会让出事件循环，因此批内 `await` 实际不会把
  另一个写事务插进来；`sharedDbWriteQueue` 再保证同一连接上的 async 写路径串行。
- 结论：当前实现没有已证实的数据竞争，但“事务内 await”是脆弱契约，任何仓储方法一旦引入真实
  异步 I/O（网络、文件、子进程），就会嵌套事务或污染批事务。

## 目标

1. sync 写路径不再依赖“await 的 promise 恰好是纯微任务”这一隐式前提。
2. 显式 BEGIN/COMMIT/ROLLBACK 与仓储调用保持在同一同步事务内。
3. 保持现有 API 与行为，不改变对外响应结构。

## 改造步骤

### 1. 仓储提供同步变体

在 `SqliteRepository` 增加仅内部使用的同步方法（复用现有 SQL/校验/映射逻辑）：

- `findByIdSync(id, context)`
- `insertSync(entity, context)`
- `updateSync(entity, context)`
- `softDeleteSync(id, context)`

现有 `async` 公共方法改为薄包装：`return this.findByIdSync(...)` 等，保证业务层 API 不变。

### 2. sync 路径改用同步变体

- `executePush` 批内：用 `findByIdSync` / `insertSync` / `updateSync` / `softDeleteSync`，删除批内所有 `await`。
- `executeResolveConflict`：同样改为同步变体。
- 保持显式 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，或改用 `db.transaction` 包裹（同步回调）。

### 3. 防回归守卫

- 在 `sync.ts` 顶部注释声明“批事务内禁止 await 仓储/业务方法”。
- 新增单测：用“含真实异步 I/O 的仓储替身”跑 `executePush`，断言批事务不会嵌套且回滚完整
  （当前实现若被误改成真 async 调用，该测试会暴露）。
- 可选 ESLint 规则：禁止 `sync.ts` 中 `BEGIN IMMEDIATE` 作用域内出现 `await`（先人工 review，
  规则实现作为独立小任务）。

### 4. 验收

- `pnpm --filter @dental/v2 test` 全绿（含新增防回归测试）。
- `smoke:multi-instance`：跨进程 sync push + 幂等写守卫通过，无嵌套 BEGIN、无 5xx。
- `smoke:delivery`：state-machine-concurrency 通过。

## 风险

- 同步变体若复制 SQL 而非复用现有方法，可能产生漂移；因此要求同步方法作为唯一实现，async 方法委托。
- 迁移现有测试 mock（仓储接口）需同步补充 `*Sync` 签名。
