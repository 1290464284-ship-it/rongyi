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
password: admin123
```

The API listens on:

```text
http://localhost:3180/api/v2
```

On first startup, V2 copies the bundled compatibility database at
`apps/v2/legacy/dental.sqlite` into `apps/v2/data/v2.sqlite` in development, or
into Electron `userData/data/v2.sqlite` in packaged mode. The original database
is never modified. All legacy tables are synchronized into the V2 working copy
so existing data and fields remain available.

## Security and Resource Names

- Generic resources use canonical names such as `patients`, `charges`, and
  `printTemplates`. Legacy SQLite table names such as `User` or `Charge` are not
  exposed as generic resource routes.
- Production refuses to seed an `admin/admin123` account. Provision the admin
  user through the packaged database or migration tooling before production
  startup.
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
$body = @{ username = 'admin'; password = 'admin123' } | ConvertTo-Json
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

## Sidebar Groups

The desktop sidebar exposes large business areas only. Each area opens one Hub page with tabs:

- 工作台: dashboard
- 患者与预约: patient files, appointments, appointment board, patient timeline, family members, risk scores
- 临床记录: visits, first exams, treatments, records, plans, imaging, cephalometric, prescriptions
- 财务中心: charges, member cards, refunds, debts, invoices
- 库存与采购: inventory, suppliers, purchase orders, processing orders
- 经营分析: dashboard, monthly report, inventory report, RFM, churn warning, doctor anomalies, satisfaction
- 随访与沟通: follow-ups, WeChat, SMS, satisfaction
- 人事与设备: staff, schedules, attendance, leaves, equipment
- 系统管理: backups, settings, alerts, operation logs, sync records
