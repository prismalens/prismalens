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
COPY packages/api/package.json packages/api/
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY packages/@prismalens/database/package.json packages/@prismalens/database/

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
# Stage 5: Build API
# ============================================
FROM node:20-alpine AS api-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=config-builder /app/packages/@prismalens/config/dist ./packages/@prismalens/config/dist
COPY --from=contracts-builder /app/packages/@prismalens/contracts/dist ./packages/@prismalens/contracts/dist
COPY --from=database-builder /app/packages/@prismalens/database/dist ./packages/@prismalens/database/dist

# Copy source
COPY packages/api packages/api
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/
COPY packages/@prismalens/database/package.json packages/@prismalens/database/
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/api
RUN pnpm build

# ============================================
# Stage 6: Production Runtime
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

# Copy node_modules for production
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules

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
# Stage 7: Production Runtime (Enterprise)
# ============================================
FROM runner AS enterprise

ENV PRISMALENS_EDITION=ENTERPRISE

# ============================================
# Stage 8: Development (for docker-compose.dev.yml)
# ============================================
FROM node:20-alpine AS dev
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules

# Copy source files
COPY packages/api packages/api
COPY packages/@prismalens/config packages/@prismalens/config
COPY packages/@prismalens/contracts packages/@prismalens/contracts
COPY packages/@prismalens/database packages/@prismalens/database
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/api

ENV NODE_ENV=development
ENV PRISMALENS_PORT=3001
ENV PRISMALENS_HOST=0.0.0.0

EXPOSE 3001

CMD ["pnpm", "start:dev"]
