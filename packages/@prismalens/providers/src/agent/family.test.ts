// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { agents, providers } from "../index.ts";
import { installCommand, modeNamed, noModeLines, offers } from "./family.ts";

const LEVELS = ["supervised", "auto-edits", "auto", "full-access"] as const;

describe("agent family helpers", () => {
	it("installCommand names the npm package, or the uv CLI with its extras", () => {
		expect(installCommand({ npm: "opencode-ai" })).toBe("npm i -g opencode-ai");
		expect(installCommand({ uv: ["deepagents-code", "deepagents-acp"] })).toBe(
			'uv tool install -U deepagents-code --with "deepagents-acp"',
		);
	});

	it("modeNamed reads the agent's own name for a mode, else the fallback; offers says whether it was listed", () => {
		const checked = { modes: [{ id: "auto", name: "Auto mode" }] };
		expect(modeNamed(checked, "auto", "Auto")).toBe("Auto mode");
		expect(modeNamed(checked, "plan", "Plan")).toBe("Plan");
		expect(modeNamed(null, "auto", "Auto")).toBe("Auto");
		expect(offers(checked, "auto")).toBe(true);
		expect(offers(checked, "plan")).toBe(false);
		expect(offers(null, "auto")).toBe(false);
	});

	it("noModeLines gives every level the same line", () => {
		const lines = noModeLines("Local agent");
		expect(LEVELS.map((l) => lines[l](null))).toEqual(
			LEVELS.map(() => "Local agent has no modes; PrismaLens answers its asks by this level."),
		);
	});
});

describe("built-in agents", () => {
	it("list the thirteen shipped agents in their declared order and resolve by id", () => {
		expect(agents().map((a) => a.id)).toEqual([
			"agent.opencode",
			"agent.claude-code",
			"agent.codex",
			"agent.gemini",
			"agent.cursor",
			"agent.antigravity",
			"agent.copilot",
			"agent.kiro",
			"agent.grok",
			"agent.qwen",
			"agent.goose",
			"agent.deepagents",
			"agent.local",
		]);
		expect(providers.resolve("agent.claude-code")).toMatchObject({ ok: true, provider: { launch: "claude-code" } });
	});

	it("are each named after the launch row they run", () => {
		expect(agents().map((a) => a.id)).toEqual(agents().map((a) => `agent.${a.launch}`));
	});

	it("Claude Code's full-access line follows whether the check listed Bypass Permissions", () => {
		const line = providers.resolve("agent.claude-code");
		if (!line.ok) throw new Error(line.reason);
		const full = (line.provider as ReturnType<typeof agents>[number]).facts.lines["full-access"];
		expect(full(null)).toBe("Claude Code runs in Bypass Permissions, or Accept Edits where your settings turn it off.");
		expect(full({ modes: [{ id: "acceptEdits", name: "Accept Edits" }] })).toBe(
			"Claude Code runs in Accept Edits: your settings turn Bypass Permissions off.",
		);
	});
});
