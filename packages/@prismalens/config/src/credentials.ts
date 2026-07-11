// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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

	if (process.env[envVar]?.trim()) {
		apiKey = process.env[envVar];
		source = "env";
	} else if (process.env[`${envVar}_FILE`]?.trim()) {
		apiKey = readEnv(envVar);
		apiKey = apiKey?.trim() ? apiKey : undefined;
		source = apiKey ? "file" : "none";
	}

	const provider = LLM_PROVIDERS[providerId];
	let baseURL = configBaseUrl;
	if (!baseURL) {
		baseURL = process.env[`${provider.id.toUpperCase()}_BASE_URL`];
	}
	// `custom` has no guessable endpoint — its registry defaultBaseUrl is UI
	// placeholder metadata, and silently resolving to it would re-open the
	// fail-open hole this resolver exists to close. Explicit config/env only.
	if (!baseURL && providerId !== "custom" && "defaultBaseUrl" in provider) {
		baseURL = provider.defaultBaseUrl;
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
