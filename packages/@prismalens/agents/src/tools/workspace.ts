import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import { z } from "zod";
import {
	getDefaultWorkspaceManager,
	type WorkspaceManager,
} from "../workspace/index.js";
import type { BundleExecutionContext } from "./bundles/types.js";

// =============================================================================
// WORKSPACE TOOLS
// =============================================================================
// Meta-tools for agent-driven workspace escalation.
// Allows agents to clone repositories and switch to local tools.
// =============================================================================

const logger = new Logger({ context: "WorkspaceTools" });

/**
 * Options for creating workspace tools.
 */
export interface WorkspaceToolsOptions {
	/** Workspace manager instance */
	workspaceManager?: WorkspaceManager;

	/** Investigation ID for this agent session */
	investigationId: string;

	/** Callback when workspace changes (for enabling local bundles) */
	onWorkspaceChange?: (workspace: {
		path: string;
		cloneType: "none" | "shallow" | "full";
		availableBundles: string[];
	}) => void;
}

/**
 * Create workspace tools for agent-driven escalation.
 */
export function createWorkspaceTools(
	options: WorkspaceToolsOptions,
): StructuredTool[] {
	const manager = options.workspaceManager ?? getDefaultWorkspaceManager();
	const { investigationId, onWorkspaceChange } = options;

	return [
		// workspace_status - Get current workspace state
		tool(
			async () => {
				const workspace = manager.getWorkspaceByInvestigation(investigationId);

				if (!workspace) {
					return `No workspace active for this investigation.

Use \`workspace_clone_repo\` to clone a repository for local analysis.

**When to clone:**
- You need to search across many files (grep/ripgrep)
- API rate limits are being reached
- You need to analyze file structure
- You need git blame or history (requires full clone)`;
				}

				const status = manager.getStatus(workspace.id);

				const lines = [
					`**Workspace Status**`,
					`- ID: ${workspace.id}`,
					`- Path: ${workspace.path}`,
					`- Clone Type: ${workspace.cloneType}`,
				];

				if (workspace.repository) {
					lines.push(
						`- Repository: ${workspace.repository.owner}/${workspace.repository.repo}`,
					);
					if (workspace.repository.ref) {
						lines.push(`- Branch/Ref: ${workspace.repository.ref}`);
					}
				}

				lines.push(`- Available Tools: ${status.availableTools.join(", ") || "none"}`);

				if (workspace.cloneType === "shallow") {
					lines.push(
						`\n**Note:** This is a shallow clone. Use \`workspace_upgrade_clone\` to get full git history.`,
					);
				}

				return lines.join("\n");
			},
			{
				name: "workspace_status",
				description: `Check the current workspace state, clone type, and available local tools.

Use this to see:
- If a repository is cloned locally
- What clone type (shallow/full) is active
- What local tools are available (repo-files, ripgrep, code-pathfinder)`,
				schema: z.object({}),
			},
		),

		// workspace_clone_repo - Clone a repository
		tool(
			async ({ owner, repo, ref, shallow }) => {
				logger.info(`Cloning repository: ${owner}/${repo}`, {
					investigationId,
					ref,
					shallow,
				});

				// Create or get workspace
				const workspace = manager.createWorkspace(investigationId);

				// Clone the repository
				const result = await manager.cloneRepository(
					workspace.id,
					{ owner, repo, ref },
					{ shallow },
				);

				if (!result.success) {
					return `**Clone Failed**\n\n${result.error}`;
				}

				// Determine available bundles
				const availableBundles = ["repo-files"];
				if (result.workspace.cloneType !== "none") {
					availableBundles.push("ripgrep");
				}
				if (result.workspace.cloneType === "full") {
					availableBundles.push("code-pathfinder");
				}

				// Notify callback
				if (onWorkspaceChange) {
					onWorkspaceChange({
						path: result.workspace.path,
						cloneType: result.workspace.cloneType,
						availableBundles,
					});
				}

				const lines = [
					`**Repository Cloned Successfully**`,
					``,
					`- Repository: ${owner}/${repo}`,
					`- Clone Type: ${result.workspace.cloneType}`,
					`- Local Path: ${result.workspace.path}`,
					``,
					`**Now Available:**`,
					...availableBundles.map((b) => `- ${b}`),
					``,
					`You can now use \`search_tools("repo files")\` to enable local file tools.`,
				];

				if (result.workspace.cloneType === "shallow") {
					lines.push(
						``,
						`**Tip:** For git blame/log, use \`workspace_upgrade_clone\` to fetch full history.`,
					);
				}

				return lines.join("\n");
			},
			{
				name: "workspace_clone_repo",
				description: `Clone a GitHub repository to local workspace for faster analysis.

**Use this when:**
- API rate limits are being reached
- You need to search across many files
- You need local file analysis tools
- You want faster repeated file access

**Clone Types:**
- shallow (default): Fast, minimal disk space, no git history
- full: Complete history for git blame/log, slower, more disk space`,
				schema: z.object({
					owner: z
						.string()
						.describe("Repository owner (user or organization)"),
					repo: z.string().describe("Repository name"),
					ref: z
						.string()
						.optional()
						.default("main")
						.describe("Branch, tag, or commit (default: main)"),
					shallow: z
						.boolean()
						.optional()
						.default(true)
						.describe("Use shallow clone (faster, no history)"),
				}),
			},
		),

		// workspace_upgrade_clone - Upgrade shallow to full
		tool(
			async () => {
				const workspace = manager.getWorkspaceByInvestigation(investigationId);

				if (!workspace) {
					return `No workspace active. Use \`workspace_clone_repo\` first.`;
				}

				if (workspace.cloneType === "none") {
					return `No repository cloned. Use \`workspace_clone_repo\` first.`;
				}

				if (workspace.cloneType === "full") {
					return `Repository is already a full clone with complete history.`;
				}

				logger.info(`Upgrading workspace to full clone: ${workspace.id}`);

				const result = await manager.upgradToFull(workspace.id);

				if (!result.success) {
					return `**Upgrade Failed**\n\n${result.error}`;
				}

				// Update available bundles
				const availableBundles = ["repo-files", "ripgrep", "code-pathfinder"];

				if (onWorkspaceChange) {
					onWorkspaceChange({
						path: result.workspace.path,
						cloneType: result.workspace.cloneType,
						availableBundles,
					});
				}

				return `**Upgraded to Full Clone**

- Clone Type: full
- Git history: Available

**Now Available:**
- git blame (find who changed code)
- git log (view commit history)
- code-pathfinder (call graph analysis)

You can now use git-based analysis tools.`;
			},
			{
				name: "workspace_upgrade_clone",
				description: `Upgrade a shallow clone to a full clone with complete git history.

**Use this when you need:**
- git blame to find who changed code
- git log to view commit history
- Code pathfinder for call graph analysis

This operation fetches all commits and branches, so it takes longer than shallow clone.`,
				schema: z.object({}),
			},
		),

		// workspace_get_local_path - Get the local path for tools
		tool(
			async () => {
				const workspace = manager.getWorkspaceByInvestigation(investigationId);

				if (!workspace) {
					return `No workspace active. Use \`workspace_clone_repo\` first.`;
				}

				if (workspace.cloneType === "none") {
					return `No repository cloned. Use \`workspace_clone_repo\` first.`;
				}

				return `Local repository path: ${workspace.path}

Use this path with local tools:
- repo_read_file(path="${workspace.path}/src/file.ts")
- ripgrep search with basePath="${workspace.path}"`;
			},
			{
				name: "workspace_get_local_path",
				description:
					"Get the local filesystem path where the repository is cloned. Use this path with local file tools.",
				schema: z.object({}),
			},
		),

		// workspace_cleanup - Clean up workspace
		tool(
			async () => {
				const workspace = manager.getWorkspaceByInvestigation(investigationId);

				if (!workspace) {
					return `No workspace to clean up.`;
				}

				await manager.cleanup(workspace.id);

				return `Workspace cleaned up. Local repository files removed.`;
			},
			{
				name: "workspace_cleanup",
				description:
					"Clean up the workspace and remove cloned repository files. Use when done with local analysis.",
				schema: z.object({}),
			},
		),
	];
}

/**
 * Create workspace tools from bundle execution context.
 * Used by the progressive disclosure system.
 */
export function createWorkspaceBundle(
	context: BundleExecutionContext,
	investigationId: string,
): StructuredTool[] {
	return createWorkspaceTools({
		investigationId,
	});
}
