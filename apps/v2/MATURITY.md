<!-- L-05 文档定位：本文件 = 生产就绪成熟度清单（Done / Remaining），逐项追加验证过的能力。
     使用与开发入口见 README.md；发布产物/签名/更新通道见 RELEASE.md。 -->
# V2 Maturity Checklist

## Done

- Desktop-first renderer with merged sidebar hubs.
- Legacy database copy and legacy table metadata adapter.
- 110 resources exposed through declarative/dynamic resource definitions
  (78 declarative CRUD + 32 legacy-compatibility).
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
- Coverage gates are enforced at 95/85/97/95 for server and domain code and
  86/75/84/90 for web code based on v8 measurements; schema- or SQL-guaranteed
  defensive branches are explicitly excluded with documented rationale.
- Metrics persistence to `logs/metrics.json` and Electron crash log file.
- Electron `win-unpacked` directory package verified with electron-builder.
- NSIS Windows installer `Dental-Clinic-V2-Setup-2.2.0.exe` generated successfully.
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
- Remote internal release `v2-internal-2.2.0` published to GitHub with
  installer, blockmap, and `latest.yml`, and remote update metadata verified.
- Local full smoke runner that starts API and Web, then runs API smoke, UI
  smoke, and load smoke.
- Foreign-key migration `116` now covers ChargeItem, PurchaseOrderItem,
  InventoryTransaction, and ProcessingOrder in addition to MemberCard and
  Refund; the rebuild helper refuses DDL that would drop existing columns.
- `verify:foreign-keys` scans 36 core relations for orphan rows.
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
  now also includes desktop settings and the clinic overview page. 当前实测为
  100% statements / 100% branches / 100% functions / 100% lines，门槛
  86/75/84/90（vite.web-coverage.config.ts）。
- Removed the entire unused ReactBits experiment directory
  (`src/components/reactbits`), its jsrepo config, its dedicated tsconfig, and
  all experiment-only dependencies; ESLint, knip, security scan, and license
  scan no longer need component quarantine exceptions.
- `clean:generated` removes any `dist-*` output directory rather than a fixed
  hard-coded list.
- P5 analytics was upgraded to a chart-based business dashboard with date
  filtering, revenue/patient-growth/inventory/satisfaction/doctor views, CSV
  export, and print-to-PDF entry points.
- HR received dedicated Chinese pages for work schedules, attendance, leave
  requests, and equipment, replacing generic resource tables for those core
  operations.
- Follow-up management now has Chinese template management, dialog-based
  completion, batch completion, overdue export, and grouped reminder views
  without native `prompt` usage.
- Finance workflow now uses an amount dialog instead of native `prompt`, with
  yuan input, validation, request IDs, and Chinese operation labels.
- WeChat delivery was changed to a provider interface: unconfigured channels
  explicitly show “未开通”, disable send, and never mark messages as sent;
  HTTP provider failures leave the message in a sendable state.
- API listens on `127.0.0.1` by default; deep health and metrics endpoints now
  require an authenticated BOSS role.
- Renderer CSP was added in the built HTML with a dev-only relaxed CSP for Vite
  HMR, plus Electron navigation whitelist, sandboxed web preferences, denied
  permission requests, and disabled webview attachment.
- Electron main now uses the packaged application icon for the tray, remembers
  window bounds/maximized state, reports renderer process crashes, and uses a
  native `crashReporter` when configured.
- API child process shutdown is graceful through IPC with a hard-kill timeout;
  crash/restart status is emitted to the renderer and repeated failures show a
  user notification instead of silently looping.
- Auto updates are enabled by default in packaged builds (can be disabled with
  `V2_DISABLE_AUTO_UPDATE=1`); IPC events cover checking, available, progress,
  downloaded, error, and install, and the desktop settings page renders them.
- P7 delivery assets were added under `docs/delivery/`: install guide,
  admin initialization, backup/restore, troubleshooting, rollback, acceptance
  checklist, and delivery drill documentation.
- `delivery:drill` automates the legacy import -> create data -> encrypted
  backup -> verify -> corrupt -> restore -> restart -> consistency check path.
- The communication page includes a built-in WeChat message template library
  (appointment reminder, treatment recall, first-exam follow-up) with copy and
  sample rendering; content comes from `wechatReminder.*Content` settings.
- Patient records support `wechatId`, `preferredContact` and `contactNote`;
  WeChat sends include the patient `wechatId` in the gateway payload.
- WeChat reminder timing (`appointmentDaysBefore`, `recallDaysAfter`,
  `firstExamDaysAfter`) is editable from the communication page and persisted
  through `PATCH /wechat-reminders/config`.
- Electron provides an edit menu and native clipboard bridge; copy buttons use
  `window.desktop.copyText` when available and fall back to
  `navigator.clipboard`.
- Electron main-process unit tests cover secrets, renderer trust boundary,
  logging, cert trust, tray setup, and API child shutdown with mocked
  `electron`; packaged UI smoke remains the end-to-end desktop check.
- `simulate:clinic-data` generates a realistic relational clinic database
  (patients, appointments, visits, charges, inventory, member cards, purchase
  orders, follow-ups) and `smoke:simulated-data` runs the API suite against it;
  the generated database passes `integrity_check` and the foreign-key scan.
  `V2_SIM_DIRTY=1` also injects duplicate phones, overlapping appointments and
  overdue follow-ups to simulate dirty legacy data.
- `smoke:packaged-ui-simulated` launches the packaged desktop app against the
  simulated clinic database and verifies login plus the patient list render.
- `disaster:drill` verifies that restoring with the wrong backup key or a
  corrupt backup fails closed without writing the target database, then
  restores the good backup and confirms integrity.
- `drill:legacy-dirty` injects CHECK-constraint violations (negative balances,
  zero refunds, zero quantities) into a legacy copy and verifies the import
  fails closed with a clear integrity error instead of crashing later.
  `legacy-import` now validates the copied target with a read-write connection
  so readonly `integrity_check` can no longer skip those constraints.
- `drill:crash` writes data, force-kills the API process, restarts it, and
  verifies the patient survives and the database integrity check passes,
  simulating power loss / abrupt termination recovery.
- Analytics query indexes (Charge patient/paid, ChargeItem category, Visit
  patient/created) plus a simpler RFM total query cut the simulated 2000-patient
  RFM response from roughly 1.2s to 6ms.
- Search-index rebuild now runs after the API starts listening, so large
  databases do not block first-start health checks.
- Treatment-plan print preview supports browser print/PDF output with A4 page
  rules and print-only layout cleanup.
- Commission rule configuration is built into the HR hub: rules support
  PERCENT/FIXED rates, category/costType/doctor scoping, and monthly
  calculation snapshots (`CommissionRule` / `CommissionStatement`, migration
  154, `/api/v2/commission/*`).
- Navigation was reorganized around the clinic staffing split: a dedicated
  front-desk hub (挂号分诊/预约/预约看板/分诊科室) now owns triage, the clinical
  hub hides triage and charge actions from the doctor workflow, patient hub is
  records-only, duplicate analytics tabs (工作台/满意度/医生异常) were removed,
  large hubs render grouped tabs (常用/资料/运维/配置), the sidebar uses
  semantic groups, and every hub has a page filter for discoverability.
- Web coverage raised to 95.42% statements / 87.15% branches / 94.39%
  functions / 97.61% lines across 206 test files / 1941 cases; focused specs
  for schedules, imaging, medical records, commission pages, dispense
  list/action components, cephalometric form/report/overlay rendering,
  first-exam history/teeth/tracking dialogs, patient archive full-field
  submission, medical-record edit-request failure paths, shared status/query
  components, searchable selects, primitive edge cases, the core HTTP client
  (idempotent retry, 401 replay, error metadata, multi-page fetch), the
  inventory page (validation, barcode location, loading/retry, batch failure
  paths), the appointment page/purpose panel (failure fallbacks, edit
  validation, raw phone backfill, pagination), the employee account page
  (loading/error states, save/delete/reset/permission failure paths), the
  clinical workflow dialogs/board/queue (charge, record, follow-up, triage,
  kanban moves, today overview, queue filtering), error-message pattern
  branches, treatment-plan utils/print/form, commission rule failure paths,
  purchase-order reconcile/review/receive unit paths and form-field
  backfill/locking, processing-order utils/reconcile/form/columns, imaging
  form/columns, follow-up dictionary CRUD/filter/error states, FormBuilder
  field types and relation loading, charge list/form/combo/tree panels,
  imaging page failure paths, first-exam failure paths, timeline SELECT/NUMBER
  custom fields, and MultiSelect and KanbanBoard edge cases raised
  `medical-records` to 100/87.5/100/100, `dispense` to
  95.83/81.97/95.65/97.6, `cephalometric` to 97.24/89.85/95.45/96.96,
  `first-exams` to 94.69/81.2/94.44/97.16, `PatientsPage` to
  100/82.75/100/100, `MedicalRecordsPage` to 97.05/89.65/97.14/100,
  `web/components` to 89.96/89.5/79.89/97.94, `web/lib/api.ts` to
  90.86/79.85/85.36/93.56, `web/lib/messages.ts` to 98.21/94.73/100/97.05,
  `InventoryPage` to 91.3/82.08/84.78/94.25, `AppointmentsPage` to
  99.29/91.83/100/100, `AppointmentPurposePanel` to 98.61/92.11/100/100,
  `UsersPage` to 97.88/83.95/100/100, `web/clinical-workflow` to
  99.38/84.35/98.5/99.32, `treatment-plans` to 97.16/83.33/100/97.91,
  `CommissionPage` to 98.87/80.85/100/100, `purchase-orders` to
  97.22/82.2/97.72/98.96, `processing-orders` to 97.7/77.38/100/100,
  `imaging` to 100/82.69/100/100, `follow-ups` to 96.87/80/95.45/96.66,
  `FormBuilder` to 100/97.05/100/100, `charges` to 98.75/85.29/100/98.55,
  `ImagingPage` to 92.4/77.77/85.71/93.33, `PatientTimelinePage` to
  96.25/87.38/97.22/98.5, and `MultiSelect` to 89.79/84.61/100/90.9; the web
  gate is enforced at 86/75/84/90. The latest batch adds failure-path specs
  for `VisitsPage`, `CephalometricPage`, `MedicalRecordsPage`,
  `PurchaseOrdersPage`, and the `DispenseNarcoticPanel`
  (create/update/delete/status errors, upload/report/WeChat/overlay-compare
  failures, resubmit failure, and edit/delete cancel paths). The following
  batch deepens the same pages with full-field edit-request submission,
  Escape/cancel close paths, in-flight submit guards, all optional narcotic
  fields, and successful edit/delete flows, raising `MedicalRecordsPage` to
  97.05/89.65/97.14/100, `CephalometricPage` to 94.2/83.33/95/93.93,
  `PurchaseOrdersPage` to 97.62/74.07/100/100, `DispenseNarcoticPanel` to
  98.96/88.23/100/100, and pushing web function coverage above 90%. The next
  batch covers processing flow close/load/advance/adjust/unsettle failures,
  update partial-save hints, dropped-detail warnings, full-field appointment
  edits, phone backfill failure and stale-response guards, delete cancel via
  the confirm dialog, last-page rollback, previous-page navigation, edit
  in-flight guards, and Drawer/Dropdown reopen and double-close paths,
  raising `ProcessingOrdersPage` to 93.75/80.89/100/100, `AppointmentsPage`
  to 99.29/91.83/100/100, `Drawer` to 90.47/86.36/100/88.57, and `Dropdown`
  to 92.3/85.71/100/94.11. The latest batch covers layout keyboard shortcuts,
  navigation/resource-meta error retries, backup time labels and navigation,
  commission form fields with busy guards and delete cancel, user delete
  success, full-field create and dialog cancel paths, generic page stat
  formatting/errors, select-all/cancel-selection, partial batch delete
  failures, last-page rollback, and search-aware CSV export, raising
  `Layout` to 100/87.95/97.5/100, `UsersPage` to 97.88/83.95/100/100,
  `CommissionPage` to 98.87/80.85/100/100, and `ResourcePage` to
  98.12/87.71/100/100. The latest batch adds refund fallback fields and
  zero-count chips, retry and non-Error query failures, backup retry plus
  create/verify busy guards, unencrypted and non-ok verification toasts,
  staged restore fallback messages and unknown summary keys, sync conflict
  null timestamps and header refresh, and patient unknown labels, skipped
  duplicate checks, code-only duplicate checks, and string allergy prefill,
  raising `RefundsPage` to 100/97.43/100/100, `PatientsPage` to
  100/82.75/100/100, `BackupsPage` to 97.14/84.37/100/100, and
  `SyncConflictsPage` to 96.15/85.71/100/100. The latest batch adds purpose
  full-field edits with dialog cancel and busy guards, treatment full-field
  creates and zero-price validation, analytics charts with missing numeric
  fields and print failures, and inventory receiving with busy guards, empty
  suggestion applications, stocktake validation/save failures, required
  stocktake numbers, and locked-stocktake cancel paths, raising
  `AppointmentPurposePanel` to 98.61/92.11/100/100, `TreatmentsPage` to
  97.92/74.6/100/100, `AnalyticsDashboardPage` to 98.78/76.41/97.22/100, and
  `InventoryWorkflowPage` to 99.31/74.4/100/100. The latest batch covers
  follow-up dialog open/close and registration transition failures, plan edit
  loading guards, dropped-detail warnings, orphan cleanup and detail delete
  failure paths, print/sign/billing/follow-up dialog close paths, dispense
  edit item changes and invalid-row warnings, dispense cancel, and report
  not-loaded saves plus outline/line color updates, raising
  `FrontDeskWorkflowPage` to 95.65/81.25/93.33/100, `TreatmentPlansPage` to
  96.34/78.94/93.75/96.2, `DispenseEditDialog` to 93.33/81.43/89.66/100, and
  `ReportDialog` to 100/97.43/100/100. The latest batch raises `ChargeList`,
  `QuickChargeDialog`, and `MemberCardPlanDialog` to 100/100/100/100 and
  `WechatTemplateLibrary` to 100/66.67/100/100 (the remaining branch is an
  unreachable `|| ''` fallback), covering missing/unknown charge statuses,
  quick-charge null targets and busy states, empty template config fallbacks,
  and plan saves without a card id plus save-failure toasts. The latest batch
  covers stale item-backfill guards after closing the processing, purchase,
  and treatment-plan edit dialogs, plus member-card status edits, action
  dialog close paths, and action-failure toasts, raising
  `ProcessingOrderFormFields` to 100/72.73/100/100,
  `PurchaseOrderFormFields` to 100/78.38/100/100, `PlanFormFields` to
  100/75.76/100/100, and `MemberCardsPage` to 98.7/76.56/100/100. The latest
  batch covers outline empty/single-point/labeled states, lower and
  non-numeric teeth, issue marks, tooth clicks and null tooth statuses,
  prescription status errors and missing reference fallbacks, and CSV
  null/object/formula-injection guards plus the maxValue floor, raising
  `OutlineSvg` to 100/77.77/100/100, `TeethMarkDialog` to
  100/85.37/100/100, `PrescriptionStatusDialog` to 100/100/100/100, and
  `analytics-utils` to 100/100/100/100. The final batch raises `Switch`,
  `BatchBar`, `use-async-action`, and `RecordFormFields` to 100/100/100/100,
  covering enabled switch state, archive/export actions, concurrent async
  guards, and doctor id fallbacks, pushing web branch coverage above 85%.
  `OutlineSvg` then reached 100/92.59/100/100 with undefined outline/polyline
  fallbacks, and the full `pnpm verify` gate passed end to end. The next batch
  covers treatment sparse-row fallbacks and zero-quantity validation, member
  card unknown status/level labels and missing-field prefill, and inventory
  sparse columns, unknown statuses, every processing status transition, and
  empty counted-stock validation, raising `TreatmentsPage` to
  97.92/85.71/100/100, `MemberCardsPage` to 98.7/96.88/100/100, and
  `InventoryWorkflowPage` to 99.31/84.8/100/100. The next batch covers sparse
  treatment-plan column fallbacks and the print preview close path, staged
  restore success and non-Error backup failures, and dashboard printing with
  failed-section fallbacks, raising `TreatmentPlansPage` to
  97.56/88.16/96.88/100, `BackupsPage` to 97.14/90.63/100/100, and
  `AnalyticsDashboardPage` to 98.78/84.91/97.22/100. The next batch covers
  front-desk kanban drag transitions and unknown status rows, commission
  sparse columns with category/doctor fallbacks, stale processing advance and
  adjust responses plus sparse-row prefill, and generic page select-all
  uncheck plus truncated report notices, raising `FrontDeskWorkflowPage` to
  100/87.5/100/100, `CommissionPage` to 98.88/93.62/100/100,
  `ProcessingOrdersPage` to 95.31/89.89/100/100, and `ResourcePage` to
  97.65/90.06/100/100. The latest batch covers empty global search,
  backup sorting without timestamps, username fallback and role-less resource
  denial, dispense null fields with batch id/error fallbacks, and sparse plan
  items with doctor id fallbacks, raising `Layout` to 100/92.77/97.5/100,
  `PlanFormFields` to 100/96.97/100/100, and `DispenseEditDialog` to
  93.33/84.29/89.66/100. The final `pnpm verify` re-run after all coverage
  batches stayed green end to end at 206 files / 1936 tests. The latest batch
  covers role-less permission denial, sparse user prefill and unknown role
  badges, missing user-role data, stocktake action failures, and CSV export
  with failed sections, raising `UsersPage` to 97.89/90.12/100/100,
  `InventoryWorkflowPage` to 100/84.8/100/100, and `AnalyticsDashboardPage`
  to 98.78/89.62/97.22/100. The latest batch adds a lazy-loader spec that
  renders every custom hub tab and fixes JSX attribute `\uXXXX` escapes that
  rendered literal escape text for the monthly report, inventory report,
  churn warning, doctor anomaly, and hub search placeholder, raising
  `hub-tabs` to 100/96.15/100/100; it also covers API login/logout/refresh
  failure and concurrency paths, dispense edit flows with batch selection,
  inventory scan/retry/dialog-close/sparse-row paths, charge dialog closes
  and combo/member-quote fallbacks, and imaging category/record/compare
  fallbacks, pushing `api.ts` to 98.26/97.01/95.12/99, `ImagingPage` to
  97.46/97.77/96.42/98.66, `ChargesPage` to 97.63/86.4/97.22/98.71, and
  `InventoryPage` to 95.1/92.48/93.47/98.27, with the full `pnpm verify`
  gate green at 208 files / 2002 tests and web coverage
  97.29/88.96/98.34/98.24. The next batch adds dedicated dialog,
  plan-billing, and template specs plus use-crud-resource lifecycle tests,
  sparse visit/cephalometric/patient rows, compare-option fallbacks, and
  non-object JSON normalisation, pushing `dialog` to 95.45/90/100/100,
  `use-crud-resource` to 97.93/91.66/100/100, `PlanBillingDialog` to
  95.45/98.57/100/95.23, `TemplateSection` to 91.22/91.66/94.44/92.45,
  `VisitsPage` to 97.43/98.18/96/97.29, `CephalometricPage` to
  94.2/92.42/95/93.93, and `PatientsPage` to 100/98.85/100/100, crossing the
  90% web branch gate with web coverage 97.42/90.06/98.38/98.39 at 211 files
  / 2041 tests and a green `pnpm verify`.
  The latest batch covers follow-up error retry and execution-dialog close
  paths, sparse wechat reminder cards with unknown-scene tags, and custom
  field TEXT editing plus delete-dialog close paths, raising
  `FollowUpsPage` to 98.97/92.75/100/100, `CommunicationWorkflowPage` to
  96.42/84.44/100/96.07, and `CustomFieldsPage` to 94.36/85.29/93.1/96.72,
  with web coverage 97.54/90.2/98.51/98.52 at 211 files / 2048 tests and a
  green `pnpm verify`.
  The latest batch covers inventory batch-date editing and delete-cancel
  paths, barcode scans without items or display fields, resource non-Error
  failures, label-less definitions, id-less rows and page fallbacks without
  refreshed items, quick-charge cancel and empty combo loads, plus dispense
  paging and sparse rows, raising `InventoryPage` to 96.73/93.64/100/100,
  `ResourcePage` to 97.65/92.39/100/99.42, `ChargesPage` to
  98.22/87.37/100/99.35, and `DispenseListPanel` to 97.56/89.56/100/100,
  with web coverage 97.6/90.4/98.68/98.59 at 211 files / 2061 tests and a
  green `pnpm verify`.
  The latest batch covers analytics empty date ranges, sparse revenue and
  doctor rows and delayed print blob release, treatment-plan unknown
  follow-up statuses and missing print counts plus create-failure cleanup
  skip, first-exam teeth/history/restart cancel paths and sparse edits, and
  user creation without phone plus permission loads without effective data,
  raising `AnalyticsDashboardPage` to 100/94.33/100/100,
  `TreatmentPlansPage` to 97.56/89.47/96.87/97.46, `FirstExamsPage` to
  100/87.96/100/100, and `UsersPage` to 97.88/91.35/100/100, with web
  coverage 97.67/90.74/98.85/98.65 at 211 files / 2071 tests and a green
  `pnpm verify`.
  The latest batch covers prescription sparse edits, item load and delete
  failures and status-dialog close, narcotic sparse rows/edits with empty
  batch submission and delete confirmation, clinical workflow sparse status
  rows, and purchase item reconcile fallbacks and invalid-item skipping,
  raising `PrescriptionsPage` to 96.15/93.54/95/97.72,
  `DispenseNarcoticPanel` to 98.96/97.64/100/100, `ClinicalWorkflowPage` to
  97.72/90.62/96/97.61, and `purchase-orders/api` to 100/89.83/100/100,
  with web coverage 97.75/91.24/98.89/98.72 at 212 files / 2082 tests and a
  green `pnpm verify`.
  The latest batch covers login double-submit and localStorage degradation,
  drawer/dropdown/accordion/timeline/backup-card edges, sparse history and
  quote/settle/follow-up fallbacks, purchase/processing sparse item backfills,
  inventory transaction/expiry/batch edit/delete re-entry guards, resource
  NUMBER fields and invalid datetimes, timeline non-Error failures and blank
  custom values, processing zero-fee recalculation, quick-charge re-entry and
  combo replacement, custom-field create/delete re-entry guards, sync conflict
  re-entry, DataTable 500-row cap, tone-less timeline items, id-less triage
  rows, appointment-board responses without items, patient workflow empty
  tables, sparse dispense detail rows, treatment teeth arrays and unnamed
  doctors, wechat config defaults
  and wechat-id branches, and prescription orphan cleanup plus missing-id
  rejection, raising `ProcessingOrderFormFields` to 100/90.9/100/100,
  `PurchaseOrderFormFields` to 100/94.59/100/100, `CustomFieldsPage` to
  95.77/88.23/93.1/96.72, `prescriptions/api` to 93.33/89.47/100/92.85, and
  `CommunicationWorkflowPage` to 96.42/88.57/100/96.07, with web coverage
  97.51/92.55/98.77/98.41 at 217 files / 2165 tests and a green `pnpm verify`;
   the same batch adds server route fallback tests (non-array permissions/roles,
   non-string flow step ids, sparse quick-charge fields, commission full-field
   PATCH, custom-field validation, and debt refund reversal), lifting server
   coverage to 95.43/86.7/98.72/97.06, then triage cancelled/no-show
   reschedule rejection, non-array prescription itemIds, and scheduler
   without cleanup callbacks lift it to 95.47/86.75/98.72/97.08.
- Large-scale benchmark re-run at 100k patients/charges: search 7ms,
  dashboard 67ms, sync full metadata 54ms, sync page (5000 rows) 72ms.
- Quality gates fail closed: `coverageStats` returns `null` on empty inputs and
  `test:quality-score` refuses to write artifacts without coverage/mutation
  reports; `pnpm verify` now includes mutation, quality score, and the v8-ignore
  ratchet; CI enforces `V2_REQUIRE_PERMISSION_SMOKE=1` and release gates include
  mutation + quality score. The flaky `SystemOperationsPage` spec was made
  deterministic with act-wrapped debounce waits (verified under concurrent load).
- Long-running foundations: daily database maintenance (quick_check + PRAGMA
  optimize + WAL checkpoint) and weekly incremental_vacuum, disk-space threshold
  alerts, hourly runtime metrics (memory/active resources/event-loop lag) to
  `logs/runtime.json`, explicit WAL governance pragmas
  (`synchronous`/`journal_size_limit`/`wal_autocheckpoint`), and a scheduler
  `triggerResumeMaintenance` path driven by the IPC `resume` message.
- Crash resilience: JS-level watchdog (`electron/watchdog.cjs`) relaunches after
  uncaught exceptions with a 10-minute/3-restart crash-loop guard, and a native
  supervisor sidecar (`electron/supervisor.cjs`, ELECTRON_RUN_AS_NODE) relaunches
  the app after hard crashes/taskkill unless a graceful-quit stop marker exists;
  `smoke:supervisor` verifies relaunch/stop semantics.
- System resume recovery: `powerMonitor('resume')` triggers immediate maintenance
  plus a strict API health check that restarts a wedged API child; renderer
  crashes reload the window with a throttled 3-per-10-minutes budget; update
  checks retry with 1/5/30min backoff and re-check daily; stale updater cache
  files are swept at startup.
- Log hygiene: api-console.log rotates 5MB×5 like desktop/v2 logs; phone and ID
  numbers are masked in crash reports, api-console output, and server log lines
  (`electron/redact.cjs` + `infrastructure/redact.ts`).
- Migration failure auto-rollback: when `runMigrations` throws at boot the newest
  `pre-migration/pre-*.sqlite` snapshot is restored (failed copy kept, WAL/SHM
  cleared, one retry, then fail closed), covered by `migration-recovery.spec.ts`.
- Emergency startup repair: a corrupt v2.sqlite triggers a byte-safe REINDEX on a
  work copy (original never opened for write; restored unchanged on failure)
  before failing closed with restore guidance; `drill:corrupt-boot` verifies the
  boot contract in CI.
- Backend consistency: token invalidation on logout/changePassword/password-reset
  is fail-closed (no optional chaining), JWT verification allows 300s clock
  tolerance for sleep/wake drift, route-policy roles were renamed `bossOrAdmin`
  to stop implying a BOSS-only tier, LAN-mode initial setup requires a
  `V2_SETUP_TOKEN` (≥16 chars, timing-safe compare), and dev CORS no longer
  allows arbitrary loopback ports.
- Web feedback: `onApiReady` wiring invalidates all queries when the desktop API
  reports ready (no more manual retry after renderer-refresh races);
  `use-crud-resource` applies optimistic list patches (create/update/delete)
  before background refetch; save/delete refetch failures no longer show false
  failure toasts.
- Accessibility: analytics bar charts expose `role="img"` summaries, dental
  tooth buttons carry `牙位 N` labels, Kanban columns use `role="list"`.
- Packaged renderer CSP: `dist-web` is copied to userData at startup with the
  meta CSP `connect-src http://127.0.0.1:*` wildcard replaced by the exact API
  port, closing the loopback-port probing surface; the runtime URL is part of
  the IPC trust boundary and navigation whitelist.
- Engineering depth: mutation testing expanded from 9 pilot files to 15
  (triage/stocktake/refund-flow/commission/wechat-reminder/shift-template) with
  a 75-point ratchet threshold; v2-ci split into verify/smoke jobs;
  v2-internal-release runs the full smoke suite; a weekly `v2-security-audit`
  workflow runs osv-scanner + pnpm audit + full cdxgen CycloneDX SBOM;
  load-smoke is concurrent multi-endpoint with an error-rate gate and JSON
  evidence; migration 159 adds `(parentId, deletedAt)` indexes on FK child
  columns; generic keyset cursors (`v:` format) cover arbitrary sort columns;
  opt-in aggregate telemetry (`V2_TELEMETRY_URL`, allowlist-gated, PII-free).
- `docs/architecture/coverage-exclusions.md` registers the v8-ignore cleanup
  batches, mutation ratchet plan, remaining FK work, and known tradeoffs.

## Remaining

No P0 blockers for internal controlled delivery. Remaining work is tracked as
P1 follow-up: real WeChat official-account template push, cephalometric
calibration tools, standalone multi-template PDF report styling, and
cloud/mobile/multi-clinic editions. Commission rule configuration is now
delivered; aligning it with the clinic's real payout policy still needs a
controlled pilot. Public CA signing, SmartScreen elimination, and public
update channels are explicitly deferred to P8.
