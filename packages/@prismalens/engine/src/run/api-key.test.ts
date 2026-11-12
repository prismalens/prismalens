// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { apiKeyIn } from "./investigate.js";

const CLAUDE = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_MODEL",
];

describe("apiKeyIn (#1101)", () => {
	it.each([
		["an API key", { ANTHROPIC_API_KEY: "sk-ant-x" }, true],
		["an auth token", { ANTHROPIC_AUTH_TOKEN: "t" }, true],
		["only a base URL and a model", { ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_MODEL: "m" }, false],
		["a blank key", { ANTHROPIC_API_KEY: "  " }, false],
		["no variables", {}, false],
	])("a Claude Code env with %s reads as keyed: %s", (_what, env, keyed) => {
		expect(apiKeyIn(env, CLAUDE)).toBe(keyed);
	});

	it("an agent that names no key variables is never keyed", () => {
		expect(apiKeyIn({ OPENAI_API_KEY: "sk-x" }, [])).toBe(false);
		expect(apiKeyIn({ OPENAI_API_KEY: "sk-x" }, undefined)).toBe(false);
	});
});
