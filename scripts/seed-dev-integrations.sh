#!/bin/bash
# Seeds dev integrations (GitHub App, Render) via the API.
# Requires: API running on port 3001, dev user seeded, .env.seed file.
# Usage: bash scripts/seed-dev-integrations.sh [--force]

set -euo pipefail

API_BASE="http://localhost:3001"
SEED_PREFIX="[seed]"
COOKIE_FILE=$(mktemp)
trap 'rm -f "$COOKIE_FILE"' EXIT

FORCE=false
for arg in "$@"; do
	case "$arg" in
		--force) FORCE=true ;;
		*) echo "Unknown argument: $arg"; exit 1 ;;
	esac
done

# --- Load .env.seed ---

SEED_ENV="$(dirname "$0")/../.env.seed"
if [ ! -f "$SEED_ENV" ]; then
	echo "ERROR: .env.seed not found. Copy .env.seed.example to .env.seed and fill in your values."
	exit 1
fi
set -a
source "$SEED_ENV"
set +a

# --- Helpers ---

api_get() {
	curl -s -b "$COOKIE_FILE" "${API_BASE}${1}"
}

api_post() {
	local endpoint="$1"
	local body="$2"
	curl -s -b "$COOKIE_FILE" -X POST "${API_BASE}${endpoint}" \
		-H 'Content-Type: application/json' \
		-d "$body"
}

api_delete() {
	local endpoint="$1"
	curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_FILE" -X DELETE "${API_BASE}${endpoint}"
}

check_http() {
	local endpoint="$1"
	local status
	status=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_FILE" "${API_BASE}${endpoint}")
	echo "$status"
}

die() {
	echo "ERROR: $1"
	exit 1
}

# --- Preflight checks ---

echo "Checking API health..."
HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/health" 2>/dev/null || true)
if [ "$HEALTH_STATUS" != "200" ]; then
	die "API not running at ${API_BASE}. Start the API first."
fi
echo "  API is healthy."

# --- Authenticate ---

echo "Logging in as dev admin..."
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "${API_BASE}/api/auth/sign-in/email" \
	-H 'Content-Type: application/json' \
	-d '{"email":"admin@prismalens.dev","password":"admin123"}')

# Verify we got a session
AUTH_STATUS=$(check_http "/api/auth/get-session")
if [ "$AUTH_STATUS" != "200" ]; then
	die "Login failed. Make sure dev user is seeded (run: bash scripts/seed-default-user.sh)"
fi
echo "  Logged in."

# --- Force cleanup ---

if [ "$FORCE" = true ]; then
	echo "Force mode: cleaning up seeded integrations (prefix: ${SEED_PREFIX})..."

	EXISTING=$(api_get "/api/integrations")
	SEED_IDS=$(echo "$EXISTING" | jq -r --arg pfx "$SEED_PREFIX" '.[] | select(.label | startswith($pfx)) | .id' 2>/dev/null || true)

	if [ -z "$SEED_IDS" ]; then
		echo "  No seeded integrations found."
	else
		CONNECTIONS=$(api_get "/api/integrations/connections")
		for iid in $SEED_IDS; do
			# Delete connections belonging to this seeded integration
			CONN_IDS=$(echo "$CONNECTIONS" | jq -r --arg iid "$iid" '.[] | select(.integrationId == $iid) | .id' 2>/dev/null || true)
			for cid in $CONN_IDS; do
				echo "  Deleting connection ${cid}..."
				api_delete "/api/integrations/connections/${cid}"
			done
			echo "  Deleting integration ${iid}..."
			api_delete "/api/integrations/${iid}"
		done
	fi

	echo "  Cleanup complete."
fi

# --- Check existing integrations ---

EXISTING=$(api_get "/api/integrations")

# --- GitHub App Integration ---

if [ -z "${GITHUB_APP_ID:-}" ] || [ -z "${GITHUB_APP_PRIVATE_KEY_PATH:-}" ] || [ -z "${GITHUB_APP_INSTALLATION_ID:-}" ]; then
	echo "Skipping GitHub App: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH, or GITHUB_APP_INSTALLATION_ID not set in .env.seed"
else
	# Check if GitHub App integration already exists
	EXISTING_GH=$(echo "$EXISTING" | jq -r '.[] | select(.templateId == "github-app") | .id' 2>/dev/null || true)

	if [ -n "$EXISTING_GH" ]; then
		echo "GitHub App integration already exists (id: ${EXISTING_GH}, template: github-app). Skipping creation."
		GH_INTEGRATION_ID="$EXISTING_GH"
	else
		# Read private key from file
		if [ ! -f "$GITHUB_APP_PRIVATE_KEY_PATH" ]; then
			die "Private key file not found: $GITHUB_APP_PRIVATE_KEY_PATH"
		fi

		echo "Creating GitHub App integration..."
		GH_BODY=$(jq -n \
			--arg templateId "github-app" \
			--arg label "${SEED_PREFIX} GitHub App" \
			--arg clientId "$GITHUB_APP_ID" \
			--rawfile privateKey "$GITHUB_APP_PRIVATE_KEY_PATH" \
			--arg webhookSecret "${GITHUB_APP_WEBHOOK_SECRET:-}" \
			'{templateId: $templateId, label: $label, clientId: $clientId,
			  clientSecret: ({privateKey: $privateKey} + (if $webhookSecret != "" then {webhookSecret: $webhookSecret} else {} end) | tostring)}')

		GH_RESPONSE=$(api_post "/api/integrations" "$GH_BODY")
		GH_INTEGRATION_ID=$(echo "$GH_RESPONSE" | jq -r '.id // empty')

		if [ -z "$GH_INTEGRATION_ID" ]; then
			echo "  Failed to create GitHub App integration:"
			echo "  $GH_RESPONSE"
			die "GitHub App integration creation failed."
		fi
		echo "  Created GitHub App integration (id: ${GH_INTEGRATION_ID})"
	fi

	# Check if connection already exists
	CONNECTIONS=$(api_get "/api/integrations/connections")
	EXISTING_GH_CONN=$(echo "$CONNECTIONS" | jq -r --arg iid "$GH_INTEGRATION_ID" '.[] | select(.integrationId == $iid) | .id' 2>/dev/null || true)
	EXISTING_GH_CONN_STATUS=$(echo "$CONNECTIONS" | jq -r --arg iid "$GH_INTEGRATION_ID" '.[] | select(.integrationId == $iid) | .status' 2>/dev/null || true)

	if [ -n "$EXISTING_GH_CONN" ]; then
		echo "  GitHub App connection already exists (id: ${EXISTING_GH_CONN}, status: ${EXISTING_GH_CONN_STATUS}). Skipping."
	else
		echo "  Connecting GitHub installation ${GITHUB_APP_INSTALLATION_ID}..."
		CONNECT_BODY=$(jq -n \
			--arg installationId "$GITHUB_APP_INSTALLATION_ID" \
			--arg organization "${GITHUB_APP_ORG:-}" \
			'if $organization == "" then {installationId: $installationId} else {installationId: $installationId, organization: $organization} end')

		CONNECT_RESPONSE=$(api_post "/api/integrations/${GH_INTEGRATION_ID}/github/installations/connect" "$CONNECT_BODY")
		CONNECT_ID=$(echo "$CONNECT_RESPONSE" | jq -r '.id // empty')

		if [ -z "$CONNECT_ID" ]; then
			echo "  Failed to connect GitHub installation:"
			echo "  $CONNECT_RESPONSE"
			die "GitHub App connection failed."
		fi
		echo "  Connected GitHub installation (connection id: ${CONNECT_ID})"
	fi
fi

# --- Render Integration ---

EXISTING_RENDER=$(echo "$EXISTING" | jq -r '.[] | select(.templateId == "render") | .id' 2>/dev/null || true)

if [ -n "$EXISTING_RENDER" ]; then
	echo "Render integration already exists (id: ${EXISTING_RENDER}, template: render). Skipping creation."
	RENDER_INTEGRATION_ID="$EXISTING_RENDER"
else
	echo "Creating Render integration..."
	RENDER_BODY=$(jq -n \
		--arg templateId "render" \
		--arg label "${SEED_PREFIX} Render" \
		'{templateId: $templateId, label: $label}')

	RENDER_RESPONSE=$(api_post "/api/integrations" "$RENDER_BODY")
	RENDER_INTEGRATION_ID=$(echo "$RENDER_RESPONSE" | jq -r '.id // empty')

	if [ -z "$RENDER_INTEGRATION_ID" ]; then
		echo "  Failed to create Render integration:"
		echo "  $RENDER_RESPONSE"
		die "Render integration creation failed."
	fi
	echo "  Created Render integration (id: ${RENDER_INTEGRATION_ID})"
fi

# Connect Render if API key is provided
if [ -n "${RENDER_API_KEY:-}" ]; then
	CONNECTIONS=$(api_get "/api/integrations/connections")
	EXISTING_RENDER_CONN=$(echo "$CONNECTIONS" | jq -r --arg iid "$RENDER_INTEGRATION_ID" '.[] | select(.integrationId == $iid) | .id' 2>/dev/null || true)
	EXISTING_RENDER_CONN_STATUS=$(echo "$CONNECTIONS" | jq -r --arg iid "$RENDER_INTEGRATION_ID" '.[] | select(.integrationId == $iid) | .status' 2>/dev/null || true)

	if [ -n "$EXISTING_RENDER_CONN" ]; then
		echo "  Render connection already exists (id: ${EXISTING_RENDER_CONN}, status: ${EXISTING_RENDER_CONN_STATUS}). Skipping."
	else
		echo "  Creating Render connection..."
		RENDER_CONN_BODY=$(jq -n \
			--arg integrationId "$RENDER_INTEGRATION_ID" \
			--arg apiKey "$RENDER_API_KEY" \
			'{integrationId: $integrationId, credentials: {apiKey: $apiKey}}')

		RENDER_CONN_RESPONSE=$(api_post "/api/integrations/connections" "$RENDER_CONN_BODY")
		RENDER_CONN_ID=$(echo "$RENDER_CONN_RESPONSE" | jq -r '.id // empty')

		if [ -z "$RENDER_CONN_ID" ]; then
			echo "  Failed to create Render connection:"
			echo "  $RENDER_CONN_RESPONSE"
			die "Render connection creation failed."
		fi
		echo "  Connected Render (connection id: ${RENDER_CONN_ID})"
	fi
else
	echo "  Skipping Render connection: RENDER_API_KEY not set in .env.seed"
fi

echo ""
echo "Dev integrations seeded successfully."
