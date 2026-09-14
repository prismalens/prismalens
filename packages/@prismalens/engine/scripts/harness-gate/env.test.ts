// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it } from "vitest";
import { assertLoopback, harnessEnv } from "./env.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

describe("harnessEnv", () => {
	it("never forwards a login token or API key from the parent", () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "sub-token";
		process.env.ANTHROPIC_API_KEY = "sk-real";
		process.env.OPENAI_API_KEY = "sk-real";
		const env = harnessEnv("/fixture/home", {});
		expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.HOME).toBe("/fixture/home");
	});
});

describe("assertLoopback", () => {
	it("accepts a local endpoint", () => {
		expect(() => assertLoopback("http://localhost:11434")).not.toThrow();
		expect(() => assertLoopback("http://127.0.0.1:11434/v1")).not.toThrow();
	});

	it("refuses any remote endpoint, including Anthropic's", () => {
		expect(() => assertLoopback("https://api.anthropic.com")).toThrow();
		expect(() => assertLoopback("https://ollama.com")).toThrow();
	});
});
