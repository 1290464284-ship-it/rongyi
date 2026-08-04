# V2 Maturity Checklist

## Done

- Desktop-first renderer with merged sidebar hubs.
- Legacy database copy and legacy table metadata adapter.
- 141 resources exposed through declarative/dynamic resource definitions.
- Core workflows: auth, appointments, registrations, visits, charges, refunds, member cards, inventory, purchase orders, processing orders, follow-ups, backups, analytics, sync, print, HR, alerts, notifications.
- Production config validation for JWT secret and CORS.
- CORS whitelist with localhost defaults.
- Sensitive field masking and protected generic write fields.
- Idempotency for charge pay, refund, member card operations, inventory transactions, debt payments.
- Structured JSON logger with local file output.
- Request metrics and deep health endpoint.
- Versioned migrations with `schema_migrations`.
- Online SQLite backup and backup integrity verification.
- Rate limiting for login and generic resource writes.
- CI workflow for typecheck, unit tests, build, Electron compile, API smoke, UI smoke.
- Electron builder configuration and packaged API path.
- Repository ports and SQLite implementations for auth, charge, member card, inventory, debt, purchase orders, processing orders, follow-ups, WeChat, analytics, alerts, patient risk, HR, and clinical workflows.
- UnitOfWork adapter with commit/rollback tests.
- Member-card payment and refund rollback with transaction tests.
- Legacy import preflight integrity check and target backup.
- Electron random API port, tray, auto-launch IPC, API restart, and close-to-tray behavior.
- Coverage baseline, dependency audit, and load smoke gate.
- Auto-update entry point exposed through Electron IPC.
- Repository, service, middleware, validation, and HTTP integration tests raising global coverage to ~76.6%.
- Desktop settings page with API port, auto-launch, API restart, and update check.
- Generic resource forms load relation options from target resources.
- Source-level security scanner and audit gate.
- Dedicated desktop workflow pages for clinical transitions, HR approval, and financial operations.
- System operations page for bulk import and global search.
- Patient risk workflow page for on-demand risk calculation and history.
- Coverage threshold raised to 75/55/85/80 after reaching the line coverage target.
- Coverage final target reached at 81.19% statements / 64.83% branches /
  91.43% functions / 84.6% lines, and the gate was raised to 80/60/90/84.
- Coverage raised to 100% statements, 100% branches, 100% functions, and
  100% lines through service, HTTP, router, repository, migration, and boundary
  tests. The delivery gate is now 100/100/100/100; only schema- or
  SQL-guaranteed defensive branches are explicitly ignored with documented
  rationale.
- Metrics persistence to `logs/metrics.json` and Electron crash log file.
- Electron `win-unpacked` directory package verified with electron-builder.
- NSIS Windows installer `Dental Clinic V2 Setup 2.0.0.exe` generated successfully.
- Direct dependency license scan gate.
- GitHub release workflow publishes installer, blockmap, and latest update metadata.
- Optional remote crash reporting via `V2_CRASH_REPORT_URL`.
- Rotating refresh-token sessions with logout and password-change invalidation.
- Operation/audit logging middleware for all authenticated writes.
- Encrypted SQLite backups, automatic backup scheduler, restore staging, and
  retention cleanup.
- Inventory expiry warnings and demand-based replenishment calculations.
- Cross-resource masked search across patients, appointments, charges,
  inventory, suppliers, and follow-ups.
- JSON/CSV file import entry point in the desktop renderer.
- Doctor satisfaction rankings and sync change-log cleanup.
- Remote update-channel verification against the published GitHub Release.
- Windows NSIS installer smoke: silent install, installed API health, silent
  uninstall.
- Upgrade smoke: reinstall over an existing installation while preserving
  user data, then verify the upgraded API.
- Release workflow downloads the previous `v2-*` installer and runs the
  upgrade smoke on a fresh Windows runner when a previous release exists.
- Fresh Windows runner upgrade smoke passed for `v2-2.1.3 -> v2-2.1.4`,
  preserving user data and verifying the upgraded API.
- Release workflow refuses self-signed development certificates via
  `verify:signature`.
- Charge discount support with cents validation.
- Follow-up adherence scoring endpoint.
- Automatic backup failure creates a scheduler task business alert.
- Sync push applies allowed row changes instead of only recording change log.
- knip dead-code/dependency gate included in `pnpm verify`.
- Installer/package artifact verification script.
- Local signing pipeline verified with a development self-signed certificate.
- `latest.yml` update metadata generation and verification.
- Application icon integrated into Windows package, removing default icon warning.
- Deliverable release artifacts and post-install verification documented in RELEASE.md.
- Free internal release path with temporary self-signed certificate, package
  verification, update metadata, and installer smoke.
- GitHub Actions internal release workflow publishes self-signed installers to
  `v2-internal-*` tags without CA secrets or public-signature verification.
- Remote internal release `v2-internal-2.1.4` published to GitHub with
  installer, blockmap, and `latest.yml`, and remote update metadata verified.
- Local full smoke runner that starts API and Web, then runs API smoke, UI
  smoke, and load smoke.
- Foreign-key migration `116` now covers ChargeItem, PurchaseOrderItem,
  InventoryTransaction, and ProcessingOrder in addition to MemberCard and
  Refund; the rebuild helper refuses DDL that would drop existing columns.
- `verify:foreign-keys` scans 19 core relations for orphan rows.
- Charge payment/refund repository writes enforce clinic scope, and
  prescription safety, treatment progress, and cephalometric service reads and
  updates are scoped to the active clinic and ignore soft-deleted rows.
- Admin user updates and password resets enforce clinic scope at the
  repository layer, with a cross-clinic regression test.
- Staged restore removes stale SQLite WAL/SHM sidecars before activating,
  preventing restored databases from failing the startup integrity check.
- Backup verification and staging clear SQLite sidecars, and retention cleanup
  deletes matching `BackupRecord` rows instead of leaving stale history.
- Backup filenames include a random suffix so same-millisecond creates cannot
  overwrite each other, and retention cleanup clamps `maxKeep` to `1..365`.
- Staged restore creates the pre-restore safety copy with SQLite `VACUUM INTO`
  when the current database is valid, preserving WAL data instead of copying
  only the main database file.
- Legacy database import uses the same WAL-safe SQLite backup helper for both
  the source copy and the existing-target pre-import backup.
- Sync delete and generic resource delete verify the target exists before
  reporting success, removing remaining fake-success paths for missing rows.
- Appointment status transitions use the shared clinic-scope helper for both
  lookup and update instead of relying on a manual clinic comparison.
- Patient hub includes an appointment board with status-column summaries,
  date filtering, and inline status transitions.
- Patient hub also includes a patient timeline that merges visits, treatments,
  charges, and follow-ups into a single chronological view.
- Multi-clinic membership is stored in `UserClinic`; only BOSS users can access
  and switch between multiple clinics through `/auth/clinics` and
  `/auth/switch-clinic`.
- Generic resources support CSV export through
  `GET /api/v2/resources/:resource/export`, including multi-page row export,
  with an Export button in the generic resource page.
- Analytics hub includes a fixed monthly revenue report backed by the existing
  revenue statistics endpoint, plus an inventory summary report.
- Communication hub includes a follow-up adherence report showing total,
  on-time, and adherence rate.
- BOSS clinic switches record an explicit audit entry with from/to clinic ids,
  and clinic memberships only reference active existing clinics.
- Cross-clinic regression coverage verifies analytics, search, sync pull,
  replenishment, generic resource lists, and CSV export are isolated by
  active clinic.
- Follow-up reminders support completion through `PATCH
  /api/v2/follow-ups/:id/complete`, with clinic scope, status conflict checks,
  optional result text, and an in-table UI action.
- Follow-up reminders are grouped into overdue, today, and upcoming sections
  on the communication workflow page.
- WeChat send, leave approval, and business alert transitions now reject
  terminal or disallowed source statuses instead of reporting false success.
- Backup verification and restore staging return core database summaries,
  including clinic/user/membership/patient/charge/card/inventory/follow-up/
  purchase counts and the latest paid charge timestamp.
- The backup page renders the staged backup and current database summaries
  side by side before the restart-based restore is activated.
- Inventory workflow page completes the replenishment loop in one place:
  generate suggestions, select and apply them to purchase orders, then receive
  pending orders with supplier and amount visible.
- Purchase orders expose item details through
  `GET /api/v2/purchase-orders/:id/items`, and the inventory workflow page
  shows purchase order line items for quantity/price verification.
- Purchase receiving returns per-line receipt details with before/after stock,
  so operators can verify exactly what entered inventory.
- Follow-up reminders expose a due-state summary endpoint
  (`GET /api/v2/follow-ups/reminders/summary`) and the follow-up page shows
  total/overdue/today/upcoming counts alongside the grouped reminder tables.
- Follow-ups support batch completion through
  `POST /api/v2/follow-ups/batch-complete`, with per-item failure summaries,
  and CSV export through `GET /api/v2/follow-ups/reminders/export`.
- BOSS users can view all-clinic business metrics through
  `GET /api/v2/analytics/clinic-overview`, including patients, appointments,
  charges, paid/unpaid amounts, inventory, and pending follow-ups by clinic.
- Bulk import is processed in configurable transactional chunks (default 100,
  max 1000 rows per chunk, 10000 rows per request), so a failed chunk does not
  discard unrelated chunks.
- Upgrade smoke now creates, verifies, and stages a backup restore against the
  previous installation before installing the current release, covering the
  backup/restore + upgrade data-preservation path in the release gate.
- Backup service was extracted from `operations.ts` into
  `service-modules/backup.ts`, reducing the operations module from roughly 680
  lines to 485 lines without changing behavior.
- Sync, HR, and alert services were extracted into `sync.ts` and
  `hr-alerts.ts`; `operations.ts` now only contains inventory and follow-up
  services at roughly 222 lines.
- `workflow-services.ts` became a four-line barrel; clinical workflow,
  replenishment, WeChat, analytics, charge assistant, and print template
  services now live in dedicated `service-modules/*.ts` files.
- Shared `DataTable` and `PageError` components were added to
  `src/web/components.tsx`; follow-up and backup pages now reuse `DataTable`,
  and the inventory workflow page now uses it for purchase, processing, and
  replenishment tables. `SimpleListPage` also uses `DataTable`, including
  optional keyless rows for report data. The shared component is included in
  the web coverage gate.
- Web coverage now includes follow-up, backup, simple list, and inventory
  workflow pages plus the inventory, charges, and finance workflow pages, in
  addition to communication, HR, clinical, patient workflow, and appointment
  board, patient timeline, dashboard, and appointments pages, resource
  hub/page, hub tabs, system operations, login, and shared components; the
  expanded set also includes the application layout and follow-up report; it
  now also includes desktop settings and the clinic overview page; it passes
  99.02% statements, 93.05% branches, 98.74% functions, and 100% lines against
  tightened gates of 98.5/92.5/98.5/100.
- Removed the entire unused ReactBits experiment directory
  (`src/components/reactbits`), its jsrepo config, its dedicated tsconfig, and
  all experiment-only dependencies; ESLint, knip, security scan, and license
  scan no longer need component quarantine exceptions.
- `clean:generated` removes any `dist-*` output directory rather than a fixed
  hard-coded list.

## Remaining

No blockers for the agreed internal delivery scope. Public CA signing is
explicitly not required by the current product decision and is left as optional
future work if external distribution is ever requested.
