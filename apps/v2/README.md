<!-- L-05 文档定位：本文件 = 使用与开发入口（启动、端口、API 示例、冒烟测试、项目结构）。
     生产就绪成熟度清单见 MATURITY.md；发布产物/签名/更新通道见 RELEASE.md。
     三者按各自角色维护，避免重复铺陈交叉内容。 -->
# Dental Clinic V2

Refactored desktop-first implementation of the dental clinic management system.

## Run

```powershell
cd D:\Desktop\rongyi\source
pnpm install
pnpm --filter @dental/v2 dev
```

Open the renderer at:

```text
http://localhost:5180
```

Default login:

```text
username: admin
password: ry0801
```

The API listens on:

```text
http://localhost:3180/api/v2
```

### Ports (端口说明)

- 开发模式下 API 默认监听 `http://127.0.0.1:3180`（`V2_PORT` 可改，
  `src/server/main.ts`），渲染端为 Vite dev 端口 `http://localhost:5180`。
- **Windows 注意**：`3180` 可能落在系统"排除端口保留"
  （excludedportrange）范围内，此时 API 无法监听、进程报错退出。改用
  其他端口启动即可：

  ```powershell
  $env:V2_PORT = '3980'
  pnpm --filter @dental/v2 dev
  ```

  `V2_PORT` 必须是 1-65535 的整数；CORS 白名单会跟随 `V2_PORT` 自动放行
  （`src/server/http/app.ts`），Vite dev 代理也读取 `V2_PORT`
  （`vite.config.ts`，默认 3180），`/api` 自动转发到当前端口，无需额外配置。
- 打包版（Electron）会自动挑选随机空闲端口（30000-50000）并注入 API 子进程，
  以上说明仅适用于开发模式。

On first startup, V2 imports the legacy compatibility database pointed to by
`V2_LEGACY_DB_PATH` into `apps/v2/data/v2.sqlite` in development, or into
Electron `userData/data/v2.sqlite` in packaged mode. The original database is
never modified. All legacy tables are synchronized into the V2 working copy so
existing data and fields remain available.

### Legacy database migration (老克隆升级)

`apps/v2/legacy/dental.sqlite` has been removed from the repository (R2-P0-04):
the patient database is no longer tracked by git, so fresh clones and upgraded
clones do not contain it. Upgraders of an older clone should:

1. Move the old `apps/v2/legacy/dental.sqlite` to any path outside the
   repository, e.g. `D:\legacy\dental.sqlite`.
2. Point the `V2_LEGACY_DB_PATH` environment variable at that file when
   starting the app:

   ```powershell
   $env:V2_LEGACY_DB_PATH = 'D:\legacy\dental.sqlite'
   pnpm --filter @dental/v2 dev
   ```

3. On startup the API automatically imports it into `v2.sqlite` when the V2
   database does not exist yet. The legacy file itself is never modified.

## Security and Resource Names

- Generic resources use canonical names such as `patients`, `charges`, and
  `printTemplates`. Legacy SQLite table names such as `User` or `Charge` are not
  exposed as generic resource routes.
- Production refuses to seed a default `admin` account with development
  credentials (`ry0801`; overridable via `V2_ADMIN_PASSWORD`). Provision the
  admin user through the packaged database or migration tooling before
  production startup.
- Sync push/pull requires a registered device token. Register a device with
  `POST /api/v2/sync/devices` and pass `deviceToken` to sync requests.
- Business workflows enforce tenant scope for the current user's `clinicId`.
- BOSS users can access multiple clinics through `UserClinic` memberships and
  switch the current clinic from the desktop sidebar.
- Resources can be exported as CSV with
  `GET /api/v2/resources/:resource/export`.

## Electron

```powershell
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 exec electron .
```

## API Examples

Login:

```powershell
$body = @{ username = 'admin'; password = 'ry0801' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3180/api/v2/auth/login' `
  -ContentType 'application/json' -Body $body
$headers = @{ Authorization = "Bearer $($login.data.token)" }
```

List patients:

```powershell
Invoke-RestMethod `
  -Uri 'http://localhost:3180/api/v2/resources/patients?page=1&pageSize=20' `
  -Headers $headers
```

Create a charge:

```powershell
$charge = @{
  patientId = 'patient-demo-001'
  items = @(
    @{ name = 'Examination'; category = 'EXAM'; price = 100; quantity = 1 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3180/api/v2/charges' `
  -Headers $headers -ContentType 'application/json' -Body $charge
```

## Smoke Tests

```powershell
pnpm --filter @dental/v2 dev
pnpm --filter @dental/v2 smoke:api
pnpm --filter @dental/v2 smoke:ui
```

`smoke:api` verifies login, generic CRUD, appointments, charges, inventory, member cards, patient risk, follow-ups, backups, stats, satisfaction, sync, HR, alerts, notifications, search, print, and bulk import. `smoke:ui` verifies that the desktop renderer reaches login, dashboard, appointments, charges, inventory, follow-ups, backups, and patient resource pages.

## Maturity

See `MATURITY.md` for the current production-readiness checklist.

## Release

Packaging, signing, update channel, internal builds, and post-install
verification are documented in `RELEASE.md`.

## Layout

```text
src/
  domain/           Entities, enums, resource registry, repository ports
  server/
    application/    Auth, appointments, charges, inventory, follow-ups, backups, stats
    infrastructure/ SQLite schema, seed, repository, clock, events, errors
    http/           Express app, middleware, generic resource router
  web/              React renderer used by the desktop app
electron/           Electron main and preload
```

## Project Scale

Verified 2026-08-05:

- 约 3.5 万行 TypeScript/TSX（`src/`，含测试代码）
- 139 个测试文件（90 个服务端 `*.spec.ts` + 48 个 Web `*.spec.tsx` + 1 个领域 `*.spec.ts`）
- 1259 个测试用例（服务端 877 + Web 380 + 领域 2，最近一次 vitest 全量运行记录）

## Sidebar Groups

The desktop sidebar exposes large business areas only. Each area opens one Hub page with tabs:

- 工作台: dashboard
- 患者与预约: patient files, appointments, appointment board, patient timeline, family members, risk scores
- 临床记录: visits, first exams, treatments, records, plans, imaging, cephalometric, prescriptions
- 财务中心: charges, member cards, refunds, debts, invoices
- 库存与采购: inventory, suppliers, purchase orders, processing orders
- 经营分析: dashboard, monthly report, inventory report, RFM, churn warning, doctor anomalies, satisfaction
- 随访与沟通: follow-ups, follow-up adherence, WeChat, satisfaction
- 人事与设备: staff, schedules, attendance, leaves, equipment
- 系统管理: backups, settings, alerts, operation logs, sync records
