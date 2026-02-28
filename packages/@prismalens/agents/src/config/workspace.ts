/**
 * Workspace infrastructure for investigation agents.
 *
 * Each investigation gets an isolated workspace directory at:
 *   /tmp/prismalens-investigations/{investigationId}/workspace/
 *
 * OpenAPI spec files are injected into /workspace/specs/ so agents
 * can grep and read_file to discover available API endpoints.
 */

import { mkdir, cp, rm } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getAdapter } from "../providers/adapters/index.js"
import type { IntegrationWithCredentials } from "../types/contexts.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Base directory for all investigation workspaces */
const WORKSPACE_BASE = "/tmp/prismalens-investigations"

/** Package-level specs directory containing OpenAPI spec files */
const SPECS_SOURCE_DIR = resolve(__dirname, "../../specs")

/**
 * Resolve the workspace directory path for an investigation.
 * Guards against path traversal via investigationId.
 */
export function getWorkspacePath(investigationId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(investigationId)) {
    throw new Error(
      "Invalid investigationId: must contain only alphanumeric, dash, or underscore characters",
    )
  }
  return resolve(WORKSPACE_BASE, investigationId, "workspace")
}

/**
 * Create the workspace directory for an investigation.
 * Returns the workspace root path.
 */
export async function createWorkspaceDir(
  investigationId: string,
): Promise<string> {
  const workspaceDir = getWorkspacePath(investigationId)
  await mkdir(resolve(workspaceDir, "specs"), { recursive: true })
  return workspaceDir
}

/**
 * Inject relevant OpenAPI spec files into the workspace.
 * Only copies specs for integrations that are actually enabled.
 */
export async function injectSpecFiles(
  workspaceDir: string,
  integrations: IntegrationWithCredentials[],
): Promise<void> {
  if (!workspaceDir.startsWith(WORKSPACE_BASE)) {
    throw new Error("workspaceDir must be within the workspace base directory")
  }
  const specsDir = resolve(workspaceDir, "specs")

  for (const integration of integrations) {
    if (!integration.enabled) continue

    const adapter = getAdapter(integration.type)
    if (!adapter?.specFileName) continue

    const sourcePath = resolve(SPECS_SOURCE_DIR, adapter.specFileName)
    const destPath = resolve(specsDir, adapter.specFileName)

    try {
      await cp(sourcePath, destPath)
    } catch {
      // Spec file may not exist yet — not a fatal error
    }
  }
}

/**
 * Clean up the workspace directory for an investigation.
 * Uses getWorkspacePath() for path traversal validation.
 */
export async function cleanupWorkspaceDir(
  investigationId: string,
): Promise<void> {
  // getWorkspacePath validates investigationId, preventing path traversal
  const workspacePath = getWorkspacePath(investigationId)
  const dir = resolve(workspacePath, "..")
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // Best effort cleanup
  }
}
