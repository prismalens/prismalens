import type { StructuredTool } from "@langchain/core/tools";
import { Logger } from "@prismalens/logger";
import type {
	BundleExecutionContext,
	NativeBundleDefinition,
	ToolBundle,
	ToolBundleMetadata,
	ToolBundleSource,
} from "../types.js";

// =============================================================================
// NATIVE BUNDLE SOURCE
// =============================================================================
// Source for registering native LangChain StructuredTools as bundles.
// Use this to add existing tools to the progressive disclosure system.
// =============================================================================

const logger = new Logger({ context: "NativeBundleSource" });

/**
 * Configuration for NativeBundleSource.
 */
export interface NativeBundleSourceConfig {
	/** Bundle definitions to register */
	bundles: NativeBundleDefinition[];
}

/**
 * Bundle source for native LangChain tools.
 * Wraps existing StructuredTool instances as bundles.
 */
export class NativeBundleSource implements ToolBundleSource {
	readonly name = "native";
	private bundles: Map<string, NativeBundleDefinition> = new Map();

	constructor(config: NativeBundleSourceConfig) {
		for (const bundle of config.bundles) {
			this.bundles.set(bundle.name, bundle);
		}
		logger.debug(`Initialized with ${this.bundles.size} native bundles`);
	}

	/**
	 * List all registered bundles.
	 */
	async listBundles(): Promise<ToolBundleMetadata[]> {
		const metadata: ToolBundleMetadata[] = [];

		for (const bundle of this.bundles.values()) {
			// Extract operation names from tools
			const operations = this.getOperationNames(bundle);

			metadata.push({
				name: bundle.name,
				category: bundle.category,
				description: bundle.description,
				operations,
				readOnly: bundle.readOnly,
				estimatedTokens: bundle.estimatedTokens,
				keywords: bundle.keywords,
				useCases: bundle.useCases,
				source: this.name,
			});
		}

		return metadata;
	}

	/**
	 * Load a bundle by name.
	 */
	async loadBundle(
		name: string,
		context: BundleExecutionContext,
	): Promise<ToolBundle | null> {
		const definition = this.bundles.get(name);
		if (!definition) {
			return null;
		}

		const operations = this.getOperationNames(definition);

		return {
			metadata: {
				name: definition.name,
				category: definition.category,
				description: definition.description,
				operations,
				readOnly: definition.readOnly,
				estimatedTokens: definition.estimatedTokens,
				keywords: definition.keywords,
				useCases: definition.useCases,
				source: this.name,
			},
			createTools: (ctx: BundleExecutionContext): StructuredTool[] => {
				if (typeof definition.tools === "function") {
					return definition.tools(ctx);
				}
				return definition.tools;
			},
		};
	}

	/**
	 * Register additional bundles.
	 */
	registerBundle(definition: NativeBundleDefinition): void {
		this.bundles.set(definition.name, definition);
		logger.debug(`Registered native bundle: ${definition.name}`);
	}

	/**
	 * Get operation names from tools.
	 */
	private getOperationNames(definition: NativeBundleDefinition): string[] {
		if (typeof definition.tools === "function") {
			// For factory functions, we can't know tool names without calling them
			// Return empty array - will be populated when loaded
			return [];
		}
		return definition.tools.map((t) => t.name);
	}
}

/**
 * Create a native bundle source from tool factories.
 * Convenience function for common use case.
 *
 * @example
 * const source = createNativeBundleSource([
 *   {
 *     name: "github-code",
 *     category: "github",
 *     description: "Read and search GitHub code",
 *     readOnly: true,
 *     tools: createGitHubCodeTools,
 *   },
 * ]);
 */
export function createNativeBundleSource(
	bundles: NativeBundleDefinition[],
): NativeBundleSource {
	return new NativeBundleSource({ bundles });
}
