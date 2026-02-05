import type { StructuredTool } from "@langchain/core/tools";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	MCP_SERVERS,
	type MCPServerConfig,
	type MCPServerId,
	type MCPTransport,
} from "@prismalens/config";
import { Logger } from "@prismalens/logger";
import { z } from "zod";
import type { IntegrationContext } from "../../../types/index.js";
import {
	appendRateLimitWarning,
	createRateLimiter,
	type RateLimiter,
} from "../../rate-limiter.js";
import type {
	BundleExecutionContext,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
} from "../types.js";

// =============================================================================
// MCP BUNDLE SOURCE
// =============================================================================
// Implements ToolBundleSource for deferred MCP server connections.
// MCP servers are only spawned when a bundle is actually loaded (agent enables it).
// Supports both HTTP (hosted) and stdio (Docker) transports.
// =============================================================================

const logger = new Logger({ context: "MCPBundleSource" });

/**
 * Definition for an MCP-based tool bundle.
 * Now uses MCPTransport from @prismalens/config for transport configuration.
 */
export interface MCPBundleDefinition {
	/** Unique bundle name (e.g., "github-mcp") */
	name: string;

	/** Category for grouping (e.g., "github", "render") */
	category: string;

	/** Human-readable description */
	description: string;

	/** MCP server identifier (matches MCPServerId from config) */
	serverId: MCPServerId;

	/** Transport configuration (http or stdio) */
	transport: MCPTransport;

	/** Integration type for credential lookup */
	integrationType?: string;

	/**
	 * Tool names to expose from this bundle.
	 * If specified, only these tools will be available.
	 * If not specified, all tools from the server are exposed.
	 */
	toolFilter?: string[];

	/** Whether all tools in this bundle are read-only */
	readOnly: boolean;

	/** Estimated token cost */
	estimatedTokens?: number;

	/** Keywords for search matching */
	keywords?: string[];

	/** Use cases - when should an agent load this bundle? */
	useCases?: string[];
}

/**
 * Connected MCP server.
 */
interface MCPConnection {
	client: Client;
	serverId: string;
	connected: boolean;
}

/**
 * Configuration for MCPBundleSource.
 */
export interface MCPBundleSourceConfig {
	/** Bundle definitions to register */
	definitions: MCPBundleDefinition[];

	/** Optional rate limiter (shared across bundles) */
	rateLimiter?: RateLimiter;
}

/**
 * Bundle source for MCP-based tools with deferred connection.
 *
 * Key design:
 * - `listBundles()` returns metadata from static definitions (NO connection)
 * - `loadBundle()` spawns the MCP server on first load (deferred)
 * - Connections are cached and shared between bundles with same serverId
 * - Supports both HTTP (hosted) and stdio (Docker) transports
 */
export class MCPBundleSource implements ToolBundleSource {
	readonly name = "mcp";

	private definitions: Map<string, MCPBundleDefinition> = new Map();
	private connections: Map<string, MCPConnection> = new Map();
	private toolCache: Map<string, StructuredTool[]> = new Map();
	private rateLimiter: RateLimiter;

	constructor(config: MCPBundleSourceConfig) {
		for (const def of config.definitions) {
			this.definitions.set(def.name, def);
		}
		this.rateLimiter = config.rateLimiter ?? createRateLimiter();

		logger.debug(
			`Initialized with ${this.definitions.size} MCP bundle definitions`,
		);
	}

	/**
	 * List all available bundles.
	 * Returns pre-defined metadata WITHOUT connecting to MCP servers.
	 */
	async listBundles(): Promise<ToolBundleMetadata[]> {
		const metadata: ToolBundleMetadata[] = [];

		for (const def of this.definitions.values()) {
			metadata.push({
				name: def.name,
				category: def.category,
				description: def.description,
				// Use pre-defined tool names from toolFilter
				operations: def.toolFilter || [],
				readOnly: def.readOnly,
				estimatedTokens: def.estimatedTokens,
				keywords: def.keywords,
				useCases: def.useCases,
				source: this.name,
			});
		}

		return metadata;
	}

	/**
	 * Load a bundle by name.
	 * This triggers the MCP server connection (deferred loading).
	 */
	async loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null> {
		const def = this.definitions.get(name);
		if (!def) {
			logger.warn(`MCP bundle not found: ${name}`);
			return null;
		}

		logger.info(`Loading MCP bundle: ${name}`);

		return {
			metadata: {
				name: def.name,
				category: def.category,
				description: def.description,
				operations: def.toolFilter || [],
				readOnly: def.readOnly,
				estimatedTokens: def.estimatedTokens,
				keywords: def.keywords,
				useCases: def.useCases,
				source: this.name,
			},
			createTools: (ctx: BundleExecutionContext): StructuredTool[] => {
				// Note: createTools is synchronous in the interface, but we need async
				// The tools themselves handle the async connection internally
				return this.createToolsSync(def, ctx);
			},
		};
	}

	/**
	 * Create tools synchronously (connection happens on first tool call).
	 * This is a workaround for the synchronous createTools interface.
	 */
	private createToolsSync(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): StructuredTool[] {
		// Check cache first
		const cacheKey = `${def.name}:${ctx.agentName}`;
		if (this.toolCache.has(cacheKey)) {
			return this.toolCache.get(cacheKey)!;
		}

		// Create placeholder tools that connect on first call
		const tools = this.createLazyTools(def, ctx);
		this.toolCache.set(cacheKey, tools);

		return tools;
	}

	/**
	 * Create tools that lazily connect to MCP server on first invocation.
	 */
	private createLazyTools(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): StructuredTool[] {
		// If we don't have a tool filter, we can't know tool names upfront
		// In this case, we create a single "proxy" tool that discovers tools on first call
		if (!def.toolFilter || def.toolFilter.length === 0) {
			return [this.createDiscoveryTool(def, ctx)];
		}

		// Create a tool for each filtered tool name
		return def.toolFilter.map((toolName) =>
			this.createLazyTool(def, ctx, toolName),
		);
	}

	/**
	 * Create a single lazy tool that connects on first call.
	 */
	private createLazyTool(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
		toolName: string,
	): StructuredTool {
		// We'll discover the actual schema on first call
		// For now, use a generic schema that accepts any arguments
		return new DynamicStructuredTool({
			name: toolName,
			description: `[MCP:${def.serverId}] Tool from ${def.name} bundle. Schema will be discovered on first call.`,
			schema: z.record(z.unknown()).describe("Arguments for the tool"),
			func: async (args: Record<string, unknown>) => {
				try {
					const connection = await this.ensureConnection(def, ctx);
					if (!connection) {
						return `Error: Failed to connect to MCP server ${def.serverId}`;
					}

					// Execute with rate limiting
					const result = await this.rateLimiter.executeWithRateLimit(
						def.serverId,
						async () => {
							const response = await connection.client.callTool({
								name: toolName,
								arguments: args,
							});
							return response.content;
						},
					);

					const formatted = this.formatMCPResult(result.result);
					return appendRateLimitWarning(formatted, result.warning);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					logger.error(`MCP tool call failed: ${toolName}`, { error, args });
					return `Error calling ${toolName}: ${message}`;
				}
			},
		});
	}

	/**
	 * Create a discovery tool for bundles without predefined tool list.
	 */
	private createDiscoveryTool(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): StructuredTool {
		return new DynamicStructuredTool({
			name: `${def.name}_discover`,
			description: `Discover available tools from ${def.name} MCP server.`,
			schema: z.object({}),
			func: async () => {
				try {
					const connection = await this.ensureConnection(def, ctx);
					if (!connection) {
						return `Error: Failed to connect to MCP server ${def.serverId}`;
					}

					const mcpTools = await connection.client.listTools();
					const toolList = mcpTools.tools
						.map((t) => `- ${t.name}: ${t.description || "No description"}`)
						.join("\n");

					return `Available tools from ${def.name}:\n${toolList}`;
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return `Error discovering tools: ${message}`;
				}
			},
		});
	}

	/**
	 * Ensure a connection to the MCP server exists.
	 * Creates connection on first call (deferred).
	 * Supports both HTTP and stdio transports.
	 */
	private async ensureConnection(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): Promise<MCPConnection | null> {
		// Check if already connected
		if (this.connections.has(def.serverId)) {
			const existing = this.connections.get(def.serverId)!;
			if (existing.connected) {
				return existing;
			}
		}

		logger.info(`Connecting to MCP server: ${def.serverId} (${def.transport.type})`);

		try {
			// Create transport based on type
			const transport = await this.createTransport(def, ctx);
			if (!transport) {
				logger.error(`Failed to create transport for ${def.serverId}`);
				return null;
			}

			// Create and connect client
			const client = new Client(
				{
					name: `prismalens-${def.serverId}`,
					version: "1.0.0",
				},
				{
					capabilities: {},
				},
			);

			await client.connect(transport);

			const connection: MCPConnection = {
				client,
				serverId: def.serverId,
				connected: true,
			};

			this.connections.set(def.serverId, connection);
			logger.info(`Connected to MCP server: ${def.serverId}`);

			return connection;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to connect to MCP server: ${def.serverId}`, {
				error,
			});
			return null;
		}
	}

	/**
	 * Create transport based on configuration.
	 * Supports HTTP (StreamableHTTPClientTransport) and stdio (StdioClientTransport).
	 */
	private async createTransport(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): Promise<{ start: () => Promise<void>; send: (message: unknown) => Promise<void>; close: () => Promise<void> } | null> {
		const transport = def.transport;

		if (transport.type === "http") {
			return this.createHTTPTransport(def, ctx, transport) as Promise<{ start: () => Promise<void>; send: (message: unknown) => Promise<void>; close: () => Promise<void> }>;
		}

		if (transport.type === "stdio") {
			return this.createStdioTransport(def, ctx, transport) as unknown as { start: () => Promise<void>; send: (message: unknown) => Promise<void>; close: () => Promise<void> };
		}

		logger.error(`Unknown transport type for ${def.serverId}`);
		return null;
	}

	/**
	 * Create HTTP transport for hosted MCP servers.
	 */
	private async createHTTPTransport(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
		transport: { type: "http"; url: string; headers?: Record<string, string> },
	): Promise<unknown> {
		// Build headers from integration credentials
		const headers = this.buildHTTPHeaders(def, ctx, transport.headers);

		// Dynamic import of StreamableHTTPClientTransport
		const { StreamableHTTPClientTransport } = await import(
			"@modelcontextprotocol/sdk/client/streamableHttp.js"
		);

		logger.debug(`Creating HTTP transport for ${def.serverId}: ${transport.url}`);

		return new StreamableHTTPClientTransport(new URL(transport.url), {
			requestInit: { headers },
		});
	}

	/**
	 * Create stdio transport for Docker-based MCP servers.
	 */
	private createStdioTransport(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
		transport: {
			type: "stdio";
			command: string;
			args: string[];
			env?: Record<string, string>;
			cwd?: string;
		},
	): StdioClientTransport {
		// Build environment variables from integration credentials
		const credentialEnv = this.buildEnvFromContext(def, ctx);

		// Filter out undefined values from process.env
		const processEnv: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				processEnv[key] = value;
			}
		}

		logger.debug(`Creating stdio transport for ${def.serverId}: ${transport.command}`);

		return new StdioClientTransport({
			command: transport.command,
			args: transport.args,
			env: { ...processEnv, ...transport.env, ...credentialEnv },
			cwd: transport.cwd,
		});
	}

	/**
	 * Build HTTP headers from integration credentials.
	 */
	private buildHTTPHeaders(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
		existingHeaders?: Record<string, string>,
	): Record<string, string> {
		const headers: Record<string, string> = { ...existingHeaders };

		if (!def.integrationType) {
			return headers;
		}

		// Find matching integration
		const integration = ctx.integrations.find(
			(i) => i.type.toLowerCase() === def.integrationType?.toLowerCase(),
		);

		if (!integration) {
			logger.warn(
				`No ${def.integrationType} integration found for ${def.name}`,
			);
			return headers;
		}

		// Get credential mapping from MCP_SERVERS config
		const serverConfig = MCP_SERVERS[def.serverId];
		const credentialMapping = serverConfig?.credentialMapping as {
			http?: { headerName: string; headerTemplate: string };
			stdio?: { envVar: string; credentialKey: string };
		} | undefined;

		if (credentialMapping?.http) {
			const httpMapping = credentialMapping.http;
			const credentials = integration.credentials as Record<string, string | undefined>;
			const token: string = credentials.accessToken || credentials.apiKey || "";
			const template: string = httpMapping.headerTemplate;
			const headerValue = template
				.replace("${credentials.accessToken}", token)
				.replace("${credentials.apiKey}", token);
			headers[httpMapping.headerName] = headerValue;
		}

		return headers;
	}

	/**
	 * Build environment variables from integration credentials.
	 */
	private buildEnvFromContext(
		def: MCPBundleDefinition,
		ctx: BundleExecutionContext,
	): Record<string, string> {
		const env: Record<string, string> = {};

		if (!def.integrationType) {
			return env;
		}

		// Find matching integration
		const integration = ctx.integrations.find(
			(i) => i.type.toLowerCase() === def.integrationType?.toLowerCase(),
		);

		if (!integration) {
			logger.warn(
				`No ${def.integrationType} integration found for ${def.name}`,
			);
			return env;
		}

		// Get credential mapping from MCP_SERVERS config
		const serverConfig = MCP_SERVERS[def.serverId];
		const credentialMapping = serverConfig?.credentialMapping as {
			http?: { headerName: string; headerTemplate: string };
			stdio?: { envVar: string; credentialKey: string };
		} | undefined;

		if (credentialMapping?.stdio) {
			const stdioMapping = credentialMapping.stdio;
			const credentials = integration.credentials as Record<string, string | undefined>;
			const token: string = credentials[stdioMapping.credentialKey] || "";
			env[stdioMapping.envVar] = token;
		}

		return env;
	}

	/**
	 * Format MCP result for display.
	 */
	private formatMCPResult(result: unknown): string {
		if (typeof result === "string") {
			return result;
		}

		if (Array.isArray(result)) {
			// MCP typically returns an array of content blocks
			return result
				.map((item) => {
					if (typeof item === "object" && item !== null) {
						const content = item as { type?: string; text?: string };
						if (content.type === "text" && content.text) {
							return content.text;
						}
					}
					return JSON.stringify(item);
				})
				.join("\n");
		}

		return JSON.stringify(result, null, 2);
	}

	/**
	 * Disconnect from all MCP servers.
	 */
	async disconnectAll(): Promise<void> {
		for (const [serverId, connection] of this.connections) {
			try {
				await connection.client.close();
				logger.info(`Disconnected from MCP server: ${serverId}`);
			} catch (error) {
				logger.warn(`Error disconnecting from ${serverId}`, { error });
			}
		}
		this.connections.clear();
		this.toolCache.clear();
	}

	/**
	 * Check if a server is connected.
	 */
	isConnected(serverId: string): boolean {
		return this.connections.get(serverId)?.connected ?? false;
	}

	/**
	 * Register additional bundle definitions.
	 */
	registerBundle(def: MCPBundleDefinition): void {
		this.definitions.set(def.name, def);
		logger.debug(`Registered MCP bundle: ${def.name}`);
	}
}

/**
 * Create an MCP bundle source from definitions.
 */
export function createMCPBundleSource(
	definitions: MCPBundleDefinition[],
	rateLimiter?: RateLimiter,
): MCPBundleSource {
	return new MCPBundleSource({ definitions, rateLimiter });
}

// =============================================================================
// CONFIG-BASED BUNDLE FACTORY
// =============================================================================

/**
 * Create an MCP bundle definition from server config.
 * Reads metadata from MCP_SERVERS in @prismalens/config.
 *
 * @param serverConfig - MCPServerConfig from user settings or defaults
 * @returns MCPBundleDefinition for use with MCPBundleSource
 */
export function createMCPBundleFromConfig(
	serverConfig: MCPServerConfig,
): MCPBundleDefinition {
	const metadata = MCP_SERVERS[serverConfig.serverId];

	return {
		name: `${serverConfig.serverId}-mcp`,
		category: serverConfig.serverId,
		description: metadata.description,
		serverId: serverConfig.serverId,
		transport: serverConfig.transport,
		integrationType: metadata.integrationType,
		toolFilter: serverConfig.toolFilter,
		readOnly: serverConfig.readOnly,
		estimatedTokens: 950,
		keywords: [serverConfig.serverId, ...metadata.suggestedTools.slice(0, 3)],
		useCases: [`Access ${metadata.name} via MCP`],
	};
}

// =============================================================================
// PRE-DEFINED MCP BUNDLE DEFINITIONS
// =============================================================================
// Using HTTP transport as default for hosted services.
// =============================================================================

/**
 * GitHub MCP Server bundle definition (read-only) - HTTP transport.
 */
export const GITHUB_MCP_BUNDLE: MCPBundleDefinition = {
	name: "github-mcp",
	category: "github",
	description:
		"GitHub repository exploration - files, search, commits, issues, pull requests",
	serverId: "github",
	transport: {
		type: "http",
		url: MCP_SERVERS.github.httpEndpoint!,
	},
	integrationType: "github",
	toolFilter: MCP_SERVERS.github.suggestedTools as unknown as string[],
	readOnly: true,
	estimatedTokens: 1200,
	keywords: ["github", "code", "repository", "git", "commits", "files", "issues"],
	useCases: [
		"Reading source code from repositories",
		"Searching for code patterns",
		"Viewing commit history",
		"Checking issues and pull requests",
	],
};

/**
 * GitHub MCP Server bundle definition (write operations) - HTTP transport.
 */
export const GITHUB_MCP_WRITE_BUNDLE: MCPBundleDefinition = {
	name: "github-mcp-write",
	category: "github",
	description: "GitHub write operations - create issues, PRs, comments",
	serverId: "github",
	transport: {
		type: "http",
		url: MCP_SERVERS.github.httpEndpoint!,
	},
	integrationType: "github",
	toolFilter: [
		"create_issue",
		"create_pull_request",
		"create_issue_comment",
		"update_issue",
	],
	readOnly: false,
	estimatedTokens: 800,
	keywords: ["github", "create", "issue", "pr", "comment", "write"],
	useCases: [
		"Creating issues for bugs found",
		"Creating pull requests with fixes",
		"Adding comments to issues",
	],
};

/**
 * Render MCP Server bundle definition - HTTP transport.
 */
export const RENDER_MCP_BUNDLE: MCPBundleDefinition = {
	name: "render-mcp",
	category: "render",
	description: "Render.com monitoring - logs, deployments, services",
	serverId: "render",
	transport: {
		type: "http",
		url: MCP_SERVERS.render.httpEndpoint!,
	},
	integrationType: "render",
	toolFilter: MCP_SERVERS.render.suggestedTools as unknown as string[],
	readOnly: true,
	estimatedTokens: 950,
	keywords: ["render", "logs", "deployment", "services", "monitoring", "hosting"],
	useCases: [
		"Investigating production errors via logs",
		"Correlating incidents with deployments",
		"Checking service health and status",
	],
};

/**
 * GitLab MCP Server bundle definition - stdio/Docker transport.
 * For self-hosted GitLab instances.
 */
export const GITLAB_MCP_BUNDLE: MCPBundleDefinition = {
	name: "gitlab-mcp",
	category: "gitlab",
	description: "GitLab repository access - files, commits, issues, merge requests (self-hosted)",
	serverId: "gitlab",
	transport: {
		type: "stdio",
		command: "docker",
		args: [
			"run",
			"-i",
			"--rm",
			"-e",
			"GITLAB_TOKEN",
			MCP_SERVERS.gitlab.dockerImage!,
		],
	},
	integrationType: "gitlab",
	toolFilter: MCP_SERVERS.gitlab.suggestedTools as unknown as string[],
	readOnly: true,
	estimatedTokens: 1000,
	keywords: ["gitlab", "code", "repository", "git", "commits", "merge-request"],
	useCases: [
		"Reading source code from GitLab repositories",
		"Searching for code patterns",
		"Viewing commit history",
		"Checking issues and merge requests",
	],
};

/**
 * Default MCP bundle definitions.
 * Includes HTTP-based bundles for GitHub and Render.
 */
export const DEFAULT_MCP_BUNDLES: MCPBundleDefinition[] = [
	GITHUB_MCP_BUNDLE,
	GITHUB_MCP_WRITE_BUNDLE,
	RENDER_MCP_BUNDLE,
	// GitLab is opt-in (requires Docker and self-hosted setup)
	// GITLAB_MCP_BUNDLE,
];
