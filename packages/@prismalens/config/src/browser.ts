/**
 * @prismalens/config/browser
 *
 * Browser-safe exports for frontend use.
 * This module ONLY exports static data and types - no Node.js dependencies.
 *
 * @example
 * ```typescript
 * import { LLM_PROVIDERS, type LLMProviderId } from '@prismalens/config/browser';
 * import { MCP_SERVERS, type MCPServerId } from '@prismalens/config/browser';
 * ```
 */

// Re-export only the browser-safe parts from llm schema
export {
	LLM_PROVIDERS,
	LLM_PROVIDER_IDS,
	type LLMProviderId,
	// Zod schemas (for provider ID validation only)
	llmProviderIdSchema,
	// Helper functions
	getApiKeyEnvVar,
	getDocsUrl,
} from "./schemas/llm.js";

// Re-export only the browser-safe parts from mcp schema
export {
	// Static metadata
	MCP_SERVERS,
	MCP_SERVER_IDS,
	type MCPServerId,
	type MCPServerMetadata,
	type MCPCredentialMapping,
	// Zod schemas (zod is browser-safe)
	mcpServerIdSchema,
	httpTransportSchema,
	stdioTransportSchema,
	mcpTransportSchema,
	mcpServerConfigSchema,
	type HTTPTransport,
	type StdioTransport,
	type MCPTransport,
	type MCPServerConfig,
	// Helper functions (browser-safe - no Node.js deps)
	getMCPServerMetadata,
	getAvailableMCPServers,
} from "./schemas/mcp.js";
