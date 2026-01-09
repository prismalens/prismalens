import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import axios from 'axios';
import type { StructuredTool } from '@langchain/core/tools';
import type { ToolFactoryOptions } from './factory.js';

// =============================================================================
// RENDER.COM TOOLS
// =============================================================================
// Tools for fetching logs from Render.com services.
// Supports both environment-based and integration-based credentials.
// =============================================================================

interface RenderCredentials {
    apiKey: string;
    ownerId?: string;
    resourceId?: string;
}

/**
 * Get Render credentials from integrations or environment
 */
function getRenderCredentials(
    integrations: ToolFactoryOptions['integrations']
): RenderCredentials | null {
    // Check integrations first
    const renderIntegration = integrations.find(
        (i) => i.type.toLowerCase() === 'render'
    );

    if (renderIntegration) {
        const apiKey =
            (renderIntegration.credentials?.apiKey as string) ||
            (renderIntegration.credentials?.accessToken as string);
        if (apiKey) {
            return {
                apiKey,
                ownerId: renderIntegration.config?.ownerId as string,
                resourceId: renderIntegration.config?.resourceId as string,
            };
        }
    }

    // Fall back to environment variables
    const apiKey = process.env.RENDER_API_KEY || process.env.RENDER_API_TOKEN;
    if (apiKey) {
        return {
            apiKey,
            ownerId: process.env.RENDER_OWNER_ID,
            resourceId: process.env.RENDER_RESOURCE_ID,
        };
    }

    return null;
}

/**
 * Create Render.com tools for an agent.
 */
export function createRenderTools(options: ToolFactoryOptions): StructuredTool[] {
    const credentials = getRenderCredentials(options.integrations);

    const tools: StructuredTool[] = [
        // Fetch logs from a Render service
        tool(
            async ({ time_range_minutes, limit, search_query, resource_id }) => {
                if (!credentials) {
                    return 'Error: Render credentials not configured. Set RENDER_API_KEY and RENDER_OWNER_ID environment variables.';
                }

                const ownerId = credentials.ownerId;
                const resourceId = resource_id || credentials.resourceId;

                if (!ownerId) {
                    return 'Error: RENDER_OWNER_ID is required';
                }
                if (!resourceId) {
                    return 'Error: resource_id parameter or RENDER_RESOURCE_ID is required';
                }

                try {
                    const endTime = new Date();
                    const startTime = new Date(
                        endTime.getTime() - (time_range_minutes || 60) * 60000
                    );

                    const params: Record<string, any> = {
                        ownerId,
                        resource: [resourceId],
                        startTime: startTime.toISOString(),
                        endTime: endTime.toISOString(),
                        limit: Math.min(limit || 100, 500),
                        direction: 'backward',
                    };

                    if (search_query) {
                        params.text = search_query;
                    }

                    const response = await axios.get(
                        'https://api.render.com/v1/logs',
                        {
                            headers: {
                                Authorization: `Bearer ${credentials.apiKey}`,
                            },
                            params,
                        }
                    );

                    const logs = (response.data.logs || []).map((log: any) => ({
                        timestamp: log.timestamp,
                        message: log.message,
                        level: log.level || 'info',
                        source: log.source || 'unknown',
                    }));

                    return JSON.stringify(
                        {
                            logs,
                            count: logs.length,
                            timeRange: {
                                start: startTime.toISOString(),
                                end: endTime.toISOString(),
                            },
                        },
                        null,
                        2
                    );
                } catch (error: any) {
                    if (error.response?.status === 401) {
                        return 'Error: Invalid Render API key';
                    }
                    if (error.response?.status === 404) {
                        return `Error: Resource not found: ${resourceId}`;
                    }
                    return `Error fetching Render logs: ${error.message}`;
                }
            },
            {
                name: 'render_get_logs',
                description:
                    'Fetch logs from a Render.com service. Useful for investigating deployment issues, errors, and runtime behavior.',
                schema: z.object({
                    time_range_minutes: z
                        .number()
                        .optional()
                        .default(60)
                        .describe('How many minutes of logs to fetch (default: 60)'),
                    limit: z
                        .number()
                        .optional()
                        .default(100)
                        .describe('Maximum number of log entries (default: 100, max: 500)'),
                    search_query: z
                        .string()
                        .optional()
                        .describe('Filter logs by text content (e.g., "error", "exception")'),
                    resource_id: z
                        .string()
                        .optional()
                        .describe(
                            'Render resource ID to fetch logs from (overrides default)'
                        ),
                }),
            }
        ),

        // List Render services
        tool(
            async ({ type }) => {
                if (!credentials) {
                    return 'Error: Render credentials not configured';
                }

                try {
                    const params: Record<string, any> = {};
                    if (type) {
                        params.type = type;
                    }

                    const response = await axios.get(
                        'https://api.render.com/v1/services',
                        {
                            headers: {
                                Authorization: `Bearer ${credentials.apiKey}`,
                            },
                            params,
                        }
                    );

                    const services = response.data.map((item: any) => ({
                        id: item.service.id,
                        name: item.service.name,
                        type: item.service.type,
                        status: item.service.suspended ? 'suspended' : 'active',
                        repo: item.service.repo,
                        branch: item.service.branch,
                    }));

                    return JSON.stringify(services, null, 2);
                } catch (error: any) {
                    return `Error listing Render services: ${error.message}`;
                }
            },
            {
                name: 'render_list_services',
                description:
                    'List all Render services. Useful for discovering service IDs for log queries.',
                schema: z.object({
                    type: z
                        .enum(['static_site', 'web_service', 'private_service', 'background_worker', 'cron_job'])
                        .optional()
                        .describe('Filter by service type'),
                }),
            }
        ),

        // Get deployment history
        tool(
            async ({ service_id, limit }) => {
                if (!credentials) {
                    return 'Error: Render credentials not configured';
                }

                if (!service_id) {
                    return 'Error: service_id is required';
                }

                try {
                    const response = await axios.get(
                        `https://api.render.com/v1/services/${service_id}/deploys`,
                        {
                            headers: {
                                Authorization: `Bearer ${credentials.apiKey}`,
                            },
                            params: { limit: limit || 10 },
                        }
                    );

                    const deploys = response.data.map((item: any) => ({
                        id: item.deploy.id,
                        status: item.deploy.status,
                        commit: item.deploy.commit?.id?.substring(0, 7),
                        message: item.deploy.commit?.message?.split('\n')[0],
                        createdAt: item.deploy.createdAt,
                        finishedAt: item.deploy.finishedAt,
                    }));

                    return JSON.stringify(deploys, null, 2);
                } catch (error: any) {
                    return `Error fetching deployments: ${error.message}`;
                }
            },
            {
                name: 'render_get_deployments',
                description:
                    'Get recent deployments for a Render service. Useful for correlating incidents with recent deployments.',
                schema: z.object({
                    service_id: z.string().describe('Render service ID'),
                    limit: z
                        .number()
                        .optional()
                        .default(10)
                        .describe('Number of deployments to return'),
                }),
            }
        ),
    ];

    return tools;
}

// Legacy export for backward compatibility
export const renderTools = createRenderTools({
    agentName: 'default',
    integrations: [],
});
