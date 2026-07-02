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
	buildDefaultMCPConfig,
	getAvailableMCPServers,
	// Helper functions
	getMCPServerMetadata,
	// Types
	type HTTPTransport,
	httpTransportSchema,
	MCP_SERVER_IDS,
	// Static metadata
	MCP_SERVERS,
	type MCPCredentialMapping,
	type MCPServerConfig,
	type MCPServerId,
	type MCPServerMetadata,
	type MCPTransport,
	mcpServerConfigSchema,
	// Zod schemas
	mcpServerIdSchema,
	mcpTransportSchema,
	type StdioTransport,
	stdioTransportSchema,
} from "./providers/mcp.js";
