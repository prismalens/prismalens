// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import { isolatedSession, runIsolationRow } from "./acp-isolation.js";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const row = {
	row: "probe-runs-no-user-code",
	run: { isolation: "probe" },
	markers: { "claude-code": ["user-hook"] },
} as unknown as Row;

describe("the isolation rows (#1180 R1)", () => {
	it("refuses to seed markers into a config folder outside the temp folder, and writes nothing there", async () => {
		// Inside the package, so outside the OS temp folder on every platform.
		const real = mkdtempSync(join(ENGINE, ".iso-real-"));
		dirs.push(real);
		await expect(runIsolationRow(row, "claude-code", { CLAUDE_CONFIG_DIR: real })).rejects.toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not under the temp folder; markers go only in a scratch home",
		);
		expect(readdirSync(real)).toEqual([]);
	});

	it("refuses when the agent's config folder is not set at all", async () => {
		await expect(runIsolationRow(row, "claude-code", {})).rejects.toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not set; markers go only in a scratch home",
		);
	});

	it("reports a session that cannot start as a problem, not a pass", async () => {
		const empty = mkdtempSync(join(tmpdir(), "pl-iso-path-"));
		const cwd = mkdtempSync(join(tmpdir(), "pl-iso-ws-"));
		dirs.push(empty, cwd);
		const problem = await isolatedSession(
			"opencode",
			{ PATH: empty, XDG_CONFIG_HOME: join(empty, "config") },
			cwd,
			"own",
			false,
		);
		expect(problem).toMatch(/^the own session failed: /);
	});
});
