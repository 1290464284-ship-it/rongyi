# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

口腔诊所管理系统 — a local-private-deployment web-based dental clinic management system targeting small clinics (<20 staff), replacing legacy desktop software (艾登特). Four-phase plan; project has progressed beyond Phase 1 with full module implementation across auth, patients, appointments, clinical, inventory, financial, and system domains.

**Tech stack:**
- Frontend: React 19, TypeScript, Vite, TailwindCSS 4, custom UI component library (components/ui/), TanStack Query, Zustand, React Router 7, ECharts, react-hook-form, zod
- Backend: NestJS, better-sqlite3 (local SQLite), raw SQL via DbService, Passport JWT
- Shared: TypeScript types shared package
- Deployment: Electron desktop app (single-machine local), optional LAN access via browser
- Testing: Vitest (frontend), Jest (backend, with better-sqlite3)
- Package manager: pnpm 11+ (workspaces), Node 20

## Monorepo structure

```
source/
├── apps/
│   ├── api/          # NestJS backend (port 3001, embedded SQLite)
│   └── web/          # React frontend (Vite + Electron wrapper)
├── packages/
│   └── shared/       # Shared TypeScript types/DTOs/enums
├── package.json      # Root (workspace scripts: dev:api, dev:web, etc.)
├── pnpm-workspace.yaml
└── CLAUDE.md
```

Package names: `@dental/api`, `@dental/web`, `@dental/shared`.

Backend modules: auth, patients, appointments, visits, treatments, treatment-plans, registrations, chairs, equipment, clinical (first-exams, oral-examinations, periodontal-records), inventory (inventory, suppliers, purchase-orders, processing-orders), financial (charges, charge-v2, refunds, member-cards), content (tooth-records, prescriptions, imaging, medical-records), communication (follow-ups-v2, wechat), system (backups, operation-logs, search, stats).

Frontend modules: auth, patient, appointment, clinical, imaging, dashboard, report, staff, settings, inventory, charge, charge-v2, prescription, treatment-plan, registration, medical-records, follow-ups-v2, processing-orders, first-exams, wechat, equipment, finance.

## Commands

```bash
# Development (start both frontend + backend)
pnpm dev

# Single workspace
pnpm dev:api          # NestJS on :3001 (auto-creates SQLite DB)
pnpm dev:web          # Vite on :5173

# Build
pnpm build

# Testing
# Backend:
cd apps/api && pnpm test:e2e    # Jest e2e tests (with better-sqlite3)
cd apps/api && pnpm test         # Unit tests
# Frontend:
cd apps/web && pnpm test         # Vitest

# Reset password (CLI)
cd apps/api && pnpm reset-password
```

## Database

SQLite via `better-sqlite3` with raw parameterized SQL. The database schema is defined in `src/db/schema.ts`. Migrations are in `src/db/migrations.ts`. The `DbService` in `src/db/db.service.ts` provides the prepared statement API and transaction support. No ORM is used.

All tables use soft delete (`deletedAt` column) and ISO 8601 timestamps. Queries use parameterized `?` placeholders exclusively — never string interpolation.

Default seed users: boss/doctor/front, all password `123456`.

## Key design decisions

- **Tooth chart global linkage:** SVG-rendered 32-tooth FDI-numbered chart acts as a cross-module filter — select a tooth to see its treatment history, images, and notes across all modules (Phase 2).
- **Visit timeline:** Patient detail page shows a chronological feed of appointments → visits → treatments → charges, forming a closed clinical loop (Phase 2).
- **Revenue Discovery:** Phase 4 daily scan for unfollowed-up treatment plans, overdue charges, and churned patients, surfaced as dashboard todos.
- **Local-first deployment:** Everything runs on a single machine via Electron desktop app or browser; clinic staff access via LAN. No cloud dependency.
- **idCard encryption:** Patient national ID stored encrypted; the plan notes this but does not specify the encryption scheme — must be decided during implementation.

## Current state (as of 2026-07-27)

Monorepo fully implemented with 80+ source files and 129+ test files across all three packages (`apps/api`, `apps/web`, `packages/shared`). Root `package.json` exists with complete workspace scripts (dev, build, typecheck, lint, verify, test:cov). Config files include `.editorconfig`, `.gitignore`, `.nvmrc`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, Husky pre-commit hooks, ESLint, and CI via GitHub Actions.

All backend and frontend modules listed above are implemented with controllers, services, DTOs, tests, page components, API layers, and routing. The initial implementation plan in `docs/superpowers/plans/2026-07-16-dental-clinic-mvp.md` has been completed; the project has progressed through subsequent phases.

## Conventions

- Indentation: 2 spaces, LF line endings, UTF-8 (see `.editorconfig`)
- All API endpoints prefixed with `/api`
- CORS configured for `http://localhost:5173` in dev
- Validation: class-validator DTOs on backend, zod schemas on frontend
- Token storage: Zustand persist in localStorage under key `dental-auth`
- UI theme: Warm stone palette (background `#FAFAF9`, primary teal `#0F766E`)
- Language: UI is Chinese (zh-CN), code identifiers in English
