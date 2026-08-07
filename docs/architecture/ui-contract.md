# V2 UI Contract

## Purpose

This document is the source of truth for how resource metadata is rendered in
the desktop application. The renderer must not display raw database field
names, English enum values, or internal columns when a Chinese presentation
label is available.

## Resource Tiers

### Core dedicated pages

These resources must receive custom business pages with guided forms and
patient/doctor/chair selectors instead of the generic resource page:

- patients, familyMembers, appointments, registrations, visits
- firstExams, medicalRecords, treatments, treatmentPlans, prescriptions, imaging
- charges, chargeItems, refunds, debts, memberCards, memberCardLogs
- inventoryItems, inventoryTransactions, purchaseOrders, processingOrders
- followUps, followUpTemplates, wechatMessages
- users, workSchedules, attendance, leaveRequests, equipment

### Generic Chinese pages

These resources may continue to use the generic resource page, but all fields
and enums must be presented through `resource-meta` labels:

- suppliers, processingFactories, drugCatalogItems, invoices,
  satisfactionSurveys, notifications, businessAlerts, operationLogs,
  syncChanges, printTemplates, dataImportJobs,
  inventoryReplenishmentSuggestions, and other read-only/reference resources.

### Internal hidden resources

Resources that are implementation details or contain credential/session data
must not be exposed to ordinary users:

- IdempotencyRecord, SyncDevice, UsedRefreshToken, UserClinic
- passwordHash, refreshToken, tokenHash, loginAttempts, lockedUntil,
  tokenVersion, currentClinicId

## Frozen Conventions

- WeChat is the supported external communication channel. SMS features are out
  of scope and must not be added to UI or resource metadata.

- Money is stored as integer cents and displayed as `¥` yuan with two decimals.
- Business dates use `Asia/Shanghai`; display uses local desktop timezone.
- Boolean fields display `是/否` in tables and `checkbox` in forms.
- JSON fields use formatted textareas in generic forms and are hidden from
  table columns unless a dedicated page exists.
- Every enum must have a Chinese label in `ui-meta.ts` before it can appear in
  the generic resource page.
- Generic list pages hide `id`, `clinicId`, `createdAt`, `updatedAt`,
  `deletedAt`, and all password/session fields.
- Write buttons must disable while submitting; native `alert/confirm/prompt`
  are prohibited.

## Metadata Contract

`GET /api/v2/resource-meta` returns `ResourceDefinition` objects with optional
presentation fields:

- `label`: Chinese resource name
- `field.label`: Chinese field label
- `field.enumLabels`: enum value to Chinese label
- `field.format`: `text | money | date | datetime | json`
- `field.inputType`: `text | textarea | number | date | datetime | select | checkbox | json`
- `field.hidden`: hide from generic tables/forms
- `field.readOnly`: prevent generic write
- `field.placeholder`: input placeholder
- `field.helpText`: inline help text

The server injects these fields through `applyUiMeta` before returning
`resource-meta`; resource definitions may override any presentation field.
