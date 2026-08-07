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
  and is gitignored, then restored from the `v2-2.1.4` tag in Round 7 so
  packaging and fresh-install verification work again. It is still tracked in
  git today; see `src/server/main.ts` for the legacy import contract.
- The packaged app bundles the remaining `legacy/` contents (schema) as
  `resources/legacy`; the legacy database itself is not part of the repository
  and must be supplied via `V2_LEGACY_DB_PATH`.

## Current Workspace

```text
apps/v2/                 Electron desktop application
docs/architecture/       V2 architecture and cleanup documentation
docs/release/            Release modes and release pipeline documentation
docs/plans/              Migration and optimization plans
.github/workflows/       v2-ci.yml, v2-release.yml, v2-internal-release.yml and v2-windows-smoke.yml
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
