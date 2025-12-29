# PrismaLens Main - Multi-Stage Dockerfile
# Builds the main server image: NestJS API + Next.js Frontend
#
# Build context should be the repo root:
#   docker build -f docker/images/main/Dockerfile -t prismalens/main .
#
# Targets:
#   - main: Community edition main server
#   - main-enterprise: Enterprise edition with additional features

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/cli/package.json packages/cli/
COPY packages/api/package.json packages/api/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: Build API
# ============================================
FROM node:20-alpine AS api-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules

# Copy source
COPY packages/api packages/api
COPY package.json pnpm-workspace.yaml ./

WORKDIR /app/packages/api
RUN pnpm build

# ============================================
# Stage 3: Build Frontend
# ============================================
FROM node:20-alpine AS web-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy source
COPY apps/web apps/web
COPY package.json pnpm-workspace.yaml ./

WORKDIR /app/apps/web

# Build for static export
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ============================================
# Stage 4: Build CLI
# ============================================
FROM node:20-alpine AS cli-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/cli/node_modules ./packages/cli/node_modules

# Copy source
COPY packages/cli packages/cli
COPY package.json pnpm-workspace.yaml ./

WORKDIR /app/packages/cli
RUN pnpm build

# ============================================
# Stage 5: Production Runtime (Community)
# ============================================
FROM node:20-alpine AS main

WORKDIR /app

# Install only production dependencies for runtime
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built artifacts
COPY --from=api-builder /app/packages/api/dist ./packages/api/dist
COPY --from=api-builder /app/packages/api/package.json ./packages/api/
COPY --from=web-builder /app/apps/web/out ./packages/api/public
COPY --from=cli-builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=cli-builder /app/packages/cli/bin ./packages/cli/bin
COPY --from=cli-builder /app/packages/cli/package.json ./packages/cli/

# Copy node_modules for production
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/cli/node_modules ./packages/cli/node_modules

# Environment
ENV NODE_ENV=production
ENV PORT=5367
ENV HOST=0.0.0.0
ENV PRISMALENS_EDITION=COMMUNITY

# Setup entrypoint
COPY docker/images/main/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create non-root user
RUN addgroup --system --gid 1001 prismalens && \
    adduser --system --uid 1001 prismalens
USER prismalens

EXPOSE 5367

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5367/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "packages/api/dist/main.js"]

# ============================================
# Stage 6: Production Runtime (Enterprise)
# ============================================
FROM main AS main-enterprise

ENV PRISMALENS_EDITION=ENTERPRISE
