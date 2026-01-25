import type { StructuredTool } from "@langchain/core/tools";
import type { IntegrationContext } from "../types/state.js";
import { createRepoTools } from "./repo.js";

// =============================================================================
// CAPABILITY REGISTRY
// =============================================================================
// Maps capabilities (WHAT) to integrations (HOW).
// Skills define capabilities; the registry resolves to specific tools.
// =============================================================================

/**
 * Capability definition - describes what the capability does
 */
export interface CapabilityDefinition {
	name: string;
	description: string;
	/** Integrations that can provide this capability, in priority order */
	integrations: string[];
}

/**
 * Registered capabilities and their possible integrations.
 * Order matters - first matching integration will be used.
 */
export const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
	{
		name: "code-search",
		description: "Search and read code from repositories",
		integrations: ["github", "gitlab", "bitbucket", "repo"],
	},
	{
		name: "log-analysis",
		description: "Fetch and analyze logs from deployment/observability platforms",
		integrations: ["render", "datadog", "opentelemetry", "cloudwatch", "splunk"],
	},
	{
		name: "deployment-check",
		description: "Check deployment status, history, and service info",
		integrations: ["render", "kubernetes", "aws-ecs", "heroku", "vercel"],
	},
	{
		name: "metrics-search",
		description: "Query metrics and telemetry data",
		integrations: ["datadog", "prometheus", "grafana", "cloudwatch"],
	},
	{
		name: "alerting",
		description: "Query and manage alerts",
		integrations: ["pagerduty", "opsgenie", "slack", "datadog"],
	},
];

/**
 * Maps integration types to their tool factory functions.
 */
type ToolFactory = (options: {
	agentName: string;
	integrations: IntegrationContext[];
	readOnly?: boolean;
}) => StructuredTool[];

/**
 * Maps integration types to their tool factory functions.
 *
 * NOTE: GitHub and Render are now provided via MCP bundles (github-mcp, render-mcp).
 * Only local repo tools are created via factory. For remote integrations, use
 * the progressive disclosure system with MCP bundles.
 */
const INTEGRATION_TOOL_FACTORIES: Record<string, ToolFactory> = {
	repo: createRepoTools,
	// Future integrations will be added here as MCP bundles:
	// gitlab: via gitlab-mcp bundle
	// datadog: via datadog-mcp bundle
	// kubernetes: via kubernetes-mcp bundle
};

/**
 * Get the capability definition by name.
 */
export function getCapability(name: string): CapabilityDefinition | undefined {
	return CAPABILITY_DEFINITIONS.find((c) => c.name === name);
}

/**
 * Get all registered capabilities.
 */
export function getCapabilities(): CapabilityDefinition[] {
	return [...CAPABILITY_DEFINITIONS];
}

/**
 * Find which integration to use for a capability based on configured integrations.
 * Returns the first matching integration (priority order).
 *
 * @example
 * // If GitHub is configured, returns "github"
 * resolveCapabilityIntegration("code-search", [githubIntegration])
 *
 * // If GitLab is configured but not GitHub, returns "gitlab"
 * resolveCapabilityIntegration("code-search", [gitlabIntegration])
 */
export function resolveCapabilityIntegration(
	capabilityName: string,
	configuredIntegrations: IntegrationContext[],
): string | undefined {
	const capability = getCapability(capabilityName);
	if (!capability) {
		return undefined;
	}

	const configuredTypes = new Set(
		configuredIntegrations.map((i) => i.type.toLowerCase()),
	);

	// Return first matching integration (priority order)
	return capability.integrations.find((integration) =>
		configuredTypes.has(integration),
	);
}

/**
 * Create tools for a specific capability based on configured integrations.
 * Returns tools for the first matching integration.
 *
 * @example
 * // If GitHub is configured, returns GitHub tools
 * const tools = createToolsForCapability("code-search", integrations, "cartographer", true);
 */
export function createToolsForCapability(
	capabilityName: string,
	integrations: IntegrationContext[],
	agentName: string,
	readOnly: boolean = false,
): StructuredTool[] {
	const selectedIntegration = resolveCapabilityIntegration(
		capabilityName,
		integrations,
	);

	if (!selectedIntegration) {
		return [];
	}

	const factory = INTEGRATION_TOOL_FACTORIES[selectedIntegration];
	if (!factory) {
		return [];
	}

	// Filter integrations to only the selected one
	const relevantIntegrations = integrations.filter(
		(i) => i.type.toLowerCase() === selectedIntegration,
	);

	return factory({
		agentName,
		integrations: relevantIntegrations,
		readOnly,
	});
}

/**
 * Get all capabilities available for the configured integrations.
 * Returns capability names that have at least one configured integration.
 *
 * @example
 * // If GitHub and Render are configured
 * getAvailableCapabilities([githubIntegration, renderIntegration])
 * // Returns: ["code-search", "log-analysis", "deployment-check"]
 */
export function getAvailableCapabilities(
	configuredIntegrations: IntegrationContext[],
): string[] {
	const configuredTypes = new Set(
		configuredIntegrations.map((i) => i.type.toLowerCase()),
	);

	return CAPABILITY_DEFINITIONS.filter((cap) =>
		cap.integrations.some((integration) => configuredTypes.has(integration)),
	).map((cap) => cap.name);
}

/**
 * Register a new capability.
 * Use this to add custom capabilities at runtime.
 */
export function registerCapability(capability: CapabilityDefinition): void {
	// Remove existing if present (allows override)
	const existingIndex = CAPABILITY_DEFINITIONS.findIndex(
		(c) => c.name === capability.name,
	);
	if (existingIndex >= 0) {
		CAPABILITY_DEFINITIONS.splice(existingIndex, 1);
	}
	CAPABILITY_DEFINITIONS.push(capability);
}

/**
 * Register a tool factory for an integration.
 * Use this to add custom integration tool factories at runtime.
 */
export function registerIntegrationToolFactory(
	integrationType: string,
	factory: ToolFactory,
): void {
	INTEGRATION_TOOL_FACTORIES[integrationType] = factory;
}
