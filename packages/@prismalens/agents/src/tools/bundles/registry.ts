import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import { z } from "zod";
import type { IntegrationContext } from "../../types/index.js";
import type {
	BundleExecutionContext,
	BundleRegistryConfig,
	BundleSearchOptions,
	BundleSearchResult,
	CreateToolsOptions,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
} from "./types.js";

// =============================================================================
// BUNDLE REGISTRY
// =============================================================================
// Central registry for tool bundles. Provides discovery, search, and loading.
// Implements Anthropic's "Tool Search Tool" pattern.
// =============================================================================

const logger = new Logger({ context: "BundleRegistry" });

/**
 * Bundle registry - manages tool bundles from multiple sources.
 */
export class BundleRegistry {
	private sources: ToolBundleSource[] = [];
	private metadataCache: Map<string, ToolBundleMetadata> = new Map();
	private bundleCache: Map<string, ToolBundle> = new Map();
	private agentPermissions: Record<string, string[]> = {};
	private readOnlyAgents: Set<string> = new Set();
	private initialized = false;

	constructor(config?: BundleRegistryConfig) {
		if (config?.sources) {
			this.sources = config.sources;
		}
		if (config?.agentPermissions) {
			this.agentPermissions = config.agentPermissions;
		}
		if (config?.readOnlyAgents) {
			this.readOnlyAgents = config.readOnlyAgents;
		}
	}

	/**
	 * Add a bundle source.
	 */
	addSource(source: ToolBundleSource): void {
		this.sources.push(source);
		this.initialized = false; // Force re-initialization
	}

	/**
	 * Initialize the registry by loading metadata from all sources.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		logger.info(`Initializing bundle registry with ${this.sources.length} sources`);

		this.metadataCache.clear();
		this.bundleCache.clear();

		for (const source of this.sources) {
			try {
				const bundles = await source.listBundles();
				for (const metadata of bundles) {
					this.metadataCache.set(metadata.name, {
						...metadata,
						source: source.name,
					});
				}
				logger.debug(`Loaded ${bundles.length} bundles from ${source.name}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`Failed to load bundles from ${source.name}: ${message}`);
			}
		}

		this.initialized = true;
		logger.info(`Registry initialized with ${this.metadataCache.size} bundles`);
	}

	/**
	 * List all available bundles.
	 */
	async listBundles(category?: string): Promise<ToolBundleMetadata[]> {
		await this.initialize();

		const bundles = Array.from(this.metadataCache.values());

		if (category) {
			return bundles.filter(
				(b) => b.category.toLowerCase() === category.toLowerCase(),
			);
		}

		return bundles;
	}

	/**
	 * Get bundle metadata by name.
	 */
	async getMetadata(name: string): Promise<ToolBundleMetadata | null> {
		await this.initialize();
		return this.metadataCache.get(name) || null;
	}

	/**
	 * Search bundles by natural language query or filters.
	 */
	async searchBundles(options: BundleSearchOptions): Promise<BundleSearchResult[]> {
		await this.initialize();

		const results: BundleSearchResult[] = [];
		const query = options.query?.toLowerCase() || "";
		const excludeSet = new Set(options.excludeEnabled || []);

		for (const metadata of this.metadataCache.values()) {
			// Apply filters
			if (excludeSet.has(metadata.name)) continue;
			if (options.category && metadata.category !== options.category) continue;
			if (options.readOnlyOnly && !metadata.readOnly) continue;

			// Calculate relevance score
			let score = 0;
			const matchReasons: string[] = [];

			if (query) {
				// Check name match
				if (metadata.name.toLowerCase().includes(query)) {
					score += 0.4;
					matchReasons.push("name");
				}

				// Check description match
				if (metadata.description.toLowerCase().includes(query)) {
					score += 0.3;
					matchReasons.push("description");
				}

				// Check keywords match
				if (metadata.keywords?.some((k) => k.toLowerCase().includes(query))) {
					score += 0.2;
					matchReasons.push("keywords");
				}

				// Check use cases match
				if (metadata.useCases?.some((u) => u.toLowerCase().includes(query))) {
					score += 0.2;
					matchReasons.push("use cases");
				}

				// Check operations match
				if (metadata.operations.some((op) => op.toLowerCase().includes(query))) {
					score += 0.1;
					matchReasons.push("operations");
				}

				// Skip if no matches found
				if (score === 0) continue;
			} else {
				// No query - include all with base score
				score = 0.5;
			}

			results.push({
				bundle: metadata,
				score,
				matchReason: matchReasons.length > 0 ? `Matched: ${matchReasons.join(", ")}` : undefined,
			});
		}

		// Sort by score descending
		results.sort((a, b) => b.score - a.score);

		// Apply limit
		const limit = options.limit || 10;
		return results.slice(0, limit);
	}

	/**
	 * Load a bundle by name.
	 */
	async loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null> {
		await this.initialize();

		// Check cache first
		const cacheKey = `${name}:${context.agentName}`;
		if (this.bundleCache.has(cacheKey)) {
			return this.bundleCache.get(cacheKey)!;
		}

		// Find the source for this bundle
		const metadata = this.metadataCache.get(name);
		if (!metadata) {
			logger.warn(`Bundle not found: ${name}`);
			return null;
		}

		// Check agent permissions
		if (!this.hasPermission(context.agentName, metadata.category)) {
			logger.warn(
				`Agent ${context.agentName} does not have permission for category ${metadata.category}`,
			);
			return null;
		}

		// Check read-only constraints
		if (context.readOnly && !metadata.readOnly) {
			logger.warn(
				`Agent ${context.agentName} is read-only but bundle ${name} has write operations`,
			);
			return null;
		}

		// Find the source and load
		for (const source of this.sources) {
			const bundle = await source.loadBundle(name, context);
			if (bundle) {
				this.bundleCache.set(cacheKey, bundle);
				logger.info(`Loaded bundle ${name} from ${source.name}`);
				return bundle;
			}
		}

		logger.warn(`Bundle ${name} not found in any source`);
		return null;
	}

	/**
	 * Create tools from multiple enabled bundles.
	 */
	async createToolsFromBundles(options: CreateToolsOptions): Promise<StructuredTool[]> {
		const tools: StructuredTool[] = [];
		const context: BundleExecutionContext = {
			integrations: options.integrations,
			agentName: options.agentName,
			readOnly: options.readOnly ?? this.readOnlyAgents.has(options.agentName),
		};

		for (const bundleName of options.enabledBundles) {
			const bundle = await this.loadBundle(bundleName, context);
			if (bundle) {
				const bundleTools = bundle.createTools(context);
				tools.push(...bundleTools);
			}
		}

		return tools;
	}

	/**
	 * Check if an agent has permission for a category.
	 */
	hasPermission(agentName: string, category: string): boolean {
		const permissions = this.agentPermissions[agentName];
		if (!permissions) {
			// No permissions defined = allow all
			return true;
		}
		return permissions.includes(category);
	}

	/**
	 * Set permissions for an agent.
	 */
	setPermissions(agentName: string, categories: string[]): void {
		this.agentPermissions[agentName] = categories;
	}

	/**
	 * Check if an agent is read-only.
	 */
	isReadOnly(agentName: string): boolean {
		return this.readOnlyAgents.has(agentName);
	}

	/**
	 * Set an agent's read-only status.
	 */
	setReadOnly(agentName: string, readOnly: boolean): void {
		if (readOnly) {
			this.readOnlyAgents.add(agentName);
		} else {
			this.readOnlyAgents.delete(agentName);
		}
	}

	/**
	 * Refresh all sources (for hot-reloading).
	 */
	async refresh(): Promise<void> {
		this.initialized = false;
		this.metadataCache.clear();
		this.bundleCache.clear();

		for (const source of this.sources) {
			if (source.refresh) {
				await source.refresh();
			}
		}

		await this.initialize();
	}

	/**
	 * Get statistics about the registry.
	 */
	getStats(): {
		bundleCount: number;
		sourceCount: number;
		categories: string[];
	} {
		const categories = new Set<string>();
		for (const metadata of this.metadataCache.values()) {
			categories.add(metadata.category);
		}

		return {
			bundleCount: this.metadataCache.size,
			sourceCount: this.sources.length,
			categories: Array.from(categories),
		};
	}
}

// =============================================================================
// META-TOOLS
// =============================================================================
// These tools are always available to agents for discovering and loading bundles.
// =============================================================================

/**
 * Format bundle metadata for display to the agent.
 */
function formatBundleForAgent(metadata: ToolBundleMetadata): string {
	const lines = [
		`**${metadata.name}** (${metadata.category})`,
		`  ${metadata.description}`,
		`  Tools: ${metadata.operations.join(", ")}`,
	];

	if (metadata.estimatedTokens) {
		lines.push(`  Estimated tokens: ~${metadata.estimatedTokens}`);
	}

	return lines.join("\n");
}

/**
 * Create the search_tools meta-tool.
 * This tool searches for and enables tool bundles.
 */
export function createSearchToolsTool(
	registry: BundleRegistry,
	getState: () => { enabledBundles: string[] },
	setState: (update: { enabledBundles: string[] }) => void,
): StructuredTool {
	return tool(
		async ({ query, category }) => {
			const currentState = getState();

			const results = await registry.searchBundles({
				query,
				category,
				excludeEnabled: currentState.enabledBundles,
				limit: 5,
			});

			if (results.length === 0) {
				return `No matching tool bundles found for query: "${query}"${category ? ` in category: ${category}` : ""}.

Currently enabled bundles: ${currentState.enabledBundles.length > 0 ? currentState.enabledBundles.join(", ") : "none"}`;
			}

			// Enable matching bundles
			const newBundles = results.map((r) => r.bundle.name);
			const updatedBundles = [...new Set([...currentState.enabledBundles, ...newBundles])];
			setState({ enabledBundles: updatedBundles });

			// Format response
			const bundleDescriptions = results
				.map((r) => formatBundleForAgent(r.bundle))
				.join("\n\n");

			return `Found and enabled ${results.length} tool bundle(s):

${bundleDescriptions}

**Now enabled:** ${updatedBundles.join(", ")}

Use the \`call_tool\` tool to execute tools from these bundles.`;
		},
		{
			name: "search_tools",
			description: `Search for and enable tool bundles by describing what you need. Returns matching bundles and enables them for use with call_tool.

Example queries:
- "search code files" → enables github-code bundle
- "fetch deployment logs" → enables render-logs bundle
- "read local files" → enables repo-files bundle

Always call this BEFORE trying to use a tool you haven't enabled yet.`,
			schema: z.object({
				query: z
					.string()
					.describe("Natural language description of needed capability"),
				category: z
					.string()
					.optional()
					.describe("Optional filter by category: github, render, repo"),
			}),
		},
	);
}

/**
 * Create the call_tool meta-tool.
 * This tool routes calls to tools from enabled bundles.
 */
export function createCallToolTool(
	registry: BundleRegistry,
	getState: () => { enabledBundles: string[] },
	getContext: () => BundleExecutionContext,
): StructuredTool {
	// Cache of instantiated tools by bundle
	const toolCache = new Map<string, Map<string, StructuredTool>>();

	return tool(
		async ({ toolName, arguments: args }) => {
			const currentState = getState();
			const context = getContext();

			// Find the tool in enabled bundles
			for (const bundleName of currentState.enabledBundles) {
				// Check metadata to see if this bundle has the tool
				const metadata = await registry.getMetadata(bundleName);
				if (!metadata || !metadata.operations.includes(toolName)) {
					continue;
				}

				// Get or create tool instances for this bundle
				let bundleTools = toolCache.get(bundleName);
				if (!bundleTools) {
					const bundle = await registry.loadBundle(bundleName, context);
					if (!bundle) continue;

					bundleTools = new Map();
					const tools = bundle.createTools(context);
					for (const t of tools) {
						bundleTools.set(t.name, t);
					}
					toolCache.set(bundleName, bundleTools);
				}

				// Find and execute the tool
				const targetTool = bundleTools.get(toolName);
				if (targetTool) {
					try {
						const result = await targetTool.invoke(args);
						return result;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return `Error executing ${toolName}: ${message}`;
					}
				}
			}

			// Tool not found - provide helpful error
			const enabledTools: string[] = [];
			for (const bundleName of currentState.enabledBundles) {
				const metadata = await registry.getMetadata(bundleName);
				if (metadata) {
					enabledTools.push(...metadata.operations);
				}
			}

			return `Tool '${toolName}' not found in enabled bundles.

Enabled bundles: ${currentState.enabledBundles.length > 0 ? currentState.enabledBundles.join(", ") : "none"}
Available tools: ${enabledTools.length > 0 ? enabledTools.join(", ") : "none"}

Use search_tools to find and enable the bundle containing '${toolName}'.`;
		},
		{
			name: "call_tool",
			description: `Execute a tool from an enabled bundle.

First use search_tools to enable the bundle containing the tool you need, then use this tool to execute it.

Arguments should be passed as a JSON object matching the tool's schema.`,
			schema: z.object({
				toolName: z.string().describe("Name of the tool to call (e.g., 'github_get_file')"),
				arguments: z.record(z.unknown()).describe("Arguments for the tool as a JSON object"),
			}),
		},
	);
}

/**
 * Create the list_enabled_tools meta-tool.
 * This tool lists all currently enabled tools.
 */
export function createListEnabledToolsTool(
	registry: BundleRegistry,
	getState: () => { enabledBundles: string[] },
): StructuredTool {
	return tool(
		async () => {
			const currentState = getState();

			if (currentState.enabledBundles.length === 0) {
				return `No tool bundles are currently enabled.

Use search_tools to find and enable bundles you need.`;
			}

			const bundleDetails: string[] = [];
			for (const bundleName of currentState.enabledBundles) {
				const metadata = await registry.getMetadata(bundleName);
				if (metadata) {
					bundleDetails.push(formatBundleForAgent(metadata));
				}
			}

			return `Currently enabled tool bundles:

${bundleDetails.join("\n\n")}`;
		},
		{
			name: "list_enabled_tools",
			description: "List all currently enabled tool bundles and their available tools.",
			schema: z.object({}),
		},
	);
}

/**
 * Create all meta-tools for progressive tool disclosure.
 */
export function createMetaTools(
	registry: BundleRegistry,
	integrations: IntegrationContext[],
	agentName: string,
	readOnly: boolean = false,
): {
	tools: StructuredTool[];
	getState: () => { enabledBundles: string[] };
	setState: (update: { enabledBundles: string[] }) => void;
} {
	// Mutable state for enabled bundles
	let state = { enabledBundles: [] as string[] };

	const getState = () => state;
	const setState = (update: { enabledBundles: string[] }) => {
		state = { ...state, ...update };
	};

	const getContext = (): BundleExecutionContext => ({
		integrations,
		agentName,
		readOnly,
	});

	const tools = [
		createSearchToolsTool(registry, getState, setState),
		createCallToolTool(registry, getState, getContext),
		createListEnabledToolsTool(registry, getState),
	];

	return { tools, getState, setState };
}

// =============================================================================
// SINGLETON REGISTRY
// =============================================================================

let defaultRegistry: BundleRegistry | null = null;

/**
 * Get the default bundle registry singleton.
 */
export function getDefaultRegistry(): BundleRegistry {
	if (!defaultRegistry) {
		defaultRegistry = new BundleRegistry();
	}
	return defaultRegistry;
}

/**
 * Set the default bundle registry.
 */
export function setDefaultRegistry(registry: BundleRegistry): void {
	defaultRegistry = registry;
}
