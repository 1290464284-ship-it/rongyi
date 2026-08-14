# Flaky Test Ledger

## 2026-08-13 full shuffle probe

**Command:** `pnpm --filter @dental/v2 exec vitest run --sequence.shuffle`

**Status:** Resolved in round 57.

**Initial result:** 77 tests failed across 39+ files due to within-file shared DB/state assumptions.

**Classification:** TEST (high confidence) - shared mutable database state and order-dependent setup.

**Evidence:**

- Many failures were duplicate-seed or rate-limit errors such as `Duplicate fieldName: isInsurance`, `429` responses, and wrong aggregate counts.
- Failures disappeared when only files were shuffled while preserving within-file test order.
- Several files create one shared SQLite database in `beforeAll` and mutate it across tests, so within-file shuffle breaks assumptions about prior rows and login rate-limit state.

**Current containment:**

- `test:flaky` and `v2-flaky.yml` use `--sequence.shuffle.files`, which still detects file-order dependencies without shuffling tests inside a file.

**Follow-up work:**

- Refactor suites with shared `beforeAll` databases to use per-test fixtures or idempotent setup.
- Add unique IDs per test for seed data and reset in-memory rate-limit state between tests.
- After refactoring, re-run `--sequence.shuffle` and move it into the flaky gate.

**Resolution evidence:**

- Full shuffle passes: 234 files / 2381 tests.
- `test:flaky` now uses complete `--sequence.shuffle` and passed two runs.

## 2026-08-14 rounds 35-36: full within-file shuffle re-hardened

**Status:** Resolved — `test:flaky`（完整 `--sequence.shuffle`，含文件内顺序）
当前布局下双轮全绿，另加 3 轮不同随机种子共 **5 轮连续 3264/3264**。

**首次在当前测试布局（3264 用例）下运行完整 shuffle 即暴露 7 处真实顺序泄漏：**

1. `prescription-process.spec.ts`：CAS 守卫测试的 `db.prepare` spy 仅靠
   afterAll 恢复 → 后续所有处理测试误报「处方已处理」（单点致 8 测试失败）
   → 测试内 try/finally 恢复。
2. `charge.service.spec.ts`：迁移测试对 patient-edge 普通 INSERT 与 OR IGNORE
   助手互踩唯一约束 → 统一 OR IGNORE。
3. `triage.spec.ts`：CAS 改期测试目标时段与其他测试共享 → 冲突检测先于 CAS
   抛错 → 互斥时段。
4. `stats-service.spec.ts`：TTL 缓存测试依赖未超阈值库、快照测试依赖已超
   阈值库且互踩 StatSnapshot 行 → 5 个测试各自独立临时库。
5. `common.spec.ts`：`import('./common')` 缺 `vi.resetModules()` → 模块缓存
   使 production 缺密钥断言失效。
6. `VisitsPage.spec.tsx` / 7. `TreatmentsPage.spec.tsx`：在途守卫测试的挂起
   请求永不 resolve → 模块级 `transitionGuard` 永久占用行 id → 后续转移
   测试 PATCH 被吞 → resolve + act flush 释放。
   附带 `dispense.spec.ts`：测试复用前序测试插入的库存档案 → 自给自足。

**当前状态：** `test:flaky` 使用完整 `--sequence.shuffle`（flaky-detect.mjs），
近 3 条历史全 passed（flakinessRate 0），质量分反 flaky 输入 100%。
