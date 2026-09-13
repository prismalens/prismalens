// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { getHarnessProviderKeys, HARNESS_REGISTRY } from "./harness.js";

describe("getHarnessProviderKeys (ADR 0004 §5, trust floor)", () => {
	it("returns only the registry row's provider keys present in the source env", () => {
		const env = {
			ANTHROPIC_API_KEY: "sk-ant-test",
			OPENAI_API_KEY: "sk-oai-test",
			UNRELATED_VAR: "noise",
		};
		expect(getHarnessProviderKeys("claude-code", env)).toEqual({
			ANTHROPIC_API_KEY: "sk-ant-test",
		});
	});

	it("never returns a PRISMALENS_* key, even if a row were misconfigured to list one", () => {
		const original = HARNESS_REGISTRY["claude-code"].providerKeys;
		HARNESS_REGISTRY["claude-code"].providerKeys = [
			"PRISMALENS_AUTH_SECRET",
			"ANTHROPIC_API_KEY",
		];
		try {
			const result = getHarnessProviderKeys("claude-code", {
				PRISMALENS_AUTH_SECRET: "leak-me",
				ANTHROPIC_API_KEY: "sk-ant-test",
			});
			expect(result.PRISMALENS_AUTH_SECRET).toBeUndefined();
			expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-test");
		} finally {
			HARNESS_REGISTRY["claude-code"].providerKeys = original;
		}
	});

	it("omits a provider key the source env does not set", () => {
		expect(getHarnessProviderKeys("gemini", {})).toEqual({});
	});

	it("defaults to process.env when no source env is given", () => {
		process.env.GEMINI_API_KEY = "test-gemini-key";
		try {
			expect(getHarnessProviderKeys("gemini")).toEqual({
				GEMINI_API_KEY: "test-gemini-key",
			});
		} finally {
			delete process.env.GEMINI_API_KEY;
		}
	});

	it("lists real provider keys for every multi-provider harness row, never a bare wildcard", () => {
		for (const [id, descriptor] of Object.entries(HARNESS_REGISTRY)) {
			for (const key of descriptor.providerKeys ?? []) {
				expect(key.endsWith("*"), `${id} providerKeys must not use a wildcard`).toBe(
					false,
				);
			}
		}
	});
});
