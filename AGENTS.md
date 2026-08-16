# AGENTS.md - Dental Clinic V2

This workspace is a single desktop application package. The legacy
`apps/api`, `apps/web`, and `packages/shared` code has been removed. The only
application workspace is `apps/v2`.

## Project Layout

```text
apps/v2/
  electron/        Electron main process, preload, tray, updater
  legacy/          Read-only legacy schema metadata and compatibility DB
  scripts/         Smoke, load, audit, package and update verification
  src/
    domain/        Entities, resource registry, repository contracts
    server/        Express API, application services, repositories
    web/           React desktop renderer
docs/              Architecture, delivery, plans, specs, audits and evidence
.github/workflows/ v2-ci, v2-release, v2-internal-release, v2-windows-smoke
```

## Commands

Run all commands from the repository root:

```powershell
pnpm install
pnpm --filter @dental/v2 typecheck
pnpm --filter @dental/v2 run lint
pnpm --filter @dental/v2 run knip
pnpm --filter @dental/v2 test
pnpm --filter @dental/v2 test:coverage
pnpm --filter @dental/v2 test:coverage:web
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 run clean:generated
pnpm --filter @dental/v2 dev
pnpm --filter @dental/v2 smoke:api
pnpm --filter @dental/v2 smoke:ui
pnpm --filter @dental/v2 smoke:packaged-ui
pnpm --filter @dental/v2 smoke:http-fuzz
pnpm --filter @dental/v2 smoke:multi-instance
pnpm --filter @dental/v2 test:load
pnpm --filter @dental/v2 run verify:package
pnpm --filter @dental/v2 run verify:update
pnpm --filter @dental/v2 run verify:remote
pnpm --filter @dental/v2 run verify:signature
pnpm --filter @dental/v2 run license:check
pnpm --filter @dental/v2 security:scan
pnpm --filter @dental/v2 restore:backup <backup> <target.sqlite>
pnpm --filter @dental/v2 run installer:smoke
pnpm --filter @dental/v2 run upgrade:smoke -CurrentInstallerPath <new> -PreviousInstallerPath <previous>
```

Root aliases are available:

```powershell
pnpm verify
pnpm verify:delivery
pnpm verify:smoke
pnpm verify:internal:delivery
pnpm build
pnpm electron:dist
pnpm --filter @dental/v2 electron:dist:internal
```

UI 视觉回归护栏（基线目录 `apps/v2/test-results/ui-baseline/`，详见 docs/audits/ui-redesign-统一方案.md 第九/十一章）：

```powershell
pnpm --filter @dental/v2 shots:ui-baseline   # 亮/暗关键页截图（UI_BASELINE_DIR/SCHEME 可覆盖）
pnpm --filter @dental/v2 shots:ui-diff       # before/after 像素 diff（UI_DIFF_PAIR 可过滤）
pnpm --filter @dental/v2 shots:ui-band       # 单对 x/y 带分布与平移分析
pnpm --filter @dental/v2 shots:a1-probe      # 弹窗遮罩层级探针
pnpm --filter @dental/v2 shots:ui-viewport   # 多视口/高DPI/打印媒体检查
pnpm --filter @dental/v2 verify:desktop-sync # 桌面包与源码逐项同步核验
pnpm --filter @dental/v2 styles:tokenize     # styles.css 刻度 token 化（幂等）
```

## Architecture Constraints

- SQLite remains the database. Use `better-sqlite3` with parameterized SQL.
- The legacy database is opened read-only during import and is never modified.
- All runtime data belongs under Electron `userData` in packaged mode.
- All HTTP inputs are validated through Express handlers and DTO-level checks.
- Soft-delete resources filter `deletedAt IS NULL` on list paths.
- Do not add production `any` or silent error swallowing in business paths.
- Do not introduce a new framework, ORM, or database engine.

## Delivery Gates

Before release:

1. `pnpm --filter @dental/v2 typecheck`
2. `pnpm --filter @dental/v2 test:coverage`
3. `pnpm --filter @dental/v2 build`
4. `pnpm --filter @dental/v2 electron:compile`
5. `pnpm --filter @dental/v2 run verify:package`
6. `pnpm --filter @dental/v2 smoke:api`
7. `pnpm --filter @dental/v2 smoke:ui`
8. `pnpm --filter @dental/v2 test:load`

Packaging is intentionally `--publish never`; release uploads are controlled by
`v2-release.yml` so signing and GitHub Release assets stay explicit.
