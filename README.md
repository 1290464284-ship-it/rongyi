# Dental Clinic V2

Desktop-first dental clinic management application built with Electron, React,
Express, and SQLite.

## Run

```powershell
cd D:\Desktop\rongyi\source
pnpm install
pnpm dev
```

Open the renderer at:

```text
http://localhost:5180
```

The API listens on `http://127.0.0.1:3180/api/v2` by default. On Windows, port
`3180` may be excluded by the system (excludedportrange); if the API fails to
start, use another port, e.g. `$env:V2_PORT = '3980'` before `pnpm dev`.

Default development login:

```text
username: admin
password: admin123
```

开发环境如需自动重置 admin/admin123，需显式设置 `V2_ALLOW_DEV_SEED=1`。

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
[docs/release-modes.md](docs/release-modes.md).

## Release

See [apps/v2/RELEASE.md](apps/v2/RELEASE.md) and
[docs/refactor-v2-release.md](docs/refactor-v2-release.md).
