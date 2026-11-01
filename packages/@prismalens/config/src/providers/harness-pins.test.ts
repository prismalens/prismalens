// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	installCommand,
} from "./harness.js";

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

	it("codex is tested on the adapter the app ships, with the pinned codex", () => {
		expect(HARNESS_REGISTRY.codex.tested).toMatchObject({
			version: adapters["@agentclientprotocol/codex-acp"],
			companion: pins["@openai/codex"],
		});
	});
});

// The hint a user follows and the pin CI installs come from one channel, so CI runs what users get (#1013).
describe("install hints name the channel the pins follow (#1013)", () => {
	const channelPackage = (id: HarnessId): string | undefined => {
		const channel = HARNESS_REGISTRY[id].channel;
		if (!channel) return undefined;
		return "npm" in channel ? channel.npm : channel.uv[0];
	};

	it("every row's hint gives its channel's command", () => {
		for (const id of HARNESS_IDS) {
			const channel = HARNESS_REGISTRY[id].channel;
			if (channel) expect(HARNESS_REGISTRY[id].install, id).toContain(installCommand(channel));
		}
	});

	it("OpenCode's hint names npm alone, the registry its pin follows", () => {
		expect(HARNESS_REGISTRY.opencode.channel).toEqual({ npm: "opencode-ai" });
		expect(HARNESS_REGISTRY.opencode.install).toBe(installCommand({ npm: "opencode-ai" }));
		expect(pins["opencode-ai"]).toBeDefined();
	});

	it("every pin is some row's channel package", () => {
		const packages = HARNESS_IDS.map(channelPackage);
		for (const pkg of Object.keys(pins)) expect(packages, pkg).toContain(pkg);
	});
});
