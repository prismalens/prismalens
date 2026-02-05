import type { StructuredTool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import type { IntegrationContext } from "../types/index.js";
import {
	BundleRegistry,
	createMetaTools,
	createNativeBundleSource,
} from "../tools/bundles/index.js";
import type { NativeBundleDefinition } from "../tools/bundles/types.js";

// =============================================================================
// TOOL DISCLOSURE MIDDLEWARE
// =============================================================================
// Middleware that provides progressive tool disclosure for agents.
// Adds meta-tools (search_tools, call_tool, list_enabled_tools) that allow
// agents to discover and load tools on-demand.
// =============================================================================

const logger = new Logger({ context: "ToolDisclosureMiddleware" });

/**
 * Middleware context type for tool disclosure.
 */
interface MiddlewareContext {
	tools?: StructuredTool[];
	[key: string]: unknown;
}

/**
 * Middleware interface for tool disclosure.
 * Compatible with deepagents middleware pattern.
 */
export interface ToolDisclosureMiddleware {
	name: string;
	beforeInvoke?: (context: MiddlewareContext) => Promise<MiddlewareContext>;
	afterInvoke?: (context: MiddlewareContext, result: unknown) => Promise<unknown>;
	getState: () => ToolDisclosureMiddlewareState;
	setState: (update: { enabledBundles: string[] }) => void;
}

/**
 * Options for the tool disclosure middleware.
 */
export interface ToolDisclosureMiddlewareOptions {
	/** Bundle registry to use */
	registry?: BundleRegistry;

	/** Bundle definitions to register (if no registry provided) */
	bundles?: NativeBundleDefinition[];

	/** Available integrations for tools */
	integrations: IntegrationContext[];

	/** Agent name for permission checking */
	agentName: string;

	/** Whether the agent is read-only */
	readOnly?: boolean;

	/** Bundles to pre-enable */
	preEnabledBundles?: string[];

	/** Agent permissions (category access) */
	agentPermissions?: Record<string, string[]>;

	/** Read-only agents set */
	readOnlyAgents?: Set<string>;
}

/**
 * State tracked by the tool disclosure middleware.
 */
export interface ToolDisclosureMiddlewareState {
	/** Currently enabled bundle names */
	enabledBundles: string[];
}

/**
 * Create the tool disclosure middleware.
 *
 * This middleware:
 * 1. Adds meta-tools for discovering and loading bundles
 * 2. Tracks which bundles are enabled across turns
 * 3. Routes tool calls through call_tool to enabled bundles
 *
 * @example
 * const middleware = createToolDisclosureMiddleware({
 *   integrations: [...],
 *   agentName: "gatherer",
 *   readOnly: true,
 *   preEnabledBundles: ["github-code"],
 * });
 *
 * const subagent: SubAgent = {
 *   name: "gatherer",
 *   systemPrompt: "...",
 *   tools: [], // Meta-tools added by middleware
 *   middleware: [middleware],
 * };
 */
export function createToolDisclosureMiddleware(
	options: ToolDisclosureMiddlewareOptions,
): ToolDisclosureMiddleware {
	// Create or use provided registry
	const registry =
		options.registry ||
		createRegistryFromOptions(options);

	// Track state for this middleware instance
	let disclosureState = {
		enabledBundles: options.preEnabledBundles || [],
	};

	const getState = () => disclosureState;
	const setState = (update: { enabledBundles: string[] }) => {
		disclosureState = { ...disclosureState, ...update };
	};

	// Create meta-tools
	const { tools: metaTools } = createMetaTools(
		registry,
		options.integrations,
		options.agentName,
		options.readOnly ?? false,
	);

	// Initialize state with pre-enabled bundles
	if (options.preEnabledBundles?.length) {
		setState({ enabledBundles: options.preEnabledBundles });
	}

	logger.debug(
		`Created tool disclosure middleware for ${options.agentName} with ${metaTools.length} meta-tools`,
	);

	return {
		name: "tool-disclosure",

		/**
		 * Called before agent execution.
		 * Injects meta-tools into the agent's tool list.
		 */
		beforeInvoke: async (context: MiddlewareContext) => {
			// Merge meta-tools with existing tools
			const existingTools = (context.tools || []) as StructuredTool[];
			const allTools = [...metaTools, ...existingTools];

			logger.debug(
				`Injecting ${metaTools.length} meta-tools into ${options.agentName}`,
			);

			return {
				...context,
				tools: allTools,
			};
		},

		/**
		 * Called after agent execution.
		 * Persists bundle state for next turn.
		 */
		afterInvoke: async (_context: MiddlewareContext, result: unknown) => {
			// State is already persisted in disclosureState
			// Could add logging or analytics here

			logger.debug(
				`${options.agentName} turn complete. Enabled bundles: ${disclosureState.enabledBundles.join(", ") || "none"}`,
			);

			return result;
		},

		/**
		 * Get current middleware state.
		 */
		getState,

		/**
		 * Set middleware state.
		 */
		setState,
	};
}

/**
 * Create a registry from middleware options.
 */
function createRegistryFromOptions(
	options: ToolDisclosureMiddlewareOptions,
): BundleRegistry {
	const bundles = options.bundles || [];
	const source = createNativeBundleSource(bundles);

	return new BundleRegistry({
		sources: [source],
		agentPermissions: options.agentPermissions,
		readOnlyAgents: options.readOnlyAgents,
	});
}

/**
 * Create middleware with default bundles for PrismaLens agents.
 *
 * @example
 * const middleware = createDefaultToolDisclosureMiddleware({
 *   integrations: [...],
 *   agentName: "gatherer",
 * });
 */
export function createDefaultToolDisclosureMiddleware(options: {
	integrations: IntegrationContext[];
	agentName: string;
	readOnly?: boolean;
	preEnabledBundles?: string[];
}): ToolDisclosureMiddleware {
	// Import default bundles - avoid circular dependency
	const { createDefaultBundleRegistry } = require("../tools/factory.js");
	const registry = createDefaultBundleRegistry();

	return createToolDisclosureMiddleware({
		...options,
		registry,
	});
}

/**
 * Type guard to check if middleware is tool disclosure middleware.
 */
export function isToolDisclosureMiddleware(
	middleware: unknown,
): middleware is ToolDisclosureMiddleware {
	return (
		typeof middleware === "object" &&
		middleware !== null &&
		"name" in middleware &&
		(middleware as { name: string }).name === "tool-disclosure"
	);
}
