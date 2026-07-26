# ====================
# Stage 1: Build
# ====================
FROM node:20-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

RUN pnpm --filter @dental/shared build
RUN pnpm --filter @dental/api build

# ====================
# Stage 2: Production (no pnpm needed — ncc bundle is self-contained)
# ====================
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && \
    useradd -r -g 1001 -u 1001 nestjs

WORKDIR /app

# ncc bundle (self-contained JS) + native better-sqlite3 binary
COPY --from=build /app/apps/api/bundle ./apps/api/bundle
COPY --from=build /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node ./apps/api/bundle/build/Release/better_sqlite3.node

RUN mkdir -p /app/data && chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const options = {hostname: 'localhost', port: process.env.PORT || 8080, path: '/api/v1/health', method: 'GET', timeout: 5000}; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "apps/api/bundle/index.js"]
