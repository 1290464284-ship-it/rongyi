# Database Migration Plan: SQLite to PostgreSQL

**Target audience**: Backend engineers, DBA, tech lead
**Estimated effort**: 4–6 weeks (2 engineers)
**Status**: Proposal — not yet started

---

## 1. Current State

### Stack
- **Database**: SQLite 3 (via `better-sqlite3`)
- **API style**: Synchronous — every `DbService.prepare().get()/.all()/.run()` call blocks the Node.js event loop
- **Connection model**: Single process, single connection, WAL mode with `busy_timeout=5000`
- **Migrations**: Hand-rolled version-number system (`schema_migrations` table + `PRAGMA user_version`), 17 versions

### Schema inventory (40+ tables across 7 domains)

| Domain | Tables | Notable patterns |
|--------|--------|-----------------|
| System | `User`, `Clinic`, `ClinicInfo`, `AuditLog`, `OperationLog`, `BackupRecord`, `IdempotencyRecord`, `UsedRefreshToken` | Multi-clinic isolation via `clinicId` column |
| Patient | `Patient`, `Family`, `FollowUp`, `FollowUpTemplate`, `FollowUpItem`, `FollowUpResult` | JSON fields as TEXT (`tags`, `allergies`, `medicalHistory`) |
| Clinical | `Appointment`, `Visit`, `Treatment`, `TreatmentPlan`, `TreatmentPlanItem`, `MedicalRecord`, `OralExamination`, `PeriodontalRecord`, `FirstExam`, `FirstExamTooth`, `FirstExamTrack`, `FirstExamFollowUp`, `ToothRecord`, `Chair`, `TreatmentCatalog`, `MedicalRecordTemplate`, `MedicalRecordPhrase`, `RecordModifyRequest` | CHECK constraints, JSON `teethNumbers` as TEXT |
| Financial | `Charge`, `ChargeItem`, `ChargeCombo`, `ChargeComboItem`, `PaymentMethod`, `DebtRecord`, `Refund`, `MemberCard`, `MemberCardLog`, `MemberPointLog` | Money stored as INTEGER (cents), CHECK constraints |
| Pharmacy | `Prescription`, `PrescriptionItem`, `DrugCatalog` | |
| Inventory | `InventoryItem`, `InventoryTransaction`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `Equipment`, `ProcessingFactory`, `ProcessingProduct`, `ProcessingOrder`, `ProcessingOrderItem`, `ProcessingFlowLog` | `UNIQUE(code)` on InventoryItem, serial business codes |
| WeChat | `WechatMessage` | |

### SQLite-specific patterns in use

| Pattern | Location | Count |
|---------|----------|-------|
| `PRAGMA table_info()` | `migrations.ts:28` | Column existence check |
| `PRAGMA user_version` | `migrations.ts:91,95` | Migration version tracking |
| `PRAGMA integrity_check` | `database.ts:152` | Backup validation |
| `PRAGMA wal_checkpoint(...)` | `db.service.ts:38,54,155` | WAL maintenance |
| `BEGIN IMMEDIATE` | `db.service.ts:134` | Write-lock acquisition |
| `INSERT OR IGNORE` | `migrations.ts:84` | Upsert |
| `db.backup()` | `database.ts:224` | Hot backup |
| `json_each()` | Not currently in SQL — JSON fields are parsed in TypeScript | — |
| `substr()` for date grouping | `stats.service.ts:143,179,239,254,289` | `substr(paidAt,1,7)` etc. |
| `LIKE ? ESCAPE '\\'` | `base.service.ts:209`, `search.service.ts:59,65` | Text search |
| Partial indexes (`WHERE`) | `indexes.ts:175-185` | 6 partial indexes |

### Services using DbService directly (36+)

All services extend `BaseService<T>` which takes `DbService` as constructor parameter and builds raw SQL with `this.dbService.prepare(...)`. Key services:

- `ChargeService` — transactional charge creation with retry on UNIQUE conflict
- `StatsService` — read-heavy aggregation queries (6 methods, each 1-3 SQL queries)
- `SearchService` — LIKE-based patient/appointment search with prefix fallback
- `BaseService` — generic CRUD with soft delete, clinic filtering, JSON field parsing
- `InventoryService` — stock deduction with inventory transaction logging

---

## 2. Target State

### Stack
- **Database**: PostgreSQL 15+ (async API via `pg` or `postgres` package)
- **API style**: Async — all DB calls return Promises
- **Connection model**: Connection pool (min 2, max 10)
- **Migrations**: Structured migration system (e.g., `node-pg-migrate` or Knex migrations)

### Why PostgreSQL
1. **Concurrent access**: Desktop Electron app + potential cloud deployment = multiple processes/connections
2. **JSONB support**: Native `jsonb` type replaces TEXT-based JSON fields, enabling `@>`, `?`, `jsonb_array_elements()` queries
3. **Full-text search**: `tsvector`/`tsquery` replaces LIKE-based search in `SearchService`
4. **Materialized views**: Cache expensive dashboard aggregations in `StatsService`
5. **Row-Level Security**: Enforce clinic isolation at the DB level, not just application layer
6. **Replication**: Built-in streaming replication for cloud HA
7. **Better CHECK constraints**: PostgreSQL supports `ALTER TABLE ... ADD CONSTRAINT` (no table rebuild needed)

---

## 3. Migration Steps

### Phase 1: Abstract the Database Interface (Week 1)

**Goal**: Decouple all services from `better-sqlite3` specifics.

#### 3.1 Expand `IDatabase` interface

Current interface (`db.interface.ts`):

```typescript
export interface IStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint | string };
}

export interface IDatabase {
  readonly name: string;
  prepare(sql: string): IStatement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
  backup(destination: string): Promise<unknown>;
}
```

Target interface:

```typescript
export interface IStatement {
  get(...params: unknown[]): Promise<unknown>;          // was sync
  all(...params: unknown[]): Promise<unknown[]>;        // was sync
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint | string }>;
}

export interface IDatabase {
  readonly name: string;
  prepare(sql: string): Promise<IStatement>;            // was sync
  exec(sql: string): Promise<void>;                     // was sync
  close(): Promise<void>;                               // was sync
  backup(destination: string): Promise<unknown>;
  transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T>;  // explicit transaction API
}

// New: remove pragma() from interface — DB-engine-specific
```

#### 3.2 Create adapter classes

```
src/db/
├── db.interface.ts          # Expanded async interface
├── db.service.ts            # NestJS service (DI token)
├── adapters/
│   ├── sqlite.adapter.ts    # Wraps better-sqlite3, returns Promises
│   └── postgres.adapter.ts  # Wraps pg Pool, implements IDatabase
└── migrations/
    ├── sqlite/              # Current 17 migrations (unchanged)
    └── postgres/            # New migration files
```

#### 3.3 Migrate all services to async

Every `BaseService` method and every direct `dbService.prepare()` call must become `await`-based. This is the largest single task.

**Affected files** (36+ services):
- `base.service.ts` — `create()`, `findMany()`, `findOne()`, `update()`, `remove()`, `softDelete()`, `generateCode()`, `batchResolve()`
- All service files in `src/modules/*/`

**Strategy**: Convert `BaseService` first, then fix compile errors in subclasses.

### Phase 2: PostgreSQL Adapter (Week 2)

#### 3.4 Implement `PostgresAdapter`

```typescript
// adapters/postgres.adapter.ts
import { Pool, PoolClient } from 'pg';

export class PostgresAdapter implements IDatabase {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      ...config,
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  async prepare(sql: string): Promise<IStatement> {
    // pg doesn't have prepare() in the same way —
    // use named parameter substitution ($1, $2) instead of ?
    const convertedSql = this.convertPlaceholders(sql);
    return {
      get: async (...params) => {
        const { rows } = await this.pool.query(convertedSql, params);
        return rows[0];
      },
      all: async (...params) => {
        const { rows } = await this.pool.query(convertedSql, params);
        return rows;
      },
      run: async (...params) => {
        const { rowCount } = await this.pool.query(convertedSql, params);
        return { changes: rowCount || 0, lastInsertRowid: 0 };
      },
    };
  }

  private convertPlaceholders(sql: string): string {
    // Convert ? placeholders to $1, $2, ... for pg
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }
}
```

#### 3.5 SQL dialect differences

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `?` placeholders | `$1, $2, ...` | Auto-converted in adapter |
| `INTEGER DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT NOW()` | Column type change |
| `INTEGER` (boolean) | `BOOLEAN` | `active INTEGER DEFAULT 1` → `active BOOLEAN DEFAULT true` |
| `TEXT DEFAULT '[]'` (JSON) | `JSONB DEFAULT '[]'` | Native JSON support |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | — |
| `BEGIN IMMEDIATE` | `BEGIN` | PG uses row-level locking |
| `PRAGMA user_version` | Custom `schema_migrations` table | Already partially used |
| `PRAGMA table_info(...)` | `information_schema.columns` | For migrations |
| `PRAGMA integrity_check` | Not needed (PG handles) | Remove |
| `PRAGMA wal_checkpoint(...)` | Not needed (PG autovacuum) | Remove |
| `db.backup()` | `pg_dump` | CLI tool, not in-app |
| `substr(col,1,7)` | `date_trunc('month', col::timestamptz)` | Date grouping |
| `LIKE ? ESCAPE '\\'` | `ILIKE $1` (PG is case-insensitive by default) | No escape needed |
| Partial index `WHERE deletedAt IS NULL` | Same syntax | Supported |
| `CHECK (status IN (...))` | Same syntax | Supported |

#### 3.6 Schema conversion

The schema creation (`schema.ts`) uses raw SQL strings. For PostgreSQL:

1. Replace `CREATE TABLE IF NOT EXISTS` with proper PostgreSQL types
2. Add `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` for UUID generation
3. Convert all `INTEGER` booleans to `BOOLEAN`
4. Convert JSON TEXT fields to `JSONB`
5. Add `TIMESTAMPTZ` instead of TEXT for date columns
6. Add `SERIAL` or keep `TEXT` for PKs (UUID stored as TEXT is fine, or use `UUID` type)

### Phase 3: Migrate Modules Incrementally (Weeks 3–4)

#### 3.7 Migration order (read-heavy first)

| Order | Module | Tables | Rationale |
|-------|--------|--------|-----------|
| 1 | `SystemModule` (Stats) | `Charge`, `Appointment`, `Patient`, `Visit`, `MemberCard` | Read-heavy, high query count, validates adapter perf |
| 2 | `SystemModule` (Search) | `Patient`, `Appointment` | Read-heavy, tests LIKE→ILIKE migration |
| 3 | `PatientsModule` | `Patient`, `Family`, `FollowUp` | Core entity, tests CRUD flow |
| 4 | `ContentModule` | `Prescription`, `Imaging`, `ToothRecord`, `DrugCatalog` | Read-heavy content |
| 5 | `ClinicalModule` | `Appointment`, `Visit`, `Treatment`, `MedicalRecord`, etc. | Complex transactions |
| 6 | `SchedulingModule` | `Appointment`, `Chair`, `Registration` | Moderate complexity |
| 7 | `InventoryModule` | `InventoryItem`, `PurchaseOrder`, `ProcessingOrder`, etc. | Stock deduction transactions |
| 8 | `FinancialModule` | `Charge`, `ChargeItem`, `DebtRecord`, `Refund`, `MemberCard` | Most critical, save for last |
| 9 | `CommunicationModule` | `FollowUp`, `WechatMessage` | Low risk |
| 10 | `AuthModule` | `User`, `UsedRefreshToken` | Security-critical, final validation |

#### 3.8 Per-module migration checklist

For each module:
1. Verify all SQL in the module is PostgreSQL-compatible
2. Convert `?` placeholders to `$1` (handled by adapter, but raw SQL in services needs review)
3. Update entity types (TEXT dates → Date/timestamptz, INTEGER booleans → boolean)
4. Write integration tests against PostgreSQL
5. Verify soft delete, clinic filtering, JSON field parsing all work

### Phase 4: Data Migration Script (Week 5)

#### 3.9 SQLite → PostgreSQL migration script

```typescript
// scripts/migrate-sqlite-to-pg.ts
import Database from 'better-sqlite3';
import { Pool } from 'pg';

const BATCH_SIZE = 1000;

async function migrateTable(
  sqliteDb: Database.Database,
  pgPool: Pool,
  tableName: string,
  columns: string[],
  transform?: (row: Record<string, unknown>) => Record<string, unknown>,
) {
  const total = sqliteDb.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number };
  console.log(`Migrating ${tableName}: ${total.c} rows`);

  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all() as Record<string, unknown>[];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(r => transform ? transform(r) : r);
    const cols = columns.join(', ');
    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const values = batch.map(row => columns.map(c => row[c]));

    // Use pg's bulk insert
    for (const rowValues of values) {
      await pgPool.query(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, rowValues);
    }

    console.log(`  ${tableName}: ${Math.min(i + BATCH_SIZE, rows.length)}/${total.c}`);
  }
}
```

**Pre-migration checklist**:
1. Run `PRAGMA integrity_check` on SQLite
2. Export SQLite data to a staging directory
3. Create PostgreSQL schema (run migration scripts)
4. Run migration script with table-by-table transfer
5. Verify row counts match
6. Run `ANALYZE` on PostgreSQL
7. Verify application against PostgreSQL (run full test suite)

#### 3.10 Mapping SQLite types to PostgreSQL

| SQLite storage | PostgreSQL type | Transform |
|---------------|----------------|-----------|
| `TEXT` (ISO datetime strings) | `TIMESTAMPTZ` | `new Date(row.col)` |
| `INTEGER` (0/1 boolean) | `BOOLEAN` | `!!row.col` |
| `TEXT` (JSON string) | `JSONB` | `JSON.parse(row.col)` |
| `INTEGER` (cents) | `INTEGER` | No change |
| `TEXT` (UUID) | `UUID` or `TEXT` | No change |
| `REAL` | `DOUBLE PRECISION` | No change |

### Phase 5: Testing Strategy (Week 6)

#### 3.11 Test pyramid

| Level | Tool | Coverage | Run frequency |
|-------|------|----------|---------------|
| Unit | Jest | Service logic, SQL building | Every commit |
| Integration | Jest + testcontainers | Real PostgreSQL in Docker | Every PR |
| E2E | Jest + supertest | Full API against PostgreSQL | Nightly |
| Migration | Custom script | SQLite dump → PG import → row count diff | Pre-release |

#### 3.12 Test database setup

```typescript
// test/setup.ts (PostgreSQL version)
import { PostgresContainer } from 'testcontainers';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgresContainer().start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  // Run migrations
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});
```

#### 3.13 Validation queries

```sql
-- Verify data integrity post-migration
SELECT 'Patient' as tbl, COUNT(*) FROM Patient
UNION ALL SELECT 'Charge', COUNT(*) FROM Charge
UNION ALL SELECT 'Appointment', COUNT(*) FROM Appointment
-- ... for all 40+ tables

-- Verify JSONB fields are valid
SELECT id FROM Patient WHERE tags::text = '' AND tags IS NOT NULL;

-- Verify foreign keys (PostgreSQL doesn't enforce by default on bulk insert)
SELECT COUNT(*) FROM Charge c LEFT JOIN Patient p ON c.patientId = p.id WHERE p.id IS NULL;
```

---

## 4. SQLite-Specific Patterns to Replace

### 4.1 PRAGMA configurations

| SQLite PRAGMA | PostgreSQL equivalent | Action |
|---------------|----------------------|--------|
| `encoding = "UTF-8"` | Default encoding (UTF-8) | Remove |
| `journal_mode = WAL` | Default (MVCC) | Remove |
| `busy_timeout = 5000` | `lock_timeout` | Set in `postgresql.conf` or connection string |
| `synchronous = NORMAL` | `synchronous = on` | Default in PG |
| `cache_size = -20000` | `shared_buffers` | Set in `postgresql.conf` |
| `mmap_size = 268435456` | N/A (PG manages memory) | Remove |
| `wal_checkpoint(PASSIVE)` | N/A (autovacuum) | Remove |
| `integrity_check` | N/A (PG handles) | Remove |

### 4.2 Query syntax replacements

**Date grouping** (used 6+ times in `StatsService`):
```sql
-- SQLite
SELECT substr(paidAt,1,7) as month, ... GROUP BY month

-- PostgreSQL
SELECT date_trunc('month', paidAt::timestamptz) as month, ... GROUP BY month
```

**Boolean filtering** (used in every soft-delete check):
```sql
-- SQLite
WHERE deletedAt IS NULL AND active = 1

-- PostgreSQL
WHERE deletedAt IS NULL AND active = true
```

**JSON field queries** (currently parsed in TypeScript, but future use):
```sql
-- SQLite
SELECT json_each.value FROM json_each(tags)

-- PostgreSQL
SELECT value FROM jsonb_array_elements(tags)
```

**Insert or ignore** (used in `migrations.ts:84`):
```sql
-- SQLite
INSERT OR IGNORE INTO schema_migrations (...) VALUES (...)

-- PostgreSQL
INSERT INTO schema_migrations (...) VALUES (...) ON CONFLICT DO NOTHING
```

**Transaction isolation** (used in `db.service.ts:134`):
```sql
-- SQLite
BEGIN IMMEDIATE  -- acquires write lock immediately

-- PostgreSQL
BEGIN  -- uses row-level locking, no IMMEDIATE needed
```

**Backup** (used in `database.ts:224`):
```sql
-- SQLite
db.backup(destination)

-- PostgreSQL
-- Use pg_dump CLI tool
-- pg_dump -Fc -f backup.dump database_name
```

**LIKE with escape** (used in `base.service.ts:209`, `search.service.ts`):
```sql
-- SQLite
WHERE name LIKE ? ESCAPE '\\'

-- PostgreSQL
WHERE name ILIKE $1  -- PG default is case-insensitive, no escape needed for most cases
```

**Partial indexes** (used in `indexes.ts:175-185`):
```sql
-- Both SQLite and PostgreSQL support
CREATE INDEX idx_name ON table(col) WHERE deletedAt IS NULL;
-- No change needed
```

### 4.3 `BaseService` method changes

Every method in `BaseService` uses `this.dbService.prepare(sql).get/run/all()`. After migration, all calls become `await`-able.

**Key transformation pattern**:
```typescript
// Before (sync)
const item = this.dbService.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

// After (async)
const item = await this.dbService.prepare(`SELECT * FROM ${table} WHERE id = $1`).get(id);
```

**Transaction pattern**:
```typescript
// Before (sync)
this.dbService.transaction((db) => {
  db.prepare(...).run(...);
});

// After (async)
await this.dbService.transaction(async (db) => {
  await (await db.prepare(...)).run(...);
});
```

---

## 5. Risk Mitigation

### 5.1 Dual-database support period

During migration, maintain both SQLite and PostgreSQL adapters behind the `IDatabase` interface. Use environment variable to switch:

```typescript
// db.module.ts
const dbAdapter = process.env.DB_DRIVER === 'postgresql'
  ? new PostgresAdapter(config)
  : new SqliteAdapter(getDbPath());

providers: [
  { provide: DbService, useFactory: () => new DbService(dbAdapter) }
];
```

### 5.2 Rollback plan

If PostgreSQL issues arise in production:
1. Keep SQLite adapter functional
2. Data sync script (PG → SQLite) runs nightly
3. Feature flag to switch back to SQLite within minutes

### 5.3 Performance benchmarks

Benchmark before migration to establish baselines:
- `StatsService.dashboard()` — 10 aggregated queries
- `SearchService.search()` — LIKE-based patient search
- `BaseService.findMany()` — paginated list with soft-delete filter
- `ChargeService.createCharge()` — transactional insert with retry

---

## 6. Effort Estimate

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| Phase 1: Abstract interface | 5 days | None |
| Phase 2: PG adapter | 5 days | Phase 1 |
| Phase 3: Module migration | 10 days | Phase 2 |
| Phase 4: Data migration script | 3 days | Phase 3 |
| Phase 5: Testing & validation | 5 days | Phase 4 |
| Buffer (issues, edge cases) | 2 days | — |
| **Total** | **~30 days (6 weeks)** | |

With 2 engineers working in parallel (one on interface/adapter, one on service conversion): **~4 weeks**.

---

## 7. Post-Migration Opportunities

Once on PostgreSQL:
1. **Full-text search**: Replace LIKE-based `SearchService` with `tsvector`/`tsquery`
2. **Materialized views**: Cache expensive `StatsService` aggregations
3. **Row-Level Security**: Enforce `clinicId` isolation at DB level
4. **JSONB queries**: Query inside JSON fields directly (e.g., find patients with specific allergies)
5. **Connection pooling**: Handle concurrent desktop + cloud users
6. **Logical replication**: Enable real-time sync for cloud deployment
