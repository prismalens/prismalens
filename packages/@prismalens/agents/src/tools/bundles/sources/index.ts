// =============================================================================
// BUNDLE SOURCES INDEX
// =============================================================================
// Exports all bundle source implementations.
//
// NOTE: OpenAPI bundle source has been removed (unused in practice).
// MCP bundles are the preferred method for integrating external APIs.
// =============================================================================

export {
	FilesystemBundleSource,
	createFilesystemBundleSource,
	type FilesystemBundleSourceConfig,
} from "./filesystem.js";

export {
	NativeBundleSource,
	createNativeBundleSource,
	type NativeBundleSourceConfig,
} from "./native.js";

export {
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
} from "./mcp.js";
