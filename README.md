# Dental Clinic V2

Desktop-first dental clinic management application built with Electron, React,
Express, and SQLite.

## Layout

```text
apps/v2/                 Electron desktop application (the only app workspace)
docs/                    Architecture, delivery, plans, specs and audit reports
docs/audits/             Audit reports, including historical rounds
docs/evidence/           Archived verification evidence and walkthroughs
docs/prototypes/         Standalone UI design prototypes
.github/workflows/       v2-ci and v2-release only
```

## Run

```powershell
cd <repo-root>\apps\v2
pnpm install
pnpm dev
```

Open the renderer at:

```text
http://localhost:5180
```

The API listens on `http://127.0.0.1:3180/api/v2` by default. On Windows, port
`3180` may be excluded by the system (excludedportrange); if the API fails to
start, use another port, e.g. `$env:V2_PORT = '3980'` before `pnpm dev`. The
Vite dev proxy reads the same `V2_PORT` (default 3180) and forwards `/api`
automatically, so no extra proxy configuration is needed.

Default development login:

```text
username: admin
password: REDACTED
```

Production first start bootstraps the admin account from `V2_ADMIN_PASSWORD`
(min 6 chars). The bundled legacy database is sanitized and ships without
users, password hashes or refresh tokens. See
[docs/delivery/admin-bootstrap.md](docs/delivery/admin-bootstrap.md).

> Round7 I4：`admin/REDACTED` 仅为开发环境默认账号（生产启动拒绝 seed 默认
> 账号）。首次进入任何非开发环境必须先创建/修改管理员密码，禁止沿用默认
> 密码。

开发环境如需自动重置 admin 密码（默认 `REDACTED`，可用 `V2_ADMIN_PASSWORD`
覆盖），需显式设置 `V2_ALLOW_DEV_SEED=1`。

> Round7 H6：仓库根 `apps/v2` 是 GitHub 实际生效的唯一副本。历史遗留的
> `source/` 嵌套副本（含独立 `.git`）已废弃并在合并后删除；请勿再在其中
> 开发，避免"本地过了、CI 红"的漂移问题。

## Desktop

```powershell
pnpm electron:dev
pnpm electron:dist
```

The installer is generated under `apps/v2/release-v2/`. In packaged mode:

- Runtime data and backups live under Electron `userData`.
- The legacy compatibility database is copied from the bundled resources into
  the working data directory.
- The API listens on a random localhost port and is supervised by the Electron
  main process.
- Sessions use short-lived access tokens with rotating refresh tokens.
- Backups are encrypted with a per-install key, automatically created, verified,
  staged for restore, and cleaned by retention policy.

## Verification

```powershell
pnpm verify
pnpm verify:delivery
pnpm verify:smoke
pnpm --filter @dental/v2 smoke:api
pnpm --filter @dental/v2 smoke:ui
pnpm --filter @dental/v2 test:load
pnpm --filter @dental/v2 run verify:package
```

For a free internal release build on Windows:

```powershell
pnpm --filter @dental/v2 electron:dist:internal
```

Public release still requires a CA-issued code signing certificate; see
[docs/release/release-modes.md](docs/release/release-modes.md).

## Release

See [apps/v2/RELEASE.md](apps/v2/RELEASE.md) and
[docs/release/refactor-v2-release.md](docs/release/refactor-v2-release.md).
