"use client";

import type { ModelMetadata } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";

interface OllamaTagsModel {
	name: string;
	model: string;
	size: number;
	details: {
		parameter_size: string;
		family: string;
		quantization_level: string;
	};
}

interface OllamaTagsResponse {
	models: OllamaTagsModel[];
}

function toModelMetadata(m: OllamaTagsModel): ModelMetadata {
	return {
		id: m.name,
		name: `${m.name} (${m.details.parameter_size}, ${m.details.quantization_level})`,
		provider: "ollama",
		cost: { input: 0, output: 0 },
		limit: { context: 0, output: 0 },
		toolCall: false,
		reasoning: false,
		modalities: { input: ["text"], output: ["text"] },
	};
}

/**
 * Fetch locally available Ollama models from the /api/tags endpoint.
 * Only enabled when a base URL is provided.
 */
export function useOllamaModels(baseUrl: string | undefined) {
	return useQuery<ModelMetadata[]>({
		queryKey: ["ollama-models", baseUrl],
		queryFn: async () => {
			// Protocol validation — block non-http(s) schemes
			const parsed = new URL(baseUrl!);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new Error(`Unsupported protocol: ${parsed.protocol}`);
			}
			// Use parsed.origin to prevent path/query injection from raw baseUrl
			const res = await fetch(`${parsed.origin}/api/tags`);
			if (!res.ok) throw new Error("Failed to fetch Ollama models");
			const data: OllamaTagsResponse = await res.json();
			return data.models.map(toModelMetadata);
		},
		enabled: !!baseUrl?.trim(),
		retry: 1,
		staleTime: 60_000,
	});
}
