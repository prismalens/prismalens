import { Controller, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import type { ModelsListResponse } from "@prismalens/contracts/schemas";
import { LlmSettingsService } from "./llm-settings.service.js";
import { SettingsService } from "./settings.service.js";

@UseGuards(ThrottlerGuard)
@Controller()
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly llmSettingsService: LlmSettingsService,
	) {}

	/**
	 * Implement the settings contract for LLM configuration
	 */
	@Implement(settingsContract.llm)
	llm() {
		return {
			getEnvStatus: implement(settingsContract.llm.getEnvStatus).handler(
				async () => {
					return this.llmSettingsService.getLlmEnvStatus();
				},
			),

			getSettings: implement(settingsContract.llm.getSettings).handler(
				async () => {
					return this.llmSettingsService.getLlmSettings();
				},
			),

			updateSettings: implement(settingsContract.llm.updateSettings).handler(
				async ({ input }) => {
					return this.llmSettingsService.updateLlmSettings(input);
				},
			),

			getModels: implement(settingsContract.llm.getModels).handler(
				async ({ input }) => {
					return this.llmSettingsService.getAvailableModels(
						input.provider,
					) as Promise<ModelsListResponse>;
				},
			),

			testConnection: implement(settingsContract.llm.testConnection).handler(
				async ({ input }) => {
					return this.llmSettingsService.testLlmConnectionWithEnv(
						input.provider,
						input.model,
						input.baseUrl,
					);
				},
			),

			saveCredential: implement(settingsContract.llm.saveCredential).handler(
				async ({ input }) => {
					await this.llmSettingsService.saveLlmCredential(
						input.provider,
						input.apiKey,
					);
					return { success: true };
				},
			),

			deleteCredential: implement(
				settingsContract.llm.deleteCredential,
			).handler(async ({ input }) => {
				await this.llmSettingsService.deleteLlmCredential(input.provider);
				return { success: true };
			}),

			getCredentialStatus: implement(
				settingsContract.llm.getCredentialStatus,
			).handler(async () => {
				const providers =
					await this.llmSettingsService.getLlmCredentialStatus();
				return { providers };
			}),
		};
	}

	/**
	 * Implement investigation policy routes
	 */
	@Implement(settingsContract.investigation)
	investigation() {
		return {
			getPolicies: implement(
				settingsContract.investigation.getPolicies,
			).handler(async () => {
				return this.settingsService.getInvestigationPolicies();
			}),

			updatePolicy: implement(
				settingsContract.investigation.updatePolicy,
			).handler(async ({ input }) => {
				const { tier, ...policy } = input;
				return this.settingsService.updateInvestigationPolicy(tier, policy);
			}),

			getLimits: implement(settingsContract.investigation.getLimits).handler(
				async () => {
					return this.settingsService.getInvestigationLimits();
				},
			),

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
			resetData: implement(settingsContract.danger.resetData).handler(
				async ({ input }) => {
					if (input.confirmation !== "RESET") {
						throw new ORPCError("BAD_REQUEST", {
							message: "Confirmation required",
						});
					}
					return this.settingsService.resetData();
				},
			),

			factoryReset: implement(settingsContract.danger.factoryReset).handler(
				async ({ input }) => {
					if (input.confirmation !== "FACTORY RESET") {
						throw new ORPCError("BAD_REQUEST", {
							message: "Confirmation required",
						});
					}
					return this.settingsService.factoryReset();
				},
			),
		};
	}
}
