// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ACCESS_LEVELS,
	AGENT_IDS,
	AGENT_REGISTRY,
	GATEWAY_RUN_FILE,
	isSafeGatewayUrl,
	levelOfAgentMode,
	MODE_NAMES,
	modeName,
	reservedEnvNames,
	resolveLevel,
	USER_SETUPS,
} from "./registry/index.js";

describe("levels", () => {
	it("are exactly the four ids app.prisma stores", () => {
		expect(ACCESS_LEVELS).toEqual(["supervised", "auto-edits", "auto", "full-access"]);
	});

	it("map every agent and level to its mode, fallback and mechanism", () => {
		const table = Object.fromEntries(
			AGENT_IDS.map((agent) => [
				agent,
				Object.fromEntries(
					ACCESS_LEVELS.map((level) => {
						const r = resolveLevel(agent, level);
						return [level, [r.mode?.id ?? null, r.fallback?.id ?? null, r.mechanism]];
					}),
				),
			]),
		);
		expect(table).toEqual({
			opencode: {
				supervised: ["build", null, "opencode-permission"],
				"auto-edits": ["build", null, "opencode-permission"],
				auto: ["build", null, "opencode-permission"],
				"full-access": ["build", null, "opencode-permission"],
			},
			"claude-code": {
				supervised: ["default", null, "acp-mode"],
				"auto-edits": ["acceptEdits", null, "acp-mode"],
				auto: ["auto", "acceptEdits", "acp-mode"],
				"full-access": ["bypassPermissions", "acceptEdits", "acp-mode"],
			},
			codex: {
				supervised: ["read-only", null, "acp-config"],
				"auto-edits": ["workspace-write", "read-only", "acp-config"],
				auto: ["agent", null, "acp-config"],
				"full-access": ["agent-full-access", null, "acp-config"],
			},
			gemini: {
				supervised: ["default", null, "acp-mode"],
				"auto-edits": ["autoEdit", null, "acp-mode"],
				auto: ["default", null, "acp-mode"],
				"full-access": ["yolo", null, "acp-mode"],
			},
			deepagents: {
				supervised: [null, null, "none"],
				"auto-edits": [null, null, "none"],
				auto: [null, null, "none"],
				"full-access": [null, null, "none"],
			},
			local: {
				supervised: [null, null, "none"],
				"auto-edits": [null, null, "none"],
				auto: [null, null, "none"],
				"full-access": [null, null, "none"],
			},
		});
	});

	it("name every mode a level uses by the agent's own name", () => {
		for (const agent of AGENT_IDS)
			for (const level of ACCESS_LEVELS) {
				const r = resolveLevel(agent, level);
				for (const m of [r.mode, r.fallback])
					if (m) expect(m.name).toBe(MODE_NAMES[agent][m.id]);
			}
		expect(resolveLevel("claude-code", "supervised").mode?.name).toBe("Manual");
		expect(resolveLevel("codex", "auto").mode?.name).toBe("Auto review");
	});

	it("prefer the name a probe offered", () => {
		expect(modeName("codex", "agent", [{ id: "agent", name: "Agent" }])).toBe("Agent");
		expect(levelOfAgentMode("claude-code", "acceptEdits")).toBe("auto-edits");
		expect(levelOfAgentMode("codex", "nope")).toBeNull();
	});

	it("give the opencode overlay the user's deny rules back", () => {
		const patch = resolveLevel("opencode", "full-access").configPatch?.({
			permission: { bash: { "rm *": "deny" } },
		});
		expect(patch).toMatchObject({
			permission: { bash: { "*": "allow" } },
			agent: { build: { permission: { bash: { "*": "allow", "rm *": "deny" } } } },
		});
	});
});

describe("registry facts", () => {
	it("keep today's rulings: Claude loads user, project and local settings, no plan-mode tools", () => {
		expect(AGENT_REGISTRY["claude-code"].sessionMeta?.()).toEqual({
			claudeCode: {
				options: {
					settingSources: ["user", "project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
				},
			},
		});
		const opencodeArgs = AGENT_REGISTRY.opencode.acpArgs({ configDir: "c", dataDir: "d", cwd: "w" });
		expect(opencodeArgs).toEqual(["acp"]);
		expect(opencodeArgs).not.toContain("--pure");
	});

	it("appends the brief to Claude's system prompt, and only Claude's (#817)", () => {
		expect(AGENT_REGISTRY["claude-code"].systemPromptVia).toBe("claude-meta");
		for (const id of AGENT_IDS.filter((a) => a !== "claude-code"))
			expect(AGENT_REGISTRY[id].systemPromptVia, id).toBeUndefined();
	});

	it("starts Gemini with --acp alone and forces no folder trust (#848)", () => {
		const env = { configDir: "c", dataDir: "d", cwd: "w" };
		expect(AGENT_REGISTRY.gemini.acpArgs(env)).toEqual(["--acp"]);
		expect(AGENT_REGISTRY.gemini.acpEnv(env)).toEqual({});
	});

	it("hands deepagents the gateway by --mcp-config, and nothing without one (#848)", () => {
		const row = AGENT_REGISTRY.deepagents;
		const env = { configDir: "/run/config", dataDir: "d", cwd: "w" };
		expect(row.gatewayDelivery).toBe("mcp-config-file");
		expect(row.acpArgs(env)).toEqual(["--acp"]);
		expect(row.configFiles?.(env)).toEqual({});
		const gateway = { url: "http://127.0.0.1:9/mcp", token: "tok", name: "prismalens-x" };
		expect(row.acpArgs({ ...env, gateway })).toEqual([
			"--acp",
			"--mcp-config",
			`/run/config/${GATEWAY_RUN_FILE}`,
		]);
		expect(row.acpArgs({ ...env, configDir: "C:\\run\\config", gateway }).at(-1)).toBe(
			`C:\\run\\config\\${GATEWAY_RUN_FILE}`,
		);
		expect(AGENT_IDS.filter((a) => AGENT_REGISTRY[a].gatewayDelivery)).toEqual(["deepagents"]);
	});

	it("keeps userSetup a setting with more than one value", () => {
		expect(USER_SETUPS.length).toBeGreaterThan(1);
		expect(USER_SETUPS).toContain("inherit");
	});

	it("lists the env names the host sets itself", () => {
		expect(reservedEnvNames("codex").sort()).toEqual(["CODEX_HOME", "CODEX_PATH", "DEFAULT_AUTH_REQUEST"]);
	});

	it("allows plain http only on loopback", () => {
		expect(isSafeGatewayUrl("https://gw.example")).toBe(true);
		expect(isSafeGatewayUrl("http://127.0.0.1:4000")).toBe(true);
		expect(isSafeGatewayUrl("http://[::1]:4000")).toBe(true);
		expect(isSafeGatewayUrl("http://gw.example")).toBe(false);
	});

	it("imports no node: module, so the registry is safe for the browser", () => {
		const dir = join(import.meta.dirname, "registry");
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")))
			expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/from "node:/);
	});
});
