import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import { SettingsService } from "./settings.service.js";

@Controller()
export class SettingsController {
	constructor(private readonly settingsService: SettingsService) {}

	/**
	 * Implement the settings contract for LLM configuration
	 * All endpoints are type-safe with input validation via Zod
	 */
	@Implement(settingsContract.llm)
	llm() {
		return {
			// GET /settings/llm - List all LLM configurations
			list: implement(settingsContract.llm.list).handler(async () => {
				return this.settingsService.getAllLlmConfigs();
			}),

			// GET /settings/llm/:provider - Get LLM config for a provider
			get: implement(settingsContract.llm.get).handler(async ({ input }) => {
				try {
					return await this.settingsService.getLlmConfig(input.provider);
				} catch (error) {
					if (
						error instanceof Error &&
						error.message.includes("No configuration found")
					) {
						throw new ORPCError("NOT_FOUND", {
							message: `No configuration found for provider: ${input.provider}`,
						});
					}
					throw error;
				}
			}),

			// PUT /settings/llm/:provider - Update LLM config for a provider
			update: implement(settingsContract.llm.update).handler(
				async ({ input }) => {
					const { provider, ...config } = input;
					const setting = await this.settingsService.updateLlmConfig(
						provider,
						config,
					);
					return this.serializeSetting(setting);
				},
			),

			// DELETE /settings/llm/:provider - Delete LLM config for a provider
			delete: implement(settingsContract.llm.delete).handler(
				async ({ input }) => {
					try {
						await this.settingsService.deleteLlmConfig(input.provider);
					} catch {
						throw new ORPCError("NOT_FOUND", {
							message: `No configuration found for provider: ${input.provider}`,
						});
					}
				},
			),

			// POST /settings/llm/:provider/test - Test LLM connection
			test: implement(settingsContract.llm.test).handler(async ({ input }) => {
				const { provider, ...config } = input;
				return this.settingsService.testLlmConnection(provider, config);
			}),

			// PUT /settings/llm/active - Set active LLM provider
			setActive: implement(settingsContract.llm.setActive).handler(
				async ({ input }) => {
					try {
						const setting = await this.settingsService.setActiveProvider(
							input.provider,
						);
						return this.serializeSetting(setting);
					} catch (error) {
						if (
							error instanceof Error &&
							error.message.includes("not configured")
						) {
							throw new ORPCError("NOT_FOUND", {
								message: `Provider ${input.provider} not configured`,
							});
						}
						throw error;
					}
				},
			),

			// =====================================================================
			// NEW: Comprehensive LLM Configuration (env-only API keys)
			// =====================================================================

			// GET /settings/llm/env-status - Get env var status for all providers
			getEnvStatus: implement(settingsContract.llm.getEnvStatus).handler(
				async () => {
					return this.settingsService.getLlmEnvStatus();
				},
			),

			// GET /settings/llm/config - Get comprehensive LLM settings
			getSettings: implement(settingsContract.llm.getSettings).handler(
				async () => {
					return this.settingsService.getLlmSettings();
				},
			),

			// PATCH /settings/llm/config - Update LLM settings
			updateSettings: implement(settingsContract.llm.updateSettings).handler(
				async ({ input }) => {
					return this.settingsService.updateLlmSettings(input);
				},
			),

			// GET /settings/llm/models - Get available models from registry
			getModels: implement(settingsContract.llm.getModels).handler(
				async ({ input }) => {
					return this.settingsService.getAvailableModels(input.provider);
				},
			),

			// POST /settings/llm/test-connection - Test connection using env vars
			testConnection: implement(settingsContract.llm.testConnection).handler(
				async ({ input }) => {
					return this.settingsService.testLlmConnectionWithEnv(
						input.provider,
						input.model,
					);
				},
			),
		};
	}

	/**
	 * Implement investigation policy routes
	 */
	@Implement(settingsContract.investigation)
	investigation() {
		return {
			// GET /settings/investigation/policies
			getPolicies: implement(
				settingsContract.investigation.getPolicies,
			).handler(async () => {
				return this.settingsService.getInvestigationPolicies();
			}),

			// PUT /settings/investigation/policies/:tier
			updatePolicy: implement(
				settingsContract.investigation.updatePolicy,
			).handler(async ({ input }) => {
				const { tier, ...policy } = input;
				return this.settingsService.updateInvestigationPolicy(tier, policy);
			}),

			// GET /settings/investigation/limits
			getLimits: implement(settingsContract.investigation.getLimits).handler(
				async () => {
					return this.settingsService.getInvestigationLimits();
				},
			),

			// PUT /settings/investigation/limits
			updateLimits: implement(
				settingsContract.investigation.updateLimits,
			).handler(async ({ input }) => {
				return this.settingsService.updateInvestigationLimits(input);
			}),
		};
	}

	/**
	 * Implement danger zone routes
	 */
	@Implement(settingsContract.danger)
	danger() {
		return {
			// POST /settings/danger/reset-data
			resetData: implement(settingsContract.danger.resetData).handler(
				async () => {
					return this.settingsService.resetData();
				},
			),

			// POST /settings/danger/factory-reset
			factoryReset: implement(settingsContract.danger.factoryReset).handler(
				async () => {
					return this.settingsService.factoryReset();
				},
			),
		};
	}

	/**
	 * Implement MCP settings routes
	 */
	@Implement(settingsContract.mcp)
	mcp() {
		return {
			// GET /settings/mcp - Get MCP settings
			getSettings: implement(settingsContract.mcp.getSettings).handler(
				async () => {
					return this.settingsService.getMcpSettings();
				},
			),

			// PATCH /settings/mcp - Update MCP settings
			updateSettings: implement(settingsContract.mcp.updateSettings).handler(
				async ({ input }) => {
					return this.settingsService.updateMcpSettings(input);
				},
			),

			// GET /settings/mcp/status - Get MCP server status
			getStatus: implement(settingsContract.mcp.getStatus).handler(async () => {
				return this.settingsService.getMcpStatus();
			}),

			// POST /settings/mcp/test - Test MCP connection
			testConnection: implement(settingsContract.mcp.testConnection).handler(
				async ({ input }) => {
					return this.settingsService.testMcpConnection(input.serverId);
				},
			),

			// GET /settings/mcp/:serverId/status - Get specific server status
			getServerStatus: implement(settingsContract.mcp.getServerStatus).handler(
				async ({ input }) => {
					return this.settingsService.getMcpServerStatus(input.serverId);
				},
			),
		};
	}

	/**
	 * Serialize setting record for API response
	 * Converts Date objects to ISO strings
	 */
	private serializeSetting(setting: any): any {
		return {
			...setting,
			createdAt: setting.createdAt?.toISOString(),
			updatedAt: setting.updatedAt?.toISOString(),
		};
	}
}
