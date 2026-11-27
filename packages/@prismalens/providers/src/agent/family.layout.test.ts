// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { agents } from "../index.ts";
import type { ConfigLayout, LayoutPath } from "./family.ts";

const pathsOf = (l: ConfigLayout): LayoutPath[] => [
	...l.instructions,
	...l.skills,
	...l.mcp,
	...l.hooks,
	...l.plugins,
];

describe("configLayout (#1180 §3.1)", () => {
	it("Claude Code, Codex, OpenCode and Gemini CLI carry a layout, and no other agent claims one", () => {
		expect(
			agents()
				.filter((a) => a.facts.configLayout)
				.map((a) => a.launch)
				.sort(),
		).toEqual(["claude-code", "codex", "gemini", "opencode"]);
	});

	it("every path starts at ~, an env var with a fallback, <repo> or <ancestors>, and a repo token only on repo scope", () => {
		const bad = agents().flatMap((a) =>
			a.facts.configLayout
				? pathsOf(a.facts.configLayout)
						.filter(
							(p) =>
								!/^(~\/|\{\$[A-Z0-9_]+\|~[^}]*\}\/|<repo>\/|<ancestors>\/)/.test(
									p.path,
								) ||
								(/<repo>|<ancestors>/.test(p.path) && p.scope !== "repo"),
						)
						.map((p) => `${a.launch}: ${p.path}`)
				: [],
		);
		expect(bad).toEqual([]);
	});

	it("OpenCode reads Claude's CLAUDE.md only where no AGENTS.md sits", () => {
		const opencode = agents().find((a) => a.launch === "opencode");
		expect(
			opencode?.facts.configLayout?.instructions.filter((i) => i.via),
		).toEqual([
			{
				path: "~/.claude/CLAUDE.md",
				scope: "global",
				via: "claude-code",
				onlyIfMissing: "{$XDG_CONFIG_HOME|~/.config}/opencode/AGENTS.md",
			},
			{
				path: "<ancestors>/CLAUDE.md",
				scope: "repo",
				via: "claude-code",
				onlyIfMissing: "<ancestors>/AGENTS.md",
			},
		]);
	});
});
