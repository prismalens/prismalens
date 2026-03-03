/**
 * Workspace infrastructure for investigation agents.
 *
 * Each investigation gets an isolated workspace directory at:
 *   /tmp/prismalens-investigations/{investigationId}/workspace/
 *
 * OpenAPI spec files are injected into {workspace}/specs/ so agents
 * can grep and read_file at /specs/ to discover available API endpoints.
 * (With virtualMode: true, paths are relative to the workspace root.)
 */

import { mkdir, cp, rm, writeFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getGraphConfig } from "./env.js"
import type { IntegrationWithCredentials } from "../types/contexts.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

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
  const workspaceBase = getGraphConfig().PRISMALENS_WORKSPACE_BASE
  return resolve(workspaceBase, investigationId, "workspace")
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
 *
 * Resolution order (Phase 1):
 *   1. integration.specUrl → fetch and write to workspace specs/
 *   2. bundled spec at specs/{type}-openapi.json → copy to workspace
 *   3. none → skip
 */
export async function injectSpecFiles(
  workspaceDir: string,
  integrations: IntegrationWithCredentials[],
): Promise<void> {
  const workspaceBase = getGraphConfig().PRISMALENS_WORKSPACE_BASE
  if (!workspaceDir.startsWith(workspaceBase)) {
    throw new Error("workspaceDir must be within the workspace base directory")
  }
  const specsDir = resolve(workspaceDir, "specs")
  const seen = new Set<string>()

  for (const integration of integrations) {
    if (!integration.enabled || seen.has(integration.type)) continue
    seen.add(integration.type)

    const destPath = resolve(specsDir, `${integration.type}-openapi.json`)
    try {
      if (integration.specUrl) {
        const res = await fetch(integration.specUrl, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) continue
        await writeFile(destPath, await res.text())
      } else {
        await cp(resolve(SPECS_SOURCE_DIR, `${integration.type}-openapi.json`), destPath)
      }
    } catch {
      // Non-fatal — spec file may not exist for this integration type
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
