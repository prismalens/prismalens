import type { ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Logger } from "@prismalens/logger";

const logger = new Logger({ context: "MCPClient" });

// =============================================================================
// MCP CLIENT WRAPPER
// =============================================================================
// Manages connections to MCP servers for code analysis during investigations.
// MCP servers are spawned via npx and communicate via stdio.
// =============================================================================

/**
 * Configuration for an MCP server.
 */
export interface MCPServerConfig {
	/** Unique identifier for this server */
	id: string;

	/** Display name */
	name: string;

	/** NPX command or path to executable */
	command: string;

	/** Command arguments */
	args: string[];

	/** Environment variables to pass */
	env?: Record<string, string>;

	/** Working directory for the server */
	cwd?: string;
}

/**
 * Configuration for all MCP servers.
 */
export interface MCPConfig {
	/** Code Pathfinder for call graph analysis */
	codePathfinder?: {
		enabled: boolean;
		projectPath?: string;
	};

	/** Code Index for multi-language AST indexing */
	codeIndex?: {
		enabled: boolean;
		projectPath?: string;
	};

	/** Ripgrep for fast text search */
	ripgrep?: {
		enabled: boolean;
		baseDir?: string;
	};
}

/**
 * Connected MCP client with process reference.
 */
export interface MCPConnection {
	/** MCP client instance */
	client: Client;

	/** Server configuration */
	config: MCPServerConfig;

	/** Underlying process (if spawned) */
	process?: ChildProcess;

	/** Connection status */
	connected: boolean;
}

/**
 * MCP Client Manager - handles connections to multiple MCP servers.
 */
export class MCPClientManager {
	private connections: Map<string, MCPConnection> = new Map();
	private config: MCPConfig;

	constructor(config: MCPConfig) {
		this.config = config;
	}

	/**
	 * Connect to all configured MCP servers.
	 */
	async connectAll(): Promise<void> {
		const serverConfigs = this.buildServerConfigs();

		for (const serverConfig of serverConfigs) {
			try {
				await this.connect(serverConfig);
			} catch (error) {
				logger.error(`Failed to connect to MCP server ${serverConfig.id}`, {
					error,
				});
			}
		}
	}

	/**
	 * Connect to a specific MCP server.
	 */
	async connect(serverConfig: MCPServerConfig): Promise<MCPConnection | null> {
		const existingConnection = this.connections.get(serverConfig.id);
		if (existingConnection) {
			return existingConnection;
		}

		try {
			logger.info(`Connecting to MCP server: ${serverConfig.name}`, {
				command: serverConfig.command,
				args: serverConfig.args,
			});

			// Filter out undefined values from process.env
			const envVars: Record<string, string> = {};
			for (const [key, value] of Object.entries(process.env)) {
				if (value !== undefined) {
					envVars[key] = value;
				}
			}
			if (serverConfig.env) {
				Object.assign(envVars, serverConfig.env);
			}

			const transport = new StdioClientTransport({
				command: serverConfig.command,
				args: serverConfig.args,
				env: envVars,
				cwd: serverConfig.cwd,
			});

			const client = new Client(
				{
					name: `prismalens-agent-${serverConfig.id}`,
					version: "1.0.0",
				},
				{
					capabilities: {},
				},
			);

			await client.connect(transport);

			const connection: MCPConnection = {
				client,
				config: serverConfig,
				connected: true,
			};

			this.connections.set(serverConfig.id, connection);

			logger.info(`Connected to MCP server: ${serverConfig.name}`);

			return connection;
		} catch (error) {
			logger.error(`Failed to connect to MCP server: ${serverConfig.name}`, {
				error,
			});
			return null;
		}
	}

	/**
	 * Get a connected client by server ID.
	 */
	getClient(serverId: string): Client | null {
		const connection = this.connections.get(serverId);
		return connection?.connected ? connection.client : null;
	}

	/**
	 * List tools available from a specific server.
	 */
	async listTools(
		serverId: string,
	): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
		const client = this.getClient(serverId);
		if (!client) {
			logger.warn(`MCP server not connected: ${serverId}`);
			return [];
		}

		try {
			const response = await client.listTools();
			return response.tools.map(
				(tool: {
					name: string;
					description?: string;
					inputSchema: unknown;
				}) => ({
					name: tool.name,
					description: tool.description || "",
					inputSchema: tool.inputSchema,
				}),
			);
		} catch (error) {
			logger.error(`Failed to list tools from ${serverId}`, { error });
			return [];
		}
	}

	/**
	 * Call a tool on a specific server.
	 */
	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		const client = this.getClient(serverId);
		if (!client) {
			throw new Error(`MCP server not connected: ${serverId}`);
		}

		try {
			logger.debug(`Calling MCP tool: ${serverId}/${toolName}`, { args });

			const result = await client.callTool({
				name: toolName,
				arguments: args,
			});

			return result.content;
		} catch (error) {
			logger.error(`Failed to call tool ${serverId}/${toolName}`, {
				error,
				args,
			});
			throw error;
		}
	}

	/**
	 * Disconnect from all servers.
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
	}

	/**
	 * Check if a specific server is connected.
	 */
	isConnected(serverId: string): boolean {
		return this.connections.get(serverId)?.connected ?? false;
	}

	/**
	 * Get all connected server IDs.
	 */
	getConnectedServers(): string[] {
		return Array.from(this.connections.keys()).filter(
			(id) => this.connections.get(id)?.connected,
		);
	}

	/**
	 * Build server configurations from MCPConfig.
	 */
	private buildServerConfigs(): MCPServerConfig[] {
		const configs: MCPServerConfig[] = [];

		if (this.config.codePathfinder?.enabled) {
			configs.push({
				id: "code-pathfinder",
				name: "Code Pathfinder",
				command: "npx",
				args: [
					"-y",
					"@anthropic/code-pathfinder-mcp",
					...(this.config.codePathfinder.projectPath
						? ["--project", this.config.codePathfinder.projectPath]
						: []),
				],
				cwd: this.config.codePathfinder.projectPath,
			});
		}

		if (this.config.codeIndex?.enabled) {
			configs.push({
				id: "code-index",
				name: "Code Index MCP",
				command: "npx",
				args: [
					"-y",
					"code-index-mcp",
					...(this.config.codeIndex.projectPath
						? ["--path", this.config.codeIndex.projectPath]
						: []),
				],
				cwd: this.config.codeIndex.projectPath,
			});
		}

		if (this.config.ripgrep?.enabled) {
			configs.push({
				id: "ripgrep",
				name: "MCP Ripgrep",
				command: "npx",
				args: ["-y", "mcp-ripgrep"],
				cwd: this.config.ripgrep.baseDir,
			});
		}

		return configs;
	}
}

/**
 * Create MCP client manager from environment configuration.
 */
export function createMCPClientManager(envConfig: {
	PRISMALENS_MCP_CODE_PATHFINDER_ENABLED?: boolean;
	PRISMALENS_MCP_CODE_PATHFINDER_PROJECT_PATH?: string;
	PRISMALENS_MCP_CODE_INDEX_ENABLED?: boolean;
	PRISMALENS_MCP_CODE_INDEX_PROJECT_PATH?: string;
	PRISMALENS_MCP_RIPGREP_ENABLED?: boolean;
	PRISMALENS_MCP_RIPGREP_BASE_DIR?: string;
}): MCPClientManager {
	const config: MCPConfig = {
		codePathfinder: {
			enabled: envConfig.PRISMALENS_MCP_CODE_PATHFINDER_ENABLED ?? false,
			projectPath: envConfig.PRISMALENS_MCP_CODE_PATHFINDER_PROJECT_PATH,
		},
		codeIndex: {
			enabled: envConfig.PRISMALENS_MCP_CODE_INDEX_ENABLED ?? false,
			projectPath: envConfig.PRISMALENS_MCP_CODE_INDEX_PROJECT_PATH,
		},
		ripgrep: {
			enabled: envConfig.PRISMALENS_MCP_RIPGREP_ENABLED ?? false,
			baseDir: envConfig.PRISMALENS_MCP_RIPGREP_BASE_DIR,
		},
	};

	return new MCPClientManager(config);
}

/**
 * Create MCP clients and connect to all enabled servers.
 * Returns a manager that can be used to call tools.
 */
export async function createMCPClients(envConfig: {
	PRISMALENS_MCP_CODE_PATHFINDER_ENABLED?: boolean;
	PRISMALENS_MCP_CODE_PATHFINDER_PROJECT_PATH?: string;
	PRISMALENS_MCP_CODE_INDEX_ENABLED?: boolean;
	PRISMALENS_MCP_CODE_INDEX_PROJECT_PATH?: string;
	PRISMALENS_MCP_RIPGREP_ENABLED?: boolean;
	PRISMALENS_MCP_RIPGREP_BASE_DIR?: string;
}): Promise<MCPClientManager> {
	const manager = createMCPClientManager(envConfig);
	await manager.connectAll();
	return manager;
}
