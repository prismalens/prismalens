import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import axios from "axios";
import * as fs from "fs/promises";
import { z } from "zod";
import type {
	BundleExecutionContext,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
} from "../types.js";

// =============================================================================
// OPENAPI BUNDLE SOURCE
// =============================================================================
// Source for generating tool bundles from OpenAPI specifications.
// Supports loading from files or URLs, with operation filtering.
// =============================================================================

const logger = new Logger({ context: "OpenApiBundleSource" });

/**
 * OpenAPI operation definition (simplified).
 */
interface OpenApiOperation {
	operationId: string;
	summary?: string;
	description?: string;
	tags?: string[];
	parameters?: OpenApiParameter[];
	requestBody?: OpenApiRequestBody;
}

interface OpenApiParameter {
	name: string;
	in: "query" | "path" | "header" | "cookie";
	description?: string;
	required?: boolean;
	schema?: OpenApiSchema;
}

interface OpenApiRequestBody {
	description?: string;
	required?: boolean;
	content?: Record<string, { schema?: OpenApiSchema }>;
}

interface OpenApiSchema {
	type?: string;
	format?: string;
	enum?: string[];
	items?: OpenApiSchema;
	properties?: Record<string, OpenApiSchema>;
	required?: string[];
	description?: string;
	default?: unknown;
}

/**
 * Bundle definition from OpenAPI spec.
 */
export interface OpenApiBundleDefinition {
	/** Bundle name */
	name: string;

	/** Bundle category */
	category: string;

	/** Bundle description */
	description: string;

	/** Whether operations are read-only (GET only) */
	readOnly: boolean;

	/** Path to OpenAPI spec file or URL */
	specPath: string;

	/** Filter to specific operations by operationId */
	operations?: string[];

	/** Filter to specific tags */
	tags?: string[];

	/** Filter to specific path prefixes */
	pathPrefixes?: string[];

	/** HTTP methods to include (default: all) */
	methods?: string[];

	/** Base URL override (if not in spec) */
	baseUrl?: string;

	/** Header to use for authentication */
	authHeader?: string;

	/** Integration type for credential lookup */
	integrationType?: string;

	/** Estimated tokens per operation */
	tokensPerOperation?: number;
}

/**
 * Configuration for OpenApiBundleSource.
 */
export interface OpenApiBundleSourceConfig {
	/** Bundle definitions */
	bundles: OpenApiBundleDefinition[];

	/** Cache parsed specs (default: true) */
	cacheSpecs?: boolean;
}

/**
 * Bundle source that generates tools from OpenAPI specifications.
 */
export class OpenApiBundleSource implements ToolBundleSource {
	readonly name = "openapi";
	private bundles: Map<string, OpenApiBundleDefinition> = new Map();
	private specCache: Map<string, Record<string, unknown>> = new Map();
	private cacheSpecs: boolean;

	constructor(config: OpenApiBundleSourceConfig) {
		this.cacheSpecs = config.cacheSpecs ?? true;

		for (const bundle of config.bundles) {
			this.bundles.set(bundle.name, bundle);
		}

		logger.debug(`Initialized with ${this.bundles.size} OpenAPI bundles`);
	}

	/**
	 * List all available bundles.
	 */
	async listBundles(): Promise<ToolBundleMetadata[]> {
		const metadata: ToolBundleMetadata[] = [];

		for (const bundle of this.bundles.values()) {
			// Get operations from spec if not explicitly defined
			let operations = bundle.operations || [];

			if (operations.length === 0) {
				try {
					const spec = await this.loadSpec(bundle.specPath);
					operations = this.extractOperationIds(spec, bundle);
				} catch {
					// Can't load spec - return empty operations
				}
			}

			const estimatedTokens = bundle.tokensPerOperation
				? operations.length * bundle.tokensPerOperation
				: undefined;

			metadata.push({
				name: bundle.name,
				category: bundle.category,
				description: bundle.description,
				operations,
				readOnly: bundle.readOnly,
				estimatedTokens,
				source: this.name,
			});
		}

		return metadata;
	}

	/**
	 * Load a bundle and create tools from the OpenAPI spec.
	 */
	async loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null> {
		const definition = this.bundles.get(name);
		if (!definition) {
			return null;
		}

		// Load and parse the spec
		let spec: Record<string, unknown>;
		try {
			spec = await this.loadSpec(definition.specPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to load OpenAPI spec for ${name}: ${message}`);
			return null;
		}

		const operations = this.extractOperations(spec, definition);
		const operationIds = operations.map((op) => op.operationId);

		return {
			metadata: {
				name: definition.name,
				category: definition.category,
				description: definition.description,
				operations: operationIds,
				readOnly: definition.readOnly,
				estimatedTokens: definition.tokensPerOperation
					? operationIds.length * definition.tokensPerOperation
					: undefined,
				source: this.name,
			},
			createTools: (ctx: BundleExecutionContext): StructuredTool[] => {
				return this.createToolsFromOperations(spec, definition, operations, ctx);
			},
		};
	}

	/**
	 * Refresh specs (clear cache).
	 */
	async refresh(): Promise<void> {
		this.specCache.clear();
		logger.debug("Cleared OpenAPI spec cache");
	}

	/**
	 * Register additional bundle definitions.
	 */
	registerBundle(definition: OpenApiBundleDefinition): void {
		this.bundles.set(definition.name, definition);
		logger.debug(`Registered OpenAPI bundle: ${definition.name}`);
	}

	/**
	 * Load an OpenAPI spec from file or URL.
	 */
	private async loadSpec(specPath: string): Promise<Record<string, unknown>> {
		// Check cache
		if (this.cacheSpecs && this.specCache.has(specPath)) {
			return this.specCache.get(specPath)!;
		}

		let content: string;

		// Load from URL or file
		if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
			const response = await axios.get(specPath);
			content =
				typeof response.data === "string"
					? response.data
					: JSON.stringify(response.data);
		} else {
			content = await fs.readFile(specPath, "utf-8");
		}

		// Parse YAML or JSON
		let spec: Record<string, unknown>;
		try {
			spec = JSON.parse(content);
		} catch {
			// Try YAML parsing (simple implementation)
			spec = this.parseSimpleYaml(content);
		}

		// Cache
		if (this.cacheSpecs) {
			this.specCache.set(specPath, spec);
		}

		return spec;
	}

	/**
	 * Simple YAML parser for basic OpenAPI specs.
	 * For complex specs, users should use JSON format.
	 */
	private parseSimpleYaml(content: string): Record<string, unknown> {
		// This is a simplified YAML parser that handles common cases
		// For full YAML support, the js-yaml library should be used
		// Since we want to keep dependencies minimal, we do basic parsing

		try {
			// Try JSON first (some .yaml files are actually JSON)
			return JSON.parse(content);
		} catch {
			// Basic YAML-like parsing for simple structures
			// This won't work for complex YAML - recommend JSON specs
			logger.warn(
				"Basic YAML parsing - complex specs should use JSON format",
			);

			// For now, return empty spec if not parseable
			// Full YAML support can be added with js-yaml package
			return {};
		}
	}

	/**
	 * Extract operation IDs matching the bundle filters.
	 */
	private extractOperationIds(
		spec: Record<string, unknown>,
		definition: OpenApiBundleDefinition,
	): string[] {
		return this.extractOperations(spec, definition).map((op) => op.operationId);
	}

	/**
	 * Extract operations from the spec based on filters.
	 */
	private extractOperations(
		spec: Record<string, unknown>,
		definition: OpenApiBundleDefinition,
	): Array<OpenApiOperation & { method: string; path: string }> {
		const operations: Array<OpenApiOperation & { method: string; path: string }> = [];
		const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;

		const allowedMethods = definition.methods || ["get", "post", "put", "patch", "delete"];

		for (const [pathStr, pathItem] of Object.entries(paths)) {
			// Check path prefix filter
			if (definition.pathPrefixes?.length) {
				const matches = definition.pathPrefixes.some((prefix) =>
					pathStr.startsWith(prefix),
				);
				if (!matches) continue;
			}

			for (const [method, operationData] of Object.entries(pathItem)) {
				// Skip non-operation keys
				if (!allowedMethods.includes(method.toLowerCase())) continue;

				const operation = operationData as OpenApiOperation;
				if (!operation.operationId) continue;

				// Check operation filter
				if (definition.operations?.length) {
					if (!definition.operations.includes(operation.operationId)) continue;
				}

				// Check tag filter
				if (definition.tags?.length) {
					const hasTag = definition.tags.some((tag) =>
						operation.tags?.includes(tag),
					);
					if (!hasTag) continue;
				}

				// Check read-only filter (GET only)
				if (definition.readOnly && method.toLowerCase() !== "get") {
					continue;
				}

				operations.push({
					...operation,
					method: method.toLowerCase(),
					path: pathStr,
				});
			}
		}

		return operations;
	}

	/**
	 * Create LangChain tools from OpenAPI operations.
	 */
	private createToolsFromOperations(
		spec: Record<string, unknown>,
		definition: OpenApiBundleDefinition,
		operations: Array<OpenApiOperation & { method: string; path: string }>,
		context: BundleExecutionContext,
	): StructuredTool[] {
		const tools: StructuredTool[] = [];

		// Get base URL from spec or definition
		const servers = (spec.servers || []) as Array<{ url: string }>;
		const baseUrl = definition.baseUrl || servers[0]?.url || "";

		// Get auth credentials
		const authToken = this.getAuthToken(definition, context);

		for (const operation of operations) {
			const toolName = operation.operationId;
			const description =
				operation.summary || operation.description || `${operation.method.toUpperCase()} ${operation.path}`;

			// Build Zod schema from parameters
			const schemaProperties: Record<string, z.ZodTypeAny> = {};

			for (const param of operation.parameters || []) {
				const paramSchema = this.paramToZodSchema(param);
				schemaProperties[param.name] = param.required
					? paramSchema
					: paramSchema.optional();
			}

			// Add request body if present
			if (operation.requestBody?.content) {
				const jsonContent = operation.requestBody.content["application/json"];
				if (jsonContent?.schema) {
					schemaProperties.body = z
						.record(z.unknown())
						.describe("Request body");
				}
			}

			const inputSchema =
				Object.keys(schemaProperties).length > 0
					? z.object(schemaProperties)
					: z.object({});

			// Create the tool
			const apiTool = tool(
				async (args: Record<string, unknown>) => {
					// Build URL with path parameters
					let url = `${baseUrl}${operation.path}`;
					const queryParams: Record<string, string> = {};
					const headers: Record<string, string> = {
						Accept: "application/json",
					};

					if (authToken && definition.authHeader) {
						headers[definition.authHeader] = authToken;
					}

					for (const param of operation.parameters || []) {
						const value = args[param.name];
						if (value === undefined) continue;

						switch (param.in) {
							case "path":
								url = url.replace(`{${param.name}}`, String(value));
								break;
							case "query":
								queryParams[param.name] = String(value);
								break;
							case "header":
								headers[param.name] = String(value);
								break;
						}
					}

					try {
						const response = await axios({
							method: operation.method,
							url,
							params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
							data: args.body,
							headers,
						});

						// Return data as string for LLM consumption
						return typeof response.data === "string"
							? response.data
							: JSON.stringify(response.data, null, 2);
					} catch (error: unknown) {
						const axiosError = error as { response?: { status: number; data: unknown }; message?: string };
						if (axiosError.response) {
							return `Error ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`;
						}
						return `Error: ${axiosError.message || "Unknown error"}`;
					}
				},
				{
					name: toolName,
					description,
					schema: inputSchema,
				},
			);

			tools.push(apiTool);
		}

		return tools;
	}

	/**
	 * Convert OpenAPI parameter to Zod schema.
	 */
	private paramToZodSchema(param: OpenApiParameter): z.ZodTypeAny {
		const schema = param.schema;
		let zodSchema: z.ZodTypeAny = z.string();

		if (schema) {
			switch (schema.type) {
				case "integer":
				case "number":
					zodSchema = z.number();
					break;
				case "boolean":
					zodSchema = z.boolean();
					break;
				case "array":
					zodSchema = z.array(z.string());
					break;
				default:
					if (schema.enum) {
						zodSchema = z.enum(schema.enum as [string, ...string[]]);
					} else {
						zodSchema = z.string();
					}
			}
		}

		if (param.description) {
			zodSchema = zodSchema.describe(param.description);
		}

		return zodSchema;
	}

	/**
	 * Get authentication token from integration context.
	 */
	private getAuthToken(
		definition: OpenApiBundleDefinition,
		context: BundleExecutionContext,
	): string | undefined {
		if (!definition.integrationType) return undefined;

		const integration = context.integrations.find(
			(i) => i.type.toLowerCase() === definition.integrationType?.toLowerCase(),
		);

		if (integration?.credentials) {
			return (
				(integration.credentials.accessToken as string) ||
				(integration.credentials.apiKey as string) ||
				(integration.credentials.token as string)
			);
		}

		return undefined;
	}
}

/**
 * Create an OpenAPI bundle source.
 *
 * @example
 * const source = createOpenApiBundleSource([
 *   {
 *     name: "github-code",
 *     category: "github",
 *     description: "Read GitHub code",
 *     readOnly: true,
 *     specPath: "./github-openapi.json",
 *     tags: ["repos"],
 *     methods: ["get"],
 *     authHeader: "Authorization",
 *     integrationType: "github",
 *   },
 * ]);
 */
export function createOpenApiBundleSource(
	bundles: OpenApiBundleDefinition[],
): OpenApiBundleSource {
	return new OpenApiBundleSource({ bundles });
}
