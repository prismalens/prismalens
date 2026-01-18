import { Injectable, NotFoundException } from "@nestjs/common";
import { createLLM } from "@prismalens/agents";
import { PrismaService } from "../prisma/prisma.service.js";
import { UpdateLlmDto } from "./dto/update-llm.dto.js";

@Injectable()
export class SettingsService {
	constructor(private prisma: PrismaService) {}

	private getProviderKey(provider: string) {
		return `LLM_CONFIG_${provider.toUpperCase()}`;
	}

	async getAllLlmConfigs() {
		// Fetch all settings that start with LLM_CONFIG_
		const allSettings = await this.prisma.setting.findMany({
			where: {
				key: { startsWith: "LLM_CONFIG_" },
			},
		});

		const activeSetting = await this.prisma.setting.findUnique({
			where: { key: "LLM_ACTIVE_PROVIDER" },
		});

		return {
			activeProvider: activeSetting
				? JSON.parse(activeSetting.value).provider
				: null,
			providers: allSettings.map((s) => {
				const providerName = s.key.replace("LLM_CONFIG_", "").toLowerCase();
				const val = JSON.parse(s.value);
				return {
					provider: providerName,
					model: val.model,
					hasApiKey: !!val.apiKey, // Do not return raw API key
					baseUrl: val.baseUrl,
				};
			}),
		};
	}

	async getLlmConfig(provider: string) {
		const key = this.getProviderKey(provider);
		const setting = await this.prisma.setting.findUnique({
			where: { key },
		});

		if (!setting) {
			throw new NotFoundException(
				`No configuration found for provider: ${provider}`,
			);
		}

		const val = JSON.parse(setting.value);
		// Mask API key for UI
		return {
			...val,
			apiKey: "********",
		};
	}

	async updateLlmConfig(provider: string, dto: UpdateLlmDto) {
		const key = this.getProviderKey(provider);

		// Store all LangChain config fields
		const configValue: Record<string, unknown> = {
			apiKey: dto.apiKey,
			model: dto.model,
			baseUrl: dto.baseUrl,
			// Common LangChain fields
			temperature: dto.temperature,
			maxTokens: dto.maxTokens,
			topP: dto.topP,
			// Provider-specific fields
			topK: dto.topK,
			frequencyPenalty: dto.frequencyPenalty,
			presencePenalty: dto.presencePenalty,
			stopSequences: dto.stopSequences,
		};

		// Remove undefined values
		const cleanedConfig = Object.fromEntries(
			Object.entries(configValue).filter(([_, v]) => v !== undefined),
		);

		const value = JSON.stringify(cleanedConfig);

		return this.prisma.setting.upsert({
			where: { key },
			update: { value, type: "json", category: "ai" },
			create: { key, value, type: "json", category: "ai" },
		});
	}

	/**
	 * Test LLM connection by making a simple API call.
	 * This validates the API key and model before saving.
	 */
	async testLlmConnection(
		provider: string,
		dto: UpdateLlmDto,
	): Promise<{ success: boolean; error?: string }> {
		try {
			// Create LLM instance with the provided config
			const llm = createLLM({
				provider,
				apiKey: dto.apiKey,
				modelName: dto.model,
				temperature: dto.temperature ?? 0,
				maxTokens: dto.maxTokens ?? 100, // Limit tokens for test
			});

			// Send a simple test message (LangChain accepts string input)
			await llm.invoke('Reply with just "OK" to confirm connection.');

			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	async deleteLlmConfig(provider: string) {
		const key = this.getProviderKey(provider);

		// Check if active
		const activeSetting = await this.prisma.setting.findUnique({
			where: { key: "LLM_ACTIVE_PROVIDER" },
		});

		if (
			activeSetting &&
			JSON.parse(activeSetting.value).provider === provider
		) {
			// Unset active if we are deleting it
			await this.prisma.setting.delete({
				where: { key: "LLM_ACTIVE_PROVIDER" },
			});
		}

		return this.prisma.setting.delete({
			where: { key },
		});
	}

	async setActiveProvider(provider: string) {
		// Verify config exists using count instead of findUnique to avoid fetching data
		const key = this.getProviderKey(provider);
		const count = await this.prisma.setting.count({ where: { key } });

		if (count === 0) {
			throw new NotFoundException(`Provider ${provider} not configured`);
		}

		return this.prisma.setting.upsert({
			where: { key: "LLM_ACTIVE_PROVIDER" },
			update: {
				value: JSON.stringify({ provider }),
				type: "json",
				category: "ai",
			},
			create: {
				key: "LLM_ACTIVE_PROVIDER",
				value: JSON.stringify({ provider }),
				type: "json",
				category: "ai",
			},
		});
	}

	// INTERNAL method for Worker
	async getActiveLlmConfigInternal() {
		const activeSetting = await this.prisma.setting.findUnique({
			where: { key: "LLM_ACTIVE_PROVIDER" },
		});

		if (!activeSetting) {
			return null;
		}

		const provider = JSON.parse(activeSetting.value).provider;
		const key = this.getProviderKey(provider);

		const configSetting = await this.prisma.setting.findUnique({
			where: { key },
		});

		if (!configSetting) {
			return null;
		}

		const config = JSON.parse(configSetting.value);
		return {
			provider,
			...config,
		};
	}

	// =============================================================================
	// INVESTIGATION POLICIES
	// =============================================================================

	private readonly DEFAULT_POLICIES = {
		tier_1: {
			tier: "tier_1" as const,
			autoInvestigate: "always" as const,
			requiresApproval: true,
			pageOnCall: true,
			postToSlack: true,
		},
		tier_2: {
			tier: "tier_2" as const,
			autoInvestigate: "critical_high" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
		},
		tier_3: {
			tier: "tier_3" as const,
			autoInvestigate: "manual" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
		},
		tier_4: {
			tier: "tier_4" as const,
			autoInvestigate: "never" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: false,
		},
	};

	private readonly DEFAULT_LIMITS = {
		maxConcurrent: 5,
		timeoutMinutes: 30,
		maxToolCalls: 50,
	};

	async getInvestigationPolicies() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		if (!setting) {
			// Return defaults
			return {
				policies: Object.values(this.DEFAULT_POLICIES),
			};
		}

		const saved = JSON.parse(setting.value);
		// Merge with defaults to ensure all tiers exist
		const policies = Object.keys(this.DEFAULT_POLICIES).map((tier) => ({
			...this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES],
			...(saved[tier] || {}),
			tier: tier as "tier_1" | "tier_2" | "tier_3" | "tier_4",
		}));

		return { policies };
	}

	async updateInvestigationPolicy(
		tier: string,
		dto: {
			autoInvestigate?: string;
			requiresApproval?: boolean;
			pageOnCall?: boolean;
			postToSlack?: boolean;
		},
	) {
		// Get current policies
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		const current = setting
			? JSON.parse(setting.value)
			: { ...this.DEFAULT_POLICIES };

		// Update the specific tier
		current[tier] = {
			...(current[tier] ||
				this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES]),
			...dto,
			tier,
		};

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_POLICIES" },
			update: { value: JSON.stringify(current), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_POLICIES",
				value: JSON.stringify(current),
				type: "json",
				category: "ai",
			},
		});

		return current[tier];
	}

	async getInvestigationLimits() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_LIMITS" },
		});

		if (!setting) {
			return this.DEFAULT_LIMITS;
		}

		return {
			...this.DEFAULT_LIMITS,
			...JSON.parse(setting.value),
		};
	}

	async updateInvestigationLimits(dto: {
		maxConcurrent?: number;
		timeoutMinutes?: number;
		maxToolCalls?: number;
	}) {
		const current = await this.getInvestigationLimits();
		const updated = { ...current, ...dto };

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_LIMITS" },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_LIMITS",
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	// =============================================================================
	// DANGER ZONE OPERATIONS
	// =============================================================================

	async resetData() {
		// Delete in order to respect foreign key constraints
		await this.prisma.$transaction([
			// Delete recommendations first (references investigations)
			this.prisma.recommendation.deleteMany({}),
			// Delete tool executions (references agent executions)
			this.prisma.toolExecution.deleteMany({}),
			// Delete agent executions (references investigations)
			this.prisma.agentExecution.deleteMany({}),
			// Delete investigations (references incidents)
			this.prisma.investigation.deleteMany({}),
			// Delete timeline entries (references incidents)
			this.prisma.timelineEntry.deleteMany({}),
			// Delete postmortems (references incidents)
			this.prisma.postmortem.deleteMany({}),
			// Delete incidents (references alerts)
			this.prisma.incident.deleteMany({}),
			// Delete alerts (references events)
			this.prisma.alert.deleteMany({}),
			// Delete events
			this.prisma.event.deleteMany({}),
		]);

		return { success: true, message: "All data has been reset" };
	}

	async factoryReset() {
		// Delete EVERYTHING except the owner user
		await this.prisma.$transaction([
			// First reset data
			this.prisma.recommendation.deleteMany({}),
			this.prisma.toolExecution.deleteMany({}),
			this.prisma.agentExecution.deleteMany({}),
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
			this.prisma.postmortem.deleteMany({}),
			this.prisma.incident.deleteMany({}),
			this.prisma.alert.deleteMany({}),
			this.prisma.event.deleteMany({}),
			// Delete services and related
			this.prisma.serviceSuggestion.deleteMany({}),
			this.prisma.serviceIntegration.deleteMany({}),
			this.prisma.serviceDependency.deleteMany({}),
			this.prisma.alertMappingRule.deleteMany({}),
			this.prisma.service.deleteMany({}),
			// Delete integrations
			this.prisma.integrationConnection.deleteMany({}),
			// Delete correlation rules
			this.prisma.correlationRule.deleteMany({}),
			// Delete all settings
			this.prisma.setting.deleteMany({}),
			// Delete sessions but keep users for now (they need to re-setup)
			this.prisma.session.deleteMany({}),
		]);

		return { success: true, message: "Factory reset complete" };
	}
}
