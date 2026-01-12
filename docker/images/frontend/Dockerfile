# PrismaLens Frontend - TanStack Start (SSR)
# Multi-stage Dockerfile for the frontend application
#
# Build context should be the repo root:
#   docker build -f docker/images/frontend/Dockerfile -t prismalens/frontend .

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for workspace packages
COPY packages/frontend/package.json packages/frontend/
COPY packages/@prismalens/config/package.json packages/@prismalens/config/
COPY packages/@prismalens/contracts/package.json packages/@prismalens/contracts/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/frontend/node_modules ./packages/frontend/node_modules
COPY --from=deps /app/packages/@prismalens/config/node_modules ./packages/@prismalens/config/node_modules
COPY --from=deps /app/packages/@prismalens/contracts/node_modules ./packages/@prismalens/contracts/node_modules

# Copy source files
COPY packages/frontend packages/frontend
COPY packages/@prismalens/config packages/@prismalens/config
COPY packages/@prismalens/contracts packages/@prismalens/contracts
COPY package.json pnpm-workspace.yaml tsconfig.json ./

# Build dependent packages first
WORKDIR /app/packages/@prismalens/config
RUN pnpm build

WORKDIR /app/packages/@prismalens/contracts
RUN pnpm build

# Build frontend
WORKDIR /app/packages/frontend
RUN pnpm build

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 prismalens && \
    adduser --system --uid 1001 prismalens

# Copy built output
COPY --from=builder --chown=prismalens:prismalens /app/packages/frontend/.output ./.output
COPY --from=builder --chown=prismalens:prismalens /app/packages/frontend/package.json ./

USER prismalens

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", ".output/server/index.mjs"]

# ============================================
# Stage 4: Development (for docker-compose.dev.yml)
# ============================================
FROM node:20-alpine AS dev
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/frontend/node_modules ./packages/frontend/node_modules
COPY --from=deps /app/packages/@prismalens/config/node_modules ./packages/@prismalens/config/node_modules
COPY --from=deps /app/packages/@prismalens/contracts/node_modules ./packages/@prismalens/contracts/node_modules

# Copy source files
COPY packages/frontend packages/frontend
COPY packages/@prismalens/config packages/@prismalens/config
COPY packages/@prismalens/contracts packages/@prismalens/contracts
COPY package.json pnpm-workspace.yaml tsconfig.json ./

WORKDIR /app/packages/frontend

ENV NODE_ENV=development
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "dev"]
