import { exec } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Logger } from "@prismalens/logger";

// =============================================================================
// WORKSPACE MANAGER
// =============================================================================
// Manages temporary directories for cloned repositories.
// Supports escalation from API-only to shallow clone to full clone.
// =============================================================================

const logger = new Logger({ context: "WorkspaceManager" });
const execAsync = promisify(exec);

/**
 * Clone type for repository.
 */
export type CloneType = "none" | "shallow" | "full";

/**
 * Repository information.
 */
export interface RepositoryInfo {
	owner: string;
	repo: string;
	ref?: string;
	url?: string;
}

/**
 * Workspace state.
 */
export interface Workspace {
	/** Unique workspace identifier */
	id: string;

	/** Absolute path to workspace directory */
	path: string;

	/** Investigation ID this workspace belongs to */
	investigationId: string;

	/** Repository information (if cloned) */
	repository?: RepositoryInfo;

	/** Current clone type */
	cloneType: CloneType;

	/** When workspace was created */
	createdAt: Date;

	/** When workspace was last accessed */
	lastAccessedAt: Date;
}

/**
 * Configuration for WorkspaceManager.
 */
export interface WorkspaceManagerConfig {
	/** Base directory for workspaces (default: os.tmpdir()) */
	baseDir?: string;

	/** Maximum number of concurrent workspaces (default: 10) */
	maxWorkspaces?: number;

	/** Auto-cleanup idle workspaces after this duration in ms (default: 1 hour) */
	ttlMs?: number;

	/** Cleanup on process exit (default: true) */
	cleanupOnExit?: boolean;
}

/**
 * Result of a clone operation.
 */
export interface CloneResult {
	success: boolean;
	workspace: Workspace;
	message?: string;
	error?: string;
}

/**
 * Manages workspaces for repository analysis.
 */
export class WorkspaceManager {
	private workspaces: Map<string, Workspace> = new Map();
	private config: Required<WorkspaceManagerConfig>;
	private cleanupTimer?: NodeJS.Timeout;

	constructor(config?: WorkspaceManagerConfig) {
		this.config = {
			baseDir: config?.baseDir ?? join(tmpdir(), "prismalens-workspaces"),
			maxWorkspaces: config?.maxWorkspaces ?? 10,
			ttlMs: config?.ttlMs ?? 60 * 60 * 1000, // 1 hour
			cleanupOnExit: config?.cleanupOnExit ?? true,
		};

		// Ensure base directory exists
		if (!existsSync(this.config.baseDir)) {
			mkdirSync(this.config.baseDir, { recursive: true });
		}

		// Start periodic cleanup
		this.startCleanupTimer();

		// Cleanup on process exit
		if (this.config.cleanupOnExit) {
			process.on("exit", () => this.cleanupAllSync());
			process.on("SIGINT", () => {
				this.cleanupAllSync();
				process.exit(0);
			});
			process.on("SIGTERM", () => {
				this.cleanupAllSync();
				process.exit(0);
			});
		}

		logger.info(`WorkspaceManager initialized`, {
			baseDir: this.config.baseDir,
			maxWorkspaces: this.config.maxWorkspaces,
		});
	}

	/**
	 * Create a new workspace for an investigation.
	 */
	createWorkspace(investigationId: string): Workspace {
		// Check if workspace already exists for this investigation
		const existing = this.getWorkspaceByInvestigation(investigationId);
		if (existing) {
			existing.lastAccessedAt = new Date();
			return existing;
		}

		// Check workspace limit
		if (this.workspaces.size >= this.config.maxWorkspaces) {
			// Clean up oldest workspace
			this.cleanupOldest();
		}

		// Create workspace
		const id = `ws-${investigationId}-${Date.now()}`;
		const path = join(this.config.baseDir, id);

		mkdirSync(path, { recursive: true });

		const workspace: Workspace = {
			id,
			path,
			investigationId,
			cloneType: "none",
			createdAt: new Date(),
			lastAccessedAt: new Date(),
		};

		this.workspaces.set(id, workspace);

		logger.info(`Created workspace: ${id}`, { path, investigationId });

		return workspace;
	}

	/**
	 * Get workspace by ID.
	 */
	getWorkspace(id: string): Workspace | null {
		const workspace = this.workspaces.get(id);
		if (workspace) {
			workspace.lastAccessedAt = new Date();
		}
		return workspace ?? null;
	}

	/**
	 * Get workspace by investigation ID.
	 */
	getWorkspaceByInvestigation(investigationId: string): Workspace | null {
		for (const workspace of this.workspaces.values()) {
			if (workspace.investigationId === investigationId) {
				workspace.lastAccessedAt = new Date();
				return workspace;
			}
		}
		return null;
	}

	/**
	 * Clone a repository into a workspace (shallow clone).
	 */
	async cloneShallow(
		workspaceId: string,
		repo: RepositoryInfo,
	): Promise<CloneResult> {
		const workspace = this.workspaces.get(workspaceId);
		if (!workspace) {
			return {
				success: false,
				workspace: { id: workspaceId } as Workspace,
				error: `Workspace not found: ${workspaceId}`,
			};
		}

		// If already cloned, check if we need to re-clone
		if (workspace.cloneType !== "none" && workspace.repository) {
			if (
				workspace.repository.owner === repo.owner &&
				workspace.repository.repo === repo.repo
			) {
				logger.info(`Repository already cloned in workspace: ${workspaceId}`);
				workspace.lastAccessedAt = new Date();
				return {
					success: true,
					workspace,
					message: `Repository already cloned (${workspace.cloneType})`,
				};
			}

			// Different repo - clean up and re-clone
			await this.cleanWorkspaceContents(workspace);
		}

		const url = repo.url ?? `https://github.com/${repo.owner}/${repo.repo}.git`;
		const ref = repo.ref ?? "main";

		try {
			logger.info(`Cloning repository (shallow): ${url}`, { workspaceId, ref });

			// Shallow clone
			await execAsync(
				`git clone --depth=1 --single-branch --branch ${ref} ${url} .`,
				{
					cwd: workspace.path,
					timeout: 120000, // 2 minute timeout
				},
			);

			workspace.repository = { ...repo, url };
			workspace.cloneType = "shallow";
			workspace.lastAccessedAt = new Date();

			logger.info(`Successfully cloned repository: ${repo.owner}/${repo.repo}`);

			return {
				success: true,
				workspace,
				message: `Shallow clone completed. Repository available at: ${workspace.path}`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to clone repository: ${url}`, { error });

			return {
				success: false,
				workspace,
				error: `Clone failed: ${message}`,
			};
		}
	}

	/**
	 * Upgrade a shallow clone to a full clone.
	 */
	async upgradToFull(workspaceId: string): Promise<CloneResult> {
		const workspace = this.workspaces.get(workspaceId);
		if (!workspace) {
			return {
				success: false,
				workspace: { id: workspaceId } as Workspace,
				error: `Workspace not found: ${workspaceId}`,
			};
		}

		if (workspace.cloneType === "none") {
			return {
				success: false,
				workspace,
				error: "No repository cloned. Use cloneShallow first.",
			};
		}

		if (workspace.cloneType === "full") {
			return {
				success: true,
				workspace,
				message: "Repository is already a full clone",
			};
		}

		try {
			logger.info(`Upgrading to full clone: ${workspaceId}`);

			// Fetch all history
			await execAsync("git fetch --unshallow", {
				cwd: workspace.path,
				timeout: 300000, // 5 minute timeout
			});

			// Fetch all branches
			await execAsync("git fetch --all", {
				cwd: workspace.path,
				timeout: 120000,
			});

			workspace.cloneType = "full";
			workspace.lastAccessedAt = new Date();

			logger.info(`Successfully upgraded to full clone: ${workspaceId}`);

			return {
				success: true,
				workspace,
				message: "Upgraded to full clone with complete history",
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to upgrade clone: ${workspaceId}`, { error });

			return {
				success: false,
				workspace,
				error: `Upgrade failed: ${message}`,
			};
		}
	}

	/**
	 * Clone or upgrade a repository based on requirements.
	 */
	async cloneRepository(
		workspaceId: string,
		repo: RepositoryInfo,
		options?: {
			shallow?: boolean;
		},
	): Promise<CloneResult> {
		const shallow = options?.shallow ?? true;

		// First, do a shallow clone
		const shallowResult = await this.cloneShallow(workspaceId, repo);
		if (!shallowResult.success) {
			return shallowResult;
		}

		// If full clone requested, upgrade
		if (!shallow) {
			return this.upgradToFull(workspaceId);
		}

		return shallowResult;
	}

	/**
	 * Get the local path for a workspace.
	 */
	getLocalPath(workspaceId: string): string | null {
		const workspace = this.workspaces.get(workspaceId);
		if (!workspace) {
			return null;
		}
		workspace.lastAccessedAt = new Date();
		return workspace.path;
	}

	/**
	 * Get workspace status.
	 */
	getStatus(workspaceId: string): {
		exists: boolean;
		workspace?: Workspace;
		availableTools: string[];
	} {
		const workspace = this.workspaces.get(workspaceId);
		if (!workspace) {
			return { exists: false, availableTools: [] };
		}

		workspace.lastAccessedAt = new Date();

		// Determine available tools based on clone type
		const availableTools: string[] = [];

		if (workspace.cloneType !== "none") {
			availableTools.push("repo-files", "ripgrep");
		}

		if (workspace.cloneType === "full") {
			availableTools.push("code-pathfinder", "git-blame", "git-log");
		}

		return {
			exists: true,
			workspace,
			availableTools,
		};
	}

	/**
	 * Clean up a specific workspace.
	 */
	async cleanup(workspaceId: string): Promise<void> {
		const workspace = this.workspaces.get(workspaceId);
		if (!workspace) {
			return;
		}

		try {
			if (existsSync(workspace.path)) {
				rmSync(workspace.path, { recursive: true, force: true });
			}
			this.workspaces.delete(workspaceId);
			logger.info(`Cleaned up workspace: ${workspaceId}`);
		} catch (error) {
			logger.error(`Failed to cleanup workspace: ${workspaceId}`, { error });
		}
	}

	/**
	 * Clean up workspace by investigation ID.
	 */
	async cleanupByInvestigation(investigationId: string): Promise<void> {
		const workspace = this.getWorkspaceByInvestigation(investigationId);
		if (workspace) {
			await this.cleanup(workspace.id);
		}
	}

	/**
	 * Clean up all workspaces.
	 */
	async cleanupAll(): Promise<void> {
		const ids = Array.from(this.workspaces.keys());
		for (const id of ids) {
			await this.cleanup(id);
		}
	}

	/**
	 * Synchronous cleanup (for process exit handlers).
	 */
	private cleanupAllSync(): void {
		for (const workspace of this.workspaces.values()) {
			try {
				if (existsSync(workspace.path)) {
					rmSync(workspace.path, { recursive: true, force: true });
				}
			} catch {
				// Ignore errors during sync cleanup
			}
		}
		this.workspaces.clear();
	}

	/**
	 * Clean workspace contents but keep the directory.
	 */
	private async cleanWorkspaceContents(workspace: Workspace): Promise<void> {
		try {
			if (existsSync(workspace.path)) {
				rmSync(workspace.path, { recursive: true, force: true });
				mkdirSync(workspace.path, { recursive: true });
			}
			workspace.repository = undefined;
			workspace.cloneType = "none";
		} catch (error) {
			logger.error(`Failed to clean workspace contents: ${workspace.id}`, {
				error,
			});
		}
	}

	/**
	 * Clean up the oldest workspace.
	 */
	private cleanupOldest(): void {
		let oldest: Workspace | null = null;

		for (const workspace of this.workspaces.values()) {
			if (!oldest || workspace.lastAccessedAt < oldest.lastAccessedAt) {
				oldest = workspace;
			}
		}

		if (oldest) {
			logger.info(`Cleaning up oldest workspace: ${oldest.id}`);
			this.cleanup(oldest.id);
		}
	}

	/**
	 * Clean up idle workspaces.
	 */
	private cleanupIdle(): void {
		const now = Date.now();
		const idsToClean: string[] = [];

		for (const workspace of this.workspaces.values()) {
			const idleTime = now - workspace.lastAccessedAt.getTime();
			if (idleTime > this.config.ttlMs) {
				idsToClean.push(workspace.id);
			}
		}

		for (const id of idsToClean) {
			logger.info(`Cleaning up idle workspace: ${id}`);
			this.cleanup(id);
		}
	}

	/**
	 * Start periodic cleanup timer.
	 */
	private startCleanupTimer(): void {
		// Check for idle workspaces every 5 minutes
		this.cleanupTimer = setInterval(
			() => this.cleanupIdle(),
			5 * 60 * 1000,
		);
	}

	/**
	 * Stop cleanup timer.
	 */
	stopCleanupTimer(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
	}

	/**
	 * Get all active workspaces.
	 */
	listWorkspaces(): Workspace[] {
		return Array.from(this.workspaces.values());
	}
}

/**
 * Create a workspace manager with default configuration.
 */
export function createWorkspaceManager(
	config?: WorkspaceManagerConfig,
): WorkspaceManager {
	return new WorkspaceManager(config);
}

// Singleton instance
let defaultManager: WorkspaceManager | null = null;

/**
 * Get the default workspace manager singleton.
 */
export function getDefaultWorkspaceManager(): WorkspaceManager {
	if (!defaultManager) {
		defaultManager = createWorkspaceManager();
	}
	return defaultManager;
}

/**
 * Set the default workspace manager.
 */
export function setDefaultWorkspaceManager(manager: WorkspaceManager): void {
	defaultManager = manager;
}
