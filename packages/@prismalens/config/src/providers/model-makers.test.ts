// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { HARNESS_REGISTRY } from "../harness.js";
import { type IdentityEvidence, modelIdentity } from "./model-makers.js";

const evidence = (
	agent: string,
	model: string,
	env: IdentityEvidence["env"],
): IdentityEvidence => ({
	agent: { value: agent, source: "reported" },
	model: { value: model, source: "reported" },
	env,
});

describe("modelIdentity's provider (#1180)", () => {
	it("is the prefix OpenCode's own model id carries, as reported", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY.opencode,
			evidence("opencode", "google/gemini-2.5-flash", null),
		);
		expect(id.provider).toEqual({ value: "google", source: "reported" });
	});

	it("is unknown for Claude Code when ANTHROPIC_BASE_URL routes it", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY["claude-code"],
			evidence("claude-code", "claude-opus-5-5", {
				ANTHROPIC_BASE_URL: "https://gateway.example",
			}),
		);
		expect(id.provider).toEqual({ value: null, source: "unknown" });
	});

	it("is unknown for Claude Code on Foundry", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY["claude-code"],
			evidence("claude-code", "claude-opus-5-5", {
				CLAUDE_CODE_USE_FOUNDRY: "1",
			}),
		);
		expect(id.provider).toEqual({ value: null, source: "unknown" });
	});

	it("is anthropic, inferred, for Claude Code with no routing key in a known env", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY["claude-code"],
			evidence("claude-code", "claude-opus-5-5", { PATH: "/usr/bin" }),
		);
		expect(id.provider).toEqual({ value: "anthropic", source: "inferred" });
	});

	it("is unknown for Claude Code when the run env is not known", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY["claude-code"],
			evidence("claude-code", "claude-opus-5-5", null),
		);
		expect(id.provider).toEqual({ value: null, source: "unknown" });
	});

	it("is unknown for Codex when the run env is not known", () => {
		const id = modelIdentity(
			HARNESS_REGISTRY.codex,
			evidence("codex", "gpt-6.2-sol", null),
		);
		expect(id.provider).toEqual({ value: null, source: "unknown" });
	});

	it("keeps a reported provider over the vendor, and the evidence's maker as inferred", () => {
		const id = modelIdentity(HARNESS_REGISTRY.codex, {
			...evidence("codex", "gpt-6.2-sol", {}),
			reportedProvider: "azure",
			maker: "openai",
		});
		expect(id).toEqual({
			agent: { value: "codex", source: "reported" },
			provider: { value: "azure", source: "reported" },
			maker: { value: "openai", source: "inferred" },
			model: { value: "gpt-6.2-sol", source: "reported" },
		});
	});
});
