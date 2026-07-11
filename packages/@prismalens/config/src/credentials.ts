import { readEnv } from "./env/readers.js";
import {
	getApiKeyEnvVar,
	LLM_PROVIDERS,
	type LLMProviderId,
} from "./providers/llm.js";

export type ResolvedCredentials = {
	providerId: LLMProviderId;
	source: "env" | "file" | "none";
	apiKey?: string;
	baseURL?: string;
};

export function ensureV1(baseURL: string): string {
	const trimmed = baseURL.replace(/\/$/, "");
	if (trimmed.endsWith("/v1")) return trimmed;
	return `${trimmed}/v1`;
}

export function resolveCredentials(
	providerId: LLMProviderId,
	configBaseUrl?: string,
): ResolvedCredentials {
	const envVar = getApiKeyEnvVar(providerId);
	let apiKey: string | undefined;
	let source: "env" | "file" | "none" = "none";

	if (process.env[envVar] !== undefined) {
		apiKey = process.env[envVar];
		source = "env";
	} else if (process.env[`${envVar}_FILE`] !== undefined) {
		apiKey = readEnv(envVar);
		source = "file";
	}

	const provider = LLM_PROVIDERS[providerId];
	let baseURL = configBaseUrl;
	if (!baseURL) {
		baseURL = process.env[`${provider.id.toUpperCase()}_BASE_URL`];
	}
	if (!baseURL && "defaultBaseUrl" in provider) {
		baseURL = (provider as any).defaultBaseUrl;
	}

	if (
		baseURL &&
		(providerId === "openai" ||
			providerId === "custom" ||
			providerId === "ollama")
	) {
		baseURL = ensureV1(baseURL);
	}

	return {
		providerId,
		source,
		...(apiKey !== undefined ? { apiKey } : {}),
		...(baseURL !== undefined ? { baseURL } : {}),
	};
}
