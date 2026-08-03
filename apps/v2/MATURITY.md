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
- Metrics persistence to `logs/metrics.json` and Electron crash log file.
- Electron `win-unpacked` directory package verified with electron-builder.
- NSIS Windows installer `Dental Clinic V2 Setup 2.0.0.exe` generated successfully.
- Direct dependency license scan gate.
- GitHub release workflow publishes installer, blockmap, and latest update metadata.
- Optional remote crash reporting via `V2_CRASH_REPORT_URL`.
- Installer/package artifact verification script.
- Local signing pipeline verified with a development self-signed certificate.
- `latest.yml` update metadata generation and verification.
- Application icon integrated into Windows package, removing default icon warning.
- Deliverable release artifacts and post-install verification documented in RELEASE.md.

## Remaining

- Raise global coverage to the final 80% target.
- Add a clean-machine installer upgrade exercise with a real code signing certificate.
- Verify the live GitHub Release update channel after the first signed `v2-*` tag.
