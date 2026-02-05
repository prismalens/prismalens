import type { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { IntegrationContext } from "../../types/index.js";

// =============================================================================
// TOOL BUNDLE TYPES
// =============================================================================
// Type definitions for the progressive tool disclosure system.
// Based on Anthropic's "Tool Search Tool" pattern for token-efficient tool loading.
// =============================================================================

/**
 * Bundle metadata - lightweight description for discovery/listing.
 * This is what agents see when searching for tools.
 */
export interface ToolBundleMetadata {
	/** Unique bundle identifier (e.g., "github-code", "render-logs") */
	name: string;

	/** Category for grouping (e.g., "github", "render", "repo") */
	category: string;

	/** Human-readable description for agent discovery */
	description: string;

	/** List of tool names included in this bundle */
	operations: string[];

	/** Whether all tools in this bundle are read-only */
	readOnly: boolean;

	/** Estimated token cost when loaded (for context budgeting) */
	estimatedTokens?: number;

	/** Keywords for search matching */
	keywords?: string[];

	/** Use cases - when should an agent load this bundle? */
	useCases?: string[];

	/** Source of this bundle (filesystem, native, openapi) */
	source?: string;
}

/**
 * Full tool bundle with factory function.
 * Contains everything needed to instantiate tools at runtime.
 */
export interface ToolBundle {
	/** Bundle metadata */
	metadata: ToolBundleMetadata;

	/**
	 * Factory function to create tools with integration context.
	 * Called when the bundle is loaded/enabled.
	 */
	createTools: (context: BundleExecutionContext) => StructuredTool[];
}

/**
 * Context passed to tool factories when creating tools.
 * Includes integration credentials and agent information.
 */
export interface BundleExecutionContext {
	/** Available integrations with credentials */
	integrations: IntegrationContext[];

	/** Name of the agent requesting the tools */
	agentName: string;

	/** Whether the agent is in read-only mode */
	readOnly: boolean;
}

// =============================================================================
// TOOL BUNDLE SOURCE PROTOCOL
// =============================================================================
// Extensible pattern for loading bundles from different sources.
// Similar to deepagents' BackendProtocol for skills.
// =============================================================================

/**
 * Protocol for bundle sources.
 * Implement this interface to add custom bundle loading mechanisms.
 */
export interface ToolBundleSource {
	/** Source identifier for logging/debugging */
	readonly name: string;

	/**
	 * List all available bundles from this source.
	 * Returns metadata only (lightweight for discovery).
	 */
	listBundles(): Promise<ToolBundleMetadata[]>;

	/**
	 * Load a specific bundle by name.
	 * Returns the full bundle with tool factory, or null if not found.
	 */
	loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null>;

	/**
	 * Optional: Reload bundles (for hot-reloading in development).
	 */
	refresh?(): Promise<void>;
}

// =============================================================================
// TOOL DISCLOSURE STATE
// =============================================================================
// State schema for tracking which bundles are enabled in an agent session.
// Used by the tool disclosure middleware.
// =============================================================================

/**
 * Zod schema for tool disclosure state.
 * Tracks enabled bundles across agent turns.
 */
export const ToolDisclosureStateSchema = z.object({
	/** Currently enabled bundle names */
	enabledBundles: z.array(z.string()).default([]),

	/** Token budget tracking */
	tokenBudget: z
		.object({
			/** Maximum tokens allocated for tools */
			max: z.number().default(4000),
			/** Currently used tokens */
			used: z.number().default(0),
		})
		.optional(),
});

export type ToolDisclosureState = z.infer<typeof ToolDisclosureStateSchema>;

// =============================================================================
// SEARCH / MATCH TYPES
// =============================================================================

/**
 * Result from searching bundles.
 */
export interface BundleSearchResult {
	/** Matching bundle metadata */
	bundle: ToolBundleMetadata;

	/** Relevance score (0-1) */
	score: number;

	/** Why this bundle matched */
	matchReason?: string;
}

/**
 * Options for bundle search.
 */
export interface BundleSearchOptions {
	/** Natural language query */
	query?: string;

	/** Filter by category */
	category?: string;

	/** Maximum results to return */
	limit?: number;

	/** Only include read-only bundles */
	readOnlyOnly?: boolean;

	/** Exclude already-enabled bundles */
	excludeEnabled?: string[];
}

// =============================================================================
// REGISTRY TYPES
// =============================================================================

/**
 * Configuration for the bundle registry.
 */
export interface BundleRegistryConfig {
	/** Bundle sources to load from */
	sources: ToolBundleSource[];

	/** Agent permissions - which categories each agent can access */
	agentPermissions?: Record<string, string[]>;

	/** Agents that are forced into read-only mode */
	readOnlyAgents?: Set<string>;
}

/**
 * Options for creating tools from enabled bundles.
 */
export interface CreateToolsOptions {
	/** Agent name for permission checking */
	agentName: string;

	/** Available integrations */
	integrations: IntegrationContext[];

	/** Bundle names to enable */
	enabledBundles: string[];

	/** Force read-only mode */
	readOnly?: boolean;
}

// =============================================================================
// MANIFEST TYPES
// =============================================================================

/**
 * Parsed TOOLS.md manifest frontmatter.
 */
export interface ToolManifestFrontmatter {
	name: string;
	category: string;
	description: string;
	readOnly: boolean;
	estimatedTokens?: number;
	keywords?: string[];
}

/**
 * Operation definition from TOOLS.md.
 */
export interface ToolManifestOperation {
	name: string;
	description: string;
}

/**
 * Full parsed TOOLS.md manifest.
 */
export interface ToolManifest {
	frontmatter: ToolManifestFrontmatter;
	operations: ToolManifestOperation[];
	useCases: string[];
	rawContent: string;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Tool factory function signature.
 * Used when registering native tools as bundles.
 */
export type ToolFactory = (context: BundleExecutionContext) => StructuredTool[];

/**
 * Native bundle definition for registering LangChain tools directly.
 */
export interface NativeBundleDefinition {
	name: string;
	category: string;
	description: string;
	readOnly: boolean;
	estimatedTokens?: number;
	keywords?: string[];
	useCases?: string[];
	/** Either pre-created tools or a factory function */
	tools: StructuredTool[] | ToolFactory;
}
