#!/bin/sh
set -e

# PrismaLens Worker Entrypoint
# Handles runtime configuration for Python ADK Workers

echo "Starting PrismaLens Worker (Edition: ${PRISMALENS_EDITION:-COMMUNITY})"

# Handle custom certificates
if [ -d /opt/custom-certificates ]; then
  echo "Loading custom certificates from /opt/custom-certificates..."
  export SSL_CERT_DIR=/opt/custom-certificates
fi

# Enforce Community edition worker limit
if [ "${PRISMALENS_EDITION}" != "ENTERPRISE" ]; then
  if [ "${PRISMALENS_WORKER_CONCURRENCY:-1}" -gt 1 ]; then
    echo "Warning: Community Edition is limited to 1 worker"
    echo "         Upgrade to Enterprise for unlimited workers"
    export PRISMALENS_WORKER_CONCURRENCY=1
  fi
fi

# Print configuration summary
echo "Configuration:"
echo "  - Edition: ${PRISMALENS_EDITION:-COMMUNITY}"
echo "  - Concurrency: ${PRISMALENS_WORKER_CONCURRENCY:-1}"

if [ -n "$PRISMALENS_REDIS_URL" ]; then
  echo "  - Redis: Connected"
else
  if [ -n "$REDIS_URL" ]; then
    export PRISMALENS_REDIS_URL="$REDIS_URL"
    echo "  - Redis: Connected (from REDIS_URL)"
  else
    echo "  - Redis: Not configured (will fail to start)"
  fi
fi

if [ -n "$GOOGLE_API_KEY" ] || [ -n "$PRISMALENS_GOOGLE_API_KEY" ]; then
  echo "  - Google API: Configured"
else
  echo "  - Google API: Not configured (agent execution will fail)"
fi

# Execute the main command
exec "$@"
