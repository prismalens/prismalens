import {
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { getApiKeyEnvVar, type LLMProviderId } from "@prismalens/config/llm";
import { Public } from "../../core/auth/public.decorator.js";
import { LlmSettingsService } from "../../core/settings/llm-settings.service.js";
import { InternalGuard } from "./guards/internal.guard.js";

/**
 * Internal API for LLM credential retrieval.
 * Used by the worker to fetch resolved LLM config per-job.
 * Protected by InternalGuard (requires X-Internal-Secret header).
 *
 * SECURITY: Returns the active API key for the configured provider.
 * Only accessible via X-Internal-Secret — never exposed publicly.
 * @Public() bypasses session-based AuthGuard — InternalGuard handles auth via X-Internal-Secret.
 */
@Public()
@ApiExcludeController()
@Controller("internal/settings")
@UseGuards(InternalGuard)
export class InternalSettingsController {
	constructor(private readonly llmSettingsService: LlmSettingsService) {}

	/**
	 * Get resolved LLM configuration: provider, model, and API key.
	 * Worker calls this per-job to get the active LLM config.
	 *
	 * Resolution order for provider/model:
	 * 1. DB settings (activeProvider, providers[provider].model)
	 * 2. Env vars (PRISMALENS_LLM_PROVIDER, PRISMALENS_LLM_MODEL)
	 *
	 * API key resolution via LlmSettingsService.resolveApiKey():
	 * Reads from process.env which is populated from both DB-saved
	 * encrypted credentials (at startup) and direct env vars.
	 *
	 * GET /internal/settings/llm-credentials
	 */
	@Get("llm-credentials")
	@HttpCode(HttpStatus.OK)
	async getLlmCredentials(): Promise<{
		provider: string | null;
		model: string | null;
		credentials: Record<string, string>;
	}> {
		const settings = await this.llmSettingsService.getLlmSettings();
		const provider =
			settings.activeProvider ??
			(process.env.PRISMALENS_LLM_PROVIDER as LLMProviderId | undefined) ??
			null;
		const model = provider
			? (settings.providers[provider as LLMProviderId]?.model ??
				process.env.PRISMALENS_LLM_MODEL ??
				null)
			: (process.env.PRISMALENS_LLM_MODEL ?? null);

		const credentials: Record<string, string> = {};
		if (provider) {
			const apiKey = this.llmSettingsService.resolveApiKey(
				provider as LLMProviderId,
			);
			const envVar = getApiKeyEnvVar(provider as LLMProviderId);
			if (envVar && apiKey) {
				credentials[envVar] = apiKey;
			}
		}

		return { provider, model, credentials };
	}
}
