/**
 * Profile-seed catalog — integration-scoped sub-agent profiles harvested from
 * the retired engine's SRE skills (work-unit 004, FR-14/15, D0.5).
 *
 * Each entry pairs a named profile with the integration it queries, a default
 * capability tag, the FULL re-authored CLI-first skill body (promtool /
 * sentry-cli / amtool / curl + HTTP fallback + required env vars), and the
 * single highest-value readonly query to run at investigation start
 * (`seedCallHint`, consumed by `planSeed` in `seed.ts`).
 *
 * BOUNDARY (FR-15): this catalog supplies skill bodies + capability defaults +
 * integration scope ONLY. It is static DATA for work-unit 002 to consume — it
 * deliberately contains NO registry, NO adapter contract, and NO tool
 * self-registration; those are 002's concerns. The set of profiles AVAILABLE
 * to an operator is NOT this whole list: it DERIVES from the integrations the
 * operator has connected (ADR 0002 §4) — and 002 owns that derivation. This
 * unit only states the mapping from integration → profile.
 *
 * Harvest provenance (re-authored, NOT imported — Principle I / NFR-1):
 *   - `prismalens-agents/skills/pl-prometheus/SKILL.md`
 *   - `prismalens-agents/skills/pl-sentry/SKILL.md`
 *   - `prismalens-agents/skills/pl-grafana/SKILL.md`
 *   - `prismalens-agents/skills/pl-alertmanager/SKILL.md`
 * Every `pl report`/`pl dispatch`/`pl status` CLI line and every
 * `gatherer`/`analyst`/`verifier` role name from the originals is STRIPPED;
 * findings are emitted through 002's typed output currency, not a dead CLI
 * (SC-3). Each body keeps a CLI-first path with an HTTP/`curl` fallback and the
 * required env vars (Principle V / NFR-3), and stays backend-neutral
 * (Principle II / NFR-5).
 */

/**
 * The canonical capability taxonomy (ADR 0002 §4, Principle IV). Profile seeds
 * default to `readonly`; `propose`/`mutate` exist for completeness so 002 can
 * tag tools that go beyond observation. The `gatherer`/`analyst`/`verifier`
 * role names from the retired engine are dropped, not mapped (A-4).
 */
export type CapabilityTag = "readonly" | "propose" | "mutate";

/**
 * One integration-scoped profile seed (FR-14). Shape-compatible with
 * `ProfileSeedHint` in `seed.ts` (it carries `profileName`,
 * `integrationSource`, `seedCallHint`, and `capabilityTag`), so `planSeed`
 * consumes `PROFILE_SEEDS` directly when deriving the pre-loop `SeedPlan`.
 */
export interface ProfileSeed {
	/** Named profile (e.g. `'metrics'`), how the agent fleet refers to it. */
	profileName: string;
	/** Integration key this profile queries (e.g. `'prometheus'`). */
	integrationSource: string;
	/** Default capability for this profile — `readonly` for all four seeds. */
	capabilityTag: CapabilityTag;
	/** Full re-authored CLI-first skill body (backend-neutral string). */
	skillBody: string;
	/** Highest-value readonly query to run first (feeds `SeedCall.rationale`). */
	seedCallHint: string;
}

/**
 * Re-authored `pl-prometheus` body. promtool-first with a `curl` fallback;
 * requires `PROMETHEUS_URL`. (Harvest: `pl-prometheus/SKILL.md`; `pl report`
 * lines removed — observations flow into typed `Finding`s in 002.)
 */
const PROMETHEUS_SKILL_BODY = `# Prometheus Investigation Queries

Query Prometheus metrics to gather evidence during an investigation.

## Environment

\`\`\`bash
# Required — set before any query
export PROMETHEUS_URL="\${PROMETHEUS_URL:-http://localhost:9090}"
\`\`\`

## Quick Reference

### promtool (preferred)

\`\`\`bash
# Instant query — current value
promtool query instant "$PROMETHEUS_URL" 'up{job="payment-api"}'

# Range query — time series over a window
promtool query range "$PROMETHEUS_URL" \\
  'rate(http_requests_total{job="payment-api",status=~"5.."}[5m])' \\
  --start="2024-01-15T10:00:00Z" --end="2024-01-15T11:00:00Z" --step=60s
\`\`\`

### curl fallback

\`\`\`bash
# Instant query
curl -sG "$PROMETHEUS_URL/api/v1/query" \\
  --data-urlencode 'query=up{job="payment-api"}' | jq '.data.result'

# Range query
curl -sG "$PROMETHEUS_URL/api/v1/query_range" \\
  --data-urlencode 'query=rate(http_requests_total{job="payment-api",status=~"5.."}[5m])' \\
  --data-urlencode 'start=2024-01-15T10:00:00Z' \\
  --data-urlencode 'end=2024-01-15T11:00:00Z' \\
  --data-urlencode 'step=60s' | jq '.data.result'
\`\`\`

### Response format

All Prometheus API responses use this envelope:

\`\`\`json
{"status":"success","data":{"resultType":"vector|matrix|scalar","result":[...]}}
\`\`\`

| resultType | Shape | When |
|------------|-------|------|
| \`vector\` | \`[{"metric":{...},"value":[timestamp,value]}]\` | Instant queries |
| \`matrix\` | \`[{"metric":{...},"values":[[ts,val],...]}]\` | Range queries |
| \`scalar\` | \`[timestamp, value]\` | Scalar expressions |

Always pipe through \`jq '.data.result'\` to extract the payload.

## Investigation Queries

### Error Rate

\`\`\`promql
# Overall error rate (5xx responses per second)
rate(http_requests_total{job="$SERVICE",status=~"5.."}[5m])

# Error ratio — fraction of requests that are errors
rate(http_requests_total{job="$SERVICE",status=~"5.."}[5m])
  / rate(http_requests_total{job="$SERVICE"}[5m])

# Error rate by endpoint
sum by (handler, method) (
  rate(http_requests_total{job="$SERVICE",status=~"5.."}[5m])
)

# Error spike detection — current vs 1 hour ago
rate(http_requests_total{job="$SERVICE",status=~"5.."}[5m])
  / rate(http_requests_total{job="$SERVICE",status=~"5.."}[5m] offset 1h)
\`\`\`

### Latency Percentiles

\`\`\`promql
# p95 latency
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="$SERVICE"}[5m]))
)

# p50 / p95 / p99 side-by-side (run separately, compare results)
# p50:
histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket{job="$SERVICE"}[5m])))
# p99:
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="$SERVICE"}[5m])))

# Latency by endpoint
histogram_quantile(0.95,
  sum by (le, handler) (rate(http_request_duration_seconds_bucket{job="$SERVICE"}[5m]))
)
\`\`\`

### Resource Saturation

\`\`\`promql
# CPU usage per pod
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="$NS",pod=~"$SERVICE.*"}[5m]))

# Memory usage per pod (bytes)
container_memory_usage_bytes{namespace="$NS",pod=~"$SERVICE.*"}

# Memory vs limit — saturation ratio
container_memory_usage_bytes{namespace="$NS",pod=~"$SERVICE.*"}
  / container_spec_memory_limit_bytes{namespace="$NS",pod=~"$SERVICE.*"}

# Disk usage
1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})

# Network receive errors
rate(node_network_receive_errs_total[5m])
\`\`\`

### Container and Kubernetes Metrics

\`\`\`promql
# Pod restart count (last hour)
increase(kube_pod_container_status_restarts_total{namespace="$NS",pod=~"$SERVICE.*"}[1h])

# OOM killed containers
kube_pod_container_status_last_terminated_reason{reason="OOMKilled",namespace="$NS"}

# Pods not ready
kube_pod_status_ready{namespace="$NS",condition="true"} == 0

# Container resource requests vs actual usage
container_memory_usage_bytes{namespace="$NS",pod=~"$SERVICE.*"}
  / kube_pod_container_resource_requests{resource="memory",namespace="$NS",pod=~"$SERVICE.*"}
\`\`\`

### Service Dependencies

\`\`\`promql
# Error rate on an upstream dependency
rate(http_requests_total{job="$UPSTREAM_SERVICE",status=~"5.."}[5m])

# Latency to a downstream service
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="$SERVICE",downstream="$DEP"}[5m]))
)

# Connection pool usage (if exposed)
sum by (pool) (db_connections_active{job="$SERVICE"})
  / sum by (pool) (db_connections_max{job="$SERVICE"})
\`\`\`

## Correlating Metrics with Alert Timestamps

When an alert fires at time \`T\`:

1. **Query the alert window** — range query from \`T - 30m\` to \`T + 10m\`, step \`30s\`.
2. **Find the inflection point** — the timestamp where the metric crossed the threshold.
3. **Correlate with deploys/events** — compare the inflection timestamp against deploy times and config changes.

\`\`\`bash
# Example: alert fired at 10:20, query a ±30 min window
ALERT_TIME="2024-01-15T10:20:00Z"
curl -sG "$PROMETHEUS_URL/api/v1/query_range" \\
  --data-urlencode "query=rate(http_requests_total{job=\\"payment-api\\",status=~\\"5..\\"}[5m])" \\
  --data-urlencode "start=2024-01-15T09:50:00Z" \\
  --data-urlencode "end=2024-01-15T10:30:00Z" \\
  --data-urlencode "step=30s" | jq '.data.result'
\`\`\`

\`\`\`bash
# Currently firing alerts
curl -s "$PROMETHEUS_URL/api/v1/alerts" | jq '.data.alerts[] | select(.state=="firing")'

# Alert rules and their thresholds
curl -s "$PROMETHEUS_URL/api/v1/rules" | jq '.data.groups[].rules[] | select(.type=="alerting")'
\`\`\`

## Gotchas

| Pitfall | Why it matters | What to do |
|---------|---------------|------------|
| \`rate()\` on a gauge | \`rate()\` computes per-second increase — meaningless on gauges | Use \`rate()\` only on counters; use the raw value or \`deriv()\` for gauges |
| \`irate()\` vs \`rate()\` | \`irate()\` uses the last two samples only — very spiky | Use \`rate()\` for investigation (smoother); \`irate()\` only for instantaneous bursts |
| Counter resets | Container restarts reset counters to 0 | \`rate()\`/\`increase()\` handle resets automatically; raw counter values do not |
| Missing \`le\` label in \`histogram_quantile\` | Aggregation must preserve \`le\` | Always include \`le\` in the \`by\` clause: \`sum by (le, ...)\` |
| Label matching in binary ops | Both sides must have identical label sets | Use \`on()\`/\`ignoring()\`: \`metric_a / on(instance) metric_b\` |
| Stale time series | Series go stale 5 min after the last scrape | Filter with \`up{job="..."}\` to confirm the target is scraped |
| Range vector window too small | \`[1m]\` with a 30s scrape interval = only 2 data points | Use at least \`[5m]\`; minimum 4x the scrape interval |
| \`absent()\` returns \`{}\` when the series exists | \`absent()\` returns 1 when the series is missing, empty when it exists | Use \`absent(up{job="..."})\` to detect down targets |
`;

/**
 * Re-authored `pl-sentry` body. sentry-cli-first with a `curl` fallback;
 * requires `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`. (Harvest:
 * `pl-sentry/SKILL.md`; `pl report` lines removed.)
 */
const SENTRY_SKILL_BODY = `# Sentry Investigation

Query Sentry for error data, extract stack traces, detect regressions, and correlate errors with deployments.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`SENTRY_AUTH_TOKEN\` | Yes | Bearer token for API authentication |
| \`SENTRY_ORG\` | Yes | Organization slug |
| \`SENTRY_PROJECT\` | Yes | Project slug (omit for org-wide queries) |
| \`SENTRY_URL\` | No | Base URL, defaults to \`https://sentry.io\` |

## Quick Reference

### sentry-cli (preferred)

\`\`\`bash
# List recent issues
sentry-cli issues list -p "$SENTRY_PROJECT" --status unresolved

# List events for a specific issue
sentry-cli issues events <ISSUE_ID>

# List releases
sentry-cli releases list -o "$SENTRY_ORG" -p "$SENTRY_PROJECT"
\`\`\`

### curl fallback

All API requests use this pattern:

\`\`\`bash
SENTRY_BASE="\${SENTRY_URL:-https://sentry.io}/api/0"

# List project issues (unresolved, sorted by frequency)
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved&sort=freq&statsPeriod=1h"

# List organization-wide issues
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/issues/?query=is:unresolved&sort=freq&statsPeriod=1h"

# Get latest event for an issue
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/issues/<ISSUE_ID>/events/latest/"

# Get event details
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/events/<EVENT_ID>/"

# List releases
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/releases/?project=$SENTRY_PROJECT"
\`\`\`

## Investigation Patterns

### 1. Error Spike Detection

Identify abnormal error frequency in the last hour compared to baseline.

\`\`\`bash
SENTRY_BASE="\${SENTRY_URL:-https://sentry.io}/api/0"

# Current hour: top issues by frequency
CURRENT=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved&sort=freq&statsPeriod=1h&limit=10")

# Previous 24h baseline for comparison
BASELINE=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved&sort=freq&statsPeriod=24h&limit=10")
\`\`\`

**What to compare:** extract \`count\` from each issue in both responses. An issue whose last-hour count exceeds its 24h-average hourly rate by 3x or more is a spike.

### 2. Stack Trace Extraction

Get the full exception chain from the latest event of an issue.

\`\`\`bash
EVENT=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/issues/<ISSUE_ID>/events/latest/")
\`\`\`

**Parse the response:** exception data lives at \`.entries[] | select(.type == "exception") | .data.values[]\`. Each value contains:
- \`type\` — exception class name
- \`value\` — error message
- \`stacktrace.frames[]\` — array of frames (bottom = most recent when \`stacktrace.framesOmitted\` is null)

For each frame extract: \`filename\`, \`function\`, \`lineNo\`, \`colNo\`, \`context\` (surrounding source lines if available).

### 3. Regression Detection

Find issues that were resolved but have re-opened, indicating a regression.

\`\`\`bash
# Query for regressed issues
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:regressed&sort=date&statsPeriod=24h"
\`\`\`

**Key fields in the response:**
- \`status\` — \`"unresolved"\` with a \`substatus\` of \`"regressed"\`
- \`firstSeen\` — original occurrence (shows how old the bug is)
- \`lastSeen\` — when the regression surfaced
- \`statusDetails.inRelease\` — the release where it was marked resolved (compare to the current release)

### 4. Deploy Correlation

Compare error rates before and after a deployment.

\`\`\`bash
SENTRY_BASE="\${SENTRY_URL:-https://sentry.io}/api/0"

# Step 1: List recent releases
RELEASES=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/releases/?project=$SENTRY_PROJECT&per_page=5&sort=date")

# Step 2: Get error counts for a specific release
RELEASE_VERSION="your-release-version"
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/releases/$RELEASE_VERSION/"
\`\`\`

**Correlation approach:**
1. Get the release \`dateCreated\` timestamp.
2. Query issues with \`statsPeriod=1h\` using \`firstSeen\` after the release timestamp.
3. Issues where \`firstSeen\` falls within 30 minutes after deploy are deploy-correlated candidates.

\`\`\`bash
# New issues since a specific timestamp
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved+firstSeen:-1h&sort=date"
\`\`\`

### 5. Cross-Service Error Tracing

Trace error propagation across microservices using Sentry's trace data.

\`\`\`bash
# Step 1: Get an event with trace context
EVENT=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/issues/<ISSUE_ID>/events/latest/")
\`\`\`

**Extract the trace ID:** parse \`.contexts.trace.trace_id\` from the event response.

\`\`\`bash
# Step 2: Find all events sharing the same trace
TRACE_ID="<extracted-trace-id>"
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/organizations/$SENTRY_ORG/events/?query=trace:$TRACE_ID&field=title&field=project&field=timestamp&sort=-timestamp"
\`\`\`

This returns events across all projects in the org that share the trace, showing the propagation path. The earliest event in the trace is the originating service.

### 6. Rate Limit Handling

The Sentry API enforces rate limits that vary by plan. Detect and handle them.

\`\`\`bash
RESPONSE=$(curl -s -w "\\n%{http_code}" -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
  "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "429" ]; then
  # Extract Retry-After header (seconds to wait)
  RETRY_AFTER=$(curl -s -I -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \\
    "$SENTRY_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/" | grep -i "Retry-After" | awk '{print $2}' | tr -d '\\r')
  echo "Rate limited. Retry after \${RETRY_AFTER}s"
  sleep "$RETRY_AFTER"
fi
\`\`\`

Also check for the \`X-Sentry-Rate-Limits\` header in responses — it gives granular per-category limits before a hard 429.

## Output Parsing

Key fields to extract from issue-list responses:

| Field | Description | Use |
|-------|-------------|-----|
| \`id\` | Issue ID | Fetch events, link findings |
| \`title\` | Error type + message | Finding description |
| \`count\` | Total event count | Frequency analysis |
| \`firstSeen\` | ISO timestamp of first occurrence | Age, deploy correlation |
| \`lastSeen\` | ISO timestamp of most recent event | Recency, active vs stale |
| \`culprit\` | Function/module where the error occurred | Quick root-cause hint |
| \`permalink\` | Direct link to the issue in the Sentry UI | Include in reports |
| \`status\` | \`resolved\`, \`unresolved\`, \`ignored\` | Filter relevant issues |
| \`substatus\` | \`new\`, \`regressed\`, \`escalating\`, \`ongoing\` | Regression detection |

\`\`\`bash
# Example: extract key fields with jq
echo "$RESPONSE" | jq -r '.[] | "\\(.id) | \\(.title) | count=\\(.count) | first=\\(.firstSeen) | last=\\(.lastSeen) | \\(.culprit) | \\(.permalink)"'
\`\`\`

## Gotchas

- **statsPeriod vs start/end:** use \`statsPeriod=1h\` for relative windows; use \`start\`/\`end\` ISO timestamps for absolute ranges. Do not mix them — the API ignores \`statsPeriod\` when \`start\`/\`end\` are present.
- **Pagination is mandatory for large result sets.** Responses include a \`Link\` header with cursor values. Follow \`rel="next"; results="true"\`. Default and max page size is 100.
- **Issue count vs event count:** the \`count\` field on an issue is the total event count, not the count within your \`statsPeriod\`. Use the \`stats\` parameter or the events endpoint for time-windowed counts.
- **Project vs org endpoints:** project-scoped endpoints return only that project's data; org-scoped endpoints search across all projects — use org-scoped for cross-service investigations.
- **sentry-cli auth:** sentry-cli reads \`SENTRY_AUTH_TOKEN\` automatically. With a \`.sentryclirc\` file, the env var takes precedence.
- **DSN vs auth token:** DSNs send events from applications; API investigation requires an auth token with \`project:read\`, \`event:read\`, and \`org:read\` scopes.
- **Rate limits vary by plan:** self-hosted Sentry may have none; SaaS plans enforce per-endpoint limits. Always implement retry logic.
- **Event retention:** events are retained per plan (typically 30–90 days). Queries for older data return empty without error.
- **Timezone awareness:** all Sentry timestamps are UTC. Convert to local time only for display, never for queries.
`;

/**
 * Re-authored `pl-grafana` body. curl-only (no official CLI); requires
 * `GRAFANA_URL`/`GRAFANA_API_KEY`. (Harvest: `pl-grafana/SKILL.md`; `pl report`
 * lines removed.)
 */
const GRAFANA_SKILL_BODY = `# Grafana Investigation Skill

Query Grafana's HTTP API to gather dashboard context, alert state, and proxy data-source queries during an investigation.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`GRAFANA_URL\` | Yes | Base URL of the Grafana instance (e.g., \`https://grafana.example.com\`) |
| \`GRAFANA_API_KEY\` | Yes | API key or service-account token with appropriate permissions |

## Quick Reference

There is no official Grafana CLI for these queries — this skill is curl-first. All commands use the same auth pattern:

\`\`\`bash
AUTH="Authorization: Bearer $GRAFANA_API_KEY"
BASE="$GRAFANA_URL"
\`\`\`

| Task | Command |
|------|---------|
| List all datasources | \`curl -s -H "$AUTH" "$BASE/api/datasources" | jq '.[] | {id, name, type}'\` |
| Search dashboards | \`curl -s -H "$AUTH" "$BASE/api/search?query=payment&type=dash-db" | jq '.[] | {uid, title}'\` |
| Get dashboard by UID | \`curl -s -H "$AUTH" "$BASE/api/dashboards/uid/<uid>" | jq '.dashboard.panels[] | {id, title, type}'\` |
| List provisioned alert rules | \`curl -s -H "$AUTH" "$BASE/api/v1/provisioning/alert-rules" | jq '[.[] | select(.execErrState == "Alerting" or .noDataState == "Alerting")]'\` |
| Query Prometheus via proxy | \`curl -s -H "$AUTH" "$BASE/api/datasources/proxy/<ds-id>/api/v1/query?query=up" | jq '.data.result'\` |
| Annotations in a time range | \`curl -s -H "$AUTH" "$BASE/api/annotations?from=<epoch_ms>&to=<epoch_ms>" | jq '.[] | {text, tags, time}'\` |

## Authentication

Grafana supports several auth methods. For automation, use API keys or service-account tokens.

\`\`\`bash
# API key or service-account token (preferred)
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" "$GRAFANA_URL/api/org"

# Basic auth (fallback)
curl -s -u "admin:$GRAFANA_PASSWORD" "$GRAFANA_URL/api/org"
\`\`\`

Verify the token works before proceeding:

\`\`\`bash
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" "$GRAFANA_URL/api/org" | jq '.name'
\`\`\`

A 401 or 403 means the token is invalid or lacks permissions.

## Investigation Patterns

### 1. List Firing Alert Rules

Retrieve all provisioned alert rules and filter for those in a firing or error state.

\`\`\`bash
# All alert rules
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/v1/provisioning/alert-rules" | jq '
  [.[] | {
    title: .title,
    uid: .uid,
    folder: .folderUID,
    condition: .condition,
    labels: .labels,
    for: .for
  }]'
\`\`\`

To see which alerts are actually firing right now, query the Alertmanager-compatible endpoint:

\`\`\`bash
# Currently firing alerts (Grafana's built-in Alertmanager)
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/alertmanager/grafana/api/v2/alerts?active=true&silenced=false&inhibited=false" | jq '
  [.[] | {
    alertname: .labels.alertname,
    severity: .labels.severity,
    state: .status.state,
    startsAt: .startsAt,
    annotations: .annotations
  }]'
\`\`\`

### 2. Get Dashboard Context

Dashboards provide investigation context: which metrics are monitored and how panels are configured.

\`\`\`bash
# Step 1: Find the dashboard UID by searching
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/search?query=payment-api&type=dash-db" | jq '.[] | {uid, title, url}'

# Step 2: Fetch the full dashboard by UID
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/dashboards/uid/abc123def" | jq '{
    title: .dashboard.title,
    tags: .dashboard.tags,
    panels: [.dashboard.panels[] | {
      id: .id,
      title: .title,
      type: .type,
      datasource: .datasource,
      targets: .targets
    }]
  }'
\`\`\`

Extract specific panel queries to understand what the team monitors:

\`\`\`bash
# Extract all PromQL expressions from a dashboard
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/dashboards/uid/abc123def" | jq '
  [.dashboard.panels[] | .targets[]? | {
    refId: .refId,
    expr: .expr,
    legendFormat: .legendFormat
  }] | map(select(.expr != null))'
\`\`\`

### 3. Proxy Queries to Data Sources

Grafana can proxy requests to configured data sources, avoiding the need for direct network access to Prometheus, Loki, or other backends.

\`\`\`bash
# Step 1: List datasources to find the ID
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources" | jq '.[] | {id, name, type, url}'

# Step 2: Query Prometheus through the proxy
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources/proxy/1/api/v1/query" \\
  --data-urlencode 'query=rate(http_requests_total{service="payment-api",code=~"5.."}[5m])' | jq '.data.result'

# Step 3: Range query for time-series data
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources/proxy/1/api/v1/query_range" \\
  --data-urlencode 'query=rate(http_requests_total{service="payment-api"}[5m])' \\
  --data-urlencode "start=$(date -d '1 hour ago' +%s)" \\
  --data-urlencode "end=$(date +%s)" \\
  --data-urlencode 'step=60' | jq '.data.result'

# Query Loki through the proxy
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources/proxy/2/loki/api/v1/query_range" \\
  --data-urlencode 'query={app="payment-api"} |= "error"' \\
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \\
  --data-urlencode "end=$(date +%s)000000000" \\
  --data-urlencode 'limit=100' | jq '.data.result'
\`\`\`

### 4. List Annotations in a Time Range

Annotations mark deployments, incidents, and manual events — critical for correlating changes with problems.

\`\`\`bash
# Annotations in the last 2 hours
NOW_MS=$(($(date +%s) * 1000))
TWO_HOURS_AGO_MS=$(($NOW_MS - 7200000))

curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/annotations?from=$TWO_HOURS_AGO_MS&to=$NOW_MS" | jq '
  [.[] | {
    id: .id,
    text: .text,
    tags: .tags,
    time: (.time / 1000 | todate),
    dashboardUID: .dashboardUID
  }]'

# Filter annotations by tag (e.g., deploy markers)
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/annotations?from=$TWO_HOURS_AGO_MS&to=$NOW_MS&tags=deploy" | jq '
  [.[] | {text, tags, time: (.time / 1000 | todate)}]'
\`\`\`

### 5. Get Datasource Info

\`\`\`bash
# List all datasources with connection details
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources" | jq '
  [.[] | {
    id: .id,
    uid: .uid,
    name: .name,
    type: .type,
    url: .url,
    isDefault: .isDefault,
    access: .access
  }]'

# Get a specific datasource by ID
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources/1" | jq '{name, type, url, access, database}'
\`\`\`

## Output Parsing Patterns

\`\`\`bash
# All unique PromQL expressions across all panels
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/dashboards/uid/<uid>" | jq '
  [.dashboard.panels[] | .targets[]? | .expr // empty] | unique'

# Parse alert-rule data queries and conditions
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/v1/provisioning/alert-rules" | jq '
  [.[] | {
    title: .title,
    condition: .condition,
    queries: [.data[] | {refId: .refId, model: .model.expr?}]
  }]'

# Build a datasource UID-to-name lookup (dashboards reference datasources by UID)
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \\
  "$GRAFANA_URL/api/datasources" | jq 'map({(.uid): .name}) | add'
\`\`\`

## Gotchas

- **Dashboard UID vs ID:** API endpoints use \`uid\` (a string like \`abc123def\`), not the numeric \`id\`. The search endpoint returns both — always use \`uid\`.
- **Datasource-proxy permissions:** the API key needs \`Admin\` role or specific datasource permissions to use \`/api/datasources/proxy/\`. Viewer tokens get 403.
- **Datasource proxy uses the numeric ID:** unlike dashboards, the proxy endpoint requires the numeric \`id\`, not the \`uid\`.
- **Annotation timestamps are milliseconds:** \`from\`/\`to\` for \`/api/annotations\` expect epoch milliseconds, not seconds.
- **API-key scope:** API keys are scoped to an organization. With multiple orgs, the key only accesses its org's resources.
- **Service-account tokens vs API keys:** API keys are deprecated in Grafana 10+. Prefer service-account tokens — same \`Bearer\` auth header.
- **Provisioned alert rules:** \`/api/v1/provisioning/alert-rules\` returns definitions, not current firing state. Use the Alertmanager-compatible endpoint for live state.
- **Rate limiting:** large instances may enforce rate limits. Space out bulk queries; watch for \`429\`.
- **Folder permissions:** dashboard search results are filtered by the key's folder permissions. Missing dashboards may be a permissions issue, not absence.
`;

/**
 * Re-authored `pl-alertmanager` body. amtool-first with a `curl` fallback;
 * requires `ALERTMANAGER_URL`. (Harvest: `pl-alertmanager/SKILL.md`; `pl
 * report` lines removed.)
 */
const ALERTMANAGER_SKILL_BODY = `# Alertmanager Investigation

Query and diagnose alerts from Alertmanager during an investigation.

## Environment

\`\`\`bash
# Required — set before any command
export ALERTMANAGER_URL="\${ALERTMANAGER_URL:-http://alertmanager:9093}"
\`\`\`

## Quick Reference

Prefer \`amtool\` when available. Fall back to \`curl\` + \`jq\` otherwise.

### amtool (preferred)

\`\`\`bash
# All firing alerts
amtool alert query --alertmanager.url="$ALERTMANAGER_URL"

# Firing alerts for a specific service
amtool alert query service=payment-api --alertmanager.url="$ALERTMANAGER_URL"

# JSON output for programmatic parsing
amtool alert query --output=json --alertmanager.url="$ALERTMANAGER_URL"

# Include inhibited alerts (hidden by default)
amtool alert query --inhibited --alertmanager.url="$ALERTMANAGER_URL"

# Include silenced alerts (hidden by default)
amtool alert query --silenced --alertmanager.url="$ALERTMANAGER_URL"

# Active silences
amtool silence query --alertmanager.url="$ALERTMANAGER_URL"

# Routing tree
amtool config routes show --alertmanager.url="$ALERTMANAGER_URL"
\`\`\`

### curl fallback

\`\`\`bash
# All alerts (active, silenced, inhibited)
curl -s "$ALERTMANAGER_URL/api/v2/alerts" | jq .

# Filter by service label
curl -s "$ALERTMANAGER_URL/api/v2/alerts?filter=service%3D%22payment-api%22" | jq .

# Only active (not silenced, not inhibited)
curl -s "$ALERTMANAGER_URL/api/v2/alerts?active=true&silenced=false&inhibited=false" | jq .

# Alert groups
curl -s "$ALERTMANAGER_URL/api/v2/alerts/groups" | jq .

# Silences
curl -s "$ALERTMANAGER_URL/api/v2/silences" | jq .

# Status and cluster info
curl -s "$ALERTMANAGER_URL/api/v2/status" | jq .
\`\`\`

## Investigation Patterns

### 1. Query firing alerts by service or namespace

\`\`\`bash
# amtool — matcher syntax: label=value, label=~regex
amtool alert query namespace=production service=payment-api \\
  --alertmanager.url="$ALERTMANAGER_URL" --output=json

# curl — URL-encode the filter parameter
# Exact match: service="payment-api"
curl -s "$ALERTMANAGER_URL/api/v2/alerts?filter=service%3D%22payment-api%22" | jq .

# Regex match: namespace=~"prod.*"
curl -s "$ALERTMANAGER_URL/api/v2/alerts?filter=namespace%3D~%22prod.*%22" | jq .
\`\`\`

### 2. Detect alert storms (>10 alerts in 60s)

When many alerts fire at once, find the shared labels to identify the upstream cause.

\`\`\`bash
# All active alerts as JSON
ALERTS=$(amtool alert query --output=json --alertmanager.url="$ALERTMANAGER_URL")

# Count alerts that started in the last 60 seconds
echo "$ALERTS" | jq '[.[] | select(
  (.startsAt | fromdateiso8601) > (now - 60)
)] | length'

# Find shared labels across recent alerts
echo "$ALERTS" | jq '
  [.[] | select((.startsAt | fromdateiso8601) > (now - 60))]
  | map(.labels)
  | (map(to_entries) | flatten | group_by(.key + "=" + .value)
     | map({label: .[0].key, value: .[0].value, count: length})
     | sort_by(-.count))
'
\`\`\`

Shared labels with a count equal to the total alert count point to the common upstream service or dependency.

### 3. Check inhibited alerts

Inhibited alerts are suppressed because a higher-severity alert is firing. They often reveal cascade effects.

\`\`\`bash
# amtool — inhibited alerts are hidden by default
amtool alert query --inhibited --alertmanager.url="$ALERTMANAGER_URL" --output=json

# curl — explicitly request inhibited
curl -s "$ALERTMANAGER_URL/api/v2/alerts?inhibited=true&active=false&silenced=false" \\
  | jq '.[] | {alertname: .labels.alertname, service: .labels.service, status: .status.state}'
\`\`\`

If many alerts are inhibited by a single parent alert, that parent is likely closer to the root cause.

### 4. Track flapping alerts (>3 fire/resolve cycles in 30 min)

Flapping indicates an intermittent issue. Alertmanager does not track history natively — check \`startsAt\`/\`endsAt\` patterns, or query Prometheus for \`ALERTS_FOR_STATE\`.

\`\`\`bash
# From Alertmanager — check if endsAt is in the past but the alert is active again
curl -s "$ALERTMANAGER_URL/api/v2/alerts?filter=alertname%3D%22HighErrorRate%22" | jq '
  .[] | {
    alertname: .labels.alertname,
    service: .labels.service,
    startsAt: .startsAt,
    endsAt: .endsAt,
    state: .status.state,
    fingerprint: .fingerprint
  }
'
\`\`\`

Multiple alerts with the same fingerprint but different \`startsAt\` values confirm flapping. The flap interval itself is diagnostic data.

### 5. Find related alerts by label matching

When investigating a specific alert, find others sharing the same service, namespace, or team.

\`\`\`bash
# Extract labels from the triggering alert, then query for peers
SERVICE=$(echo "$ALERT" | jq -r '.labels.service')
NAMESPACE=$(echo "$ALERT" | jq -r '.labels.namespace')

# All alerts for the same service
amtool alert query service="$SERVICE" \\
  --alertmanager.url="$ALERTMANAGER_URL" --output=json

# All alerts in the same namespace (broader search)
amtool alert query namespace="$NAMESPACE" \\
  --alertmanager.url="$ALERTMANAGER_URL" --output=json

# curl equivalent
curl -s "$ALERTMANAGER_URL/api/v2/alerts?filter=service%3D%22\${SERVICE}%22" | jq .
\`\`\`

### 6. Check silences that might hide relevant alerts

Active silences can mask related alerts. Always audit silences during an investigation.

\`\`\`bash
# List all active silences
amtool silence query --alertmanager.url="$ALERTMANAGER_URL"

# JSON output with matcher details
curl -s "$ALERTMANAGER_URL/api/v2/silences" | jq '
  [.[] | select(.status.state == "active")] | map({
    id: .id,
    createdBy: .createdBy,
    comment: .comment,
    matchers: .matchers,
    startsAt: .startsAt,
    endsAt: .endsAt
  })
'

# Check if a specific service has active silences
curl -s "$ALERTMANAGER_URL/api/v2/silences" | jq '
  [.[] | select(.status.state == "active")
   | select(.matchers[] | .name == "service" and .value == "payment-api")]
'
\`\`\`

A silence covering the service under investigation is itself a finding — the silenced alerts may carry critical signals.

## Output Parsing

Alertmanager API v2 returns alerts as JSON arrays. Key fields to extract:

\`\`\`bash
curl -s "$ALERTMANAGER_URL/api/v2/alerts" | jq '.[] | {
  alertname:    .labels.alertname,
  service:      .labels.service,
  namespace:    .labels.namespace,
  severity:     .labels.severity,
  state:        .status.state,
  startsAt:     .startsAt,
  endsAt:       .endsAt,
  generatorURL: .generatorURL,
  fingerprint:  .fingerprint
}'
\`\`\`

| Field | Use |
|-------|-----|
| \`labels.alertname\` | What alert fired |
| \`labels.service\` | Which service is affected |
| \`labels.severity\` | Triage priority (critical > warning > info) |
| \`status.state\` | Current state: \`active\`, \`suppressed\`, \`unprocessed\` |
| \`startsAt\` | When the alert began firing (ISO 8601) |
| \`endsAt\` | When resolved, or \`0001-01-01T00:00:00.000Z\` if still firing |
| \`generatorURL\` | Link back to the Prometheus query that generated this alert |
| \`fingerprint\` | Unique hash of the label set — track identity across fire/resolve cycles |

## Gotchas

- **amtool hides inhibited and silenced alerts by default.** Always pass \`--inhibited\` and \`--silenced\` for a full sweep, or you will miss relevant suppressed alerts.
- **\`endsAt\` does not mean resolved.** A future \`endsAt\` means "auto-resolve at this time if no update arrives." Only a past \`endsAt\` with \`status.state != "active"\` means actually resolved.
- **Filter syntax is URL-encoded in curl.** \`=\` becomes \`%3D\`, \`"\` becomes \`%22\`, \`=~\` becomes \`%3D~\`. Get it wrong and you get unfiltered results with no error.
- **Alertmanager has no built-in auth.** It usually sits behind a reverse proxy. A 401/403 is a proxy/network-policy issue, not Alertmanager config.
- **Alert history is not stored.** Alertmanager only knows current state. For history, query Prometheus \`ALERTS\`/\`ALERTS_FOR_STATE\`, or check the notification log.
- **Cluster mode returns duplicates.** In HA cluster mode, querying individual instances returns the same alert from each peer. Query through the load balancer or deduplicate by \`fingerprint\`.
- **\`generatorURL\` can be stale.** If Prometheus was reconfigured or a rule changed, the URL may point to a modified or deleted query. Verify before relying on it.
`;

/**
 * The profile-seed catalog (FR-14): one entry per retired SRE skill, each
 * `readonly` by default (Principle IV), each carrying a backend-neutral
 * re-authored skill body and the single highest-value readonly query to run at
 * investigation start.
 *
 * Shape-compatible with `seed.ts`'s `ProfileSeedHint`, so `planSeed` consumes
 * this list directly. The set AVAILABLE to a given operator is the subset whose
 * `integrationSource` is connected — 002 owns that derivation (FR-15).
 */
export const PROFILE_SEEDS: ProfileSeed[] = [
	{
		profileName: "metrics",
		integrationSource: "prometheus",
		capabilityTag: "readonly",
		skillBody: PROMETHEUS_SKILL_BODY,
		seedCallHint:
			"Instant + range query the error-rate/latency for the affected job around the trigger time (T-30m to T+10m, step 30s) to locate the inflection point.",
	},
	{
		profileName: "errors",
		integrationSource: "sentry",
		capabilityTag: "readonly",
		skillBody: SENTRY_SKILL_BODY,
		seedCallHint:
			"List unresolved issues for the affected project sorted by frequency (statsPeriod=1h) and the recent releases, to surface the top error spike and any deploy correlation.",
	},
	{
		profileName: "dashboards",
		integrationSource: "grafana",
		capabilityTag: "readonly",
		skillBody: GRAFANA_SKILL_BODY,
		seedCallHint:
			"List currently firing alert rules via the Alertmanager-compatible endpoint, then resolve the affected service's dashboard panels/datasource for query context.",
	},
	{
		profileName: "alerts",
		integrationSource: "alertmanager",
		capabilityTag: "readonly",
		skillBody: ALERTMANAGER_SKILL_BODY,
		seedCallHint:
			"Query active firing alerts for the affected service and list active silences, so suppressed-but-relevant signals are not missed.",
	},
];
