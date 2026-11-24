// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseProviderList } from "./harness-doctor.js";

// What `opencode auth list` 1.19.6 prints: @clack/prompts `intro`, `log.info("<name> <dim><type>")`
// and `outro` (cli/cmd/providers.ts, ProvidersListCommand), one space before the type.
const E = "\u001b";
const clack = (...lines: string[]) =>
	lines.join("\n") + "\n";
const OPENCODE_1_19_6 = clack(
	`${E}[90m┌${E}[39m  Credentials ${E}[90m~/.local/share/opencode/auth.json${E}[39m`,
	`${E}[90m│${E}[39m`,
	`${E}[34m●${E}[39m  Google ${E}[90moauth${E}[39m`,
	`${E}[90m│${E}[39m`,
	`${E}[34m●${E}[39m  Ollama Cloud ${E}[90mapi${E}[39m`,
	`${E}[90m│${E}[39m`,
	`${E}[90m└${E}[39m  2 credentials`,
	"",
	`${E}[90m┌${E}[39m  Environment`,
	`${E}[90m│${E}[39m`,
	`${E}[34m●${E}[39m  OpenAI ${E}[90mOPENAI_API_KEY${E}[39m`,
	`${E}[90m│${E}[39m`,
	`${E}[90m└${E}[39m  1 environment variable`,
);

describe("parseProviderList", () => {
	it("reads the provider names from the pinned CLI's list: stored logins, then env keys", () => {
		expect(parseProviderList(OPENCODE_1_19_6)).toEqual([
			"Google",
			"Ollama Cloud",
			"OpenAI",
		]);
	});

	it("reads the provider names from a CLI that pads its columns", () => {
		const out =
			"\u001b[0m\u001b[32mGoogle        OAuth                       stored\u001b[0m\r\nOllama Cloud  Ollama Cloud                stored\r\n";
		expect(parseProviderList(out)).toEqual(["Google", "Ollama Cloud"]);
	});

	it("reads none from a list that says it holds no credentials", () => {
		expect(parseProviderList("┌  Credentials\n│\n└  0 credentials\n")).toEqual(
			[],
		);
	});

	it("says it cannot tell from output it does not recognise, and from none", () => {
		expect(parseProviderList("")).toBeNull();
		expect(parseProviderList("error: unknown command\n")).toBeNull();
	});
});
