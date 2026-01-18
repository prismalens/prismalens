import type { StructuredTool } from "@langchain/core/tools";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import { z } from "zod";
import type { MCPClientManager } from "../../mcp/client.js";

const logger = new Logger({ context: "MCPTools" });

// =============================================================================
// MCP TOOLS
// =============================================================================
// Creates LangChain tools that wrap MCP server capabilities.
// Tools are dynamically created based on connected MCP servers.
// =============================================================================

/**
 * Create LangChain tools from connected MCP servers.
 * Tools are wrapped to handle MCP communication transparently.
 */
export async function createMCPTools(
	mcpManager: MCPClientManager,
): Promise<StructuredTool[]> {
	const tools: StructuredTool[] = [];

	// Create tools for each connected server
	const connectedServers = mcpManager.getConnectedServers();

	for (const serverId of connectedServers) {
		const serverTools = await createToolsForServer(mcpManager, serverId);
		tools.push(...serverTools);
	}

	return tools;
}

/**
 * Create LangChain tools for a specific MCP server.
 */
async function createToolsForServer(
	mcpManager: MCPClientManager,
	serverId: string,
): Promise<StructuredTool[]> {
	const tools: StructuredTool[] = [];

	try {
		const mcpTools = await mcpManager.listTools(serverId);

		for (const mcpTool of mcpTools) {
			const tool = createLangChainTool(mcpManager, serverId, mcpTool);
			if (tool) {
				tools.push(tool);
			}
		}

		logger.info(`Created ${tools.length} tools from MCP server: ${serverId}`);
	} catch (error) {
		logger.error(`Failed to create tools for ${serverId}`, { error });
	}

	return tools;
}

/**
 * Create a single LangChain tool from an MCP tool definition.
 */
function createLangChainTool(
	mcpManager: MCPClientManager,
	serverId: string,
	mcpTool: { name: string; description: string; inputSchema: unknown },
): StructuredTool | null {
	try {
		// Convert JSON Schema to Zod schema
		const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);

		// Create tool with prefixed name to avoid conflicts
		const toolName = `mcp_${serverId.replace(/-/g, "_")}_${mcpTool.name}`;

		return new DynamicStructuredTool({
			name: toolName,
			description: `[MCP:${serverId}] ${mcpTool.description}`,
			schema: zodSchema,
			func: async (args: Record<string, unknown>) => {
				try {
					const result = await mcpManager.callTool(
						serverId,
						mcpTool.name,
						args,
					);
					return formatMCPResult(result);
				} catch (error) {
					logger.error(`MCP tool call failed: ${toolName}`, { error, args });
					return `Error: ${error instanceof Error ? error.message : String(error)}`;
				}
			},
		});
	} catch (error) {
		logger.warn(`Failed to create tool: ${mcpTool.name}`, { error });
		return null;
	}
}

/**
 * Convert JSON Schema to Zod schema.
 * This is a simplified converter - handles common cases.
 */
function jsonSchemaToZod(
	jsonSchema: unknown,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
	if (!jsonSchema || typeof jsonSchema !== "object") {
		return z.object({});
	}

	const schema = jsonSchema as Record<string, unknown>;
	const properties = schema.properties as Record<string, unknown> | undefined;
	const required = (schema.required as string[]) || [];

	if (!properties) {
		return z.object({});
	}

	const zodShape: Record<string, z.ZodTypeAny> = {};

	for (const [key, propSchema] of Object.entries(properties)) {
		const prop = propSchema as Record<string, unknown>;
		const isRequired = required.includes(key);
		let zodType: z.ZodTypeAny;

		switch (prop.type) {
			case "string":
				zodType = z.string();
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
				break;

			case "number":
			case "integer":
				zodType = z.number();
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
				break;

			case "boolean":
				zodType = z.boolean();
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
				break;

			case "array": {
				const itemSchema = prop.items as Record<string, unknown> | undefined;
				if (itemSchema?.type === "string") {
					zodType = z.array(z.string());
				} else if (
					itemSchema?.type === "number" ||
					itemSchema?.type === "integer"
				) {
					zodType = z.array(z.number());
				} else {
					zodType = z.array(z.unknown());
				}
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
				break;
			}

			case "object":
				zodType = z.record(z.unknown());
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
				break;

			default:
				zodType = z.unknown();
				if (prop.description) {
					zodType = zodType.describe(prop.description as string);
				}
		}

		zodShape[key] = isRequired ? zodType : zodType.optional();
	}

	return z.object(zodShape);
}

/**
 * Format MCP result for display.
 */
function formatMCPResult(result: unknown): string {
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

// =============================================================================
// SPECIALIZED TOOL FACTORIES
// =============================================================================
// Pre-defined tools for specific MCP servers with better typing.
// =============================================================================

/**
 * Create Code Pathfinder tools (call graph analysis).
 */
export function createCodePathfinderTools(
	mcpManager: MCPClientManager,
): StructuredTool[] {
	if (!mcpManager.isConnected("code-pathfinder")) {
		return [];
	}

	return [
		new DynamicStructuredTool({
			name: "mcp_get_callers",
			description:
				"Find all functions that call a given function (reverse call graph). Use this to trace how an error might propagate.",
			schema: z.object({
				functionName: z
					.string()
					.describe("Name of the function to find callers for"),
				depth: z
					.number()
					.optional()
					.default(2)
					.describe("How many levels deep to search"),
			}),
			func: async ({ functionName, depth }) => {
				const result = await mcpManager.callTool(
					"code-pathfinder",
					"get_callers",
					{
						function: functionName,
						depth,
					},
				);
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_get_callees",
			description:
				"Find all functions called by a given function (forward call graph). Use this to understand what a function depends on.",
			schema: z.object({
				functionName: z
					.string()
					.describe("Name of the function to find callees for"),
				depth: z
					.number()
					.optional()
					.default(2)
					.describe("How many levels deep to search"),
			}),
			func: async ({ functionName, depth }) => {
				const result = await mcpManager.callTool(
					"code-pathfinder",
					"get_callees",
					{
						function: functionName,
						depth,
					},
				);
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_find_symbol",
			description: "Locate a function, class, or symbol in the codebase.",
			schema: z.object({
				symbolName: z.string().describe("Name of the symbol to find"),
			}),
			func: async ({ symbolName }) => {
				const result = await mcpManager.callTool(
					"code-pathfinder",
					"find_symbol",
					{
						name: symbolName,
					},
				);
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_resolve_import",
			description: "Resolve import paths to find actual file locations.",
			schema: z.object({
				importPath: z.string().describe("The import path to resolve"),
				fromFile: z
					.string()
					.optional()
					.describe("File where the import is used"),
			}),
			func: async ({ importPath, fromFile }) => {
				const result = await mcpManager.callTool(
					"code-pathfinder",
					"resolve_import",
					{
						import: importPath,
						from: fromFile,
					},
				);
				return formatMCPResult(result);
			},
		}),
	];
}

/**
 * Create Code Index tools (multi-language AST indexing).
 */
export function createCodeIndexTools(
	mcpManager: MCPClientManager,
): StructuredTool[] {
	if (!mcpManager.isConnected("code-index")) {
		return [];
	}

	return [
		new DynamicStructuredTool({
			name: "mcp_search_code_advanced",
			description:
				"Smart code search with regex, fuzzy matching, and file filtering. Better than grep for semantic code search.",
			schema: z.object({
				query: z.string().describe("Search query or pattern"),
				regex: z
					.boolean()
					.optional()
					.default(false)
					.describe("Use regex matching"),
				filePattern: z
					.string()
					.optional()
					.describe("Glob pattern to filter files (e.g., '*.ts')"),
			}),
			func: async ({ query, regex, filePattern }) => {
				const result = await mcpManager.callTool(
					"code-index",
					"search_code_advanced",
					{
						query,
						regex,
						file_pattern: filePattern,
					},
				);
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_get_file_summary",
			description:
				"Analyze file structure: functions, imports, complexity. Use to understand a file before diving in.",
			schema: z.object({
				filePath: z.string().describe("Path to the file to analyze"),
			}),
			func: async ({ filePath }) => {
				const result = await mcpManager.callTool(
					"code-index",
					"get_file_summary",
					{
						path: filePath,
					},
				);
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_build_deep_index",
			description:
				"Build full symbol index for deep analysis. Run this once per project for faster subsequent searches.",
			schema: z.object({
				path: z.string().optional().describe("Project path to index"),
			}),
			func: async ({ path }) => {
				const result = await mcpManager.callTool(
					"code-index",
					"build_deep_index",
					{
						path,
					},
				);
				return formatMCPResult(result);
			},
		}),
	];
}

/**
 * Create Ripgrep tools (fast text search).
 */
export function createRipgrepTools(
	mcpManager: MCPClientManager,
): StructuredTool[] {
	if (!mcpManager.isConnected("ripgrep")) {
		return [];
	}

	return [
		new DynamicStructuredTool({
			name: "mcp_search_pattern",
			description:
				"Fast text/regex search using ripgrep. Great for finding error messages, log patterns, or specific strings.",
			schema: z.object({
				pattern: z.string().describe("Pattern to search for (supports regex)"),
				directory: z.string().optional().describe("Directory to search in"),
				fileType: z
					.string()
					.optional()
					.describe("File type filter (e.g., 'ts', 'js', 'py')"),
				caseSensitive: z
					.boolean()
					.optional()
					.default(false)
					.describe("Case-sensitive search"),
			}),
			func: async ({ pattern, directory, fileType, caseSensitive }) => {
				const result = await mcpManager.callTool("ripgrep", "search", {
					pattern,
					path: directory,
					type: fileType,
					case_sensitive: caseSensitive,
				});
				return formatMCPResult(result);
			},
		}),

		new DynamicStructuredTool({
			name: "mcp_count_matches",
			description: "Count occurrences of a pattern in the codebase.",
			schema: z.object({
				pattern: z.string().describe("Pattern to count"),
				directory: z.string().optional().describe("Directory to search in"),
			}),
			func: async ({ pattern, directory }) => {
				const result = await mcpManager.callTool("ripgrep", "count", {
					pattern,
					path: directory,
				});
				return formatMCPResult(result);
			},
		}),
	];
}

/**
 * Create all specialized MCP tools based on connected servers.
 */
export function createAllMCPTools(
	mcpManager: MCPClientManager,
): StructuredTool[] {
	return [
		...createCodePathfinderTools(mcpManager),
		...createCodeIndexTools(mcpManager),
		...createRipgrepTools(mcpManager),
	];
}

/**
 * Get MCP tools for a specific agent.
 * Returns only the tools relevant to the agent's role.
 */
export function getMCPToolsForAgent(
	mcpManager: MCPClientManager,
	agentName: string,
): StructuredTool[] {
	const allTools = createAllMCPTools(mcpManager);

	// All agents can use MCP tools for code analysis
	// In the future, we might want to restrict some tools based on agent role
	switch (agentName) {
		case "cartographer":
			// Cartographer gets all read-only analysis tools
			return allTools;

		case "detective":
			// Detective gets call graph and search tools
			return allTools;

		case "surgeon":
			// Surgeon gets search tools for understanding code before fixing
			return allTools.filter(
				(t) =>
					t.name.includes("search") ||
					t.name.includes("find") ||
					t.name.includes("get_file"),
			);

		case "commander":
			// Commander can access all tools if needed
			return allTools;

		default:
			return allTools;
	}
}
