# PrismaLens API - NestJS Backend
# Multi-stage Dockerfile for the API service
#
# Build context should be the repo root:
#   docker build -f docker/images/api/Dockerfile -t prismalens/api .
#
# Note: Frontend is now built separately. This image only contains the API.

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy package.json files for workspace packages
# `packages/worker` is the per-run investigation child the API forks. A missing
# workspace directory does NOT fail `--frozen-lockfile`: pnpm links the dependency
# anyway and leaves a dangling symlink, so the break shows up at runtime as
# `require.resolve("@prismalens/worker")` throwing and no investigation ever starting.
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY packages/@prismalens/database/package.json packages/@prismalens/database/
COPY packages/@prismalens/engine/package.json packages/@prismalens/engine/
COPY packages/@prismalens/logger/package.json packages/@prismalens/logger/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: Build Config Package
# ============================================
FROM node:20-alpine AS config-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/@prismalens/config/node_modules ./packages/@prismalens/config/node_modules

COPY packages/@prismalens/config packages/@prismalens/config
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/@prismalens/config
RUN pnpm build

# ============================================
# Stage 3: Build Contracts Package
# ============================================
FROM node:20-alpine AS contracts-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/@prismalens/contracts/node_modules ./packages/@prismalens/contracts/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist

COPY packages/@prismalens/contracts packages/@prismalens/contracts
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/@prismalens/contracts
RUN pnpm build

# ============================================
# Stage 4: Build Database Package
# ============================================
FROM node:20-alpine AS database-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/@prismalens/database/node_modules ./packages/@prismalens/database/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist

COPY packages/@prismalens/database packages/@prismalens/database
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/@prismalens/database
RUN pnpm build

# ============================================
# Stage 5: Build Logger Package
# ============================================
FROM node:20-alpine AS logger-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/@prismalens/logger/node_modules ./packages/@prismalens/logger/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist

COPY packages/@prismalens/logger packages/@prismalens/logger
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/@prismalens/logger
RUN pnpm build

# ============================================
# Stage 6: Build Engine Package
# ============================================
FROM node:20-alpine AS engine-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/@prismalens/engine/node_modules ./packages/@prismalens/engine/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist
COPY --from=contracts-builder /app/packages/@prismalens/contracts/dist ./packages/@prismalens/contracts/dist

COPY packages/@prismalens/engine packages/@prismalens/engine
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/@prismalens/engine
RUN pnpm build

# ============================================
# Stage 7: Build Worker Package
# ============================================
# The per-run investigation child. The API does not import it as a library — it
# forks `dist/index.js` — so the built package has to be present in the runtime
# image or `resolveChildEntry` throws and no investigation can start.
FROM node:20-alpine AS worker-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist
COPY --from=contracts-builder /app/packages/@prismalens/contracts/dist ./packages/@prismalens/contracts/dist
COPY --from=engine-builder /app/packages/@prismalens/engine/dist ./packages/@prismalens/engine/dist
COPY --from=logger-builder /app/packages/@prismalens/logger/dist ./packages/@prismalens/logger/dist

COPY packages/worker packages/worker
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY packages/@prismalens/engine/package.json packages/@prismalens/engine/
COPY packages/@prismalens/logger/package.json packages/@prismalens/logger/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/worker
RUN pnpm build

# ============================================
# Stage 8: Build API
# ============================================
FROM node:20-alpine AS api-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist
COPY --from=contracts-builder /app/packages/@prismalens/contracts/dist ./packages/@prismalens/contracts/dist
COPY --from=database-builder /app/packages/@prismalens/database/dist ./packages/@prismalens/database/dist
COPY --from=logger-builder /app/packages/@prismalens/logger/dist ./packages/@prismalens/logger/dist
COPY --from=engine-builder /app/packages/@prismalens/engine/dist ./packages/@prismalens/engine/dist
COPY --from=worker-builder /app/packages/worker/dist ./packages/worker/dist

# Copy source
COPY packages/api packages/api
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY packages/@prismalens/database/package.json packages/@prismalens/database/
COPY packages/@prismalens/logger/package.json packages/@prismalens/logger/
COPY packages/@prismalens/engine/package.json packages/@prismalens/engine/
COPY packages/worker/package.json packages/worker/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/api
RUN pnpm build

# ============================================
# Stage 9: Production Runtime
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

# Install only production dependencies for runtime
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built artifacts
COPY --from=api-builder /app/packages/api/dist ./packages/api/dist
COPY --from=api-builder /app/packages/api/package.json ./packages/api/
COPY --from=api-builder /app/packages/api/prisma ./packages/api/prisma
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist
COPY --from=config-builder /app/packages/@prismalens/config/package.json ./packages/@prismalens/config/
COPY --from=contracts-builder /app/packages/@prismalens/contracts/dist ./packages/@prismalens/contracts/dist
COPY --from=contracts-builder /app/packages/@prismalens/contracts/package.json ./packages/@prismalens/contracts/
COPY --from=database-builder /app/packages/@prismalens/database/dist ./packages/@prismalens/database/dist
COPY --from=database-builder /app/packages/@prismalens/database/package.json ./packages/@prismalens/database/
COPY --from=logger-builder /app/packages/@prismalens/logger/dist ./packages/@prismalens/logger/dist
COPY --from=logger-builder /app/packages/@prismalens/logger/package.json ./packages/@prismalens/logger/
COPY --from=engine-builder /app/packages/@prismalens/engine/dist ./packages/@prismalens/engine/dist
COPY --from=engine-builder /app/packages/@prismalens/engine/package.json ./packages/@prismalens/engine/
COPY --from=worker-builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=worker-builder /app/packages/worker/package.json ./packages/worker/

# Copy node_modules for production
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
# The forked child resolves its own dependencies from its own node_modules.
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules

# Environment - API runs on internal port 3001 (Caddy exposes 5367)
ENV NODE_ENV=production
ENV PRISMALENS_PORT=3001
ENV PRISMALENS_HOST=0.0.0.0
ENV PRISMALENS_EDITION=COMMUNITY

# Setup entrypoint
COPY docker/images/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create non-root user
RUN addgroup --system --gid 1001 prismalens && \
    adduser --system --uid 1001 prismalens

# Create data directory
RUN mkdir -p /app/data && chown prismalens:prismalens /app/data

USER prismalens

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "packages/api/dist/main.js"]

# ============================================
# Stage 10: Production Runtime (Enterprise)
# ============================================
FROM runner AS enterprise

ENV PRISMALENS_EDITION=ENTERPRISE

# ============================================
# Stage 11: Development (for docker-compose.dev.yml)
# ============================================
FROM node:20-alpine AS dev
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
# The forked child is a separate process and resolves from its own node_modules.
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules

# Copy source files. The worker is shipped unbuilt here on purpose: with no
# `dist`, `resolveChildEntry` falls back to `src/index.ts` and forks it under the
# tsx loader, which is the dev loop this stage exists for.
COPY packages/api packages/api
COPY packages/worker packages/worker
COPY packages/@prismalens/config packages/@prismalens/config
COPY packages/@prismalens/contracts packages/@prismalens/contracts
COPY packages/@prismalens/database packages/@prismalens/database
COPY packages/@prismalens/engine packages/@prismalens/engine
COPY packages/@prismalens/logger packages/@prismalens/logger
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/api

ENV NODE_ENV=development
ENV PRISMALENS_PORT=3001
ENV PRISMALENS_HOST=0.0.0.0

EXPOSE 3001

CMD ["pnpm", "start:dev"]
