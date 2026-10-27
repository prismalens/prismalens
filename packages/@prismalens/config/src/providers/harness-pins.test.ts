// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HARNESS_REGISTRY } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const json = <T>(path: string): T =>
	JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;

const { pins } = json<{ pins: Record<string, string> }>("scripts/agent-pins.json");
const { devDependencies: adapters } = json<{ devDependencies: Record<string, string> }>(
	"packages/@prismalens/agent-adapters/package.json",
);

// A row's `tested` is what CI proved. It moves only with a pin, in the bump PR that
// carries the new recording (#914), so a pin bump alone leaves this red.
describe("tested versions follow the pins CI installs (#914)", () => {
	it("opencode is tested on the opencode-ai pin", () => {
		expect(HARNESS_REGISTRY.opencode.tested?.version).toBe(pins["opencode-ai"]);
	});

	it("claude-code is tested on the adapter the app ships, with the pinned claude", () => {
		expect(HARNESS_REGISTRY["claude-code"].tested).toMatchObject({
			version: adapters["@agentclientprotocol/claude-agent-acp"],
			companion: pins["@anthropic-ai/claude-code"],
		});
	});

	it("codex is tested on the adapter the app ships", () => {
		expect(HARNESS_REGISTRY.codex.tested?.version).toBe(
			adapters["@agentclientprotocol/codex-acp"],
		);
	});
});
