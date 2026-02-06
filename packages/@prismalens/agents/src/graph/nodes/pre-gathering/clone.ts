/**
 * Clone Strategy Node
 *
 * Determines whether to clone a repository for code analysis
 * based on the incident category and error type.
 *
 * Key insight: Not all incidents need code analysis.
 * - Code bugs → ALWAYS clone (need AST tools)
 * - Config issues → Clone to trace references
 * - Infrastructure → No clone needed (use observability tools)
 * - External → Clone to check API client code
 */

import { exec } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Logger } from "@prismalens/logger";
import type {
	AlertContext,
	CloneDecision,
	ClonedRepoInfo,
	IncidentContext,
	IntegrationContext,
	InvestigationState,
} from "../../../types/index.js";

const execAsync = promisify(exec);
const logger = new Logger({ context: "CloneStrategy" });

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Base directory for cloned repositories */
const WORKSPACE_BASE_DIR =
	process.env.PRISMALENS_WORKSPACE_DIR || "/tmp/prismalens-workspaces";

/** Maximum age of a workspace before cleanup (24 hours) */
const WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// CLONE DECISION LOGIC
// =============================================================================

/**
 * Determine whether to clone a repository based on incident characteristics.
 *
 * Decision matrix:
 * - Code bugs → ALWAYS clone (need AST tools for analysis)
 * - Config issues → Clone to trace config references
 * - Infrastructure → No clone (use observability tools)
 * - External deps → Clone to check API client code
 * - Unknown → Clone as default (can search for clues)
 */
export function shouldCloneRepo(incident: IncidentContext | null): CloneDecision {
	if (!incident) {
		return {
			clone: false,
			reason: "No incident context available",
		};
	}

	// Infer category from incident title, description, and any error info
	const category = inferIncidentCategory(incident);

	switch (category) {
		case "code":
			return {
				clone: true,
				type: "shallow",
				reason: "Code analysis requires AST tools",
			};

		case "config":
			return {
				clone: true,
				type: "shallow",
				reason: "Need to trace config references in code",
			};

		case "infrastructure":
			return {
				clone: false,
				reason: "Infrastructure issues use observability tools, not code",
			};

		case "external":
			return {
				clone: true,
				type: "shallow",
				reason: "Check API client code for integration issues",
			};

		case "unknown":
		default:
			return {
				clone: true,
				type: "shallow",
				reason: "Default: clone to search for error patterns",
			};
	}
}

/**
 * Infer incident category from title, description, and error patterns.
 */
function inferIncidentCategory(
	incident: IncidentContext,
): "code" | "config" | "infrastructure" | "external" | "unknown" {
	const text = `${incident.title} ${incident.description || ""}`.toLowerCase();

	// Code-related patterns
	const codePatterns = [
		"exception",
		"error",
		"null pointer",
		"undefined is not",
		"typeerror",
		"referenceerror",
		"stack trace",
		"at line",
		"syntax error",
		"cannot read property",
		"is not a function",
		"segmentation fault",
		"panic",
		"assertion failed",
	];

	// Config-related patterns
	const configPatterns = [
		"config",
		"configuration",
		"environment",
		"env var",
		"missing variable",
		"feature flag",
		"threshold",
		"timeout setting",
		"connection string",
		"credentials",
		"permission denied",
		"access denied",
	];

	// Infrastructure-related patterns
	const infraPatterns = [
		"cpu",
		"memory",
		"disk",
		"out of memory",
		"oom",
		"scaling",
		"resource limit",
		"container",
		"pod",
		"node",
		"network",
		"dns",
		"connection refused",
		"connection timeout",
		"load balancer",
		"health check",
		"restart",
	];

	// External dependency patterns
	const externalPatterns = [
		"api",
		"third party",
		"third-party",
		"external service",
		"upstream",
		"downstream",
		"gateway timeout",
		"502",
		"503",
		"504",
		"rate limit",
		"quota",
		"dependency",
	];

	// Check patterns in order of specificity
	for (const pattern of codePatterns) {
		if (text.includes(pattern)) {
			return "code";
		}
	}

	for (const pattern of configPatterns) {
		if (text.includes(pattern)) {
			return "config";
		}
	}

	for (const pattern of externalPatterns) {
		if (text.includes(pattern)) {
			return "external";
		}
	}

	for (const pattern of infraPatterns) {
		if (text.includes(pattern)) {
			return "infrastructure";
		}
	}

	return "unknown";
}

// =============================================================================
// MULTI-REPO CLONE LOGIC
// =============================================================================

/**
 * Decision for cloning multiple repositories.
 * Used when an incident spans multiple microservices.
 */
interface MultiRepoCloneDecision {
	repos: Array<{
		serviceId: string;
		serviceName?: string;
		repoUrl: string;
		cloneType: "shallow" | "full";
		reason: string;
	}>;
}

/**
 * Derive repositories to clone from ALL alerts in the incident.
 *
 * Key insight: An incident can span multiple services (microservice failures).
 * We need to clone ALL relevant repositories, not just the primary alert's repo.
 *
 * @param alerts - All alerts associated with the incident
 * @param category - Incident category (determines if cloning is needed)
 * @returns Decision with list of repos to clone
 */
export function shouldCloneMultiRepos(
	alerts: AlertContext[],
	category: "code" | "config" | "infrastructure" | "external" | "unknown",
): MultiRepoCloneDecision {
	// Skip clone for infrastructure issues (use observability APIs instead)
	if (category === "infrastructure") {
		return { repos: [] };
	}

	// Collect unique repos from all alerts, keyed by serviceId
	const repoMap = new Map<
		string,
		{
			serviceId: string;
			serviceName?: string;
			repoUrl: string;
			alertCount: number;
		}
	>();

	for (const alert of alerts) {
		// Skip alerts without repository info
		if (!alert.repository) continue;

		// Use serviceId as key, fall back to repo URL
		const key = alert.serviceId || alert.repository;
		const existing = repoMap.get(key);

		if (existing) {
			existing.alertCount++;
		} else {
			repoMap.set(key, {
				serviceId: alert.serviceId || "primary",
				serviceName: alert.serviceName,
				repoUrl: alert.repository,
				alertCount: 1,
			});
		}
	}

	// Convert to decision array
	return {
		repos: Array.from(repoMap.values()).map((r) => ({
			serviceId: r.serviceId,
			serviceName: r.serviceName,
			repoUrl: r.repoUrl,
			cloneType: "shallow" as const,
			reason: `${r.alertCount} alert(s) from this service`,
		})),
	};
}

/**
 * Clone multiple repositories for an investigation.
 *
 * @param decision - Multi-repo clone decision
 * @param investigationId - Investigation ID for workspace directory
 * @returns Record of serviceId to clonePath
 */
async function cloneMultiRepos(
	decision: MultiRepoCloneDecision,
	investigationId: string,
): Promise<{
	clonePaths: Record<string, string>;
	clonedRepos: ClonedRepoInfo[];
	errors: Array<{ serviceId: string; error: string }>;
}> {
	const clonePaths: Record<string, string> = {};
	const clonedRepos: ClonedRepoInfo[] = [];
	const errors: Array<{ serviceId: string; error: string }> = [];

	for (const repo of decision.repos) {
		const result = await cloneRepository(
			repo.repoUrl,
			investigationId,
			repo.cloneType === "shallow",
			repo.serviceId, // Pass serviceId for subdirectory
		);

		if (result.success && result.path) {
			clonePaths[repo.serviceId] = result.path;
			clonedRepos.push({
				serviceId: repo.serviceId,
				serviceName: repo.serviceName,
				repoUrl: repo.repoUrl,
				clonePath: result.path,
				cloneType: repo.cloneType,
				timestamp: new Date().toISOString(),
			});
		} else {
			errors.push({
				serviceId: repo.serviceId,
				error: result.error || "Unknown error",
			});
		}
	}

	return { clonePaths, clonedRepos, errors };
}

// =============================================================================
// WORKSPACE MANAGEMENT
// =============================================================================

/**
 * Get the workspace path for an investigation.
 *
 * @param investigationId - Investigation ID
 * @param serviceId - Optional service ID for multi-repo workspaces
 */
export function getWorkspacePath(investigationId: string, serviceId?: string): string {
	if (serviceId) {
		return join(WORKSPACE_BASE_DIR, investigationId, serviceId);
	}
	return join(WORKSPACE_BASE_DIR, investigationId);
}

/**
 * Clone a repository to the workspace.
 *
 * @param repoUrl - Repository URL (GitHub, GitLab, etc.)
 * @param investigationId - Investigation ID for workspace directory
 * @param shallow - Whether to do a shallow clone (default: true)
 * @param serviceId - Optional service ID for multi-repo workspace subdirectory
 */
export async function cloneRepository(
	repoUrl: string,
	investigationId: string,
	shallow: boolean = true,
	serviceId?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
	const workspacePath = getWorkspacePath(investigationId, serviceId);

	try {
		// Ensure base directory exists
		await mkdir(WORKSPACE_BASE_DIR, { recursive: true });

		// Check if workspace already exists
		try {
			await stat(workspacePath);
			logger.info("Workspace already exists", { workspacePath });
			return { success: true, path: workspacePath };
		} catch {
			// Directory doesn't exist, proceed with clone
		}

		// Build clone command
		const cloneArgs = shallow ? "--depth 1 --single-branch" : "";
		const command = `git clone ${cloneArgs} ${repoUrl} ${workspacePath}`;

		logger.info("Cloning repository", { repoUrl, workspacePath, shallow });

		await execAsync(command, { timeout: 120000 }); // 2 minute timeout

		logger.info("Repository cloned successfully", { workspacePath });
		return { success: true, path: workspacePath };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error("Failed to clone repository", { repoUrl, error: errorMessage });
		return { success: false, error: errorMessage };
	}
}

/**
 * Clean up a workspace after investigation.
 */
export async function cleanupWorkspace(investigationId: string): Promise<void> {
	const workspacePath = getWorkspacePath(investigationId);

	try {
		await rm(workspacePath, { recursive: true, force: true });
		logger.info("Workspace cleaned up", { workspacePath });
	} catch (error) {
		logger.warn("Failed to cleanup workspace", {
			workspacePath,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Clean up old workspaces (older than 24 hours).
 * Should be called periodically by a background job.
 */
export async function cleanupOldWorkspaces(): Promise<number> {
	const { readdir, stat: fsStat } = await import("node:fs/promises");
	let cleaned = 0;

	try {
		const entries = await readdir(WORKSPACE_BASE_DIR, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const dirPath = join(WORKSPACE_BASE_DIR, entry.name);
			const stats = await fsStat(dirPath);
			const age = Date.now() - stats.mtimeMs;

			if (age > WORKSPACE_MAX_AGE_MS) {
				await rm(dirPath, { recursive: true, force: true });
				cleaned++;
				logger.info("Cleaned up old workspace", { path: dirPath, ageHours: age / (1000 * 60 * 60) });
			}
		}
	} catch (error) {
		logger.warn("Error during workspace cleanup", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return cleaned;
}

// =============================================================================
// CLONE NODE
// =============================================================================

/**
 * Clone If Needed node - decides whether to clone and performs the clone.
 *
 * This node runs before the supervisor to ensure code analysis tools
 * have access to the repository when needed.
 *
 * Supports multi-repo cloning: derives repos from ALL alerts in the incident,
 * not just the primary alert. This is essential for microservice incidents
 * where the root cause may span multiple services.
 */
export async function cloneIfNeededNode(
	state: InvestigationState,
	config?: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	logger.info("Evaluating clone decision", {
		investigationId: state.investigationId,
		alertCount: state.alerts.length,
	});

	// Integrations resolved on-demand - credentials never pass through LangGraph
	const integrations: IntegrationContext[] = [];

	// Get single-repo clone decision based on incident category
	const decision = shouldCloneRepo(state.incident);

	if (!decision.clone) {
		logger.info("Clone not needed", { reason: decision.reason });
		return {
			clonePaths: undefined,
			clonedRepos: undefined,
		};
	}

	// Infer category for multi-repo decision
	const category = state.incident
		? inferIncidentCategory(state.incident)
		: "unknown";

	// Derive repos to clone from ALL alerts
	const multiRepoDecision = shouldCloneMultiRepos(state.alerts, category);

	// If no repos from alerts, fall back to primary alert or integration
	if (multiRepoDecision.repos.length === 0) {
		const repoUrl = getRepositoryUrl(state, integrations);

		if (!repoUrl) {
			logger.warn("No repository URL available, skipping clone");
			return {
				clonePaths: undefined,
				clonedRepos: undefined,
				};
		}

		// Single repo fallback (legacy behavior)
		const result = await cloneRepository(
			repoUrl,
			state.investigationId,
			decision.type === "shallow",
			"primary", // Use "primary" as serviceId for single-repo
		);

		if (!result.success) {
			logger.error("Clone failed", { error: result.error });
			return {
				clonePaths: undefined,
				clonedRepos: undefined,
				agentErrors: [
					{
						agent: "code-searcher",
						error: `Failed to clone repository: ${result.error}`,
						timestamp: new Date().toISOString(),
						recoverable: true,
					},
				],
				};
		}

		const clonePath = result.path as string; // Safe: success=true guarantees path exists
		logger.info("Single repo clone successful", { clonePath });
		return {
			clonePaths: { primary: clonePath },
			clonedRepos: [
				{
					serviceId: "primary",
					repoUrl,
					clonePath,
					cloneType: decision.type || "shallow",
					timestamp: new Date().toISOString(),
				},
			],
		};
	}

	// Multi-repo clone
	logger.info("Cloning multiple repositories", {
		repoCount: multiRepoDecision.repos.length,
		repos: multiRepoDecision.repos.map((r) => r.serviceId),
	});

	const result = await cloneMultiRepos(multiRepoDecision, state.investigationId);

	// Log any errors but continue with successfully cloned repos
	if (result.errors.length > 0) {
		logger.warn("Some repositories failed to clone", { errors: result.errors });
	}

	if (Object.keys(result.clonePaths).length === 0) {
		logger.error("All repository clones failed");
		return {
			clonePaths: undefined,
			clonedRepos: undefined,
			agentErrors: result.errors.map((e) => ({
				agent: "code-searcher" as const,
				error: `Failed to clone ${e.serviceId}: ${e.error}`,
				timestamp: new Date().toISOString(),
				recoverable: true,
			})),
		};
	}

	logger.info("Multi-repo clone successful", {
		clonedCount: result.clonedRepos.length,
		services: Object.keys(result.clonePaths),
	});

	return {
		clonePaths: result.clonePaths,
		clonedRepos: result.clonedRepos,
	};
}

/**
 * Extract repository URL from state and integrations.
 *
 * @param state - Investigation state
 * @param integrations - Integrations from RunnableConfig.configurable (NOT from state)
 */
function getRepositoryUrl(
	state: InvestigationState,
	integrations: IntegrationContext[],
): string | null {
	// Try to get from primary alert
	if (state.primaryAlert?.repository) {
		return normalizeRepoUrl(state.primaryAlert.repository);
	}

	// Try to get from integrations (passed from config, not state)
	const githubIntegration = integrations.find(
		(i) => i.type.toLowerCase() === "github",
	);

	if (githubIntegration?.config?.repository) {
		return normalizeRepoUrl(githubIntegration.config.repository as string);
	}

	return null;
}

/**
 * Normalize repository URL to a clone-able format.
 */
function normalizeRepoUrl(repo: string): string {
	// Already a URL
	if (repo.startsWith("http") || repo.startsWith("git@")) {
		return repo;
	}

	// GitHub shorthand (owner/repo)
	if (repo.match(/^[\w-]+\/[\w.-]+$/)) {
		return `https://github.com/${repo}.git`;
	}

	return repo;
}
