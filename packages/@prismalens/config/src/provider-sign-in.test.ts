// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	preferredModel,
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

describe("an agent with a provider check and no model named", () => {
	it("is unchecked, never na, so it is never reported ready", () => {
		expect(providerSignIn("opencode", held, null)).toBe("unchecked");
		expect(providerSignIn("opencode", held, undefined)).toBe("unchecked");
		expect(providerSignIn("opencode", held, "gemini-4-neon")).toBe("unchecked");
		expect(providerSignIn("claude-code", held, null)).toBe("na");
	});
});

describe("preferredModel", () => {
	const entries = [
		{ id: "anthropic/claude-5" },
		{ id: "ollama-cloud/qwen" },
		{ id: "google/gemini-4-neon" },
	];
	it("keeps the agent's own model when its provider is signed in", () => {
		expect(
			preferredModel(
				"opencode",
				{ providers: ["Google"], servedModel: "google/gemini-4-neon" },
				entries,
			),
		).toBe("google/gemini-4-neon");
	});

	it("moves to the first listed model whose provider is signed in when the agent's own is not", () => {
		expect(
			preferredModel(
				"opencode",
				{ providers: ["Ollama Cloud"], servedModel: "google/gemini-4-neon" },
				entries,
			),
		).toBe("ollama-cloud/qwen");
	});

	it("keeps the agent's own model when its logins were not read", () => {
		expect(
			preferredModel(
				"opencode",
				{ providers: null, servedModel: "google/gemini-4-neon" },
				entries,
			),
		).toBe("google/gemini-4-neon");
	});

	it("names none when no listed model is signed in, and none for an agent with no provider check", () => {
		expect(
			preferredModel(
				"opencode",
				{ providers: [], servedModel: "google/gemini-4-neon" },
				entries,
			),
		).toBe("google/gemini-4-neon");
		expect(
			preferredModel("claude-code", { providers: [], servedModel: null }, entries),
		).toBeNull();
	});
});
