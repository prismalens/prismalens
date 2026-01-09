import { StructuredTool } from '@langchain/core/tools';
import type { IntegrationContext } from '../types/state.js';
import { createGitHubTools } from './github.js';
import { createRenderTools } from './render.js';
import { createRepoTools } from './repo.js';

// =============================================================================
// TOOL FACTORY
// =============================================================================
// Creates tools dynamically based on agent permissions and available integrations.
// Supports plug-and-play integration with external services.
// =============================================================================

export interface ToolFactoryOptions {
    /** Agent name for permission lookup */
    agentName: string;
    /** Available integrations with credentials */
    integrations: IntegrationContext[];
    /** Force read-only mode (overrides agent permissions) */
    readOnly?: boolean;
}

/**
 * Tool category to factory function mapping.
 * Each factory creates tools for a specific integration type.
 */
type ToolFactory = (options: ToolFactoryOptions) => StructuredTool[];

const TOOL_REGISTRY: Record<string, ToolFactory> = {
    github: createGitHubTools,
    render: createRenderTools,
    repo: createRepoTools,
};

/**
 * Agent tool permissions - which tool categories each agent can use.
 * This is the primary access control mechanism.
 */
const AGENT_TOOL_PERMISSIONS: Record<string, string[]> = {
    // Commander has access to all tools for orchestration
    commander: ['github', 'render', 'repo'],

    // Cartographer is READ-ONLY - can gather context but not modify
    cartographer: ['github', 'render', 'repo'],

    // Detective only has the hypothesis tool (added separately)
    detective: [],

    // Surgeon only has the fix proposal tool (added separately)
    surgeon: [],
};

/**
 * Agents that should be forced into read-only mode
 */
const READ_ONLY_AGENTS = new Set(['cartographer']);

/**
 * Create tools for a specific agent based on permissions and integrations.
 *
 * @example
 * // Create tools for cartographer with GitHub integration
 * const tools = createToolsForAgent('cartographer', [
 *   { type: 'github', connectionId: '...', credentials: {...}, config: {...} }
 * ]);
 *
 * @example
 * // Create all tools for commander
 * const tools = createToolsForAgent('commander', integrations);
 */
export function createToolsForAgent(
    agentName: string,
    integrations: IntegrationContext[]
): StructuredTool[] {
    const permissions = AGENT_TOOL_PERMISSIONS[agentName] || [];
    const readOnly = READ_ONLY_AGENTS.has(agentName);
    const tools: StructuredTool[] = [];

    for (const category of permissions) {
        const factory = TOOL_REGISTRY[category];
        if (!factory) {
            console.warn(`[ToolFactory] Unknown tool category: ${category}`);
            continue;
        }

        // Find integrations for this category
        const categoryIntegrations = integrations.filter(
            (i) => i.type.toLowerCase() === category.toLowerCase()
        );

        // Create tools with factory
        const categoryTools = factory({
            agentName,
            integrations: categoryIntegrations,
            readOnly,
        });

        tools.push(...categoryTools);
    }

    return tools;
}

/**
 * Register a custom tool category factory.
 * Use this to add new integration types at runtime.
 *
 * @example
 * registerToolCategory('prometheus', createPrometheusTools);
 */
export function registerToolCategory(category: string, factory: ToolFactory): void {
    TOOL_REGISTRY[category] = factory;
}

/**
 * Set permissions for an agent.
 * Use this to customize agent tool access at runtime.
 *
 * @example
 * setAgentPermissions('custom_agent', ['github', 'prometheus']);
 */
export function setAgentPermissions(agentName: string, categories: string[]): void {
    AGENT_TOOL_PERMISSIONS[agentName] = categories;
}

/**
 * Get current permissions for an agent.
 */
export function getAgentPermissions(agentName: string): string[] {
    return AGENT_TOOL_PERMISSIONS[agentName] || [];
}

/**
 * Check if an agent is in read-only mode.
 */
export function isReadOnlyAgent(agentName: string): boolean {
    return READ_ONLY_AGENTS.has(agentName);
}

/**
 * Set an agent's read-only status.
 */
export function setReadOnlyAgent(agentName: string, readOnly: boolean): void {
    if (readOnly) {
        READ_ONLY_AGENTS.add(agentName);
    } else {
        READ_ONLY_AGENTS.delete(agentName);
    }
}

/**
 * Get all registered tool categories.
 */
export function getToolCategories(): string[] {
    return Object.keys(TOOL_REGISTRY);
}
