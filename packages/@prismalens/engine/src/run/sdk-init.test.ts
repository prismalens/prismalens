// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { initItems, initOf } from "./sdk-init.js";

describe("Claude Code's init as What loads rows (#1180 §3.1)", () => {
	const init = {
		type: "system",
		subtype: "init",
		mcp_servers: [
			{ name: "docs", status: "connected", source: "user" },
			{ name: "db", status: "failed", source: "project" },
			{ name: "prismalens", status: "connected", source: "sdk" },
		],
		skills: ["triage"],
		plugins: [{ name: "lint", path: "/p/lint" }],
	};

	it("reads the init from an _claude/sdkMessage notification and nothing else", () => {
		expect(initOf({ message: init })).toBe(init);
		expect(initOf({ message: { type: "assistant" } })).toBeNull();
		expect(initOf({ message: { type: "system", subtype: "compact_boundary" } })).toBeNull();
	});

	it("maps each server's source to a scope and status to a state, skills and plugins as loaded", () => {
		expect(initItems(init).map((i) => [i.kind, i.name, i.scope, i.state, i.path])).toEqual([
			["mcp", "docs", "global", "loads", null],
			["mcp", "db", "repo", "failed", null],
			["mcp", "prismalens", "prismalens", "loads", null],
			["skill", "triage", "global", "loads", null],
			["plugin", "lint", "plugin", "loads", "/p/lint"],
		]);
	});
});
