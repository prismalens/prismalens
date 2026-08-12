// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Regression cover for PR #396 thread B: keylessness must be an explicit flag.
 * Inferring it from `envVar` made every provider look key-required, which left
 * "Test & continue" permanently disabled for a local-Ollama setup.
 */

import { describe, expect, it } from "vitest";
import {
	isLLMProviderId,
	LLM_PROVIDER_IDS,
	LLM_PROVIDERS,
	providerRequiresApiKey,
} from "./llm.js";

const KEYLESS = ["ollama", "custom"] as const;

describe("LLM_PROVIDERS keylessness", () => {
	it("names an env var for every provider, including the keyless ones", () => {
		// The premise of the bug: `envVar !== null` can never discriminate.
		for (const id of LLM_PROVIDER_IDS) {
			expect(LLM_PROVIDERS[id].envVar).toEqual(expect.any(String));
		}
	});

	it("declares requiresApiKey on every provider", () => {
		for (const id of LLM_PROVIDER_IDS) {
			expect(typeof LLM_PROVIDERS[id].requiresApiKey).toBe("boolean");
		}
	});

	it("treats ollama and custom as keyless and every cloud provider as keyed", () => {
		for (const id of LLM_PROVIDER_IDS) {
			const keyless = (KEYLESS as readonly string[]).includes(id);
			expect(providerRequiresApiKey(id)).toBe(!keyless);
		}
	});
});

describe("isLLMProviderId", () => {
	it("accepts every registered id and rejects anything else", () => {
		for (const id of LLM_PROVIDER_IDS) {
			expect(isLLMProviderId(id)).toBe(true);
		}
		expect(isLLMProviderId("not-a-provider")).toBe(false);
		// Prototype keys must not pass as providers.
		expect(isLLMProviderId("toString")).toBe(false);
	});
});
