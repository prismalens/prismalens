// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	providerSignedOutLine,
	providerSignIn,
} from "./providers/harness.js";

const held = { providers: ["Google", "Ollama Cloud"] };

describe("providerSignIn", () => {
	it("is signed in for a model whose provider the agent lists, by name or id", () => {
		expect(providerSignIn("opencode", held, "google/gemini-4-neon")).toBe(
			"signed-in",
		);
		expect(providerSignIn("opencode", held, "ollama-cloud/qwen")).toBe(
			"signed-in",
		);
	});

	it("is signed out for a provider the agent holds no login for", () => {
		expect(providerSignIn("opencode", held, "anthropic/claude-5")).toBe(
			"signed-out",
		);
		expect(providerSignedOutLine("opencode", "anthropic/claude-5")).toBe(
			"OpenCode is not signed in to Anthropic. Sign in with its own CLI, then retry.",
		);
	});

	it("is unchecked, never signed in, when its login list was not read", () => {
		expect(providerSignIn("opencode", { providers: null }, "google/x")).toBe(
			"unchecked",
		);
		expect(providerSignIn("opencode", null, "google/x")).toBe("unchecked");
	});

	it("runs the agent's own keyless provider with no login, and has no check for an agent without one", () => {
		expect(providerSignIn("opencode", held, "opencode/big-pickle")).toBe(
			"signed-in",
		);
		expect(providerSignIn("claude-code", null, "anthropic/claude-5")).toBe("na");
	});
});
