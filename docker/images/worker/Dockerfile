# PrismaLens Worker - Python Worker Dockerfile
# Builds the worker image: Google ADK Agent Execution
#
# Build context should be the repo root:
#   docker build -f docker/images/worker/Dockerfile -t prismalens/worker .
#
# Targets:
#   - worker: Community edition (1 worker limit)
#   - worker-enterprise: Enterprise edition (unlimited workers)

# ============================================
# Stage 1: Base with Python dependencies
# ============================================
FROM python:3.13-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster dependency management
RUN pip install --no-cache-dir uv

# Copy dependency files
COPY packages/@prismalens/worker-python/pyproject.toml ./

# Install dependencies
RUN uv sync --no-dev

# ============================================
# Stage 2: Worker (Community)
# ============================================
FROM base AS worker

WORKDIR /app

# Copy application code
COPY packages/@prismalens/worker-python/ ./

# Environment
ENV PRISMALENS_EDITION=COMMUNITY
ENV PRISMALENS_WORKER_CONCURRENCY=1

# Setup entrypoint
COPY docker/images/worker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create non-root user
RUN addgroup --system --gid 1001 prismalens && \
    adduser --system --uid 1001 prismalens
USER prismalens

# Workers don't expose ports - they connect to Redis
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uv", "run", "python", "worker.py"]

# ============================================
# Stage 3: Worker (Enterprise)
# ============================================
FROM worker AS worker-enterprise

ENV PRISMALENS_EDITION=ENTERPRISE
# Enterprise allows configurable concurrency
ENV PRISMALENS_WORKER_CONCURRENCY=5
