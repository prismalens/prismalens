import { z } from "zod";

// =============================================================================
// MCP SERVER METADATA
// =============================================================================
// Static metadata for each MCP server type.
// Similar to LLM_PROVIDERS in schemas/llm.ts
// =============================================================================

/**
 * Credential mapping for transport types.
 * Describes how to map IntegrationContext credentials to transport auth.
 */
export interface MCPCredentialMapping {
	http?: {
		headerName: string;
		headerTemplate: string;
	};
	stdio?: {
		envVar: string;
		credentialKey: "accessToken" | "apiKey";
	};
}

/**
 * MCP Server Metadata.
 * Static configuration for each supported MCP server type.
 */
export interface MCPServerMetadata {
	id: string;
	name: string;
	description: string;
	helpUrl: string;
	integrationType: string;
	defaultTransport: "http" | "stdio";
	httpEndpoint: string | null;
	dockerImage: string | null;
	suggestedTools: string[];
	credentialMapping: MCPCredentialMapping;
}

/**
 * MCP Server Metadata Registry.
 * Minimal static info for each supported MCP server.
 * Following the same pattern as LLM_PROVIDERS.
 */
export const MCP_SERVERS = {
	github: {
		id: "github",
		name: "GitHub",
		description:
			"GitHub repository access - files, commits, issues, pull requests",
		helpUrl: "https://github.com/github/github-mcp-server",
		integrationType: "github",
		defaultTransport: "http",
		httpEndpoint: "https://api.githubcopilot.com/mcp/",
		dockerImage: "ghcr.io/github/github-mcp-server",
		suggestedTools: [
			"get_file_contents",
			"search_code",
			"search_repositories",
			"list_commits",
			"get_issue",
			"list_issues",
			"search_issues",
			"get_pull_request",
			"list_pull_requests",
		],
		credentialMapping: {
			http: {
				headerName: "Authorization",
				headerTemplate: "Bearer ${credentials.accessToken}",
			},
			stdio: {
				envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
				credentialKey: "accessToken",
			},
		},
	},
	render: {
		id: "render",
		name: "Render",
		description: "Render.com - logs, deployments, services",
		helpUrl: "https://github.com/render-oss/render-mcp-server",
		integrationType: "render",
		defaultTransport: "http",
		httpEndpoint: "https://mcp.render.com/mcp",
		dockerImage: null,
		suggestedTools: [
			"list_services",
			"get_service",
			"list_deploys",
			"get_deploy",
			"list_logs",
			"get_env_vars",
		],
		credentialMapping: {
			http: {
				headerName: "Authorization",
				headerTemplate: "Bearer ${credentials.apiKey}",
			},
		},
	},
	gitlab: {
		id: "gitlab",
		name: "GitLab",
		description: "GitLab repository access (self-hosted)",
		helpUrl: "https://gitlab.com",
		integrationType: "gitlab",
		defaultTransport: "stdio",
		httpEndpoint: null,
		dockerImage: "registry.gitlab.com/gitlab-org/gitlab-mcp-server",
		suggestedTools: [
			"get_file_contents",
			"search_code",
			"list_commits",
			"get_issue",
			"get_merge_request",
		],
		credentialMapping: {
			stdio: {
				envVar: "GITLAB_TOKEN",
				credentialKey: "accessToken",
			},
		},
	},
} as const satisfies Record<string, MCPServerMetadata>;

export type MCPServerId = keyof typeof MCP_SERVERS;

/**
 * Derive server IDs array for Zod schema.
 * This creates a tuple type required by z.enum().
 */
export const MCP_SERVER_IDS = Object.keys(MCP_SERVERS) as [
	MCPServerId,
	...MCPServerId[],
];

/**
 * Zod schema for MCP server IDs - dynamically derived from MCP_SERVERS.
 * Use this instead of hardcoding server enums.
 */
export const mcpServerIdSchema = z.enum(MCP_SERVER_IDS);

// =============================================================================
// TRANSPORT SCHEMAS
// =============================================================================

/**
 * HTTP transport configuration.
 * Used for hosted MCP servers like GitHub Copilot and Render.
 */
export const httpTransportSchema = z.object({
	type: z.literal("http"),
	url: z.string().url(),
	headers: z.record(z.string()).optional(),
});

export type HTTPTransport = z.infer<typeof httpTransportSchema>;

/**
 * Stdio transport configuration.
 * Used for Docker-based or local MCP servers (e.g., self-hosted GitLab).
 */
export const stdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string(),
	args: z.array(z.string()),
	env: z.record(z.string()).optional(),
	cwd: z.string().optional(),
});

export type StdioTransport = z.infer<typeof stdioTransportSchema>;

/**
 * Discriminated union for MCP transport types.
 */
export const mcpTransportSchema = z.discriminatedUnion("type", [
	httpTransportSchema,
	stdioTransportSchema,
]);

export type MCPTransport = z.infer<typeof mcpTransportSchema>;

// =============================================================================
// MCP CONFIG SCHEMA
// =============================================================================

/**
 * Configuration for a single MCP server.
 */
export const mcpServerConfigSchema = z.object({
	serverId: mcpServerIdSchema,
	enabled: z.boolean().default(true),
	transport: mcpTransportSchema,
	toolFilter: z.array(z.string()).optional(),
	readOnly: z.boolean().default(true),
});

export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build default MCP config for a server using credentials.
 * Creates the appropriate transport based on server defaults.
 *
 * @param serverId - The MCP server ID
 * @param credentials - Credentials from IntegrationContext
 * @returns MCP server config or null if not possible to build
 */
export function buildDefaultMCPConfig(
	serverId: MCPServerId,
	credentials: { accessToken?: string; apiKey?: string },
): MCPServerConfig | null {
	const server = MCP_SERVERS[serverId];
	if (!server) return null;

	// HTTP transport (default for hosted services)
	if (server.defaultTransport === "http" && server.httpEndpoint) {
		const credMapping = server.credentialMapping.http;
		if (!credMapping) return null;

		// Build header value from template
		const token = credentials.accessToken || credentials.apiKey || "";
		const headerValue = credMapping.headerTemplate.replace(
			"${credentials.accessToken}",
			token,
		).replace("${credentials.apiKey}", token);

		return {
			serverId,
			enabled: true,
			transport: {
				type: "http",
				url: server.httpEndpoint,
				headers: {
					[credMapping.headerName]: headerValue,
				},
			},
			toolFilter:
				server.suggestedTools.length > 0
					? [...server.suggestedTools]
					: undefined,
			readOnly: true,
		};
	}

	// Stdio transport (Docker-based for self-hosted)
	if (server.defaultTransport === "stdio" && server.dockerImage) {
		const credMapping = server.credentialMapping.stdio;
		if (!credMapping) return null;

		const token =
			credentials[credMapping.credentialKey as keyof typeof credentials] || "";

		return {
			serverId,
			enabled: true,
			transport: {
				type: "stdio",
				command: "docker",
				args: ["run", "-i", "--rm", "-e", credMapping.envVar, server.dockerImage],
				env: { [credMapping.envVar]: token },
			},
			toolFilter:
				server.suggestedTools.length > 0
					? [...server.suggestedTools]
					: undefined,
			readOnly: true,
		};
	}

	return null;
}

/**
 * Get MCP server metadata by ID.
 *
 * @param serverId - The MCP server ID
 * @returns Server metadata or undefined
 */
export function getMCPServerMetadata(
	serverId: string,
): MCPServerMetadata | undefined {
	return MCP_SERVERS[serverId as MCPServerId];
}

/**
 * Get all available MCP server IDs.
 */
export function getAvailableMCPServers(): MCPServerId[] {
	return [...MCP_SERVER_IDS];
}
