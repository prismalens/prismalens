// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { getHarnessProviderKeys, HARNESS_REGISTRY } from "./harness.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

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
		vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
		expect(getHarnessProviderKeys("gemini")).toEqual({
			GEMINI_API_KEY: "test-gemini-key",
		});
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

describe("harness isolation (ADR 0004 §1, #637)", () => {
	const runEnv = { configDir: "/c", dataDir: "/d", cwd: "/w" };

	it("opencode ignores the snapshot's own config and keeps looping after a refusal", () => {
		const row = HARNESS_REGISTRY.opencode;
		expect(row.acpEnv(runEnv)).toMatchObject({
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		});
		const config = JSON.parse(row.configFiles?.(runEnv)["opencode.json"] ?? "{}");
		expect(config.permission).toMatchObject({
			webfetch: "deny",
			websearch: "deny",
			external_directory: "deny",
		});
		expect(config.experimental).toEqual({ continue_loop_on_deny: true });
	});

	it("claude-code takes the operator's model for every tier", () => {
		const env = HARNESS_REGISTRY["claude-code"].acpEnv({ ...runEnv, model: "gemma4:31b-cloud" });
		for (const key of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
			expect(env[key]).toBe("gemma4:31b-cloud");
		}
		expect(HARNESS_REGISTRY["claude-code"].acpEnv(runEnv).ANTHROPIC_MODEL).toBeUndefined();
	});

	it("claude-code loads no setting sources from the snapshot", () => {
		expect(HARNESS_REGISTRY["claude-code"].sessionMeta?.()).toEqual({
			claudeCode: { options: { settingSources: [] } },
		});
	});
});

describe("gateway URL (claude-code)", () => {
	it("passes https and loopback http, refuses http to another host", () => {
		for (const ok of ["https://gw.example.com", "http://127.0.0.1:11434", "http://localhost:4000"]) {
			expect(getHarnessProviderKeys("claude-code", { ANTHROPIC_BASE_URL: ok }).ANTHROPIC_BASE_URL).toBe(ok);
		}
		expect(() =>
			getHarnessProviderKeys("claude-code", { ANTHROPIC_BASE_URL: "http://gw.lan:4000", ANTHROPIC_AUTH_TOKEN: "t" }),
		).toThrow(/must be https/);
	});
});
