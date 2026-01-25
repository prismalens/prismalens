// =============================================================================
// TOOL BUNDLES INDEX
// =============================================================================
// Progressive tool disclosure system based on Anthropic's "Tool Search Tool" pattern.
// Allows agents to discover and load tools on-demand to reduce context token usage.
// =============================================================================

// Types
export type {
	BundleExecutionContext,
	BundleRegistryConfig,
	BundleSearchOptions,
	BundleSearchResult,
	CreateToolsOptions,
	NativeBundleDefinition,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
	ToolDisclosureState,
	ToolFactory,
	ToolManifest,
	ToolManifestFrontmatter,
	ToolManifestOperation,
} from "./types.js";

export { ToolDisclosureStateSchema } from "./types.js";

// Manifest parser
export {
	manifestToMetadata,
	parseToolsManifest,
	validateManifestOperations,
} from "./manifest.js";

// Registry
export {
	BundleRegistry,
	createCallToolTool,
	createListEnabledToolsTool,
	createMetaTools,
	createSearchToolsTool,
	getDefaultRegistry,
	setDefaultRegistry,
} from "./registry.js";

// Sources
export {
	FilesystemBundleSource,
	createFilesystemBundleSource,
	type FilesystemBundleSourceConfig,
	NativeBundleSource,
	createNativeBundleSource,
	type NativeBundleSourceConfig,
	MCPBundleSource,
	createMCPBundleSource,
	createMCPBundleFromConfig,
	GITHUB_MCP_BUNDLE,
	GITHUB_MCP_WRITE_BUNDLE,
	RENDER_MCP_BUNDLE,
	GITLAB_MCP_BUNDLE,
	DEFAULT_MCP_BUNDLES,
	type MCPBundleDefinition,
	type MCPBundleSourceConfig,
} from "./sources/index.js";
