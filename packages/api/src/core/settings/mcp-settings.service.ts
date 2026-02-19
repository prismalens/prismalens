import { Injectable, NotFoundException, Inject, forwardRef, Logger } from "@nestjs/common";
import {
	MCP_SERVERS,
	type MCPServerId,
	getAvailableMCPServers,
} from "@prismalens/config/mcp";
import type {
	McpSettings,
	McpServerSettings,
	UpdateMcpSettings,
	McpServerStatus,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";
import { IntegrationsService } from "../../modules/integrations/integrations.service.js";

@Injectable()
export class McpSettingsService {
	private readonly logger = new Logger(McpSettingsService.name);

	private readonly MCP_SETTINGS_KEY = "MCP_SETTINGS_V1";

	constructor(
		private prisma: PrismaService,
		@Inject(forwardRef(() => IntegrationsService))
		private integrationsService: IntegrationsService,
	) {}

	private getDefaultMcpSettings(): McpSettings {
		const servers: Record<MCPServerId, McpServerSettings> = {} as Record<
			MCPServerId,
			McpServerSettings
		>;

		for (const serverId of getAvailableMCPServers()) {
			servers[serverId] = {
				enabled: true,
				readOnlyMode: true,
				toolFilter: undefined,
			};
		}

		return { servers };
	}

	async getMcpSettings(): Promise<McpSettings> {
		const setting = await this.prisma.setting.findUnique({
			where: { key: this.MCP_SETTINGS_KEY },
		});

		if (!setting) {
			return this.getDefaultMcpSettings();
		}

		try {
			const parsed = JSON.parse(setting.value);
			const defaults = this.getDefaultMcpSettings();
			return {
				servers: {
					...defaults.servers,
					...parsed.servers,
				},
			};
		} catch {
			return this.getDefaultMcpSettings();
		}
	}

	async updateMcpSettings(dto: UpdateMcpSettings): Promise<McpSettings> {
		const current = await this.getMcpSettings();

		const updatedServers = { ...current.servers };
		if (dto.servers) {
			for (const [serverId, serverConfig] of Object.entries(dto.servers)) {
				const existing = updatedServers[serverId as MCPServerId] || {
					enabled: true,
					readOnlyMode: true,
				};
				updatedServers[serverId as MCPServerId] = {
					enabled: serverConfig?.enabled ?? existing.enabled,
					readOnlyMode: serverConfig?.readOnlyMode ?? existing.readOnlyMode,
					toolFilter: serverConfig?.toolFilter ?? existing.toolFilter,
					customHttpUrl: serverConfig?.customHttpUrl ?? existing.customHttpUrl,
					customDockerImage:
						serverConfig?.customDockerImage ?? existing.customDockerImage,
				};
			}
		}

		const updated: McpSettings = {
			servers: updatedServers,
		};

		await this.prisma.setting.upsert({
			where: { key: this.MCP_SETTINGS_KEY },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: this.MCP_SETTINGS_KEY,
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	async getMcpStatus(): Promise<{ servers: McpServerStatus[] }> {
		const settings = await this.getMcpSettings();
		const integrations = await this.integrationsService.getIntegrationsForService();

		const integrationTypes = new Set(integrations.map((i) => i.type));

		const servers: McpServerStatus[] = [];

		for (const serverId of getAvailableMCPServers()) {
			const serverMeta = MCP_SERVERS[serverId];
			const serverSettings = settings.servers[serverId] || {
				enabled: true,
				readOnlyMode: true,
			};

			const hasCredentials = integrationTypes.has(serverMeta.integrationType);
			const isReady = serverSettings.enabled && hasCredentials;

			servers.push({
				serverId,
				enabled: serverSettings.enabled,
				readOnlyMode: serverSettings.readOnlyMode,
				hasCredentials,
				isReady,
				integrationType: serverMeta.integrationType,
				toolFilter: serverSettings.toolFilter,
			});
		}

		return { servers };
	}

	async getMcpServerStatus(serverId: MCPServerId): Promise<McpServerStatus> {
		const { servers } = await this.getMcpStatus();
		const server = servers.find((s) => s.serverId === serverId);

		if (!server) {
			throw new NotFoundException(`MCP server not found: ${serverId}`);
		}

		return server;
	}

	async testMcpConnection(
		serverId: MCPServerId,
	): Promise<{ success: boolean; error?: string; toolCount?: number }> {
		const serverMeta = MCP_SERVERS[serverId];
		if (!serverMeta) {
			return { success: false, error: `Unknown MCP server: ${serverId}` };
		}

		const integrations = await this.integrationsService.getIntegrationsForService();
		const integration = integrations.find(
			(i) => i.type === serverMeta.integrationType,
		);

		if (!integration) {
			return {
				success: false,
				error: `No ${serverMeta.integrationType} integration configured. Please add the integration first.`,
			};
		}

		try {
			const credentials = integration.credentials as Record<string, unknown>;
			const hasToken = !!(credentials.accessToken || credentials.apiKey);

			if (!hasToken) {
				return {
					success: false,
					error: "Integration credentials are missing required token",
				};
			}

			return {
				success: true,
				toolCount: serverMeta.suggestedTools.length,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection test failed",
			};
		}
	}
}
