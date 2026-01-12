#!/bin/sh
set -e

# PrismaLens API Server Entrypoint
# Handles runtime configuration for NestJS API

echo "Starting PrismaLens API (Edition: ${PRISMALENS_EDITION:-COMMUNITY})"

# Handle custom certificates
if [ -d /opt/custom-certificates ]; then
  echo "Loading custom certificates from /opt/custom-certificates..."
  export NODE_EXTRA_CA_CERTS=/opt/custom-certificates
fi

# Print configuration summary (without sensitive data)
echo "Configuration:"
echo "  - Edition: ${PRISMALENS_EDITION:-COMMUNITY}"
echo "  - Port: ${PRISMALENS_PORT:-3001}"
echo "  - Host: ${PRISMALENS_HOST:-0.0.0.0}"
echo "  - Node Environment: ${NODE_ENV:-production}"

if [ -n "$REDIS_URL" ]; then
  echo "  - Redis: Connected"
else
  echo "  - Redis: Not configured (queue disabled)"
fi

if [ -n "$DATABASE_URL" ]; then
  echo "  - Database: Configured"
else
  echo "  - Database: Using default SQLite"
fi

# Execute the main command
exec "$@"
