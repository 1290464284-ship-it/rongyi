# Refactor V2 - Code Quality Guarantees

## Legacy Data Is Not Legacy Code

The refactored application uses the existing SQLite file only as a data
compatibility source. It does not reuse old controllers, old services, old
routers, or old business logic.

The compatibility path is isolated:

```text
application/          use cases, commands, queries, state machines
domain/               new entities, enums, repository ports, resource registry
infrastructure/
  database.ts         new SQLite connection and table bootstrap
  legacy-registry.ts  dynamic metadata adapter for legacy tables
  repository.ts       generic SQL repository for declarative resources
```

## Boundary Rules

1. Application use cases must not import `legacy-registry.ts` or raw schema files.
2. Legacy table metadata is produced from `PRAGMA table_info`, not copied from old service code.
3. Generic CRUD is driven by declarative `ResourceDefinition`; old table names and columns are only metadata.
4. Complex workflows are explicit use cases in `application/`, not hidden SQL inside old controllers.
5. The original `apps/api/data/dental.sqlite` is never modified. V2 works on a copy.
6. Domain contracts in `apps/v2/src/domain/contracts.ts` remain the source of truth for new code.

## Quality Gates

- `pnpm --filter @dental/v2 typecheck`
- `pnpm --filter @dental/v2 test`
- `pnpm --filter @dental/v2 build`
- `pnpm --filter @dental/v2 electron:compile`
- `pnpm --filter @dental/v2 smoke:api`
- `pnpm --filter @dental/v2 smoke:ui`

The architecture boundary test at
`apps/v2/src/server/application/architecture.spec.ts` fails if application code
starts depending on the legacy adapter or raw database bootstrap.

