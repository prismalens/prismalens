/**
 * Render API response fixture builders.
 *
 * Matches the actual Render API response shapes referenced in
 * skills/gatherer/render-logs/SKILL.md.
 */

// =============================================================================
// Services
// =============================================================================

interface ServiceInput {
  id: string
  name: string
  type?: string
  status?: string
  region?: string
}

export function buildServicesResponse(services: ServiceInput[]) {
  return services.map((s) => ({
    service: {
      id: s.id,
      name: s.name,
      type: s.type ?? "web_service",
      serviceDetails: {
        region: s.region ?? "oregon",
      },
      status: s.status ?? "deployed",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-15T09:00:00Z",
    },
    cursor: s.id,
  }))
}

// =============================================================================
// Deploys
// =============================================================================

interface DeployInput {
  id: string
  status: string
  commitMessage?: string
  commitSha?: string
  createdAt?: string
  finishedAt?: string
}

export function buildDeploysResponse(deploys: DeployInput[]) {
  return deploys.map((d) => ({
    deploy: {
      id: d.id,
      status: d.status,
      commit: {
        message: d.commitMessage ?? "Deploy commit",
        id: d.commitSha ?? d.id.replace("dep-", ""),
      },
      createdAt: d.createdAt ?? "2025-01-15T09:30:00Z",
      finishedAt: d.finishedAt ?? "2025-01-15T09:35:00Z",
    },
    cursor: d.id,
  }))
}

// =============================================================================
// Logs
// =============================================================================

interface LogEntryInput {
  timestamp?: string
  message: string
  level?: string
}

export function buildLogsResponse(entries: LogEntryInput[]) {
  return entries.map((e) => ({
    log: {
      timestamp: e.timestamp ?? "2025-01-15T10:00:00Z",
      message: e.message,
      level: e.level ?? "info",
    },
  }))
}
