# Cloud Deployment Plan: Desktop + Cloud Hybrid Architecture

**Target audience**: Backend engineers, DevOps, tech lead
**Estimated effort**: 8–12 weeks (2–3 engineers)
**Status**: Proposal — not yet started

---

## 1. Current State

### Desktop-first architecture
- **Frontend**: React + Vite + Electron (desktop app)
- **Backend**: NestJS API server (embedded in Electron, runs locally)
- **Database**: SQLite file on local disk (`better-sqlite3`)
- **Auth**: JWT with refresh tokens, stored in-memory/SQLite
- **Backup**: Local file copies + optional remote directory copy

### Limitations
1. **Single-device**: Data locked to one machine
2. **No real-time sync**: Clinics with multiple stations need manual data sharing
3. **No multi-clinic support**: `clinicId` exists in schema but single-node deployment limits it
4. **Backup fragility**: Local SQLite backups require manual remote copy
5. **No mobile access**: Doctors can't view patient data on phones/tablets

---

## 2. Target Architecture: Desktop + Cloud Hybrid

### 2.1 High-level design

```
┌─────────────────────────────────────────────────────┐
│                   Cloud (AWS/Aliyun)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   API GW    │  │  NestJS API  │  │ PostgreSQL │ │
│  │ (rate limit)│──│  (stateless) │──│  (RDS)     │ │
│  └─────────────┘  └──────┬───────┘  └────────────┘ │
│                          │                          │
│  ┌─────────────┐  ┌──────┴───────┐  ┌────────────┐ │
│  │   Redis     │  │  File Store  │  │  Worker    │ │
│  │  (cache +   │  │  (S3/OSS)    │  │  (async    │ │
│  │   sessions) │  │              │  │   jobs)    │ │
│  └─────────────┘  └──────────────┘  └────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (REST API)
          ┌────────────┼────────────────┐
          │            │                │
    ┌─────┴─────┐ ┌───┴─────┐  ┌──────┴──────┐
    │ Desktop   │ │ Desktop │  │   Mobile    │
    │ Station 1 │ │ Station 2│  │  (PWA/App)  │
    │ (Electron)│ │ (Electron│  │             │
    └───────────┘ └─────────┘  └─────────────┘
```

### 2.2 Deployment modes

| Mode | Use case | Database | Sync |
|------|----------|----------|------|
| **Local-only** | Single clinic, no internet | SQLite (current) | None |
| **Hybrid** | Desktop + cloud backup | SQLite primary, PG replica | Incremental push/pull |
| **Cloud-only** | Multi-device, multi-clinic | PostgreSQL (cloud) | Real-time via API |

---

## 3. Data Sync Strategy

### 3.1 Sync model: Incremental via timestamps

Every table already has `createdAt` and `updatedAt` columns. Use these for incremental sync.

```
Desktop (SQLite)                    Cloud (PostgreSQL)
     │                                    │
     │  ── sync_push(since: timestamp) ──>│
     │     UPSERT rows WHERE              │
     │     updatedAt > timestamp          │
     │                                    │
     │  <── sync_pull(since: timestamp) ──│
     │     UPSERT rows WHERE              │
     │     updatedAt > timestamp          │
     │                                    │
     │  ── sync_conflicts ───────────────>│
     │     Last-write-wins merge          │
     │     or manual conflict resolution  │
```

### 3.2 Sync metadata table

```sql
CREATE TABLE IF NOT EXISTS SyncState (
  id TEXT PRIMARY KEY,
  clinicId TEXT NOT NULL,
  lastPushAt TIMESTAMPTZ,
  lastPullAt TIMESTAMPTZ,
  lastSyncVersion INTEGER DEFAULT 0,
  deviceFingerprint TEXT NOT NULL,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinicId, deviceFingerprint)
);
```

### 3.3 Sync API endpoints

```
POST /api/sync/push    — Push local changes to cloud
POST /api/sync/pull    — Pull cloud changes to local
GET  /api/sync/status  — Check sync state
POST /api/sync/resolve — Resolve merge conflicts
```

### 3.4 Sync flow

```typescript
// 1. Desktop initiates push
async function syncPush(lastSyncAt: Date, changes: TableChanges) {
  // changes = { Patient: [...rows], Charge: [...rows], ... }

  // 2. Cloud receives and upserts
  for (const [table, rows] of Object.entries(changes)) {
    for (const row of rows) {
      await pgPool.query(`
        INSERT INTO ${table} (${Object.keys(row).join(',')})
        VALUES (${placeholders})
        ON CONFLICT (id) DO UPDATE SET
          ${Object.keys(row).filter(k => k !== 'id').map(k => `${k} = EXCLUDED.${k}`).join(', ')}
        WHERE EXCLUDED."updatedAt" > ${table}."updatedAt"
      `, Object.values(row));
    }
  }

  // 3. Pull changes from cloud since last pull
  const pullChanges = await pgPool.query(`
    SELECT * FROM ${table}
    WHERE "updatedAt" > $1 AND "clinicId" = $2
  `, [lastSyncAt, clinicId]);

  return { pulled: pullChanges.rows, syncedAt: new Date() };
}
```

### 3.5 Conflict resolution

| Strategy | When to use | Implementation |
|----------|------------|----------------|
| **Last-write-wins** | Default for most tables | Compare `updatedAt` timestamps |
| **Cloud-wins** | Master data (Clinic, User) | Cloud always takes priority |
| **Manual resolution** | Critical data (Charge, Refund) | Queue for admin review |
| **CRDT merge** | Simple additive fields (balance, points) | `new_balance = max(local, cloud)` |

---

## 4. API Gateway Design

### 4.1 Gateway responsibilities

```
Internet → API Gateway → NestJS API → PostgreSQL
                 │
                 ├── Rate limiting (per clinic, per user)
                 ├── Authentication (JWT validation)
                 ├── Request logging (CloudWatch/SLS)
                 ├── CORS (desktop origins)
                 ├── SSL termination
                 └── Load balancing (if multi-instance)
```

### 4.2 Recommended: Alibaba Cloud API Gateway (阿里云 API 网关)

Since this is a Chinese dental clinic system, Alibaba Cloud is the natural choice:

| Feature | Configuration |
|---------|--------------|
| Rate limiting | 100 req/s per clinic, 10 req/s per user |
| Auth | JWT authorizer (validate token in gateway) |
| CORS | Allow `file://` (Electron) and app origins |
| Logging | Full request/response logs to SLS |
| HTTPS | TLS 1.2+ enforced |
| Custom domains | `api.clinic.example.com` |

### 4.3 API versioning

```
/api/v1/patients      — Current API (backward compatible)
/api/v2/patients      — Cloud-enhanced API (new features)
```

### 4.4 Health check endpoint

```
GET /health
→ { status: "ok", db: "connected", sync: "active", version: "1.0.0" }
```

---

## 5. Authentication: JWT + Clinic-Scoped Tokens

### 5.1 Current auth flow

```
Login → Generate JWT (userId, role, clinicId) → Store in memory
Request → JwtAuthGuard validates → RolesGuard checks permissions
```

### 5.2 Cloud auth enhancements

```typescript
// Enhanced JWT payload
interface CloudJwtPayload {
  sub: string;           // userId
  clinicId: string;      // clinic isolation
  role: UserRole;        // BOSS, DOCTOR, RECEPTIONIST, NURSE, ADMIN
  sessionId: string;     // track active sessions
  deviceId: string;      // desktop device fingerprint
  iat: number;
  exp: number;
}

// Refresh token flow
POST /api/auth/login        → { accessToken, refreshToken }
POST /api/auth/refresh       → { accessToken } (rotate refresh token)
POST /api/auth/logout        → Invalidate refresh token
GET  /api/auth/sessions      → List active sessions per device
DELETE /api/auth/sessions/:id → Revoke specific session
```

### 5.3 Multi-device session management

```sql
CREATE TABLE IF NOT EXISTS UserSession (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  clinicId TEXT NOT NULL,
  deviceFingerprint TEXT NOT NULL,
  deviceType TEXT NOT NULL,  -- 'desktop', 'mobile', 'tablet'
  ipAddress INET,
  lastActiveAt TIMESTAMPTZ DEFAULT NOW(),
  expiresAt TIMESTAMPTZ NOT NULL,
  revokedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (userId) REFERENCES "User"(id)
);

-- Index for fast session lookup
CREATE INDEX idx_session_user_active ON UserSession(userId, revokedAt)
  WHERE revokedAt IS NULL;
```

### 5.4 Role-based access control (RBAC)

Existing roles: `BOSS`, `DOCTOR`, `RECEPTIONIST`, `NURSE`, `ADMIN`

Cloud additions:

| Permission | BOSS | DOCTOR | RECEPTIONIST | NURSE | ADMIN |
|-----------|------|--------|-------------|-------|-------|
| View patients | Y | Y (clinic) | Y (clinic) | Y (clinic) | Y |
| Edit patients | Y | Y (clinic) | Y (clinic) | N | Y |
| Create charges | Y | N | Y (clinic) | N | Y |
| View reports | Y | Y (own) | N | N | Y |
| Manage users | Y | N | N | N | Y |
| Manage clinic settings | Y | N | N | N | Y |
| Export data | Y | N | N | N | Y |
| Sync data | Y | Y (clinic) | Y (clinic) | Y (clinic) | Y |

---

## 6. File Storage: S3-Compatible

### 6.1 What gets stored in S3

| Content | Current | Cloud target |
|---------|---------|-------------|
| Database backups | Local file copy | S3 with lifecycle policy |
| Patient images (imaging) | Local file system | S3 bucket per clinic |
| Medical record attachments | Local file system | S3 bucket per clinic |
| Export reports (PDF/Excel) | Generated on-demand | S3 temporary (24h expiry) |
| WeChat media | In-memory / local | S3 with CDN |

### 6.2 S3 bucket structure

```
dental-clinic-{env}/
├── backups/
│   └── {clinicId}/
│       └── dental-2026-07-23.sqlite
├── imaging/
│   └── {clinicId}/
│       └── {patientId}/
│           └── {imageId}.jpg
├── medical-records/
│   └── {clinicId}/
│       └── {patientId}/
│           └── {recordId}/
│               └── attachment.pdf
├── exports/
│   └── {clinicId}/
│       └── {exportId}.xlsx  (expires: 24h)
└── wechat-media/
    └── {clinicId}/
        └── {messageId}.jpg
```

### 6.3 File upload flow

```
Desktop → POST /api/upload/presign → { uploadUrl, fileKey }
Desktop → PUT uploadUrl (direct to S3) → 200 OK
Desktop → POST /api/upload/confirm → { fileId, url }
```

### 6.4 Lifecycle policies

| Bucket prefix | Retention | Transition | Delete |
|--------------|-----------|------------|--------|
| `backups/` | 90 days | IA after 30d | After 90d |
| `exports/` | 1 day | — | After 24h |
| `imaging/` | 7 years | IA after 1y | Never (medical) |
| `medical-records/` | 15 years | IA after 2y | Never (medical) |

---

## 7. Infrastructure Design

### 7.1 Cloud components (Alibaba Cloud)

| Service | Purpose | Spec |
|---------|---------|------|
| ECS / ACK | NestJS API server | 2 vCPU, 4GB RAM × 2 (HA) |
| RDS PostgreSQL | Primary database | pg 15, 4 vCPU, 16GB RAM |
| Redis | Cache + session store | 2GB, standard |
| OSS | File storage | Standard bucket |
| API Gateway | Rate limiting + auth | — |
| SLB | Load balancer | — |
| SLS | Logging | — |
| PolarDB (optional) | High-performance alternative | If > 100 clinics |

### 7.2 Estimated monthly cost

| Component | Cost (RMB/month) |
|-----------|-----------------|
| ECS × 2 | ~800 |
| RDS PostgreSQL | ~1,200 |
| Redis | ~300 |
| OSS | ~50 |
| API Gateway | ~200 |
| SLB | ~100 |
| SLS | ~50 |
| **Total** | **~2,700 (~$370 USD)** |

For a single-clinic deployment, the desktop-only mode (current) is free. Cloud costs only apply when multi-device/sync is enabled.

---

## 8. Implementation Phases

### Phase 1: Database Migration to PostgreSQL (Weeks 1–6)
See `database-migration-plan.md` — prerequisite for cloud deployment.

### Phase 2: Cloud Infrastructure Setup (Weeks 3–5, parallel)
- Provision RDS, Redis, OSS, API Gateway
- Set up CI/CD pipeline (GitHub Actions → ECS)
- Configure monitoring and alerting
- **Effort**: 2 weeks (1 DevOps engineer)

### Phase 3: Sync Engine (Weeks 7–9)
- Implement `SyncService` on server side
- Implement sync adapter on desktop client
- Handle offline-first with conflict resolution
- **Effort**: 3 weeks (2 engineers)

### Phase 4: API Gateway + Auth (Weeks 8–10)
- Configure API Gateway with JWT authorizer
- Enhance auth flow for multi-device sessions
- Add rate limiting per clinic
- **Effort**: 2 weeks (1 engineer)

### Phase 5: File Storage Migration (Weeks 10–11)
- Implement presigned URL upload flow
- Migrate existing local files to OSS
- Update imaging/medical-record services
- **Effort**: 1.5 weeks (1 engineer)

### Phase 6: Mobile/PWA Access (Weeks 11–14, optional)
- Build lightweight PWA for doctor mobile access
- Core features: patient lookup, appointment view, charge creation
- **Effort**: 3 weeks (1 frontend engineer)

---

## 9. Rollback Strategy

| Phase | Rollback | Risk |
|-------|----------|------|
| DB migration | Keep SQLite adapter, feature flag `DB_DRIVER` | Low — dual-mode supported |
| Cloud infra | Destroy resources, revert to local-only | Low — no data loss |
| Sync engine | Disable sync, use local-only mode | Medium — data may diverge |
| File storage | Keep local file paths, S3 as backup only | Low |

### 9.1 Feature flags

```typescript
// config/feature-flags.ts
export const FEATURES = {
  CLOUD_SYNC: process.env.FEATURE_CLOUD_SYNC === 'true',
  CLOUD_STORAGE: process.env.FEATURE_CLOUD_STORAGE === 'true',
  MULTI_DEVICE: process.env.FEATURE_MULTI_DEVICE === 'true',
  PWA_ACCESS: process.env.FEATURE_PWA === 'true',
};
```

---

## 10. Effort Estimate

| Phase | Duration | Engineers |
|-------|----------|-----------|
| Phase 1: DB migration | 6 weeks | 2 |
| Phase 2: Cloud infra | 2 weeks | 1 (DevOps) |
| Phase 3: Sync engine | 3 weeks | 2 |
| Phase 4: API gateway + auth | 2 weeks | 1 |
| Phase 5: File storage | 1.5 weeks | 1 |
| Phase 6: Mobile PWA (optional) | 3 weeks | 1 |
| **Total (without PWA)** | **~10 weeks** | 2–3 |
| **Total (with PWA)** | **~13 weeks** | 2–3 |

### Parallelizable work
- Phase 1 (DB) and Phase 2 (infra) can run in parallel
- Phase 4 (gateway) can start once Phase 1 is complete
- Phase 5 (storage) can start once Phase 2 is complete
- Phase 3 (sync) requires Phase 1 + Phase 2

---

## 11. Security Considerations

### 11.1 Data in transit
- All API calls over HTTPS (TLS 1.2+)
- Desktop ↔ Cloud: Certificate pinning for Electron app
- Internal services: VPC internal communication

### 11.2 Data at rest
- RDS: Encrypted at rest (AES-256)
- OSS: Server-side encryption (SSE-KMS)
- Redis: Password authentication + VPC isolation

### 11.3 PHI (Patient Health Information) compliance
- Data residency: All data within mainland China (Alibaba Cloud)
- Access logging: Full audit trail via `AuditLog` + `OperationLog`
- Data export: Controlled via RBAC permissions
- Backup retention: Per medical record retention policies (15+ years)

### 11.4 Desktop client security
- Electron app with context isolation
- No `nodeIntegration` in renderer
- IPC calls for native operations
- Auto-update via signed releases
