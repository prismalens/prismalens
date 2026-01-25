import type { StructuredTool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IntegrationContext } from "../types/state.js";
import {
	BundleRegistry,
	createMCPBundleSource,
	createNativeBundleSource,
	DEFAULT_MCP_BUNDLES,
} from "./bundles/index.js";
import type { BundleExecutionContext, NativeBundleDefinition } from "./bundles/types.js";
import { createRateLimiter } from "./rate-limiter.js";
import { createRepoFilesBundle, createRepoTools } from "./repo.js";
import { createWorkspaceTools } from "./workspace.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger({ context: "ToolFactory" });

// =============================================================================
// TOOL FACTORY
// =============================================================================
// Creates tools dynamically based on agent permissions and available integrations.
// Supports both direct loading and progressive disclosure via bundles.
// =============================================================================

export interface ToolFactoryOptions {
	/** Agent name for permission lookup */
	agentName: string;
	/** Available integrations with credentials */
	integrations: IntegrationContext[];
	/** Force read-only mode (overrides agent permissions) */
	readOnly?: boolean;
}

/**
 * Tool category to factory function mapping.
 * Each factory creates tools for a specific integration type.
 */
type ToolFactory = (options: ToolFactoryOptions) => StructuredTool[];

const TOOL_REGISTRY: Record<string, ToolFactory> = {
	repo: createRepoTools,
};

/**
 * Agent tool permissions - which tool categories each agent can use.
 * This is the primary access control mechanism.
 *
 * Design: Commander is a pure coordinator with NO direct tools.
 * It uses DeepAgent built-ins (write_todos, task) to delegate work.
 * SubAgents have capability-based tools resolved from integrations.
 */
const AGENT_TOOL_PERMISSIONS: Record<string, string[]> = {
	// Commander is a PURE COORDINATOR - no direct tools
	// Uses DeepAgent built-ins (write_todos, task) to delegate to subagents
	commander: [],

	// Cartographer is READ-ONLY - can gather context but not modify
	// Tools resolved based on configured integrations (GitHub/GitLab/local via MCP bundles)
	// NOTE: github and render tools are now provided via MCP bundles, not direct tool creation
	cartographer: ["repo"],

	// Detective only has the hypothesis tool (added separately)
	detective: [],

	// Surgeon only has the fix proposal tool (added separately)
	surgeon: [],

	// Adversary has challenge tools (added separately) + potential RAG/MCP access
	// RAG and MCP tools will be added dynamically based on integrations
	adversary: [],
};

/**
 * Agents that should be forced into read-only mode
 */
const READ_ONLY_AGENTS = new Set(["cartographer"]);

/**
 * Create tools for a specific agent based on permissions and integrations.
 * Loads all permitted tools at once for the agent.
 *
 * @example
 * // Create tools for cartographer with GitHub integration
 * const tools = createToolsForAgent('cartographer', [
 *   { type: 'github', connectionId: '...', credentials: {...}, config: {...} }
 * ]);
 *
 * @example
 * // Create all tools for commander
 * const tools = createToolsForAgent('commander', integrations);
 */
export function createToolsForAgent(
	agentName: string,
	integrations: IntegrationContext[],
): StructuredTool[] {
	const permissions = AGENT_TOOL_PERMISSIONS[agentName] || [];
	const readOnly = READ_ONLY_AGENTS.has(agentName);
	const tools: StructuredTool[] = [];

	for (const category of permissions) {
		const factory = TOOL_REGISTRY[category];
		if (!factory) {
			logger.warn(`Unknown tool category: ${category}`);
			continue;
		}

		// Find integrations for this category
		const categoryIntegrations = integrations.filter(
			(i) => i.type.toLowerCase() === category.toLowerCase(),
		);

		// Create tools with factory
		const categoryTools = factory({
			agentName,
			integrations: categoryIntegrations,
			readOnly,
		});

		tools.push(...categoryTools);
	}

	return tools;
}

/**
 * Register a custom tool category factory.
 * Use this to add new integration types at runtime.
 *
 * @example
 * registerToolCategory('prometheus', createPrometheusTools);
 */
export function registerToolCategory(
	category: string,
	factory: ToolFactory,
): void {
	TOOL_REGISTRY[category] = factory;
}

/**
 * Set permissions for an agent.
 * Use this to customize agent tool access at runtime.
 *
 * @example
 * setAgentPermissions('custom_agent', ['github', 'prometheus']);
 */
export function setAgentPermissions(
	agentName: string,
	categories: string[],
): void {
	AGENT_TOOL_PERMISSIONS[agentName] = categories;
}

/**
 * Get current permissions for an agent.
 */
export function getAgentPermissions(agentName: string): string[] {
	return AGENT_TOOL_PERMISSIONS[agentName] || [];
}

/**
 * Check if an agent is in read-only mode.
 */
export function isReadOnlyAgent(agentName: string): boolean {
	return READ_ONLY_AGENTS.has(agentName);
}

/**
 * Set an agent's read-only status.
 */
export function setReadOnlyAgent(agentName: string, readOnly: boolean): void {
	if (readOnly) {
		READ_ONLY_AGENTS.add(agentName);
	} else {
		READ_ONLY_AGENTS.delete(agentName);
	}
}

/**
 * Get all registered tool categories.
 */
export function getToolCategories(): string[] {
	return Object.keys(TOOL_REGISTRY);
}

// =============================================================================
// PROGRESSIVE DISCLOSURE SUPPORT
// =============================================================================
// New bundle-based tool system for token-efficient tool loading.
// =============================================================================

/**
 * Default bundle definitions for native tools.
 *
 * NOTE: GitHub and Render tools are now provided via MCP bundles (github-mcp, render-mcp)
 * which offer better rate limiting, deferred loading, and unified server management.
 * The native axios-based implementations have been removed.
 */
const DEFAULT_BUNDLE_DEFINITIONS: NativeBundleDefinition[] = [
	{
		name: "repo-files",
		category: "repo",
		description:
			"Read and search files in the local repository. Provides tools for reading file contents, listing directories, searching for text patterns, and getting file metadata.",
		readOnly: true,
		estimatedTokens: 850,
		keywords: ["local", "repository", "files", "search", "filesystem"],
		useCases: [
			"Reading source code files for analysis",
			"Finding where specific errors occur",
			"Understanding project structure",
		],
		tools: createRepoFilesBundle,
	},
];

/**
 * Create a bundle registry configured with default bundles.
 * Use this for progressive tool disclosure.
 *
 * Includes:
 * - Native bundles (github-code, render-logs, repo-files) - direct HTTP API calls
 * - MCP bundles (github-mcp, render-mcp) - MCP server-based with deferred loading
 *
 * @example
 * const registry = createDefaultBundleRegistry();
 * const { tools, getState, setState } = createMetaTools(
 *   registry,
 *   integrations,
 *   "cartographer",
 *   true
 * );
 */
export function createDefaultBundleRegistry(): BundleRegistry {
	// Native bundles (direct HTTP API tools)
	const nativeSource = createNativeBundleSource(DEFAULT_BUNDLE_DEFINITIONS);

	// MCP bundles (new deferred loading via MCP servers)
	const rateLimiter = createRateLimiter();
	const mcpSource = createMCPBundleSource(DEFAULT_MCP_BUNDLES, rateLimiter);

	const registry = new BundleRegistry({
		sources: [nativeSource, mcpSource],
		agentPermissions: AGENT_TOOL_PERMISSIONS,
		readOnlyAgents: READ_ONLY_AGENTS,
	});

	return registry;
}

/**
 * Create a bundle registry with workspace tools for a specific investigation.
 * This includes all default bundles plus workspace escalation tools.
 *
 * @example
 * const registry = createBundleRegistryWithWorkspace("inv-123");
 */
export function createBundleRegistryWithWorkspace(
	investigationId: string,
): BundleRegistry {
	// Native bundles
	const nativeSource = createNativeBundleSource([
		...DEFAULT_BUNDLE_DEFINITIONS,
		{
			name: "workspace",
			category: "workspace",
			description:
				"Workspace management tools for cloning repositories and switching to local analysis. Use when API rate limits are reached or you need faster local file access.",
			readOnly: false,
			estimatedTokens: 600,
			keywords: ["workspace", "clone", "local", "repository", "git"],
			useCases: [
				"Cloning a repository for local analysis",
				"Switching from API to local file tools",
				"Getting git history for blame/log analysis",
			],
			tools: (_ctx) => createWorkspaceTools({ investigationId }),
		},
	]);

	// MCP bundles
	const rateLimiter = createRateLimiter();
	const mcpSource = createMCPBundleSource(DEFAULT_MCP_BUNDLES, rateLimiter);

	const registry = new BundleRegistry({
		sources: [nativeSource, mcpSource],
		agentPermissions: {
			...AGENT_TOOL_PERMISSIONS,
			// Add workspace permission to agents that can use it
			commander: [...AGENT_TOOL_PERMISSIONS.commander, "workspace"],
			cartographer: [...AGENT_TOOL_PERMISSIONS.cartographer, "workspace"],
		},
		readOnlyAgents: READ_ONLY_AGENTS,
	});

	return registry;
}

/**
 * Get the path to the manifests directory.
 */
export function getManifestsDir(): string {
	return path.join(__dirname, "manifests");
}

/**
 * Options for creating progressive disclosure tools.
 */
export interface ProgressiveToolsOptions {
	/** Agent name for permission checking */
	agentName: string;

	/** Available integrations */
	integrations: IntegrationContext[];

	/** Custom bundle registry (optional, uses default if not provided) */
	registry?: BundleRegistry;

	/** Bundles to pre-enable (optional) */
	preEnabledBundles?: string[];
}

/**
 * Create progressive disclosure meta-tools for an agent.
 * Returns the meta-tools (search_tools, call_tool, list_enabled_tools)
 * that allow agents to discover and load tools on-demand.
 *
 * @example
 * const { tools, registry, getState, setState } = createProgressiveTools({
 *   agentName: "cartographer",
 *   integrations: [...],
 * });
 *
 * // tools contains: search_tools, call_tool, list_enabled_tools
 * // Agents use search_tools to find and enable bundles
 * // Then use call_tool to execute tools from enabled bundles
 */
export function createProgressiveTools(options: ProgressiveToolsOptions): {
	tools: StructuredTool[];
	registry: BundleRegistry;
	getState: () => { enabledBundles: string[] };
	setState: (update: { enabledBundles: string[] }) => void;
} {
	const registry = options.registry || createDefaultBundleRegistry();
	const readOnly = READ_ONLY_AGENTS.has(options.agentName);

	// Import createMetaTools at runtime to avoid circular dependency
	const { createMetaTools } = require("./bundles/registry.js");

	const { tools, getState, setState } = createMetaTools(
		registry,
		options.integrations,
		options.agentName,
		readOnly,
	);

	// Pre-enable specified bundles
	if (options.preEnabledBundles?.length) {
		setState({ enabledBundles: options.preEnabledBundles });
	}

	return { tools, registry, getState, setState };
}

/**
 * Convert bundle execution context to tool factory options.
 * Useful for bridging between the two systems.
 */
export function contextToFactoryOptions(
	context: BundleExecutionContext,
): ToolFactoryOptions {
	return {
		agentName: context.agentName,
		integrations: context.integrations,
		readOnly: context.readOnly,
	};
}

/**
 * Convert tool factory options to bundle execution context.
 * Useful for bridging between the two systems.
 */
export function factoryOptionsToContext(
	options: ToolFactoryOptions,
): BundleExecutionContext {
	return {
		agentName: options.agentName,
		integrations: options.integrations,
		readOnly: options.readOnly ?? false,
	};
}
