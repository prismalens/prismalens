/**
 * Models Registry - models.dev Integration
 *
 * Fetches model metadata from models.dev API with caching and bundled fallback.
 * Provides pricing, context limits, and capability information.
 */

import type { LLMProviderId } from "./providers.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ModelMetadata {
	id: string;
	name: string;
	provider: string;
	cost: { input: number; output: number };
	limit: { context: number; output: number };
	toolCall: boolean;
	reasoning: boolean;
	modalities: { input: string[]; output: string[] };
	releaseDate?: string; // ISO date string for sorting (newest first)
}

// models.dev response structure: { "provider-id": { id, name, models: { "model-id": {...} } } }
interface ModelsDevModel {
	id: string;
	name?: string;
	cost?: { input: number; output: number };
	limit?: { context: number; output: number };
	tool_call?: boolean;
	reasoning?: boolean;
	modalities?: { input: string[]; output: string[] };
	release_date?: string; // ISO date string
}

interface ModelsDevProvider {
	id: string;
	name: string;
	models?: Record<string, ModelsDevModel>;
}

type ModelsDevResponse = Record<string, ModelsDevProvider>;

// Map models.dev provider IDs to our provider IDs
const PROVIDER_ID_MAP: Record<string, LLMProviderId> = {
	anthropic: "anthropic",
	openai: "openai",
	google: "google",
	groq: "groq",
	openrouter: "openrouter",
	// ollama is local, not in models.dev
};

let cachedModels: ModelMetadata[] | null = null;
let cacheTimestamp = 0;

function transformModelsData(data: ModelsDevResponse): ModelMetadata[] {
	const models: ModelMetadata[] = [];

	for (const [providerKey, provider] of Object.entries(data)) {
		const mappedProviderId = PROVIDER_ID_MAP[providerKey];
		if (!mappedProviderId || !provider.models) continue;

		for (const [, model] of Object.entries(provider.models)) {
			models.push({
				id: model.id,
				name: model.name || model.id,
				provider: mappedProviderId,
				cost: model.cost || { input: 0, output: 0 },
				limit: model.limit || { context: 0, output: 0 },
				toolCall: model.tool_call ?? false,
				reasoning: model.reasoning ?? false,
				modalities: model.modalities || { input: ["text"], output: ["text"] },
				releaseDate: model.release_date,
			});
		}
	}

	return models;
}

// Bundled fallback data - loaded lazily
let bundledModels: ModelsDevResponse | null = null;

async function loadBundledModels(): Promise<ModelsDevResponse> {
	if (bundledModels) return bundledModels;

	try {
		const module = await import("./data/models-fallback.json", {
			with: { type: "json" },
		});
		bundledModels = module.default as ModelsDevResponse;
		return bundledModels;
	} catch {
		bundledModels = {};
		return bundledModels;
	}
}

/**
 * Fetch model registry from models.dev with caching
 */
export async function getModelsRegistry(): Promise<ModelMetadata[]> {
	const now = Date.now();

	if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
		return cachedModels;
	}

	try {
		const response = await fetch(MODELS_DEV_URL);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const data = (await response.json()) as ModelsDevResponse;

		// transformModelsData already filters to supported providers via PROVIDER_ID_MAP
		cachedModels = transformModelsData(data);
		cacheTimestamp = now;

		return cachedModels;
	} catch (error) {
		console.warn("Failed to fetch models.dev, using bundled fallback:", error);
		const fallback = await loadBundledModels();
		return transformModelsData(fallback);
	}
}

/**
 * Get models for a specific provider
 */
export async function getModelsForProvider(
	provider: string,
): Promise<ModelMetadata[]> {
	const models = await getModelsRegistry();
	return models.filter((m) => m.provider === provider);
}

/**
 * Get models that support function/tool calling (required for agents)
 */
export async function getAgentCompatibleModels(): Promise<ModelMetadata[]> {
	const models = await getModelsRegistry();
	return models.filter((m) => m.toolCall === true);
}

/**
 * Get model by ID
 */
export async function getModelById(
	modelId: string,
): Promise<ModelMetadata | undefined> {
	const models = await getModelsRegistry();
	return models.find((m) => m.id === modelId);
}

/**
 * Get models with reasoning capabilities
 */
export async function getReasoningModels(): Promise<ModelMetadata[]> {
	const models = await getModelsRegistry();
	return models.filter((m) => m.reasoning === true);
}

/**
 * Force refresh the cache
 */
export async function refreshModelsCache(): Promise<ModelMetadata[]> {
	cachedModels = null;
	cacheTimestamp = 0;
	return getModelsRegistry();
}
