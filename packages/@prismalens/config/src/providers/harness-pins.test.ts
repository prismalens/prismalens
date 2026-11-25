// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HARNESS_IDS, HARNESS_REGISTRY, type HarnessId, installCommand } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const AGENTS = join(ROOT, "packages/@prismalens/providers/src/agent");
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Each agent's pin.json, by agent id. */
const pinOf = Object.fromEntries(
	readdirSync(AGENTS, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.flatMap((e) => {
			try {
				return [[e.name, json<{ cli: { package: string; version: string } }>(join(AGENTS, e.name, "pin.json"))]];
			} catch {
				return [];
			}
		}),
) as Record<string, { cli: { package: string; version: string } }>;
const { devDependencies: adapters } = json<{ devDependencies: Record<string, string> }>(
	join(ROOT, "packages/@prismalens/agent-adapters/package.json"),
);

// A row's `tested` is what CI proved. It moves only with a pin, in the bump PR that
// carries the new recording (#914), so a pin bump alone leaves this red.
describe("tested versions follow the pins CI installs (#914)", () => {
	it("opencode is tested on its CLI pin", () => {
		expect(HARNESS_REGISTRY.opencode.tested?.version).toBe(pinOf.opencode?.cli.version);
	});

	it("claude-code is tested on the adapter the app ships, with the pinned claude", () => {
		expect(HARNESS_REGISTRY["claude-code"].tested).toMatchObject({
			version: adapters["@agentclientprotocol/claude-agent-acp"],
			companion: pinOf["claude-code"]?.cli.version,
		});
	});

	it("codex is tested on the adapter the app ships, with the pinned codex", () => {
		expect(HARNESS_REGISTRY.codex.tested).toMatchObject({
			version: adapters["@agentclientprotocol/codex-acp"],
			companion: pinOf.codex?.cli.version,
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
		const off = HARNESS_IDS.filter((id) => {
			const channel = HARNESS_REGISTRY[id].channel;
			return channel && !HARNESS_REGISTRY[id].install.includes(installCommand(channel));
		});
		expect(off).toEqual([]);
	});

	it("OpenCode's hint names npm alone, the registry its pin follows", () => {
		expect(HARNESS_REGISTRY.opencode.channel).toEqual({ npm: "opencode-ai" });
		expect(HARNESS_REGISTRY.opencode.install).toBe(installCommand({ npm: "opencode-ai" }));
	});

	it("every agent with a pin installs its CLI package from that pin's channel", () => {
		expect(Object.keys(pinOf).map((id) => [id, channelPackage(id as HarnessId)])).toEqual(
			Object.entries(pinOf).map(([id, p]) => [id, p.cli.package]),
		);
	});
});
