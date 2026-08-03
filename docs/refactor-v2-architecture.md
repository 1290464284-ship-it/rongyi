# Refactor V2 - System Architecture

## Goals

- Replace the legacy controller-service-schema code organization with a clean modular monolith.
- Keep the business rules independent from Express/SQLite/React.
- Make every module self-contained: domain contract, application use case, infrastructure repository, HTTP adapter, web feature.
- Use typed events for side effects instead of hidden service-to-service calls.
- Make the API surface data-driven and consistent while retaining custom endpoints for complex workflows.
- Target the Electron desktop app as the primary runtime. The React renderer is the Electron window, not a separately deployed public web application.

## Architecture Layers

```mermaid
flowchart LR
  subgraph Web
    UI[React Feature Shell]
    API_CLIENT[Typed API Client]
  end

  subgraph HTTP
    MIDDLEWARE[Auth/Trace/Error/RateLimit]
    ROUTER[Feature Routers]
  end

  subgraph Application
    USE_CASES[Use Cases]
    EVENT_BUS[Domain Event Bus]
  end

  subgraph Domain
    ENTITIES[Entities and Value Objects]
    RULES[Business Rules and State Machines]
    PORTS[Repository and Clock Ports]
  end

  subgraph Infrastructure
    SQLITE[SQLite Connection and Migrations]
    REPOS[SQL Repositories]
    FILES[Backup/Print/File Storage]
  end

  UI --> API_CLIENT
  API_CLIENT --> MIDDLEWARE
  MIDDLEWARE --> ROUTER
  ROUTER --> USE_CASES
  USE_CASES --> ENTITIES
  USE_CASES --> RULES
  USE_CASES --> PORTS
  USE_CASES --> EVENT_BUS
  PORTS --> REPOS
  REPOS --> SQLITE
  USE_CASES --> FILES
  EVENT_BUS --> USE_CASES
```

## Module Dependency Graph

```mermaid
flowchart TD
  AUTH[Auth] --> USERS[Users]
  USERS --> PATIENTS[Patients]
  SCHED[Appointments] --> PATIENTS
  SCHED --> CHAIRS[Chairs]
  VISITS[Visits] --> SCHED
  VISITS --> PATIENTS
  CLINICAL[Clinical Records] --> VISITS
  CLINICAL --> PATIENTS
  CHARGE[Charge] --> PATIENTS
  CHARGE --> VISITS
  MEMBER[Member Cards] --> PATIENTS
  REFUND[Refunds] --> CHARGE
  REFUND --> MEMBER
  INVENTORY[Inventory] --> SUPPLIERS[Suppliers]
  PURCHASE[Purchase Orders] --> INVENTORY
  PURCHASE --> SUPPLIERS
  PROCESS[Processing Orders] --> INVENTORY
  FOLLOWUP[Follow-ups] --> PATIENTS
  FOLLOWUP --> VISITS
  ANALYTICS[Analytics] --> CHARGE
  ANALYTICS --> VISITS
  ANALYTICS --> FOLLOWUP
  SYSTEM[System] --> ALL[All Modules]
```

## Request Data Flow

```mermaid
sequenceDiagram
  participant Browser
  participant Http
  participant Middleware
  participant Router
  participant UseCase
  participant Domain
  participant Repository
  participant Sqlite

  Browser->>Http: HTTP request
  Http->>Middleware: trace/auth/validation
  Middleware->>Router: normalized context
  Router->>UseCase: typed command/query
  UseCase->>Domain: load aggregate and validate rules
  Domain->>UseCase: result/domain event
  UseCase->>Repository: persist aggregate
  Repository->>Sqlite: parameterized transaction
  Sqlite-->>Repository: rows
  Repository-->>UseCase: saved aggregate
  UseCase-->>Router: response DTO
  Router-->>Browser: JSON result
```

## New Project Layout

```text
apps/v2/
  src/
    domain/          Entities, enums, value objects, repository ports
    application/     Use cases, commands, queries, event handlers
    infrastructure/  SQLite, repositories, file/backup adapters
    http/            Express app, middleware, feature routers, DTO validation
    web/             Vite React application
  docs/              Architecture and contract documentation
```

## Key Decisions

1. **Modular monolith**: one deployable backend, clear module boundaries, no hidden cross-module service calls.
2. **Hexagonal ports**: use cases depend on interfaces, not SQL or Express.
3. **Type-first contracts**: a single domain package defines entities, enums, commands, queries, and DTOs.
4. **Event bus**: side effects such as audit logs, cache invalidation, alerts, and sync changes subscribe to domain events.
5. **Data-driven CRUD**: simple resources share a generic router and repository; complex workflows get explicit use cases.
6. **Soft delete and idempotency are infrastructure invariants**, not per-module conventions.
7. **Fixed timezone**: all business dates are normalized to `Asia/Shanghai`.
8. **Money is integer cents** until the presentation layer formats it.
