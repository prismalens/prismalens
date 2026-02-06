/**
 * Headless MCP Tool Caller for Pre-Gathering
 *
 * Calls MCP tools without an LLM agent — predetermined arguments, no reasoning.
 * Reuses the existing BundleRegistry, MCPBundleSource, and credential mapping.
 */

import { Logger } from "@prismalens/logger";
import type { BundleRegistry } from "../../../tools/bundles/registry.js";
import type { IntegrationContext } from "../../../types/index.js";

const logger = new Logger({ context: "PreGather:MCPCaller" });

export interface MCPCallResult {
	success: boolean;
	data: string | null;
	error?: string;
}

/**
 * Call an MCP tool headlessly (no LLM agent).
 * Uses the BundleRegistry to load the bundle, create tools, and invoke directly.
 */
export async function callMCPTool(
	registry: BundleRegistry,
	bundleName: string,
	toolName: string,
	args: Record<string, unknown>,
	integrations: IntegrationContext[],
): Promise<MCPCallResult> {
	try {
		const bundle = await registry.loadBundle(bundleName, {
			integrations,
			agentName: "pre-gatherer",
			readOnly: true,
		});

		if (!bundle) {
			return { success: false, data: null, error: `Bundle not found: ${bundleName}` };
		}

		const tools = bundle.createTools({
			integrations,
			agentName: "pre-gatherer",
			readOnly: true,
		});

		const targetTool = tools.find((t) => t.name === toolName);
		if (!targetTool) {
			return {
				success: false,
				data: null,
				error: `Tool ${toolName} not found in bundle ${bundleName}`,
			};
		}

		const result = await targetTool.invoke(args);
		const data = typeof result === "string" ? result : JSON.stringify(result);

		return { success: true, data };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`MCP tool call failed: ${bundleName}/${toolName}`, { error: message });
		return { success: false, data: null, error: message };
	}
}

/**
 * Search for a bundle that matches a capability keyword.
 * Returns the bundle name or null if no match.
 *
 * This is how pre-gathering discovers which MCP server to use
 * without hardcoding provider names (e.g., "logs" → "render-mcp").
 */
export async function findBundleForCapability(
	registry: BundleRegistry,
	capability: string,
): Promise<string | null> {
	const results = await registry.searchBundles({
		query: capability,
		readOnlyOnly: true,
		limit: 1,
	});

	if (results.length === 0) {
		logger.debug(`No bundle found for capability: ${capability}`);
		return null;
	}

	logger.debug(`Found bundle for capability "${capability}": ${results[0].bundle.name}`);
	return results[0].bundle.name;
}
