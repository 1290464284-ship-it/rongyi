# Core code boundary rules
# Lines starting with ! are exclusions
# Patterns are relative to source/ root

# Database layer
apps/api/src/db/**
apps/api/src/common/services/base.service.ts
apps/api/src/common/services/operation-log-sink.interface.ts

# Core services
apps/api/src/modules/system/operation-logs/**

# API entry & middleware
apps/api/src/main.ts
apps/api/src/app.module.ts
apps/api/src/common/middleware/**

# Shared types
packages/shared/src/**

# Web API client
apps/web/src/lib/api/api.ts
