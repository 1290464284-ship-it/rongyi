# Refactor V2 - Legacy Cleanup (Completed)

## Status

The V2 installer has been generated and verified. Legacy application
directories and obsolete root entry points have been deleted.

## Completed Cleanup

- Removed `apps/api`, `apps/web`, and `packages/shared`.
- Removed legacy root scripts, Docker files, changesets, and old documentation.
- Repointed root `package.json`, `.husky/pre-commit`, AGENTS, README, and CI to
  `apps/v2` only.
- V2 keeps a read-only compatibility copy at `apps/v2/legacy/`:
  - `schema/*.tables.ts`
- `apps/v2/legacy/dental.sqlite` was removed from the repository (R2-P0-04)
  and is gitignored, so fresh clones and upgraded clones do not contain it.
  Upgraders of an older clone must move the file outside the repository and
  point `V2_LEGACY_DB_PATH` at it explicitly
  (see the comment in `src/server/main.ts`).
- The packaged app bundles the remaining `legacy/` contents (schema) as
  `resources/legacy`; the legacy database itself is not part of the repository
  and must be supplied via `V2_LEGACY_DB_PATH`.

## Current Workspace

```text
source/
  apps/v2/            Electron desktop application
  docs/refactor-v2-*  V2 architecture and release documentation
  .github/workflows/  v2-ci.yml, v2-release.yml, v2-internal-release.yml and v2-windows-smoke.yml
```

## Verification

```powershell
pnpm --filter @dental/v2 run verify:database
pnpm --filter @dental/v2 run delivery:drill
pnpm --filter @dental/v2 smoke:api
pnpm --filter @dental/v2 smoke:ui
pnpm --filter @dental/v2 test:load
pnpm --filter @dental/v2 run verify:package
pnpm --filter @dental/v2 run verify:update
```
