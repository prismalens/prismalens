/**
 * @prismalens/config/mcp
 *
 * Static MCP server metadata and schemas.
 * This module contains NO environment-dependent code - safe for all contexts.
 *
 * @example
 * ```typescript
 * import { MCP_SERVERS, mcpServerIdSchema } from '@prismalens/config/mcp';
 * ```
 */

export {
	// Static metadata
	MCP_SERVERS,
	MCP_SERVER_IDS,
	type MCPServerId,
	type MCPServerMetadata,
	type MCPCredentialMapping,
	// Zod schemas
	mcpServerIdSchema,
	httpTransportSchema,
	stdioTransportSchema,
	mcpTransportSchema,
	mcpServerConfigSchema,
	// Types
	type HTTPTransport,
	type StdioTransport,
	type MCPTransport,
	type MCPServerConfig,
	// Helper functions
	getMCPServerMetadata,
	getAvailableMCPServers,
	buildDefaultMCPConfig,
} from "./providers/mcp.js";
